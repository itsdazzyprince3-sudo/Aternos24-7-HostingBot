'use strict';

const { GoalBlock, GoalFollow, GoalNear } = require('mineflayer-pathfinder').goals;
const { Vec3 } = require('vec3');
const { moveTo, withTimeout } = require('./ai-utils');
const {
  ANIMALS,
  COOKED_FOOD,
  FOOD_NAMES,
  HOSTILE_MOBS,
  LOG_NAMES,
  PLANK_NAMES,
  RAW_TO_COOKED,
  TOOL_TIER,
  bestPickaxe,
  canonicalItem,
  formatInventory,
  formatPosition,
  formatTime,
  inventoryFromList,
  isFood,
  isLog,
  isPlank,
  plankForLog,
  total
} = require('./ai-brain');

const MAX_ACTIONS_PER_TASK = 160;
const MAX_RECIPE_DEPTH = 7;
const DEFAULT_MINING_DISTANCE = 32;
const LOOP_DELAY_MS = 120;

class TaskAbortedError extends Error {
  constructor() {
    super('Task stopped.');
    this.name = 'TaskAbortedError';
  }
}

class AISkills {
  constructor({ agent, getBot, memory, config = {}, onProgress = () => {}, runId = null }) {
    this.agent = agent;
    this.getBot = getBot;
    this.memory = memory;
    this.config = config;
    this.onProgress = onProgress;
    this.runId = runId;
    this.actionCount = 0;
    this.lastProgressAt = 0;
    this.lastProgressText = '';
  }

  get bot() {
    return this.getBot();
  }

  isAborted() {
    if (this.runId !== null && this.agent && this.agent.runId !== this.runId) return true;
    return false;
  }

  assertActive() {
    if (this.isAborted()) throw new TaskAbortedError();
    const bot = this.bot;
    if (!bot) throw new Error('Minecraft bot is not connected.');
    return bot;
  }

  async wait(milliseconds) {
    const end = Date.now() + Math.max(0, milliseconds);
    while (Date.now() < end) {
      this.assertActive();
      await new Promise(resolve => setTimeout(resolve, Math.min(200, end - Date.now())));
    }
  }

