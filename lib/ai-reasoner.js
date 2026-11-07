'use strict';

// Deterministic goal reasoner. It turns a free-form request into an ordered
// plan of real skill calls, including prerequisite tool tiers, then executes
// that plan step by step and reports which step failed and why.

const minecraftData = require('minecraft-data');
const {
  PICKAXE_BY_TIER,
  TOOL_TIER,
  canonicalItem,
  isLog,
  isPlank
} = require('./ai-brain');
const {
  getSkillCatalog,
  resolveInstruction,
  searchSkills
} = require('./skill-catalog');

const DEFAULT_VERSION = '26.1';
const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];
const TOOL_PIECES = ['pickaxe', 'sword', 'axe', 'shovel', 'hoe'];
const ARMOR_TIERS = new Set(['wooden', 'stone', 'copper', 'iron', 'golden', 'diamond', 'netherite']);

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
  potato: ['potatoes']
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
  return { skill, args, why, ...extra };
}

function planSkill(entry, count, { data, inventory }) {
  const amount = count || entry.defaultCount;
  switch (entry.action) {
    case 'mine': {
      if (isLog(entry.target)) {
        return {
          title: `gather ${amount} ${entry.display}`,
          steps: [makeStep('gatherWood', { count: amount }, `Chop trees for ${amount} ${entry.display.toLowerCase()}.`)],
          rationale: 'Logs need no tool tier; any reachable tree works.'
        };
      }
      const blocks = blockNamesForTarget(entry.target);
      const tier = requiredPickaxeTier(data, blocks);
      const steps = [];
      if (tier > currentPickaxeTier(inventory)) {
        const pickaxe = PICKAXE_BY_TIER[tier];
        steps.push(makeStep(
          'ensureItem',
          { item: pickaxe, count: 1 },
          `Craft a ${pickaxe.replace(/_/g, ' ')} first; ${entry.display.toLowerCase()} needs tier ${tier} harvesting.`
        ));
      }
      steps.push(makeStep('mine', { item: entry.target, count: amount }, `Mine ${amount} ${entry.display.toLowerCase()} and collect the drops.`));
      return {
        title: `mine ${amount} ${entry.display}`,
        steps,
        rationale: tier > 0
          ? `The target blocks require a tier ${tier} pickaxe, so the plan settles tooling before digging.`
          : 'No pickaxe tier is required for these blocks.'
      };
    }
    case 'craft':
      return {
        title: `craft ${amount} ${entry.display}`,
        steps: [makeStep('ensureItem', { item: entry.target, count: amount }, `Craft ${amount} ${entry.display.toLowerCase()}, recursively gathering every ingredient first.`)],
        rationale: 'The crafting chain is resolved against the recipe, not assumed.'
      };
    case 'smelt':
      return {
        title: `smelt ${amount} ${entry.display}`,
        steps: [makeStep('smelt', { item: entry.target, count: amount }, `Fuel the furnace and smelt ${amount} ${entry.display.toLowerCase()}.`)],
        rationale: 'Smelting includes obtaining the raw input and fuel.'
      };
    case 'equip':
      return {
        title: `equip ${entry.display}`,
        steps: [makeStep('equipItem', { item: entry.target }, `Equip ${entry.display.toLowerCase()} in its correct slot, crafting it first if missing.`)],
        rationale: 'Armor goes to the matching body slot, tools to the hand, shields to the off hand.'
      };
    case 'hunt':
      return {
        title: `hunt ${entry.display}`,
        steps: [makeStep('huntMob', { target: entry.target, count: amount }, `Find and fight ${amount} ${entry.display.toLowerCase()}.`)],
        rationale: 'Combat checks health, equips the best weapon and armor, and retreats if critical.'
      };
    case 'breed':
      return {
        title: `breed ${entry.display}`,
        steps: [makeStep('breedAnimal', { target: entry.target, count: Math.max(2, amount) }, `Feed two ${entry.display.toLowerCase()} their breeding food.`)],
        rationale: 'Breeding needs two adults, the right food, and a wait for the baby.'
      };
    case 'deliver':
      return {
        title: `deliver ${amount} ${entry.display}`,
        steps: [makeStep('deliverToPlayer', { item: entry.target, count: amount }, `Obtain ${amount} ${entry.display.toLowerCase()} and drop it to the requester.`)],
        rationale: 'The plan acquires the item before walking it to the player.'
      };
    default:
      return null;
  }
}

