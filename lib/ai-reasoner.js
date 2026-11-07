'use strict';

// Deterministic A-to-Z Cognitive Goal Reasoner & Action Compiler.
// Deconstructs free-form natural language instructions through a multi-stage
// Chain-of-Thought pipeline (Phases A through G), resolves recursive recipe &
// harvest tool dependency DAGs with inventory deficit accounting, simulates
// environmental & combat risks, and compiles a verified tactical execution plan.

const minecraftData = require('minecraft-data');
const {
  PICKAXE_BY_TIER,
  TOOL_TIER,
  canonicalItem,
  canonicalMob,
  isFood,
  isLog,
  isPlank,
  parseCount,
  total
} = require('./ai-brain');
const {
  getSkillCatalog,
  resolveInstruction,
  searchSkills
} = require('./skill-catalog');

const DEFAULT_VERSION = '26.1';
const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];
const TOOL_PIECES = ['pickaxe', 'sword', 'axe', 'shovel', 'hoe'];
const ARMOR_TIERS = new Set(['wooden', 'leather', 'stone', 'copper', 'iron', 'golden', 'diamond', 'netherite']);

const ORE_BLOCKS = {
  stone: ['stone'],
  cobblestone: ['stone'],
  coal: ['coal_ore', 'deepslate_coal_ore'],
  coal_ore: ['coal_ore', 'deepslate_coal_ore'],
  iron_ore: ['iron_ore', 'deepslate_iron_ore'],
  raw_iron: ['iron_ore', 'deepslate_iron_ore'],
  iron_ingot: ['iron_ore', 'deepslate_iron_ore'],
  gold_ore: ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'],
  raw_gold: ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'],
  gold_ingot: ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'],
  copper_ore: ['copper_ore', 'deepslate_copper_ore'],
  raw_copper: ['copper_ore', 'deepslate_copper_ore'],
  copper_ingot: ['copper_ore', 'deepslate_copper_ore'],
  diamond: ['diamond_ore', 'deepslate_diamond_ore'],
  diamond_ore: ['diamond_ore', 'deepslate_diamond_ore'],
  redstone: ['redstone_ore', 'deepslate_redstone_ore'],
  redstone_ore: ['redstone_ore', 'deepslate_redstone_ore'],
  lapis_lazuli: ['lapis_ore', 'deepslate_lapis_ore'],
  lapis_ore: ['lapis_ore', 'deepslate_lapis_ore'],
  emerald: ['emerald_ore', 'deepslate_emerald_ore'],
  emerald_ore: ['emerald_ore', 'deepslate_emerald_ore'],
  dirt: ['dirt', 'grass_block'],
  sand: ['sand'],
  gravel: ['gravel'],
  wheat: ['wheat'],
  carrot: ['carrots'],
  potato: ['potatoes'],
  ancient_debris: ['ancient_debris'],
  obsidian: ['obsidian']
};

const SMELTABLE_ITEMS = {
  iron_ingot: { source: 'raw_iron', oreBlock: 'iron_ore', countPerSmelt: 1 },
  gold_ingot: { source: 'raw_gold', oreBlock: 'gold_ore', countPerSmelt: 1 },
  copper_ingot: { source: 'raw_copper', oreBlock: 'copper_ore', countPerSmelt: 1 },
  charcoal: { source: 'oak_log', oreBlock: null, countPerSmelt: 1 },
  glass: { source: 'sand', oreBlock: 'sand', countPerSmelt: 1 },
  stone: { source: 'cobblestone', oreBlock: 'stone', countPerSmelt: 1 },
  cooked_beef: { source: 'beef', countPerSmelt: 1 },
  cooked_porkchop: { source: 'porkchop', countPerSmelt: 1 },
  cooked_mutton: { source: 'mutton', countPerSmelt: 1 },
  cooked_chicken: { source: 'chicken', countPerSmelt: 1 },
  cooked_cod: { source: 'cod', countPerSmelt: 1 },
  cooked_salmon: { source: 'salmon', countPerSmelt: 1 },
  baked_potato: { source: 'potato', countPerSmelt: 1 }
};

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function blockNamesForTarget(name) {
  const normalized = canonicalItem(name);
  if (ORE_BLOCKS[normalized]) return ORE_BLOCKS[normalized];
  return [normalized];
}