  async goto(goal, options = {}) {
    const bot = this.assertActive();
    const retries = Math.max(0, Math.min(1, Number(options.retries ?? 1)));
    const moveOptions = { ...options };
    delete moveOptions.retries;
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const result = await moveTo(bot, goal, moveOptions);
        this.assertActive();
        return result;
      } catch (error) {
        lastError = error;
        this.assertActive();
        if (attempt >= retries) break;
        this.progress('Path blocked; retrying the route once.', { force: true });
        await this.wait(250);
      }
    }
    throw lastError;
  }

  async action(callback) {
    this.actionCount += 1;
    if (this.actionCount > MAX_ACTIONS_PER_TASK) {
      throw new Error(`Stopped after ${MAX_ACTIONS_PER_TASK} actions to keep the task bounded.`);
    }
    this.assertActive();
    return callback();
  }

  progress(message, { force = false } = {}) {
    if (typeof message !== 'string' || !message.trim()) return;
    const now = Date.now();
    if (!force && now - this.lastProgressAt < 5000) return;
    if (!force && message === this.lastProgressText) return;
    this.lastProgressAt = now;
    this.lastProgressText = message;
    try {
      this.onProgress(message.trim().slice(0, 180));
    } catch {
      // Chat progress must never interrupt the task.
    }
  }

  inventory() {
    const bot = this.assertActive();
    const counts = {};
    for (const item of bot.inventory.items()) {
      counts[item.name] = (counts[item.name] || 0) + item.count;
    }
    return counts;
  }

  countItem(name) {
    const inventory = this.inventory();
    const normalized = canonicalItem(name);
    if (normalized === 'bed') return Object.entries(inventory)
      .filter(([item, count]) => count > 0 && item.endsWith('_bed'))
      .reduce((sum, [, count]) => sum + count, 0);
    if (isLog(normalized)) return total(inventory, [...LOG_NAMES]);
    if (isPlank(normalized)) return total(inventory, [...PLANK_NAMES]);
    if (normalized === 'food') return Object.entries(inventory)
      .filter(([item, count]) => count > 0 && FOOD_NAMES.has(item))
      .reduce((sum, [, count]) => sum + count, 0);
    if (normalized === 'pickaxe') {
      return Object.entries(inventory)
        .filter(([item, count]) => count > 0 && item.endsWith('_pickaxe'))
        .reduce((sum, [, count]) => sum + count, 0);
    }
    if (normalized === 'sword') {
      return Object.entries(inventory)
        .filter(([item, count]) => count > 0 && item.endsWith('_sword'))
        .reduce((sum, [, count]) => sum + count, 0);
    }
    return inventory[normalized] || 0;
  }

  hasItem(name, count = 1) {
    return this.countItem(name) >= count;
  }

  findInventoryItem(name) {
    const bot = this.assertActive();
    const normalized = canonicalItem(name);
    return bot.inventory.items().find(item => {
      if (item.name === normalized) return true;
      if (normalized === 'bed') return item.name.endsWith('_bed');
      if (isLog(normalized)) return isLog(item.name);
      if (isPlank(normalized)) return isPlank(item.name);
      if (normalized === 'food') return FOOD_NAMES.has(item.name);
      if (normalized === 'pickaxe') return item.name.endsWith('_pickaxe');
      if (normalized === 'sword') return item.name.endsWith('_sword');
      return false;
    }) || null;
  }

  async equipItem(name) {
    const bot = this.assertActive();
    const item = this.findInventoryItem(name);
    if (!item) throw new Error(`No ${name.replace(/_/g, ' ')} in my inventory.`);
    if (bot.heldItem?.name === item.name) return item;
    await bot.equip(item, 'hand');
    return item;
  }

  armorTier(name) {
    const match = String(name || '').match(/^(leather|chainmail|golden|iron|turtle|diamond|netherite)_(?:helmet|chestplate|leggings|boots)$/);
    if (!match) return 0;
    return { leather: 1, chainmail: 2, golden: 2, iron: 3, turtle: 3, diamond: 4, netherite: 5 }[match[1]] || 0;
  }

  async equipBestArmor() {
    const bot = this.assertActive();
    const slots = [
      { key: 'boots', equipmentIndex: 2, slot: 'feet' },
      { key: 'leggings', equipmentIndex: 3, slot: 'legs' },
      { key: 'chestplate', equipmentIndex: 4, slot: 'torso' },
      { key: 'helmet', equipmentIndex: 5, slot: 'head' }
    ];
    const equipped = [];
    for (const entry of slots) {
      const current = bot.entity?.equipment?.[entry.equipmentIndex];
      const candidates = bot.inventory.items()
        .filter(item => item.name.endsWith(`_${entry.key === 'leggings' ? 'leggings' : entry.key === 'chestplate' ? 'chestplate' : entry.key === 'helmet' ? 'helmet' : 'boots'}`))
        .sort((left, right) => this.armorTier(right.name) - this.armorTier(left.name));
      const best = candidates[0];
      if (best && this.armorTier(best.name) > this.armorTier(current?.name)) {
        await bot.equip(best, entry.slot);
        equipped.push(best.name);
      }
    }
    return equipped;
  }

  async equipBestSword() {
    const bot = this.assertActive();
    const sword = bot.inventory.items()
      .filter(item => item.name.endsWith('_sword'))
      .sort((left, right) => this.toolTier(right.name) - this.toolTier(left.name))[0];
    if (sword) await this.equipItem(sword.name);
    return sword || null;
  }

  toolTier(name) {
    if (name.endsWith('_pickaxe')) return TOOL_TIER[name] || 0;
    if (name.endsWith('_sword')) {
      return { wooden_sword: 1, stone_sword: 2, golden_sword: 1, iron_sword: 3, diamond_sword: 4, netherite_sword: 5 }[name] || 0;
    }
    if (name.endsWith('_axe')) {
      return { wooden_axe: 1, stone_axe: 2, golden_axe: 1, iron_axe: 3, diamond_axe: 4, netherite_axe: 5 }[name] || 0;
    }
    return 0;
  }

  observation() {
    const bot = this.assertActive();
    const inventory = this.inventory();
    const position = bot.entity?.position || new Vec3(0, 0, 0);
    const nearbyBlocks = [];
    try {
      const positions = bot.findBlocks({
        matching: block => block?.name && block.name !== 'air' && block.name !== 'cave_air',
        maxDistance: 16,
        count: 80
      });
      const counts = new Map();
      for (const blockPosition of positions) {
        const block = bot.blockAt(blockPosition);
        if (!block) continue;
        const distance = Math.round(position.distanceTo(block.position));
        const key = block.name;
        if (counts.has(key)) continue;
        const entry = { name: key, distance, position: { x: Math.floor(block.position.x), y: Math.floor(block.position.y), z: Math.floor(block.position.z) } };
        counts.set(key, entry);
        nearbyBlocks.push(entry);
      }
    } catch {
      // Block scanning is best effort.
    }
    const entities = Object.values(bot.entities || {}).filter(entity => entity?.position && entity !== bot.entity);
    const nearbyHostiles = entities
      .filter(entity => entity.type === 'mob' && HOSTILE_MOBS.has(entity.name) && position.distanceTo(entity.position) <= 20)
      .map(entity => ({
        name: entity.name,
        distance: Math.round(position.distanceTo(entity.position)),
        position: {
          x: Math.floor(entity.position.x),
          y: Math.floor(entity.position.y),
          z: Math.floor(entity.position.z)
        }
      }))
      .sort((left, right) => left.distance - right.distance);
    const players = {};
    for (const [name, player] of Object.entries(bot.players || {})) {
      if (!player?.entity || name === bot.username) continue;
      players[name] = {
        username: name,
        distance: Math.round(position.distanceTo(player.entity.position)),
        position: {
          x: Math.floor(player.entity.position.x),
          y: Math.floor(player.entity.position.y),
          z: Math.floor(player.entity.position.z)
        }
      };
    }
    const nearbyEntities = entities
      .filter(entity => position.distanceTo(entity.position) <= 20)
      .map(entity => ({
        name: entity.username || entity.name || entity.type || 'unknown',
        kind: entity.type || 'unknown',
        distance: Math.round(position.distanceTo(entity.position)),
        position: {
          x: Math.floor(entity.position.x),
          y: Math.floor(entity.position.y),
          z: Math.floor(entity.position.z)
        }
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 20);
    const equipment = bot.entity?.equipment || [];
    const armor = { boots: equipment[2]?.name || null, leggings: equipment[3]?.name || null, chestplate: equipment[4]?.name || null, helmet: equipment[5]?.name || null };
    const hazards = nearbyBlocks.filter(block => /^(?:lava|fire|soul_fire|magma_block|campfire|soul_campfire)$/.test(block.name)).sort((a, b) => a.distance - b.distance).slice(0, 8);
    let nearbyBedAvailable = false;
    try {
      nearbyBedAvailable = Boolean(bot.findBlock?.({
        matching: block => block?.name?.endsWith('_bed'),
        maxDistance: 16
      }));
    } catch {
      // Bed discovery is best effort and limited to loaded nearby blocks.
    }
    return {
      position: { x: position.x, y: position.y, z: position.z },
      dimension: bot.game?.dimension || null,
      weather: { raining: Boolean(bot.isRaining), thunder: Number(bot.thunderState) > 0 },
      armor, hazards,
      recentEvents: Array.isArray(bot.aiRecentEvents) ? bot.aiRecentEvents.slice(-8) : [],
      health: bot.health,
      food: bot.food,
      oxygen: bot.oxygenLevel,
      time: {
        timeOfDay: bot.time?.timeOfDay,
        day: bot.time?.day,
        isDay: bot.time?.isDay
      },
      inventory,
      inventoryList: bot.inventory.items().map(item => ({ name: item.name, count: item.count })),
      nearbyBlocks,
      nearbyHostiles,
      nearbyBedAvailable,
      shelter: Boolean(this.memory?.getFact?.('shelter')),
      nearbyEntities,
      players,
      heldItem: bot.heldItem?.name || null,
      deathRecoveryAvailable: Boolean(this.agent?.hasDeathRecovery?.())
    };
  }

  playerEntity(name) {
    const bot = this.assertActive();
    if (!name || name === 'requester') {
      const requester = this.agent?.requestedBy;
      if (!requester) return null;
      name = requester;
    }
    const player = Object.entries(bot.players || {}).find(([username]) =>
      username.toLowerCase() === String(name).toLowerCase())?.[1];
    return player?.entity || null;
  }

  async comeToPlayer(name = 'requester') {
    const bot = this.assertActive();
    const targetName = name === 'requester' ? this.agent?.requestedBy : name;
    if (!targetName) throw new Error('I do not know which player to come to.');
    const entity = this.playerEntity(targetName);
    if (!entity) throw new Error(`${targetName} is not visible to me right now.`);
    const distance = bot.entity.position.distanceTo(entity.position);
    if (distance > 64) throw new Error(`${targetName} is ${Math.round(distance)} blocks away; I can only come within 64 blocks.`);
    this.progress(`Coming to ${targetName}...`, { force: true });
    await this.goto(new GoalNear(entity.position.x, entity.position.y, entity.position.z, 2));
    const after = this.playerEntity(targetName);
    if (!after || bot.entity.position.distanceTo(after.position) > 4) {
      throw new Error(`I reached the area but ${targetName} moved away.`);
    }
    return { message: `I am next to you, ${targetName}.`, player: targetName };
  }

  async followPlayer(name = 'requester', durationMs = 60000) {
    const bot = this.assertActive();
    const targetName = name === 'requester' ? this.agent?.requestedBy : name;
    if (!targetName) throw new Error('I do not know which player to follow.');
    const entity = this.playerEntity(targetName);
    if (!entity) throw new Error(`${targetName} is not visible to me right now.`);
    this.progress(`Following ${targetName}. Say !ai stop to end it.`, { force: true });
    bot.pathfinder.setGoal(new GoalFollow(entity, 2), true);
    const end = Date.now() + Math.max(5000, Math.min(durationMs || 60000, 300000));
    try {
      while (Date.now() < end) {
        this.assertActive();
        const current = this.playerEntity(targetName);
        if (!current) break;
        const distance = bot.entity.position.distanceTo(current.position);
        if (distance > 4 && !bot.pathfinder.isMoving()) {
          bot.pathfinder.setGoal(new GoalFollow(current, 2), true);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } finally {
      bot.pathfinder.stop();
    }
    return { message: `Finished following ${targetName}.` };
  }

  async stay() {
    const bot = this.assertActive();
    bot.pathfinder.stop();
    bot.clearControlStates?.();
    return { message: 'Holding position.' };
  }

  async explore(radius = 24) {
    const bot = this.assertActive();
    const origin = bot.entity.position.clone();
    const boundedRadius = Math.max(8, Math.min(Number(radius) || 24, 64));
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.max(6, boundedRadius * (0.5 + Math.random() * 0.5));
      const target = new Vec3(
        Math.floor(origin.x + Math.cos(angle) * distance),
        Math.floor(origin.y),
        Math.floor(origin.z + Math.sin(angle) * distance)
      );
      try {
        await this.goto(new GoalNear(target.x, target.y, target.z, 3));
        const position = bot.entity.position;
        if (position.distanceTo(origin) > 3) {
          const name = `scout-${Math.floor(position.x)}-${Math.floor(position.z)}`;
          this.memory?.addWaypoint?.(name, position, { kind: 'scout' });
          return {
            exploredTo: [Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)],
            message: `Scouted to ${formatPosition({ position })}.`
          };
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`I could not find a safe route to explore${lastError ? `: ${lastError.message}` : '.'}`);
  }

  async ensureCraftingTable() {
    const bot = this.assertActive();
    let tableBlock = bot.findBlock({
      matching: block => block.name === 'crafting_table',
      maxDistance: 8
    });
    if (tableBlock) return tableBlock;

    await this.ensureItem('crafting_table', 1, 0, { skipTable: true });
    const tableItem = this.findInventoryItem('crafting_table');
    if (!tableItem) throw new Error('I could not craft a crafting table.');
    await this.equipItem('crafting_table');

    const base = bot.entity.position.floored();
    for (let radius = 1; radius <= 3; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const support = bot.blockAt(base.offset(dx, -1, dz));
          const target = bot.blockAt(base.offset(dx, 0, dz));
          if (!support || support.boundingBox !== 'block' || !target || target.name !== 'air') continue;
          if (Math.abs(support.position.x + 0.5 - bot.entity.position.x) < 0.9 &&
            Math.abs(support.position.z + 0.5 - bot.entity.position.z) < 0.9) continue;
          try {
            await this.equipItem('crafting_table');
            await withTimeout(bot.placeBlock(support, new Vec3(0, 1, 0)), 8000, 'Placing a block');
            await this.wait(250);
            const placed = bot.blockAt(support.position.offset(0, 1, 0));
            if (placed?.name === 'crafting_table') return placed;
          } catch {
            // Try the next spot.
          }
        }
      }
    }
    throw new Error('I could not find a clear spot for the crafting table.');
  }

  async ensureItem(name, count = 1, depth = 0, { skipTable = false } = {}) {
    const bot = this.assertActive();
    const requested = canonicalItem(name);
    const amount = Math.max(1, Math.min(Number(count) || 1, 256));
    if (depth > MAX_RECIPE_DEPTH) throw new Error(`Recipe for ${requested} is too deep.`);
    if (await this.isSatisfied(requested, amount)) return { item: requested, count: this.countItem(requested) };

    if (isLog(requested)) {
      await this.gatherWood(Math.max(amount, 8));
      return { item: requested, count: this.countItem(requested) };
    }
    if (isPlank(requested)) {
      return this.ensurePlanks(amount, depth);
    }
    if (requested === 'food') {
      await this.gatherFood(amount);
      return { item: requested, count: this.countItem(requested) };
    }
    if (requested === 'cobblestone' || requested === 'stone') {
      await this.mine('stone', amount);
      return { item: requested, count: this.countItem(requested) };
    }
    if (requested === 'coal') {
      if (this.countItem('coal') + this.countItem('charcoal') >= amount) {
        return { item: requested, count: this.countItem('coal') + this.countItem('charcoal') };
      }
      await this.mine('coal_ore', amount);
      if (this.countItem('coal') + this.countItem('charcoal') < amount) {
        try {
          await this.smelt('charcoal', amount - this.countItem('coal') - this.countItem('charcoal'));
        } catch {
          // Coal ore is the primary source.
        }
      }
      return { item: requested, count: this.countItem('coal') + this.countItem('charcoal') };
    }
    if (requested === 'iron_ingot') {
      if (this.countItem('iron_ingot') >= amount) return { item: requested, count: this.countItem('iron_ingot') };
      const raw = this.countItem('raw_iron') + this.countItem('iron_ore');
      if (raw < amount) await this.mine('iron_ore', Math.max(amount - raw, 1));
      const available = this.countItem('raw_iron') + this.countItem('iron_ore');
      if (available > 0) await this.smelt('iron_ingot', Math.min(amount, available));
      return { item: requested, count: this.countItem('iron_ingot') };
    }
    if (requested === 'charcoal') {
      const log = this.findInventoryItem('oak_log');
      if (!log) await this.gatherWood(4);
      await this.smelt('charcoal', amount);
      return { item: requested, count: this.countItem('charcoal') };
    }
    if (requested === 'torch') {
      const coal = this.countItem('coal') + this.countItem('charcoal');
      if (coal < 1) {
        try {
          await this.mine('coal_ore', 1);
        } catch {
          await this.ensureItem('charcoal', 1, depth + 1);
        }
      }
      await this.ensureItem('stick', Math.max(1, Math.ceil(amount / 4)), depth + 1);
      return this.craftRecipe('torch', amount, depth);
    }
    if (requested === 'bed') {
      const beds = this.countItem('bed');
      if (beds >= amount) return { item: requested, count: beds };
      const wool = this.countItem('white_wool');
      if (wool < amount * 3) await this.gatherWool(amount * 3);
      await this.ensureItem('oak_planks', amount * 3, depth + 1);
      return this.craftRecipe('bed', amount, depth);
    }

    return this.craftRecipe(requested, amount, depth, { skipTable });
  }

  async isSatisfied(name, count) {
    if (name.endsWith('_pickaxe')) {
      const best = bestPickaxe(this.inventory());
      return Boolean(best && (TOOL_TIER[best] || 0) >= (TOOL_TIER[name] || 1));
    }
    if (name.endsWith('_sword')) {
      const sword = this.findInventoryItem('sword');
      return Boolean(sword && this.toolTier(sword.name) >= this.toolTier(name));
    }
    if (name.endsWith('_axe')) {
      const axe = this.bot.inventory.items().find(item => item.name.endsWith('_axe'));
      return Boolean(axe && this.toolTier(axe.name) >= this.toolTier(name));
    }
    return this.countItem(name) >= count;
  }

  async ensurePlanks(count, depth) {
    if (this.countItem('oak_planks') >= count) return { item: 'oak_planks', count: this.countItem('oak_planks') };
    const bot = this.assertActive();
    const logType = bot.inventory.items().find(item => isLog(item.name))?.name;
    if (logType) {
      const planksName = plankForLog(logType);
      return this.craftRecipe(planksName, count, depth);
    }
    if (this.countItem('oak_planks') > 0) return { item: 'oak_planks', count: this.countItem('oak_planks') };
    await this.gatherWood(4);
    const newLog = bot.inventory.items().find(item => isLog(item.name))?.name;
    if (!newLog) throw new Error('I could not collect any logs to make planks.');
    return this.craftRecipe(plankForLog(newLog), count, depth);
  }

  async craftRecipe(name, count, depth, { skipTable = false } = {}) {
    const bot = this.assertActive();
    const normalized = canonicalItem(name);
    const item = bot.registry.itemsByName[normalized];
    if (!item) throw new Error(`Unknown item: ${normalized}`);
    const needed = Math.max(1, Number(count) || 1);
    const existing = this.countItem(normalized);
    if (existing >= needed) return { item: normalized, count: existing };

    let table = null;
    if (!skipTable) {
      const recipesNoTable = bot.recipesAll(item.id, null, false);
      if (recipesNoTable.length === 0) table = await this.ensureCraftingTable();
    }
    const recipes = bot.recipesAll(item.id, null, true);
    if (recipes.length === 0) {
      throw new Error(`I do not know a crafting recipe for ${normalized.replace(/_/g, ' ')}.`);
    }

    const craftCount = Math.ceil((needed - existing) / recipes[0].result.count);
    let best = null;
    let bestScore = -Infinity;
    for (const recipe of recipes) {
      if (recipe.requiresTable && !table && !skipTable) {
        // A table may be craftable; score it but do not reject it.
      }
      let score = 0;
      for (const delta of recipe.delta) {
        if (delta.count >= 0) continue;
        const ingredientName = bot.registry.items[delta.id]?.name;
        if (!ingredientName) continue;
        const need = -delta.count * craftCount;
        const have = this.countItem(ingredientName);
        if (have >= need) score += 8;
        else if (have > 0) score += 3;
        else if (this.isGatherable(ingredientName)) score += 2;
        else score += this.craftableScore(ingredientName);
      }
      if (recipe.requiresTable && table) score += 2;
      if (score > bestScore) {
        bestScore = score;
        best = recipe;
      }
    }
    if (!best) throw new Error(`No usable recipe for ${normalized}.`);
    if (best.requiresTable && !table) table = await this.ensureCraftingTable();

    const batches = Math.ceil((needed - existing) / best.result.count);
    for (const delta of best.delta) {
      if (delta.count >= 0) continue;
      const ingredientName = bot.registry.items[delta.id]?.name;
      if (!ingredientName) throw new Error(`Unknown ingredient ID ${delta.id}.`);
      const need = -delta.count * batches;
      if (this.countItem(ingredientName) < need) {
        await this.ensureItem(ingredientName, need, depth + 1);
      }
    }
    const craftable = bot.recipesFor(item.id, null, needed - existing, table)[0];
    if (!craftable) {
      throw new Error(`I have the ingredients but ${normalized.replace(/_/g, ' ')} is not craftable here.`);
    }
    this.progress(`Crafting ${needed - existing} ${normalized.replace(/_/g, ' ')}...`);
    await withTimeout(bot.craft(craftable, batches, best.requiresTable ? table : null), 20000, 'Crafting', () => { try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch {} });
    await this.wait(250);
    return { item: normalized, count: this.countItem(normalized) };
  }

  craftableScore(name) {
    const bot = this.bot;
    const item = bot?.registry?.itemsByName?.[canonicalItem(name)];
    if (!item) return 0;
    const recipes = bot.recipesAll(item.id, null, true);
    return recipes.length ? 1 : 0;
  }

  isGatherable(name) {
    return isLog(name) || isPlank(name) || ['stone', 'cobblestone', 'coal', 'coal_ore', 'iron_ore', 'raw_iron', 'dirt', 'sand', 'gravel', 'food', 'wheat', 'carrot', 'potato', 'white_wool'].includes(name);
  }

  treeBase(bot, position) {
    let base = position.clone();
    for (let depth = 0; depth < 32; depth += 1) {
      const below = bot.blockAt(base.offset(0, -1, 0));
      if (!below || !isLog(below.name)) break;
      base = below.position.clone();
    }
    return base;
  }

  async chopReachableLogs(maximum = 8) {
    const bot = this.assertActive();
    let chopped = 0;
    for (let round = 0; round < Math.max(12, maximum * 2) && chopped < maximum; round += 1) {
      this.assertActive();
      const positions = bot.findBlocks({
        matching: block => isLog(block.name),
        maxDistance: 4.5,
        count: 32
      }).sort((left, right) => {
        const height = left.y - right.y;
        if (height !== 0) return height;
        return bot.entity.position.distanceTo(left) - bot.entity.position.distanceTo(right);
      });
      if (positions.length === 0) break;
      let dugThisRound = false;
      for (const position of positions) {
        const block = bot.blockAt(position);
        if (!block || !isLog(block.name) || !block.diggable) continue;
        if (bot.entity.position.distanceTo(block.position) > 4.6) continue;
        try {
          const axe = bot.inventory.items().find(item => item.name.endsWith('_axe'));
          if (axe) await this.equipItem(axe.name);
          await withTimeout(
            bot.dig(block),
            12000,
            'Chopping a log',
            () => bot.stopDigging?.()
          );
          await this.wait(250);
          chopped += 1;
          dugThisRound = true;
          break;
        } catch (error) {
          if (error instanceof TaskAbortedError) throw error;
          if (error.name === 'TaskAbortedError') throw error;
        }
      }
      if (!dugThisRound) break;
    }
    return chopped;
  }

  async gatherWood(count = 16) {
    const bot = this.assertActive();
    const autonomous = Boolean(this.agent?.isAutonomousTask);
    if (autonomous) count = Math.min(8, Math.max(1, Number(count) || 8));
    const searchDistance = autonomous ? 16 : DEFAULT_MINING_DISTANCE;
    let remaining = Math.max(1, Number(count) || 16);
    let gathered = 0;
    let choppedBlocks = 0;
    let explorations = 0;
    let dryPasses = 0;
    const visited = new Set();
    const startInventory = this.inventory();
    const startLogCount = total(startInventory, [...LOG_NAMES]);
    const requestedCount = remaining;
    this.progress(`Chopping ${remaining} logs...`, { force: true });
    while (remaining > 0 && !this.isInventoryFull()) {
      this.assertActive();
      if ([...LOG_NAMES].every(name => !bot.registry.blocksByName[name])) {
        throw new Error('This server version has no known log blocks.');
      }
      const positions = bot.findBlocks({
        matching: block => isLog(block.name),
        maxDistance: searchDistance,
        count: Math.min(64, remaining + 24)
      }).filter(position => !visited.has(`${position.x},${position.y},${position.z}`));
      if (positions.length === 0) {
        if (explorations >= 3) break;
        explorations += 1;
        this.progress('No trees in reach; scouting for a forest...', { force: true });
        try {
          await this.explore(autonomous ? 16 : 32);
        } catch (error) {
          if (error instanceof TaskAbortedError) throw error;
        }
        continue;
      }
      positions.sort((left, right) => bot.entity.position.distanceTo(left) - bot.entity.position.distanceTo(right));
      let choppedThisPass = 0;
      for (const position of positions) {
        if (remaining <= 0) break;
        if (visited.has(`${position.x},${position.y},${position.z}`)) continue;
        const block = bot.blockAt(position);
        if (!block || !isLog(block.name) || !block.diggable) {
          visited.add(`${position.x},${position.y},${position.z}`);
          continue;
        }
        try {
          const base = this.treeBase(bot, block.position);
          await this.goto(
            new GoalNear(base.x, base.y, base.z, 2),
            { timeoutMs: 12000, label: 'Walking to a tree' }
          );
          const chopped = await this.chopReachableLogs(Math.min(remaining, 12));
          if (chopped > 0) {
            choppedBlocks += chopped;
            const pickupDeadline = Date.now() + 2000;
            let currentLogCount = total(this.inventory(), [...LOG_NAMES]);
            while (currentLogCount <= startLogCount + gathered && Date.now() < pickupDeadline) {
              await this.wait(200);
              currentLogCount = total(this.inventory(), [...LOG_NAMES]);
            }
            gathered = Math.max(0, currentLogCount - startLogCount);
            remaining = Math.max(0, requestedCount - gathered);
            choppedThisPass += chopped;
          } else {
            visited.add(`${position.x},${position.y},${position.z}`);
          }
        } catch (error) {
          if (error instanceof TaskAbortedError) throw error;
          if (error.name === 'TaskAbortedError') throw error;
          visited.add(`${position.x},${position.y},${position.z}`);
        }
        this.progress(`Wood: ${gathered} log(s) in inventory, ${remaining} to go.`);
      }
      if (choppedThisPass === 0) {
        dryPasses += 1;
        if (dryPasses >= 2) break;
        try {
          await this.explore(24);
        } catch (error) {
          if (error instanceof TaskAbortedError) throw error;
        }
      } else {
        dryPasses = 0;
      }
    }
    const gained = this.inventoryGain(startInventory);
    gathered = Math.max(0, total(this.inventory(), [...LOG_NAMES]) - startLogCount);
    if (gathered === 0) {
      const detail = choppedBlocks > 0
        ? `I chopped ${choppedBlocks} log block(s), but no log drops reached my inventory.`
        : 'I could not find reachable logs nearby, even after scouting.';
      throw new Error(detail);
    }
    this.memory?.recordSkill?.('gatherWood', { success: true, durationMs: 0, detail: `${gathered} logs` });
    this.memory?.setFact?.('lastWoodSite', {
      position: { ...bot.entity.position },
      at: new Date().toISOString()
    });
    return { message: `Collected ${gathered} log(s) into inventory. ${this.describeGain(gained)}`, gained };
  }

  async mine(name, count = 8, { maxDistance = DEFAULT_MINING_DISTANCE } = {}) {
    const bot = this.assertActive();
    const requested = canonicalItem(name);
    const blockNames = this.blockNamesForItem(requested);
    if (blockNames.length === 0) throw new Error(`I do not know which block gives ${requested.replace(/_/g, ' ')}.`);
    const blocks = blockNames.map(blockName => bot.registry.blocksByName[blockName]).filter(Boolean);
    if (blocks.length === 0) throw new Error(`This server version does not have ${blockNames.join(', ')}.`);
    const autonomous = Boolean(this.agent?.isAutonomousTask);
    if (autonomous) {
      if (bot.health <= 8) throw new Error('Autonomous mining stopped because health is critical.');
      const hostile = Object.values(bot.entities || {}).some(entity => entity?.type === 'mob' &&
        HOSTILE_MOBS.has(entity.name) && entity.position && bot.entity.position.distanceTo(entity.position) <= 12);
      if (hostile) throw new Error('Autonomous mining paused because a hostile mob is within 12 blocks.');
      maxDistance = Math.min(16, Number(maxDistance) || 16);
      count = Math.min(8, Math.max(1, Number(count) || 8));
    }
    let remaining = Math.max(1, Number(count) || 8);
    const requestedCount = remaining;
    let mined = 0;
    let lastFailure = '';
    let explorations = 0;
    let dryPasses = 0;
    const startInventory = this.inventory();

    if (this.requiresPickaxe(requested)) {
      const pickaxe = bestPickaxe(this.inventory());
      if (!pickaxe) {
        await this.ensureItem('wooden_pickaxe', 1, 0);
      }
    }
    this.progress(`Mining ${remaining} ${requested.replace(/_/g, ' ')}...`, { force: true });
    while (remaining > 0) {
      this.assertActive();
      const positions = bot.findBlocks({
        matching: block => blocks.some(type => type.id === block.type),
        maxDistance,
        count: Math.min(96, remaining + 24)
      });
      if (positions.length === 0) {
        if (explorations >= 2) break;
        explorations += 1;
        this.progress(`No ${requested.replace(/_/g, ' ')} in reach; scouting...`, { force: true });
        try {
          await this.explore(28);
        } catch (error) {
          if (error instanceof TaskAbortedError) throw error;
        }
        continue;
      }
      positions.sort((left, right) => bot.entity.position.distanceTo(left) - bot.entity.position.distanceTo(right));
      let minedThisPass = 0;
      for (const position of positions) {
        if (remaining <= 0) break;
        const block = bot.blockAt(position);
        if (!block || !blocks.some(type => type.id === block.type) || !block.diggable || block.entity) continue;
        if (autonomous && Math.abs(block.position.y - bot.entity.position.y) > 3) continue;
        if (autonomous) {
          const nearbyHazard = bot.findBlocks({
            matching: candidate => /^(?:lava|fire|soul_fire|magma_block|campfire|soul_campfire)$/.test(candidate?.name || ''),
            maxDistance: 4,
            count: 1
          });
          if (nearbyHazard.length) continue;
        }
        try {
          const targetPosition = `${Math.floor(block.position.x)}, ${Math.floor(block.position.y)}, ${Math.floor(block.position.z)}`;
          this.progress(`Walking to ${block.name.replace(/_/g, ' ')} at ${targetPosition}.`, { force: mined === 0 });
          await this.goto(
            new GoalNear(block.position.x, block.position.y, block.position.z, 1),
            { timeoutMs: 12000, label: 'Walking to a block' }
          );
          const current = bot.blockAt(block.position);
          if (!current || !blocks.some(type => type.id === current.type)) {
            lastFailure = 'the target block changed before I reached it';
            continue;
          }
          const tool = bot.pathfinder.bestHarvestTool(current);
          if (tool) await this.equipItem(tool.name);
          await withTimeout(bot.dig(current), 15000, 'Mining a block', () => bot.stopDigging?.());
          await this.wait(350);
          remaining -= 1;
          mined += 1;
          minedThisPass += 1;
          if (this.isInventoryFull()) break;
        } catch (error) {
          if (error instanceof TaskAbortedError) throw error;
          if (error.name === 'TaskAbortedError') throw error;
          lastFailure = String(error?.message || 'pathing or digging failed').slice(0, 160);
          this.progress(`Could not reach or mine that block (${lastFailure}); trying another target.`, { force: true });
        }
      }
      if (minedThisPass === 0) {
        dryPasses += 1;
        if (dryPasses >= 2 || explorations >= 2) break;
        try {
          await this.explore(24);
        } catch (error) {
          if (error instanceof TaskAbortedError) throw error;
        }
      } else {
        dryPasses = 0;
      }
      this.progress(`Mining: ${mined} done, ${remaining} to go.`);
      if (this.isInventoryFull()) break;
    }
    const gained = this.inventoryGain(startInventory);
    if (mined === 0) {
      const hint = requested === 'iron_ingot' || requested === 'iron_ore'
        ? ' I only see surface blocks; I need to explore a cave or dig a staircase for iron.'
        : '';
      const failure = lastFailure ? ` Last attempt: ${lastFailure}.` : '';
      throw new Error(`I could not find reachable ${blockNames.join(' or ')} within ${maxDistance} blocks.${hint}${failure}`);
    }
    this.memory?.recordSkill?.('mine', {
      success: remaining === 0,
      durationMs: 0,
      detail: `${mined}/${requestedCount} ${requested}${remaining > 0 ? `; ${lastFailure || 'no reachable targets remain'}` : ''}`
    });
    this.memory?.setFact?.(`lastMined:${requested}`, {
      position: { ...bot.entity.position },
      at: new Date().toISOString()
    });
    const partialReason = this.isInventoryFull()
      ? 'my inventory is full'
      : lastFailure || 'no more reachable targets were found';
    const completion = remaining > 0
      ? `Mined ${mined}/${requestedCount} ${requested.replace(/_/g, ' ')}; stopped early because ${partialReason}.`
      : `Mined ${mined} ${requested.replace(/_/g, ' ')}.`;
    this.progress(completion, { force: true });
    return { message: `${completion} ${this.describeGain(gained)}`, gained, mined, requested: requestedCount, partial: remaining > 0 };
  }

  blockNamesForItem(item) {
    if (isLog(item)) return [...LOG_NAMES];
    switch (item) {
      case 'stone':
      case 'cobblestone': return ['stone'];
      case 'coal':
      case 'coal_ore': return ['coal_ore', 'deepslate_coal_ore'];
      case 'iron_ore':
      case 'raw_iron':
      case 'iron_ingot': return ['iron_ore', 'deepslate_iron_ore'];
      case 'gold_ore':
      case 'raw_gold':
      case 'gold_ingot': return ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'];
      case 'diamond':
      case 'diamond_ore': return ['diamond_ore', 'deepslate_diamond_ore'];
      case 'copper_ore':
      case 'copper_ingot': return ['copper_ore', 'deepslate_copper_ore'];
      case 'redstone':
      case 'redstone_ore': return ['redstone_ore', 'deepslate_redstone_ore'];
      case 'lapis_lazuli':
      case 'lapis_ore': return ['lapis_ore', 'deepslate_lapis_ore'];
      case 'emerald':
      case 'emerald_ore': return ['emerald_ore', 'deepslate_emerald_ore'];
      case 'dirt': return ['dirt', 'grass_block'];
      case 'sand': return ['sand'];
      case 'gravel': return ['gravel'];
      case 'wheat': return ['wheat'];
      case 'carrot': return ['carrots'];
      case 'potato': return ['potatoes'];
      case 'white_wool': return [];
      default: return [];
    }
  }

  requiresPickaxe(item) {
    return !isLog(item) && !['dirt', 'sand', 'gravel', 'food', 'wheat', 'carrot', 'potato', 'white_wool'].includes(item);
  }

  isInventoryFull() {
    const bot = this.bot;
    if (!bot?.inventory) return false;
    const items = bot.inventory.items();
    if (items.length < 36) return false;
    return items.every(item => item.count >= 64);
  }

  inventoryGain(before) {
    const after = this.inventory();
    const gained = {};
    for (const [name, count] of Object.entries(after)) {
      const delta = count - (before[name] || 0);
      if (delta > 0) gained[name] = delta;
    }
    return gained;
  }

  describeGain(gained) {
    const text = formatInventory(gained, 6);
    return text === 'empty' ? 'No drops were collected.' : `Collected ${text}.`;
  }

  async gatherFood(count = 8) {
    const bot = this.assertActive();
    if (this.hasItem('food') && Number(bot.food) <= 6) {
      const eaten = await this.eat();
      if (eaten) return eaten;
    }
    let hunted = 0;
    const animals = Object.values(bot.entities || {})
      .filter(entity => ANIMALS.has(entity.name) && entity.position &&
        bot.entity.position.distanceTo(entity.position) <= 32)
      .sort((left, right) =>
        bot.entity.position.distanceTo(left.position) - bot.entity.position.distanceTo(right.position));
    if (animals.length) {
      this.progress(`Hunting ${Math.min(animals.length, count)} animals...`, { force: true });
      for (const animal of animals.slice(0, count)) {
        if (hunted >= count) break;
        try {
          await this.attackEntity(animal, { maxDistance: 32 });
          hunted += 1;
        } catch (error) {
          if (error instanceof TaskAbortedError) throw error;
        }
      }
      if (hunted > 0) {
        await this.wait(800);
        this.progress(`Hunted ${hunted} animal(s).`, { force: true });
        return { message: `Hunted ${hunted} animal(s).` };
      }
    }
    const harvested = await this.harvestCrops();
    if (harvested > 0) return { message: `Harvested ${harvested} crop(s).` };
    throw new Error('I could not find animals or mature crops nearby.');
  }

  async gatherWool(count = 3) {
    const bot = this.assertActive();
    const sheep = Object.values(bot.entities || {})
      .filter(entity => entity.name === 'sheep' && entity.position &&
        bot.entity.position.distanceTo(entity.position) <= 32)
      .sort((left, right) =>
        bot.entity.position.distanceTo(left.position) - bot.entity.position.distanceTo(right.position));
    let killed = 0;
    for (const entity of sheep.slice(0, Math.max(2, count))) {
      if (this.countItem('white_wool') >= count) break;
      try {
        await this.attackEntity(entity, { maxDistance: 32 });
        killed += 1;
        await this.wait(500);
      } catch (error) {
        if (error instanceof TaskAbortedError) throw error;
      }
    }
    if (this.countItem('white_wool') < count) {
      throw new Error(`I only collected ${this.countItem('white_wool')} wool.`);
    }
    return { message: `Collected ${this.countItem('white_wool')} wool from ${killed} sheep.` };
  }

  async attackNearest(target = null) {
    const bot = this.assertActive();
    const normalized = target ? canonicalItem(target) : null;
    const candidates = Object.values(bot.entities || {})
      .filter(entity => entity?.type === 'mob' && entity?.position && entity !== bot.entity && HOSTILE_MOBS.has(entity.name))
      .filter(entity => !normalized || entity.name === normalized || entity.name.includes(normalized))
      .sort((left, right) =>
        bot.entity.position.distanceTo(left.position) - bot.entity.position.distanceTo(right.position));
    if (candidates.length === 0) return { message: 'No hostile mobs nearby.' };
    const targetEntity = candidates[0];
    await this.attackEntity(targetEntity, { maxDistance: 24 });
    return { message: `Fought a ${targetEntity.name}.` };
  }

  async defend() {
    return this.attackNearest();
  }

  async attackEntity(entity, { maxDistance = 16 } = {}) {
    const bot = this.assertActive();
    if (!entity || entity.type !== 'mob' || !entity.position ||
      (!HOSTILE_MOBS.has(entity.name) && !ANIMALS.has(entity.name))) {
      throw new Error('I can only attack a visible hostile mob or a food animal, never a player or unknown entity.');
    }
    if (entity.id !== undefined && bot.entities?.[entity.id] !== entity) {
      throw new Error('That target is no longer a live nearby entity.');
    }
    const distance = bot.entity.position.distanceTo(entity.position);
    if (distance > maxDistance) throw new Error(`The ${entity.name} is too far away (${Math.round(distance)} blocks).`);
    if (entity.name === 'creeper') {
      await this.fleeFrom(entity);
      return { message: 'Retreated from the creeper instead of trading hits.' };
    }
    await this.equipBestArmor();
    await this.equipBestSword();
    this.progress(`Fighting ${entity.name}...`, { force: true });
    let lastAttack = 0;
    for (let round = 0; round < 60; round += 1) {
      this.assertActive();
      const current = bot.entities?.[entity.id];
      if (!current || current !== entity || current.type !== 'mob' || current.health === 0 || !current.position) break;
      if (bot.health <= 8) {
        await this.fleeFrom(current);
        throw new Error('I retreated because my health was low.');
      }
      const targetDistance = bot.entity.position.distanceTo(current.position);
      if (targetDistance > 3) {
        try {
          await this.goto(new GoalNear(current.position.x, current.position.y, current.position.z, 2));
        } catch {
          // If pathfinding fails, still try to hit if close enough.
        }
      }
      if (bot.entity.position.distanceTo(current.position) <= 4 && Date.now() - lastAttack >= 620) {
        bot.attack(current);
        lastAttack = Date.now();
      }
      await this.wait(180);
    }
    return { message: `Finished fighting ${entity.name}.` };
  }

  async fleeFrom(hostile) {
    const bot = this.assertActive();
    const position = bot.entity.position;
    let dx = position.x - hostile.position.x;
    let dz = position.z - hostile.position.z;
    let length = Math.hypot(dx, dz);
    if (length === 0) {
      dx = 1;
      dz = 0;
      length = 1;
    }
    const target = new GoalNear(
      Math.floor(position.x + (dx / length) * 12),
      Math.floor(position.y),
      Math.floor(position.z + (dz / length) * 12),
      2
    );
    await this.goto(target);
    return { message: `Retreated from the ${hostile.name}.` };
  }

  async survive() {
    const bot = this.assertActive();
    const observation = this.observation();
    const hostile = observation.nearbyHostiles[0];
    if (bot.health <= 10) {
      if (this.hasItem('food')) {
        await this.eat();
        return { message: 'Ate food to recover health.' };
      }
      if (hostile) {
        const entity = Object.values(bot.entities || {}).find(entry => entry.name === hostile.name);
        if (entity) {
          await this.fleeFrom(entity);
          return { message: 'Retreated from danger.' };
        }
      }
      return { message: 'Health is low; staying defensive.' };
    }
    if (hostile) {
      const entity = Object.values(bot.entities || {}).find(entry =>
        entry.name === hostile.name && entry.position &&
        Math.round(bot.entity.position.distanceTo(entry.position)) === hostile.distance);
      if (entity) {
        await this.attackEntity(entity);
        return { message: `Defended against a ${hostile.name}.` };
      }
    }
    return { message: 'No immediate danger.' };
  }

  async eat() {
    const bot = this.assertActive();
    if (Number(bot.food) >= 18) return { message: 'I am not hungry right now.' };
    const food = bot.inventory.items()
      .filter(item => FOOD_NAMES.has(item.name))
      .sort((left, right) => {
        const leftCooked = COOKED_FOOD.has(left.name) ? 1 : 0;
        const rightCooked = COOKED_FOOD.has(right.name) ? 1 : 0;
        return rightCooked - leftCooked;
      })[0];
    if (!food) return { message: 'I do not have any food.' };
    await this.equipItem(food.name);
    this.progress(`Eating ${food.name.replace(/_/g, ' ')}...`, { force: true });
    await withTimeout(bot.consume(), 8000, 'Eating');
    await this.wait(300);
    return { message: `Ate ${food.name.replace(/_/g, ' ')}. Food is now ${bot.food}/20.` };
  }

  async ensureFurnace() {
    const bot = this.assertActive();
    let furnace = bot.findBlock({
      matching: block => block.name === 'furnace' || block.name === 'blast_furnace' || block.name === 'smoker',
      maxDistance: 8
    });
    if (furnace) return furnace;
    await this.ensureItem('furnace', 1);
    await this.equipItem('furnace');
    const base = bot.entity.position.floored();
    for (let radius = 1; radius <= 3; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const support = bot.blockAt(base.offset(dx, -1, dz));
          const target = bot.blockAt(base.offset(dx, 0, dz));
          if (!support || support.boundingBox !== 'block' || !target || target.name !== 'air') continue;
          if (Math.abs(support.position.x + 0.5 - bot.entity.position.x) < 0.9 &&
            Math.abs(support.position.z + 0.5 - bot.entity.position.z) < 0.9) continue;
          try {
            await this.equipItem('furnace');
            await withTimeout(bot.placeBlock(support, new Vec3(0, 1, 0)), 8000, 'Placing a block');
            await this.wait(250);
            const placed = bot.blockAt(support.position.offset(0, 1, 0));
            if (placed?.name === 'furnace' || placed?.name === 'blast_furnace') return placed;
          } catch {
            // Try the next spot.
          }
        }
      }
    }
    throw new Error('I could not place a furnace nearby.');
  }

  smeltOutput(item) {
    const normalized = canonicalItem(item);
    if (normalized === 'iron_ingot') return { input: ['raw_iron', 'iron_ore'], output: 'iron_ingot' };
    if (normalized === 'gold_ingot') return { input: ['raw_gold', 'gold_ore'], output: 'gold_ingot' };
    if (normalized === 'copper_ingot') return { input: ['raw_copper', 'copper_ore'], output: 'copper_ingot' };
    if (normalized === 'charcoal') return { input: [...LOG_NAMES], output: 'charcoal' };
    if (normalized === 'glass') return { input: ['sand'], output: 'glass' };
    if (normalized === 'stone') return { input: ['cobblestone'], output: 'stone' };
    if (RAW_TO_COOKED[normalized]) return { input: [normalized], output: RAW_TO_COOKED[normalized] };
    if (COOKED_FOOD.has(normalized)) {
      const raw = Object.entries(RAW_TO_COOKED).find(([, cooked]) => cooked === normalized)?.[0];
      if (raw) return { input: [raw], output: normalized };
    }
    return { input: [], output: normalized };
  }

  async smelt(item, count = 8) {
    const bot = this.assertActive();
    const normalized = canonicalItem(item);
    const { input, output } = this.smeltOutput(normalized);
    if (!input.length) throw new Error(`I do not know how to smelt ${normalized.replace(/_/g, ' ')}.`);
    if (output === 'charcoal') {
      if (this.countItem('charcoal') >= count) return { message: `I already have ${this.countItem('charcoal')} charcoal.` };
      if (!this.findInventoryItem('oak_log')) await this.gatherWood(Math.max(4, count));
    } else if (this.countItem(output) >= count) {
      return { message: `I already have ${this.countItem(output)} ${output.replace(/_/g, ' ')}.` };
    }
    const source = input.find(name => this.countItem(name) > 0);
    if (!source) {
      if (input.some(name => name.endsWith('_ore') || name.startsWith('raw_'))) {
        await this.mine(input[0], count);
      } else if (input.some(name => isLog(name))) {
        await this.gatherWood(Math.max(4, count));
      } else {
        await this.gatherFood(count);
      }
    }
    const available = input.reduce((sum, name) => sum + this.countItem(name), 0);
    if (available < 1) throw new Error(`I do not have any ${input[0].replace(/_/g, ' ')} to smelt.`);
    const furnaceBlock = await this.ensureFurnace();
    const furnace = await withTimeout(bot.openFurnace(furnaceBlock), 12000, 'Opening the furnace');
    try {
      const inputItem = input.map(name => this.findInventoryItem(name)).find(Boolean);
      if (!inputItem) throw new Error('The smelting input disappeared.');
      const amount = Math.min(count, available);
      const fuel = this.findFuel();
      if (!fuel) throw new Error('I do not have fuel (coal, charcoal, planks, or logs).');
      this.progress(`Smelting ${amount} ${inputItem.name.replace(/_/g, ' ')}...`, { force: true });
      await furnace.putFuel(fuel.id, null, Math.max(1, Math.ceil(amount / 8)));
      await furnace.putInput(inputItem.type, null, amount);
      const deadline = Date.now() + Math.max(15000, amount * 12000);
      let outputItem = null;
      while (Date.now() < deadline) {
        this.assertActive();
        outputItem = furnace.outputItem();
        if (outputItem && outputItem.count >= amount) break;
        if (furnace.outputItem() && furnace.outputItem().count > 0 && !furnace.inputItem()) break;
        await this.wait(500);
      }
      outputItem = furnace.outputItem();
      if (!outputItem) throw new Error('The furnace produced no output; it may need more fuel.');
      await furnace.takeOutput();
      await this.wait(250);
      this.progress(`Smelted ${normalized.replace(/_/g, ' ')}.`, { force: true });
      return { message: `Smelted ${outputItem.count} ${outputItem.name.replace(/_/g, ' ')}.` };
    } finally {
      try {
        furnace.close();
      } catch {
        // The window may already be closed.
      }
    }
  }

  findFuel() {
    const bot = this.assertActive();
    return ['coal', 'charcoal', 'oak_planks', 'birch_planks', 'spruce_planks', 'oak_log', 'birch_log', 'spruce_log', 'stick']
      .map(name => this.findInventoryItem(name))
      .find(Boolean) || null;
  }

  async sleep() {
    const bot = this.assertActive();
    if (bot.time?.isDay !== false) return { message: 'It is not clearly nighttime; I will wait rather than attempt sleep.' };
    if (bot.health <= 8 || bot.food <= 4) throw new Error('Sleeping is unsafe while health or hunger is critical.');
    const nearbyHostile = Object.values(bot.entities || {})
      .find(entity => entity?.type === 'mob' && HOSTILE_MOBS.has(entity.name) && entity.position &&
        bot.entity.position.distanceTo(entity.position) <= 8);
    if (nearbyHostile) throw new Error(`I will not sleep while a ${nearbyHostile.name} is within 8 blocks.`);
    let bed = bot.findBlock?.({
      matching: block => block.name.endsWith('_bed'),
      maxDistance: 32
    });
    if (!bed) {
      if (this.findInventoryItem('bed')) {
        await this.equipItem('bed');
        const base = bot.entity.position.floored();
        const airNames = new Set(['air', 'cave_air', 'void_air']);
        const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let radius = 1; radius <= 2; radius += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            for (let dz = -radius; dz <= radius; dz += 1) {
              const targetPosition = base.offset(dx, 0, dz);
              const support = bot.blockAt(targetPosition.offset(0, -1, 0));
              const target = bot.blockAt(targetPosition);
              if (!support || support.boundingBox !== 'block' || !target || !airNames.has(target.name)) continue;
              const allDirectionsClear = directions.every(([sideX, sideZ]) => {
                const headPosition = targetPosition.offset(sideX, 0, sideZ);
                const head = bot.blockAt(headPosition);
                const headSupport = bot.blockAt(headPosition.offset(0, -1, 0));
                return head && airNames.has(head.name) && headSupport?.boundingBox === 'block';
              });
              if (!allDirectionsClear) continue;
              try {
                await withTimeout(bot.placeBlock(support, new Vec3(0, 1, 0)), 8000, 'Placing a bed');
                await this.wait(250);
                const placed = bot.blockAt(targetPosition);
                if (placed?.name.endsWith('_bed')) bed = placed;
              } catch {
                // Try another spot.
              }
            }
            if (bed) break;
          }
          if (bed) break;
        }
      } else {
        throw new Error('No bed is nearby or in my inventory. I will not hunt for wool at night.');
      }
    }
    if (!bed) throw new Error('I could not find or place a bed.');
    await this.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 2));
    await withTimeout(bot.sleep(bed), 300000, 'Sleeping', () => bot.wake?.());
    this.progress('Sleeping until morning.', { force: true });
    return { message: 'I am sleeping until morning.' };
  }

  async buildShelter() {
    const bot = this.assertActive();
    const materials = ['cobblestone', 'dirt', 'oak_planks', 'birch_planks', 'spruce_planks', 'stone']
      .map(name => this.findInventoryItem(name))
      .find(Boolean);
    if (!materials) {
      await this.mine('stone', 32);
    }
    const blockItem = this.findInventoryItem('cobblestone') || this.findInventoryItem('dirt') ||
      this.findInventoryItem('oak_planks') || this.findInventoryItem('stone');
    if (!blockItem) throw new Error('I need building blocks for a shelter.');
    const needed = 26;
    const available = this.countItem(blockItem.name);
    if (available < needed) {
      try {
        await this.mine(blockItem.name === 'cobblestone' ? 'stone' : blockItem.name, needed - available);
      } catch {
        // Use what we have.
      }
    }
    const base = bot.entity.position.floored();
    const center = base.offset(0, 0, 0);
    const positions = [];
    for (let y = 0; y <= 2; y += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          if (y < 2 && dx === 0 && dz === 0) continue;
          positions.push({ dx, dy: y, dz });
        }
      }
    }
    this.progress('Building a shelter...', { force: true });
    let placed = 0;
    for (const offset of positions) {
      this.assertActive();
      const targetPosition = center.offset(offset.dx, offset.dy, offset.dz);
      const existing = bot.blockAt(targetPosition);
      if (existing && existing.name !== 'air' && existing.name !== 'cave_air') continue;
      let reference = null;
      let face = null;
      if (offset.dy > 0) {
        const below = bot.blockAt(targetPosition.offset(0, -1, 0));
        if (below && below.boundingBox === 'block') {
          reference = below;
          face = new Vec3(0, 1, 0);
        }
      } else {
        const below = bot.blockAt(targetPosition.offset(0, -1, 0));
        if (below && below.boundingBox === 'block') {
          reference = below;
          face = new Vec3(0, 1, 0);
        }
      }
      if (!reference) continue;
      try {
        await this.equipItem(blockItem.name);
        await withTimeout(bot.placeBlock(reference, face), 8000, 'Placing a block');
        await this.wait(150);
        placed += 1;
      } catch {
        // Keep building the rest.
      }
    }
    if (placed === 0) throw new Error('I could not place shelter blocks here.');
    const torch = this.findInventoryItem('torch');
    if (torch) {
      try {
        await this.equipItem('torch');
        const support = bot.blockAt(center.offset(0, -1, 0));
        if (support) {
          await withTimeout(bot.placeBlock(support, new Vec3(0, 1, 0)), 8000, 'Placing a block');
        }
      } catch {
        // Light is optional.
      }
    }
    this.memory?.setFact?.('shelter', {
      position: { x: center.x, y: center.y, z: center.z },
      at: new Date().toISOString()
    });
    this.progress(`Shelter built with ${placed} blocks.`, { force: true });
    return { message: `Built a shelter with ${placed} blocks at ${formatPosition({ position: center })}.` };
  }

  async harvestCrops() {
    const bot = this.assertActive();
    const cropTypes = ['wheat', 'carrots', 'potatoes', 'beetroots'];
    const blocks = cropTypes
      .flatMap(name => bot.registry.blocksByName[name] ? [bot.registry.blocksByName[name]] : []);
    if (blocks.length === 0) return 0;
    const positions = bot.findBlocks({
      matching: block => cropTypes.includes(block.name),
      maxDistance: 32,
      count: 64
    });
    let harvested = 0;
    for (const position of positions) {
      const block = bot.blockAt(position);
      if (!block || !cropTypes.includes(block.name)) continue;
      if (block.metadata !== undefined && block.metadata < 7) continue;
      try {
        await this.goto(new GoalNear(block.position.x, block.position.y, block.position.z, 1));
        const current = bot.blockAt(block.position);
        if (!current) continue;
        await withTimeout(bot.dig(current), 15000, 'Mining a block', () => bot.stopDigging?.());
        harvested += 1;
        await this.wait(200);
      } catch (error) {
        if (error instanceof TaskAbortedError) throw error;
      }
    }
    return harvested;
  }

  async farm() {
    const bot = this.assertActive();
    const harvested = await this.harvestCrops();
    let planted = 0;
    const seeds = this.findInventoryItem('wheat_seeds') || this.findInventoryItem('carrot') || this.findInventoryItem('potato');
    if (seeds) {
      const farmland = bot.findBlock({
        matching: block => block.name === 'farmland',
        maxDistance: 24
      });
      if (farmland) {
        try {
          await this.goto(new GoalNear(farmland.position.x, farmland.position.y, farmland.position.z, 2));
          await this.equipItem(seeds.name);
          const above = bot.blockAt(farmland.position.offset(0, 1, 0));
          if (above && above.name === 'air') {
            await withTimeout(bot.placeBlock(farmland, new Vec3(0, 1, 0)), 8000, 'Placing a block');
            planted += 1;
          }
        } catch {
          // Planting is best effort.
        }
      }
    }
    if (harvested === 0 && planted === 0) {
      throw new Error('I could not find mature crops or farmland nearby.');
    }
    return { message: `Harvested ${harvested} crop(s) and planted ${planted}.` };
  }

  async deliverToPlayer(item, count, player = 'requester') {
    const bot = this.assertActive();
    const targetName = player === 'requester' ? this.agent?.requestedBy : player;
    if (!targetName) throw new Error('I do not know who to deliver to.');
    const normalized = canonicalItem(item);
    const amount = Math.max(1, Math.min(Number(count) || 1, 64));
    if (this.countItem(normalized) < amount) {
      await this.ensureItem(normalized, amount);
    }
    if (this.countItem(normalized) < amount) {
      throw new Error(`I could only obtain ${this.countItem(normalized)} ${normalized.replace(/_/g, ' ')}.`);
    }
    const entity = this.playerEntity(targetName);
    if (!entity) throw new Error(`${targetName} is not visible to me right now.`);
    if (bot.entity.position.distanceTo(entity.position) > 32) {
      await this.comeToPlayer(targetName);
    }
    const itemType = bot.registry.itemsByName[normalized];
    if (!itemType) throw new Error(`Unknown item: ${normalized}`);
    const current = this.playerEntity(targetName);
    if (!current || bot.entity.position.distanceTo(current.position) > 4) {
      throw new Error(`${targetName} moved out of delivery range.`);
    }
    await bot.toss(itemType.id, null, amount);
    this.progress(`Delivered ${amount} ${normalized.replace(/_/g, ' ')}.`, { force: true });
    return { message: `Delivered ${amount} ${normalized.replace(/_/g, ' ')} to ${targetName}.` };
  }

  async setWaypoint(name = 'home') {
    const bot = this.assertActive();
    this.memory?.addWaypoint?.(name, bot.entity.position, { kind: 'manual' });
    return { message: `Saved waypoint ${name} at ${formatPosition({ position: bot.entity.position })}.` };
  }

  async gotoWaypoint(name = 'home') {
    const bot = this.assertActive();
    const waypoint = this.memory?.getWaypoint?.(name);
    if (!waypoint) throw new Error(`I do not know a waypoint named ${name}.`);
    await this.goto(new GoalNear(waypoint.x, waypoint.y, waypoint.z, 2));
    return { message: `Arrived at ${name}.` };
  }

  async storeItem(name, count = 64) {
    const bot = this.assertActive();
    const normalized = canonicalItem(name);
    let chestBlock = bot.findBlock({
      matching: block => block.name === 'chest' || block.name === 'barrel' || block.name === 'trapped_chest',
      maxDistance: 16
    });
    if (!chestBlock) {
      await this.ensureItem('chest', 1);
      await this.equipItem('chest');
      const base = bot.entity.position.floored();
      for (let radius = 1; radius <= 2 && !chestBlock; radius += 1) {
        for (let dx = -radius; dx <= radius && !chestBlock; dx += 1) {
          for (let dz = -radius; dz <= radius && !chestBlock; dz += 1) {
            const support = bot.blockAt(base.offset(dx, -1, dz));
            const target = bot.blockAt(base.offset(dx, 0, dz));
            if (!support || support.boundingBox !== 'block' || !target || target.name !== 'air') continue;
            try {
              await withTimeout(bot.placeBlock(support, new Vec3(0, 1, 0)), 8000, 'Placing a block');
              await this.wait(250);
              chestBlock = bot.blockAt(support.position.offset(0, 1, 0));
            } catch {
              // Try another spot.
            }
          }
        }
      }
    }
    if (!chestBlock) throw new Error('I could not find or place a chest.');
    const item = this.findInventoryItem(normalized);
    if (!item) throw new Error(`I do not have any ${normalized.replace(/_/g, ' ')}.`);
    const chest = await withTimeout(bot.openChest(chestBlock), 8000, 'Opening the chest');
    try {
      await chest.deposit(item.type, null, Math.min(count, item.count));
      return { message: `Stored ${Math.min(count, item.count)} ${normalized.replace(/_/g, ' ')}.` };
    } finally {
      chest.close();
    }
  }
}

module.exports = {
  AISkills,
  MAX_ACTIONS_PER_TASK,
  TaskAbortedError
};