function createReasoner({ version = DEFAULT_VERSION, data, catalog } = {}) {
  const mcData = data || minecraftData(version);
  const skillCatalog = catalog || getSkillCatalog({ version });
  const registry = mcData;

  function inferGoal(instruction) {
    const text = normalize(instruction);
    if (!text) return null;
    const tierMatch = text.match(/\b(wooden|stone|copper|iron|golden|diamond|netherite)\b/);
    const tier = tierMatch && ARMOR_TIERS.has(tierMatch[1]) ? tierMatch[1] : null;

    if (/\b(?:armor|armour)\b/.test(text)) {
      return { kind: 'armor', tier: tier || 'iron', title: `${tier || 'iron'} armor set` };
    }
    if (/\btools?\b/.test(text) && !/\b(?:pickaxe|sword|axe|shovel|hoe)\b/.test(text)) {
      return { kind: 'tools', tier: tier || 'iron', title: `${tier || 'iron'} tool set` };
    }
    if (/\b(?:night|nightfall)\b/.test(text) && /\b(?:prepare|ready|survive|safe|shelter)\b/.test(text)) {
      return { kind: 'night', title: 'survive the night' };
    }
    if (/\b(?:shelter|house|base|fort)\b/.test(text) && /\b(?:build|make|need|prepare|place)\b/.test(text)) {
      return { kind: 'shelter', title: 'shelter' };
    }
    if (/\b(?:food|eat|hungry)\b/.test(text) && /\b(?:get|gather|hunt|find|need|want|prepare|something)\b/.test(text)) {
      return { kind: 'food', title: 'food' };
    }

    const resolved = resolveInstruction(skillCatalog, instruction);
    if (resolved) return { kind: 'skill', ...resolved };
    return null;
  }

  function plan(instruction, { observation = null } = {}) {
    const goal = typeof instruction === 'string' ? inferGoal(instruction) : instruction;
    if (!goal) return null;
    const inventory = observation?.inventory || {};
    let built = null;
    let confidence = goal.confidence || 0.7;

    if (goal.kind === 'armor') {
      const steps = [];
      for (const piece of ARMOR_PIECES) {
        const item = `${goal.tier}_${piece}`;
        steps.push(makeStep('ensureItem', { item, count: 1 }, `Craft ${goal.tier} ${piece.replace(/_/g, ' ')}.`));
        steps.push(makeStep('equipItem', { item }, `Equip the ${goal.tier} ${piece.replace(/_/g, ' ')}.`));
      }
      built = {
        title: `${goal.tier} armor set`,
        steps,
        rationale: 'Each piece is crafted from ingots or equivalent materials; missing ore is mined and smelted as needed.'
      };
    } else if (goal.kind === 'tools') {
      const steps = TOOL_PIECES.map(piece => makeStep(
        'ensureItem',
        { item: `${goal.tier}_${piece}`, count: 1 },
        `Craft ${goal.tier} ${piece}.`
      ));
      built = {
        title: `${goal.tier} tool set`,
        steps,
        rationale: 'Tools share the same material base, so the plan crafts the whole set in one pass.'
      };
    } else if (goal.kind === 'night') {
      built = {
        title: 'survive the night',
        steps: [
          makeStep('gatherFood', { count: 6 }, 'Gather or cook food so hunger does not drop during the night.'),
          makeStep('ensureItem', { item: 'stone_sword', count: 1 }, 'Craft a stone sword for defense.'),
          makeStep('buildShelter', {}, 'Build or reinforce a shelter before dark.'),
          makeStep('sleep', {}, 'Sleep through the night if a bed is available.')
        ],
        rationale: 'Food, a weapon, shelter, then sleep: each step removes one night-time failure mode.'
      };
    } else if (goal.kind === 'food') {
      built = {
        title: 'get food',
        steps: [makeStep('gatherFood', { count: 6 }, 'Hunt animals or harvest mature crops.')],
        rationale: 'Gathering food directly is faster than crafting a cooked meal from nothing.'
      };
    } else if (goal.kind === 'shelter') {
      built = {
        title: 'build a shelter',
        steps: [makeStep('buildShelter', {}, 'Place a safe enclosed shelter at the current position.')],
        rationale: 'Shelter uses local materials and verifies the enclosure.'
      };
    } else if (goal.kind === 'skill') {
      built = planSkill(goal.skill, goal.count, { data: mcData, inventory });
      if (built) built.skill = goal.skill;
    }

    if (!built || built.steps.length === 0) return null;
    return {
      ...built,
      goal,
      confidence,
      version,
      createdAt: new Date().toISOString()
    };
  }

  function describePlan(built) {
    if (!built) return 'I could not turn that into a concrete plan.';
    const lines = built.steps.map((step, index) => `${index + 1}. ${step.why}`);
    return `Plan for ${built.title}: ${lines.join(' ')}`;
  }

  async function executePlan(skills, built, { onStep = () => {} } = {}) {
    if (!built || !Array.isArray(built.steps) || built.steps.length === 0) {
      throw new Error('There is no plan to execute.');
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
    search
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
  createReasoner,
  currentPickaxeTier,
  getReasoner,
  requiredPickaxeTier
};