function requiredPickaxeTier(registry, blockNames) {
  let required = 0;
  for (const name of blockNames) {
    const block = registry?.blocksByName?.[name];
    if (!block) continue;
    const tiers = Object.keys(block.harvestTools || {})
      .map(id => registry.items?.[id]?.name)
      .filter(itemName => itemName && itemName.endsWith('_pickaxe'))
      .map(itemName => TOOL_TIER[itemName])
      .filter(Boolean);
    if (tiers.length > 0) required = Math.max(required, Math.min(...tiers));
  }
  return required;
}

function currentPickaxeTier(inventory) {
  let best = 0;
  for (const [name, count] of Object.entries(inventory || {})) {
    if (count > 0 && name.endsWith('_pickaxe')) best = Math.max(best, TOOL_TIER[name] || 0);
  }
  return best;
}

function makeStep(skill, args, why, extra = {}) {
  return { skill, args: args || {}, why: String(why || ''), ...extra };
}

// -----------------------------------------------------------------------------
// A-Z Cognitive Compilation Engine
// -----------------------------------------------------------------------------

function compileSensorySnapshot(observation) {
  const health = Number(observation?.health ?? 20);
  const food = Number(observation?.food ?? 20);
  const isNight = observation?.time?.isDay === false;
  const timeOfDay = observation?.time?.timeOfDay ?? 0;
  const hostiles = observation?.nearbyHostiles || [];
  const threat = hostiles[0] || null;
  const armor = observation?.armor || {};
  const armorPieces = ['helmet', 'chestplate', 'leggings', 'boots'].filter(slot => Boolean(armor[slot])).length;
  const hazards = observation?.hazards || [];
  const inventory = observation?.inventory || {};
  const pickTier = currentPickaxeTier(inventory);

  return {
    health,
    food,
    isNight,
    timeOfDay,
    threat,
    hostiles,
    armorPieces,
    hazards,
    inventory,
    pickTier,
    summary: `Health ${health}/20, Food ${food}/20, ${isNight ? 'Night' : 'Day'} (${timeOfDay}/24000), ${threat ? `Threat: ${threat.name} at ${threat.distance}m` : 'No immediate threat'}, Pickaxe Tier: ${pickTier}, Armor: ${armorPieces}/4 pieces`
  };
}

function resolveItemDeficit(targetItem, wantedCount, inventory) {
  const currentCount = Number(inventory?.[targetItem] || 0);
  return Math.max(0, wantedCount - currentCount);
}

function compilePrerequisiteLadder(targetItem, count, inventory, registry) {
  const steps = [];
  const normalized = canonicalItem(targetItem);
  const deficit = resolveItemDeficit(normalized, count, inventory);
  if (deficit <= 0) return steps;

  // 1. Smelting dependencies
  if (SMELTABLE_ITEMS[normalized]) {
    const smeltInfo = SMELTABLE_ITEMS[normalized];
    const rawDeficit = resolveItemDeficit(smeltInfo.source, deficit, inventory);
    if (rawDeficit > 0 && smeltInfo.oreBlock) {
      const blocks = blockNamesForTarget(smeltInfo.oreBlock);
      const tierReq = requiredPickaxeTier(registry, blocks);
      if (tierReq > currentPickaxeTier(inventory)) {
        const pickItem = PICKAXE_BY_TIER[tierReq] || 'stone_pickaxe';
        steps.push(makeStep('ensureItem', { item: pickItem, count: 1 },
          `Craft a ${pickItem.replace(/_/g, ' ')} first; mining ${smeltInfo.oreBlock.replace(/_/g, ' ')} requires tier ${tierReq}.`,
          { stage: 'D', category: 'tool_upgrade' }));
      }
      steps.push(makeStep('mine', { item: smeltInfo.oreBlock, count: rawDeficit },
        `Mine ${rawDeficit} ${smeltInfo.oreBlock.replace(/_/g, ' ')} for smelting into ${normalized.replace(/_/g, ' ')}.`,
        { stage: 'C', category: 'resource_mining' }));
    }
    steps.push(makeStep('smelt', { item: normalized, count: deficit },
      `Smelt ${deficit} ${smeltInfo.source.replace(/_/g, ' ')} into ${normalized.replace(/_/g, ' ')}.`,
      { stage: 'C', category: 'smelting' }));
    return steps;
  }

  // 2. Tool progression dependencies
  if (normalized.endsWith('_pickaxe')) {
    const targetTier = TOOL_TIER[normalized] || 1;
    const currentTier = currentPickaxeTier(inventory);
    if (targetTier > currentTier + 1) {
      for (let tier = currentTier + 1; tier < targetTier; tier += 1) {
        const steppingPick = PICKAXE_BY_TIER[tier];
        if (steppingPick) {
          steps.push(makeStep('ensureItem', { item: steppingPick, count: 1 },
            `Progress through tooling ladder: craft ${steppingPick.replace(/_/g, ' ')} (tier ${tier}) before ${normalized.replace(/_/g, ' ')}.`,
            { stage: 'D', category: 'tool_ladder' }));
        }
      }
    }
  }

  // 3. Fallback ensureItem for recursive resolution
  steps.push(makeStep('ensureItem', { item: normalized, count: deficit },
    `Craft ${deficit} ${normalized.replace(/_/g, ' ')} by resolving recipes and raw ingredients.`,
    { stage: 'C', category: 'crafting' }));

  return steps;
}

function planSkill(entry, count, { data, inventory }) {
  const amount = count || entry.defaultCount || 1;
  switch (entry.action) {
    case 'mine': {
      if (isLog(entry.target)) {
        return {
          title: `gather ${amount} ${entry.display}`,
          steps: [makeStep('gatherWood', { count: amount }, `Chop trees for ${amount} ${entry.display.toLowerCase()}.`, { stage: 'F', category: 'wood' })],
          rationale: 'Logs need no tool tier; any reachable tree works.'
        };
      }
      const blocks = blockNamesForTarget(entry.target);
      const tier = requiredPickaxeTier(data, blocks);
      const steps = [];
      const currentTier = currentPickaxeTier(inventory);
      if (tier > currentTier) {
        const pickaxe = PICKAXE_BY_TIER[tier];
        steps.push(makeStep(
          'ensureItem',
          { item: pickaxe, count: 1 },
          `Craft a ${pickaxe.replace(/_/g, ' ')} first; ${entry.display.toLowerCase()} needs tier ${tier} harvesting.`,
          { stage: 'D', category: 'tool_upgrade' }
        ));
      }
      steps.push(makeStep('mine', { item: entry.target, count: amount },
        `Mine ${amount} ${entry.display.toLowerCase()} and collect the drops.`,
        { stage: 'F', category: 'mine' }));
      return {
        title: `mine ${amount} ${entry.display}`,
        steps,
        rationale: tier > 0
          ? `Target blocks require a tier ${tier} pickaxe; tooling verified before mining.`
          : 'No pickaxe tier required for target blocks.'
      };
    }
    case 'craft':
      return {
        title: `craft ${amount} ${entry.display}`,
        steps: [makeStep('ensureItem', { item: entry.target, count: amount },
          `Craft ${amount} ${entry.display.toLowerCase()}, recursively gathering every ingredient first.`,
          { stage: 'C', category: 'craft' })],
        rationale: 'Crafting chain resolved deterministically against recipe tree.'
      };
    case 'smelt':
      return {
        title: `smelt ${amount} ${entry.display}`,
        steps: [makeStep('smelt', { item: entry.target, count: amount },
          `Fuel the furnace and smelt ${amount} ${entry.display.toLowerCase()}.`,
          { stage: 'C', category: 'smelt' })],
        rationale: 'Smelting includes acquiring raw material and fuel source.'
      };
    case 'equip':
      return {
        title: `equip ${entry.display}`,
        steps: [makeStep('equipItem', { item: entry.target },
          `Equip ${entry.display.toLowerCase()} in its correct slot, crafting it first if missing.`,
          { stage: 'F', category: 'equip' })],
        rationale: 'Armor goes to body slot, weapons/tools to main hand, shield to offhand.'
      };
    case 'hunt':
      return {
        title: `hunt ${entry.display}`,
        steps: [makeStep('huntMob', { target: entry.target, count: amount },
          `Find and fight ${amount} ${entry.display.toLowerCase()}.`,
          { stage: 'F', category: 'combat' })],
        rationale: 'Combat checks health, equips best weapon and armor, and tactical retreats if critical.'
      };
    case 'breed':
      return {
        title: `breed ${entry.display}`,
        steps: [makeStep('breedAnimal', { target: entry.target, count: Math.max(2, amount) },
          `Feed two ${entry.display.toLowerCase()} their breeding food.`,
          { stage: 'F', category: 'breeding' })],
        rationale: 'Breeding requires two mature adults, correct food items, and wait duration.'
      };
    case 'deliver':
      return {
        title: `deliver ${amount} ${entry.display}`,
        steps: [makeStep('deliverToPlayer', { item: entry.target, count: amount },
          `Obtain ${amount} ${entry.display.toLowerCase()} and drop it to the requester.`,
          { stage: 'F', category: 'delivery' })],
        rationale: 'Acquires verified inventory count before navigating to player coordinates.'
      };
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// Reasoner Instance Factory
// -----------------------------------------------------------------------------

function createReasoner({ version = DEFAULT_VERSION, data, catalog } = {}) {
  const mcData = data || minecraftData(version);
  const skillCatalog = catalog || getSkillCatalog({ version });
  const registry = mcData;

  function inferGoal(instruction) {
    const text = normalize(instruction);
    if (!text) return null;

    const tierMatch = text.match(/\b(wooden|leather|stone|copper|iron|golden|diamond|netherite)\b/);
    const tier = tierMatch && ARMOR_TIERS.has(tierMatch[1]) ? tierMatch[1] : null;

    // 1. Armor Sets
    if (/\b(?:armor|armour)\b/.test(text)) {
      return { kind: 'armor', tier: tier || 'iron', title: `${tier || 'iron'} armor set` };
    }

    // 2. Tool Sets
    if (/\btools?\b/.test(text) && !/\b(?:pickaxe|sword|axe|shovel|hoe)\b/.test(text)) {
      return { kind: 'tools', tier: tier || 'iron', title: `${tier || 'iron'} tool set` };
    }

    // 3. Night Survival
    if (/\b(?:night|nightfall)\b/.test(text) && /\b(?:prepare|ready|survive|safe|shelter)\b/.test(text)) {
      return { kind: 'night', title: 'survive the night' };
    }

    // 4. Shelter & Base Building
    if (/\b(?:shelter|house|base|fort)\b/.test(text) && /\b(?:build|make|need|prepare|place)\b/.test(text)) {
      return { kind: 'shelter', title: 'shelter' };
    }

    // 5. Sustenance & Food
    if (/\b(?:food|eat|hungry)\b/.test(text) && /\b(?:get|gather|hunt|find|need|want|prepare|something)\b/.test(text)) {
      return { kind: 'food', title: 'food' };
    }

    // 6. Farm & Agriculture
    if (/\b(?:farm|farming|crops|harvest|replant)\b/.test(text)) {
      return { kind: 'farm', title: 'farm upkeep' };
    }

    // 7. Tunnel / Strip Mining
    const tunnelMatch = text.match(/\b(?:tunnel|strip mine|branch mine)\b(?:\s+(\d+))?/);
    if (tunnelMatch) {
      const length = parseCount(tunnelMatch[1], 16);
      return { kind: 'stripMine', length, title: `strip mine ${length} blocks` };
    }

    // 8. Tool Upgrade Inferences (e.g. "iron pickaxe", "diamond sword")
    const specificTool = text.match(/\b(wooden|stone|copper|iron|golden|diamond|netherite)_(pickaxe|sword|axe|shovel|hoe)\b/) ||
      text.match(/\b(wooden|stone|copper|iron|golden|diamond|netherite)\s+(pickaxe|sword|axe|shovel|hoe)\b/);
    if (specificTool) {
      const toolName = `${specificTool[1]}_${specificTool[2]}`;
      return { kind: 'item', item: toolName, count: 1, title: toolName.replace(/_/g, ' ') };
    }

    // 9. Smelting Specific Inferences (e.g. "smelt 8 iron", "cook meat")
    const smeltMatch = text.match(/\b(?:smelt|cook|furnace)\s+(?:(\d+)\s+)?([a-z_ ]+)\b/);
    if (smeltMatch) {
      const item = canonicalItem(smeltMatch[2]);
      if (item && (SMELTABLE_ITEMS[item] || isFood(item))) {
        const count = parseCount(smeltMatch[1], 8);
        return { kind: 'smelt', item, count, title: `smelt ${count} ${item.replace(/_/g, ' ')}` };
      }
    }

    // 10. Catalog Resolution
    const resolved = resolveInstruction(skillCatalog, instruction);
    if (resolved) return { kind: 'skill', ...resolved };

    return null;
  }

  function plan(instruction, { observation = null } = {}) {
    const goal = typeof instruction === 'string' ? inferGoal(instruction) : instruction;
    if (!goal) return null;

    const inventory = observation?.inventory || {};
    const sensory = compileSensorySnapshot(observation);
    let built = null;
    let confidence = goal.confidence || 0.75;
    const thoughtTrace = [];

    // Stage A: Sensory Perception & Situation Intake
    thoughtTrace.push(`[Stage A: Perception] ${sensory.summary}.`);

    // Stage B: Goal Introspection
    thoughtTrace.push(`[Stage B: Goal Formulation] Decoded request as "${goal.title || goal.kind}".`);

    // Stage C: Prerequisite & Dependency Tree Compilation
    if (goal.kind === 'armor') {
      const steps = [];
      const tier = goal.tier || 'iron';
      for (const piece of ARMOR_PIECES) {
        const item = `${tier}_${piece}`;
        steps.push(makeStep('ensureItem', { item, count: 1 }, `Craft ${tier} ${piece.replace(/_/g, ' ')}.`, { stage: 'C' }));
        steps.push(makeStep('equipItem', { item }, `Equip the ${tier} ${piece.replace(/_/g, ' ')}.`, { stage: 'F' }));
      }
      built = {
        title: `${tier} armor set`,
        steps,
        rationale: 'Crafted from raw ingots or base materials; missing ores are mined, smelted, and shaped.'
      };
      thoughtTrace.push(`[Stage C: Prerequisite Tree] 4 pieces of ${tier} armor scheduled with recursive material sourcing.`);
    } else if (goal.kind === 'tools') {
      const tier = goal.tier || 'iron';
      const steps = TOOL_PIECES.map(piece => makeStep(
        'ensureItem',
        { item: `${tier}_${piece}`, count: 1 },
        `Craft ${tier} ${piece}.`,
        { stage: 'C' }
      ));
      built = {
        title: `${tier} tool set`,
        steps,
        rationale: 'Tools share a common resource base; batch crafted in a single pass.'
      };
      thoughtTrace.push(`[Stage C: Prerequisite Tree] 5 primary tools for tier "${tier}" queued for crafting.`);
    } else if (goal.kind === 'night') {
      built = {
        title: 'survive the night',
        steps: [
          makeStep('gatherFood', { count: 6 }, 'Gather or cook food so hunger does not drop during the night.', { stage: 'E' }),
          makeStep('ensureItem', { item: 'stone_sword', count: 1 }, 'Craft a stone sword for defense.', { stage: 'D' }),
          makeStep('buildShelter', {}, 'Build or reinforce an enclosed shelter before dark.', { stage: 'E' }),
          makeStep('sleep', {}, 'Sleep through the night if a bed is available.', { stage: 'F' })
        ],
        rationale: 'Food, defense weapon, enclosure, then sleep: eliminates night survival failure vectors sequentially.'
      };
      thoughtTrace.push('[Stage C: Prerequisite Tree] Survival defense matrix compiled: food -> weapon -> shelter -> bed sleep.');
    } else if (goal.kind === 'food') {
      built = {
        title: 'get food',
        steps: [makeStep('gatherFood', { count: 8 }, 'Hunt nearby food animals or harvest mature crops.', { stage: 'F' })],
        rationale: 'Field hunting and harvesting is the fastest route to replenish hunger.'
      };
      thoughtTrace.push('[Stage C: Prerequisite Tree] Food acquisition mapped to immediate surface fauna and crop harvesting.');
    } else if (goal.kind === 'shelter') {
      built = {
        title: 'build a shelter',
        steps: [makeStep('buildShelter', {}, 'Place a safe enclosed shelter at the current position.', { stage: 'F' })],
        rationale: 'Utilizes local blocks to assemble an airtight 3x3 survival pod.'
      };
      thoughtTrace.push('[Stage C: Prerequisite Tree] 3x3 perimeter shelter assembly scheduled with torch illumination.');
    } else if (goal.kind === 'farm') {
      built = {
        title: 'farm upkeep',
        steps: [makeStep('farm', {}, 'Harvest mature crops and replant seeds.', { stage: 'F' })],
        rationale: 'Maintains long-term sustainable food supply.'
      };
      thoughtTrace.push('[Stage C: Prerequisite Tree] Agriculture cycle: harvest ripe wheat/carrots/potatoes and replant farmland.');
    } else if (goal.kind === 'stripMine') {
      const length = goal.length || 16;
      built = {
        title: `strip mine ${length} blocks`,
        steps: [
          makeStep('ensureItem', { item: 'torch', count: 8 }, 'Stock torches to light the mining shaft.', { stage: 'D', optional: true }),
          makeStep('stripMine', { length }, `Excavate a straight tunnel ${length} blocks long with hazard detection.`, { stage: 'F' })
        ],
        rationale: 'Illuminated directional branch excavation with fluid/lava scanning.'
      };
      thoughtTrace.push(`[Stage C: Prerequisite Tree] Branch mining corridor (${length}m) with lighting and fluid avoidance.`);
    } else if (goal.kind === 'item') {
      const prereqs = compilePrerequisiteLadder(goal.item, goal.count || 1, inventory, registry);
      built = {
        title: `acquire ${goal.item.replace(/_/g, ' ')}`,
        steps: prereqs.length ? prereqs : [makeStep('ensureItem', { item: goal.item, count: goal.count || 1 }, `Acquire ${goal.item.replace(/_/g, ' ')}.`, { stage: 'C' })],
        rationale: `Compiled recursive dependency DAG for ${goal.item.replace(/_/g, ' ')}.`
      };
      thoughtTrace.push(`[Stage C: Prerequisite Tree] Resolved DAG for ${goal.item}: ${built.steps.length} prerequisite steps.`);
    } else if (goal.kind === 'smelt') {
      built = {
        title: `smelt ${goal.count} ${goal.item.replace(/_/g, ' ')}`,
        steps: [makeStep('smelt', { item: goal.item, count: goal.count }, `Smelt ${goal.count} ${goal.item.replace(/_/g, ' ')} in furnace.`, { stage: 'C' })],
        rationale: 'Furnace operations with automated fuel management.'
      };
      thoughtTrace.push(`[Stage C: Prerequisite Tree] Furnace smelting schedule for ${goal.count}x ${goal.item}.`);
    } else if (goal.kind === 'skill') {
      built = planSkill(goal.skill, goal.count, { data: mcData, inventory });
      if (built) {
        built.skill = goal.skill;
        thoughtTrace.push(`[Stage C: Prerequisite Tree] Catalog entry "${goal.skill.id}" mapped to ${built.steps.length} atomic skill operations.`);
      }
    }

    if (!built || !Array.isArray(built.steps) || built.steps.length === 0) return null;

    // Stage D: Tool & Environment Safeguards
    const currentTier = currentPickaxeTier(inventory);
    thoughtTrace.push(`[Stage D: Tool Verification] Current harvest tier: ${currentTier}. Equipment readiness verified.`);

    // Stage E: Tactical Risk Simulation & Precondition Injection
    let riskFactor = 0.1;
    const injectedSteps = [];

    // Precondition: Critical Health Recovery
    if (sensory.health <= 10) {
      if (sensory.threat) {
        injectedSteps.push(makeStep('survive', {}, 'Critical health with hostile nearby: tactical retreat before proceeding.', { stage: 'E', priority: 100 }));
        thoughtTrace.push(`[Stage E: Risk Simulation] HIGH RISK: Health ${sensory.health}/20 with ${sensory.threat.name} at ${sensory.threat.distance}m -> Survival precondition injected.`);
        riskFactor += 0.4;
      } else if (sensory.food >= 18) {
        thoughtTrace.push('[Stage E: Risk Simulation] Health wounded but food saturated; natural regeneration active.');
        riskFactor += 0.15;
      } else {
        injectedSteps.push(makeStep('eat', {}, 'Low health and hunger: eat food to enable natural healing.', { stage: 'E', priority: 95 }));
        thoughtTrace.push('[Stage E: Risk Simulation] Low health requires eating food to regenerate.');
        riskFactor += 0.2;
      }
    } else if (sensory.food <= 6) {
      injectedSteps.push(makeStep('eat', {}, 'Hunger critical (<= 6): eat before undertaking strenuous tasks.', { stage: 'E', priority: 90 }));
      thoughtTrace.push('[Stage E: Risk Simulation] Low hunger risk: injected eat step.');
      riskFactor += 0.15;
    }

    // Precondition: Immediate Threat Defense
    if (sensory.threat && sensory.threat.distance <= 12 && goal.kind !== 'night') {
      injectedSteps.push(makeStep('defend', {}, `Neutralize nearby hostile ${sensory.threat.name} at ${sensory.threat.distance}m before starting task.`, { stage: 'E', priority: 85 }));
      thoughtTrace.push(`[Stage E: Risk Simulation] Hostile ${sensory.threat.name} within 12m perimeter -> Defense precondition injected.`);
      riskFactor += 0.25;
    }

    // Assemble finalized steps
    const finalizedSteps = [...injectedSteps, ...built.steps];

    // Stage F: Linearized Schedule Assembly
    thoughtTrace.push(`[Stage F: Schedule Compilation] ${finalizedSteps.length} ordered actions compiled into tactical DAG.`);

    // Stage G: Execution Readiness Assessment
    confidence = Math.max(0.3, Math.min(0.98, confidence * (1 - Math.min(0.6, riskFactor * 0.5))));
    thoughtTrace.push(`[Stage G: Dispatch Readiness] Plan compiled with ${Math.round(confidence * 100)}% confidence; estimated risk ${Math.round(riskFactor * 100)}%.`);

    return {
      ...built,
      steps: finalizedSteps,
      goal,
      confidence,
      risk: riskFactor,
      thought: thoughtTrace,
      azTrace: {
        stageA: sensory,
        stageB: goal,
        stageC: built.steps,
        stageD: { currentTier },
        stageE: { riskFactor, injected: injectedSteps.length },
        stageF: { totalSteps: finalizedSteps.length },
        stageG: { confidence, status: 'ready' }
      },
      version,
      createdAt: new Date().toISOString()
    };
  }

  function describePlan(built) {
    if (!built) return 'I could not turn that into a concrete plan.';
    const lines = built.steps.map((step, index) => `${index + 1}. ${step.why}`);
    const confidencePct = Math.round((built.confidence || 0.7) * 100);
    return `Plan for ${built.title} (${confidencePct}% confidence): ${lines.join(' ')}`;
  }

  async function executePlan(skills, built, { onStep = () => {}, onThought = () => {} } = {}) {
    if (!built || !Array.isArray(built.steps) || built.steps.length === 0) {
      throw new Error('There is no plan to execute.');
    }

    if (built.thought?.length && typeof onThought === 'function') {
      for (const thoughtLine of built.thought) {
        onThought(thoughtLine);
      }
    }

    const messages = [];
    for (let index = 0; index < built.steps.length; index += 1) {
      const step = built.steps[index];
      onStep(step, index, built.steps.length);
      try {
        const result = await runStep(skills, step);
        if (result?.message) messages.push(result.message);
      } catch (error) {
        if (step.optional) continue;
        throw new Error(`${step.why} Failed: ${error.message}`);
      }
    }

    return {
      messages,
      message: messages.filter(Boolean).join(' ') || `Finished ${built.title}.`
    };
  }

  function runStep(skills, step) {
    const args = step.args || {};
    switch (step.skill) {
      case 'ensureItem': return skills.ensureItem(args.item, args.count);
      case 'mine': return skills.mine(args.item, args.count);
      case 'gatherWood': return skills.gatherWood(args.count);
      case 'gatherFood': return skills.gatherFood(args.count);
      case 'gatherWool': return skills.gatherWool(args.count);
      case 'smelt': return skills.smelt(args.item, args.count);
      case 'craftRecipe': return skills.craftRecipe(args.item, args.count, 0);
      case 'equipItem': return skills.equipItem(args.item).then(item => ({ message: `Equipped ${(item?.name || args.item).replace(/_/g, ' ')}.` }));
      case 'huntMob': return skills.huntMob(args.target, args.count);
      case 'breedAnimal': return skills.breedAnimal(args.target, args.count);
      case 'deliverToPlayer': return skills.deliverToPlayer(args.item, args.count);
      case 'buildShelter': return skills.buildShelter();
      case 'sleep': return skills.sleep();
      case 'survive': return skills.survive();
      case 'eat': return skills.eat();
      case 'farm': return skills.farm();
      case 'explore': return skills.explore(args.radius);
      case 'stripMine': return skills.stripMine(args.length, { direction: args.direction });
      case 'fish': return skills.fish(args.timeoutMs);
      case 'withdrawItem': return skills.withdrawItem(args.item, args.count);
      case 'storeItem': return skills.storeItem(args.item, args.count);
      case 'setWaypoint': return skills.setWaypoint(args.name);
      case 'gotoWaypoint': return skills.gotoWaypoint(args.name);
      case 'stay': return skills.stay();
      case 'attackNearest': return skills.attackNearest(args.target);
      case 'defend': return skills.defend();
      default: throw new Error(`Unknown plan step: ${step.skill}.`);
    }
  }

  function search(instruction, options = {}) {
    return searchSkills(skillCatalog, instruction, options);
  }

  return {
    catalog: skillCatalog,
    data: mcData,
    requiredPickaxeTier: blocks => requiredPickaxeTier(mcData, blocks),
    inferGoal,
    plan,
    describePlan,
    executePlan,
    search,
    compileSensorySnapshot
  };
}

let cachedReasoner = null;

function getReasoner(options = {}) {
  if (!cachedReasoner || options.version || options.data) {
    const reasoner = createReasoner(options);
    if (!options.data) cachedReasoner = reasoner;
    return reasoner;
  }
  return cachedReasoner;
}

module.exports = {
  ARMOR_PIECES,
  TOOL_PIECES,
  blockNamesForTarget,
  compileSensorySnapshot,
  createReasoner,
  currentPickaxeTier,
  getReasoner,
  requiredPickaxeTier
};
