'use strict';

// Local, dependency-free planning helpers. These let Virgo act immediately
// without an API key, while the optional language model handles open-ended
// conversation and unusual requests.

const MAX_TASK_COUNT = 256;

const LOG_NAMES = new Set([
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log',
  'dark_oak_log', 'mangrove_log', 'cherry_log', 'pale_oak_log',
  'crimson_stem', 'warped_stem'
]);
const PLANK_NAMES = new Set([
  'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks',
  'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
  'pale_oak_planks', 'crimson_planks', 'warped_planks', 'bamboo_planks'
]);
const PLANKS_BY_LOG = {
  oak_log: 'oak_planks',
  birch_log: 'birch_planks',
  spruce_log: 'spruce_planks',
  jungle_log: 'jungle_planks',
  acacia_log: 'acacia_planks',
  dark_oak_log: 'dark_oak_planks',
  mangrove_log: 'mangrove_planks',
  cherry_log: 'cherry_planks',
  pale_oak_log: 'pale_oak_planks',
  crimson_stem: 'crimson_planks',
  warped_stem: 'warped_planks'
};
const FOOD_NAMES = new Set([
  'apple', 'baked_potato', 'beef', 'beetroot', 'beetroot_soup', 'bread',
  'carrot', 'chicken', 'cod', 'cooked_beef', 'cooked_chicken', 'cooked_cod',
  'cooked_mutton', 'cooked_porkchop', 'cooked_rabbit', 'cooked_salmon',
  'cookie', 'dried_kelp', 'golden_apple', 'golden_carrot', 'melon_slice',
  'mushroom_stew', 'mutton', 'porkchop', 'potato', 'pumpkin_pie', 'rabbit',
  'rabbit_stew', 'salmon', 'suspicious_stew', 'sweet_berries', 'tropical_fish'
]);
const COOKED_FOOD = new Set([
  'baked_potato', 'cooked_beef', 'cooked_chicken', 'cooked_cod',
  'cooked_mutton', 'cooked_porkchop', 'cooked_rabbit', 'cooked_salmon'
]);
const RAW_TO_COOKED = {
  beef: 'cooked_beef',
  chicken: 'cooked_chicken',
  cod: 'cooked_cod',
  mutton: 'cooked_mutton',
  porkchop: 'cooked_porkchop',
  rabbit: 'cooked_rabbit',
  salmon: 'cooked_salmon',
  potato: 'baked_potato'
};
const ANIMALS = new Set(['cow', 'pig', 'chicken', 'sheep', 'rabbit', 'salmon', 'cod', 'tropical_fish']);
const HOSTILE_MOBS = new Set([
  'blaze', 'cave_spider', 'creeper', 'drowned', 'elder_guardian', 'endermite',
  'evoker', 'ghast', 'guardian', 'hoglin', 'husk', 'magma_cube', 'phantom',
  'piglin_brute', 'pillager', 'ravager', 'silverfish', 'skeleton', 'slime',
  'spider', 'stray', 'vex', 'vindicator', 'witch', 'wither_skeleton',
  'zoglin', 'zombie', 'zombie_villager'
]);

const ITEM_ALIASES = [
  ['oak logs', 'oak_log'], ['oak log', 'oak_log'], ['logs', 'oak_log'], ['log', 'oak_log'],
  ['wood', 'oak_log'], ['timber', 'oak_log'], ['trees', 'oak_log'], ['tree', 'oak_log'],
  ['planks', 'oak_planks'], ['plank', 'oak_planks'], ['wooden planks', 'oak_planks'],
  ['sticks', 'stick'], ['stick', 'stick'],
  ['cobblestone', 'cobblestone'], ['cobble', 'cobblestone'],
  ['stone', 'stone'], ['rocks', 'stone'], ['rock', 'stone'],
  ['coal ore', 'coal_ore'], ['coal', 'coal'],
  ['iron ore', 'iron_ore'], ['iron', 'iron_ingot'], ['iron ingot', 'iron_ingot'],
  ['raw iron', 'raw_iron'], ['gold ore', 'gold_ore'], ['gold', 'gold_ingot'],
  ['diamond ore', 'diamond_ore'], ['diamonds', 'diamond'], ['diamond', 'diamond'],
  ['copper ore', 'copper_ore'], ['copper', 'copper_ingot'],
  ['redstone ore', 'redstone_ore'], ['redstone', 'redstone'],
  ['emerald ore', 'emerald_ore'], ['emerald', 'emerald'],
  ['lapis ore', 'lapis_ore'], ['lapis', 'lapis_lazuli'],
  ['pickaxe', 'wooden_pickaxe'], ['pick axes', 'wooden_pickaxe'], ['pick axe', 'wooden_pickaxe'],
  ['sword', 'wooden_sword'], ['axe', 'wooden_axe'], ['shovel', 'wooden_shovel'],
  ['hoe', 'wooden_hoe'],
  ['crafting table', 'crafting_table'], ['workbench', 'crafting_table'],
  ['furnace', 'furnace'], ['chest', 'chest'], ['torch', 'torch'], ['torches', 'torch'],
  ['bed', 'bed'], ['shield', 'shield'], ['bucket', 'bucket'],
  ['bread', 'bread'], ['wheat', 'wheat'], ['seeds', 'wheat_seeds'], ['wheat seeds', 'wheat_seeds'],
  ['carrots', 'carrot'], ['carrot', 'carrot'], ['potatoes', 'potato'], ['potato', 'potato'],
  ['beef', 'beef'], ['steak', 'cooked_beef'], ['chicken', 'chicken'],
  ['pork', 'porkchop'], ['porkchop', 'porkchop'], ['mutton', 'mutton'],
  ['food', 'food'], ['meat', 'food'], ['animals', 'food'], ['animal', 'food'],
  ['dirt', 'dirt'], ['sand', 'sand'], ['gravel', 'gravel'],
  ['wool', 'white_wool'], ['string', 'string'], ['leather', 'leather'],
  ['apple', 'apple'], ['apples', 'apple'],
  ['air', 'air']
];

for (const material of ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite']) {
  for (const tool of ['pickaxe', 'sword', 'axe', 'shovel', 'hoe']) {
    ITEM_ALIASES.push([`${material} ${tool}`, `${material}_${tool}`]);
  }
}
ITEM_ALIASES.push(['golden apple', 'golden_apple'], ['golden carrot', 'golden_carrot']);

const SORTED_ITEM_ALIASES = [...ITEM_ALIASES].sort((left, right) => right[0].length - left[0].length);

const TOOL_TIER = {
  wooden_pickaxe: 1,
  stone_pickaxe: 2,
  iron_pickaxe: 3,
  golden_pickaxe: 1,
  diamond_pickaxe: 4,
  netherite_pickaxe: 5
};

const RECIPE_GUIDE = {
  oak_planks: '1 log -> 4 planks (any log type works).',
  stick: '2 planks -> 4 sticks.',
  crafting_table: '4 planks -> 1 crafting table.',
  wooden_pickaxe: '3 planks + 2 sticks at a crafting table.',
  stone_pickaxe: '3 cobblestone + 2 sticks at a crafting table.',
  iron_pickaxe: '3 iron ingots + 2 sticks at a crafting table.',
  wooden_sword: '2 planks + 1 stick at a crafting table.',
  stone_sword: '2 cobblestone + 1 stick at a crafting table.',
  iron_sword: '2 iron ingots + 1 stick at a crafting table.',
  furnace: '8 cobblestone at a crafting table.',
  torch: '1 coal or charcoal + 1 stick -> 4 torches.',
  chest: '8 planks at a crafting table.',
  bed: '3 wool + 3 planks at a crafting table.',
  bread: '3 wheat at a crafting table.',
  bucket: '3 iron ingots at a crafting table.',
  shield: '6 planks + 1 iron ingot at a crafting table.'
};

const MC_FACTS = [
  [/what (?:is|are) (?:a )?(?:creeper|creepers)/i,
    'Creepers sneak up and explode. Keep 8+ blocks away, hit once, back off, and repeat. A shield blocks the blast.'],
  [/what (?:is|are) (?:a )?(?:zombie|zombies)/i,
    'Zombies burn in daylight and break doors on Hard. Fight them with a sword while backing up, or trap them behind two blocks.'],
  [/what (?:is|are) (?:a )?(?:enderman|endermen)/i,
    'Endermen teleport and hit hard. Do not look at their eyes. Wear a pumpkin if you must look, or fight them under a 2-block ceiling.'],
  [/what (?:is|are) (?:a )?(?:skeleton|skeletons)/i,
    'Skeletons shoot arrows. Close the distance while strafing, use a shield, or shoot back from cover.'],
  [/what (?:is|are) (?:a )?(?:witch|witches)/i,
    'Witches throw potions. Rush them with a sword; their healing cannot outrun steady damage.'],
  [/how (?:do|can) i (?:find|get) (?:iron|iron ore)/i,
    'Iron spawns from Y=72 down to Y=-64, most commonly around Y=16 and Y=-24. Dig a safe staircase, never straight down, and bring torches.'],
  [/how (?:do|can) i (?:find|get) (?:diamonds?|diamond ore)/i,
    'Diamonds are most common below Y=0, especially around Y=-58. Branch mine at that depth with a iron or better pickaxe and carry water.'],
  [/how (?:do|can) i (?:find|get) (?:coal|coal ore)/i,
    'Coal is common in exposed cliffs and caves from Y=256 down to Y=0. Mine it with any pickaxe.'],
  [/how (?:do|can) i (?:find|get) (?:gold|gold ore)/i,
    'Gold spawns below Y=32, most often around Y=-16 in the Badlands or Nether. Use an iron pickaxe or better.'],
  [/how (?:do|can) i (?:find|get) (?:food|eat)/i,
    'Hunt cows, pigs, chickens, sheep, or rabbits, then cook the meat in a furnace. You can also grow wheat, carrots, and potatoes.'],
  [/how (?:do|can) i (?:not )?die|survive/i,
    'Keep food above 6, carry a shield, light your base, never dig straight down, and retreat to a lit shelter at night.'],
  [/what (?:is|are) (?:the )?(?:best|strongest) (?:tool|pickaxe)/i,
    'Netherite is the strongest tier, then diamond, iron, stone, and wood. Enchant with Efficiency and Unbreaking for grinding.'],
  [/how (?:do|can) i (?:make|craft|get) (?:a )?(?:netherite|netherite ingot)/i,
    'Mine ancient debris in the Nether at Y=8-22, smelt it into netherite scrap, then combine 4 scrap + 4 gold ingots into a netherite ingot.'],
  [/how (?:do|can) i (?:make|craft|get) (?:a )?(?:beacon)/i,
    'A beacon needs 5 glass, 3 obsidian, and 1 nether star. The nether star drops from the Wither.'],
  [/how (?:do|can) i (?:make|craft|get) (?:a )?(?:shield)/i, RECIPE_GUIDE.shield],
  [/how (?:do|can) i (?:make|craft|get) (?:a )?(?:bed)/i, RECIPE_GUIDE.bed],
  [/how (?:do|can) i (?:make|craft|get) (?:a )?(?:furnace)/i, RECIPE_GUIDE.furnace],
  [/how (?:do|can) i (?:make|craft|get) (?:a )?(?:torch|torches)/i, RECIPE_GUIDE.torch]
];

const COUNT_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  stack: 64, stacks: 64, 'half stack': 32, dozen: 12
};

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9_\s:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCount(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(MAX_TASK_COUNT, Math.floor(value)));
  }
  const text = normalizeText(value);
  const stackMatch = text.match(/(\d+)\s*stacks?/);
  if (stackMatch) return Math.max(1, Math.min(MAX_TASK_COUNT, Number(stackMatch[1]) * 64));
  const digitMatch = text.match(/\b(\d{1,4})\b/);
  if (digitMatch) return Math.max(1, Math.min(MAX_TASK_COUNT, Number(digitMatch[1])));
  for (const [word, count] of Object.entries(COUNT_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return count;
  }
  return fallback;
}

function stripCount(text) {
  return text
    .replace(/\b\d{1,4}\s*(?:x\s*)?/g, ' ')
    .replace(/\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|dozen|stack|stacks|half stack)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularize(value) {
  const word = String(value || '').trim();
  if (word.endsWith('ies') && word.length > 3) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ves') && word.length > 3) return `${word.slice(0, -3)}f`;
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) return word.slice(0, -1);
  return word;
}

function cleanItemPhrase(value) {
  let text = normalizeText(value)
    .replace(/^(?:some|any|the|my|your|me|us|please|pls|for me|for us)\s+/g, '')
    .replace(/\s+(?:please|pls|for me|for us|now|quickly|asap)$/g, '')
    .replace(/\b(?:blocks?|items?|pieces?|units?|ores?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  for (const [alias, item] of SORTED_ITEM_ALIASES) {
    if (text === alias) return item;
  }
  for (const [alias, item] of SORTED_ITEM_ALIASES) {
    if (text.endsWith(` ${alias}`)) return item;
  }
  text = singularize(text).replace(/\s+/g, '_');
  return /^[a-z0-9_]+$/.test(text) ? text : '';
}

function extractItem(text) {
  const normalized = normalizeText(text);
  for (const [alias, item] of SORTED_ITEM_ALIASES) {
    if (new RegExp(`(?:^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(normalized)) {
      return item;
    }
  }
  return cleanItemPhrase(normalized
    .replace(/^(?:mine|get|gather|chop|dig|collect|craft|make|smelt|cook|give|bring|equip|use|find|need|want|deliver|toss|drop)\s+/i, '')
    .replace(/^(?:me|us)\s+/i, ''));
}

function isLog(name) {
  return LOG_NAMES.has(name);
}

function isPlank(name) {
  return PLANK_NAMES.has(name);
}

function isFood(name) {
  return FOOD_NAMES.has(name);
}

function plankForLog(logName) {
  return PLANKS_BY_LOG[logName] || 'oak_planks';
}

function canonicalItem(name, fallback = '') {
  const cleaned = normalizeText(name).replace(/\s+/g, '_');
  if (!cleaned) return fallback;
  for (const [alias, item] of SORTED_ITEM_ALIASES) {
    if (cleaned === alias.replace(/\s+/g, '_')) return item;
  }

  // Preserve valid Minecraft IDs whose final letter is s; blindly singularizing
  // these turns real items such as cherry_planks into nonexistent cherry_plank.
  if (PLANK_NAMES.has(cleaned) || FOOD_NAMES.has(cleaned) ||
    ['shears', 'fireworks', 'wheat_seeds', 'pumpkin_seeds', 'melon_seeds'].includes(cleaned)) {
    return cleaned;
  }
  if (cleaned.endsWith('_plank') && PLANK_NAMES.has(`${cleaned}s`)) return `${cleaned}s`;

  const compoundPlurals = [
    ['_pickaxes', '_pickaxe'], ['_swords', '_sword'], ['_shovels', '_shovel'],
    ['_hoes', '_hoe'], ['_axes', '_axe'], ['_logs', '_log']
  ];
  for (const [plural, singular] of compoundPlurals) {
    if (cleaned.endsWith(plural)) return `${cleaned.slice(0, -plural.length)}${singular}`;
  }
  return cleaned.includes('_') ? cleaned : singularize(cleaned);
}

function parseLocalIntent(rawText) {
  const raw = typeof rawText === 'string' ? rawText.trim() : '';
  const text = normalizeText(raw);
  if (!text) return { type: 'help', raw };

  if (/^(?:help|commands|what can you do|how do i use you)$/.test(text)) return { type: 'help', raw };
  if (/^(?:status|what are you doing|progress|are you done)\b/.test(text)) return { type: 'status', raw };
  if (/^(?:stop|halt|cancel|abort|enough)\b/.test(text)) return { type: 'stop', raw };
  if (/^(?:pause|wait|hold on|stand by)\b/.test(text)) return { type: 'pause', raw };
  if (/^(?:resume|continue|keep going|carry on)\b/.test(text)) return { type: 'resume', raw };

  const teach = text.match(/^(?:teach|learn|remember|note)\s+(.+)$/);
  if (teach) return { type: 'teach', text: teach[1].trim(), raw };
  const forget = text.match(/^(?:forget|delete note)\s+(.+)$/);
  if (forget) return { type: 'forget', text: forget[1].trim(), raw };

  if (/^(?:come|come here|come to me|tp to me|teleport to me)\b/.test(text)) {
    return { type: 'come', player: 'requester', raw };
  }
  if (/^(?:follow|follow me|stay with me|escort me)\b/.test(text)) {
    const target = text.match(/(?:follow|escort)\s+([a-z0-9_]{2,16})/);
    return {
      type: 'follow',
      player: target && !['me', 'us'].includes(target[1]) ? target[1] : 'requester',
      durationMs: 120000,
      raw
    };
  }
  if (/^(?:stay|stay here|wait here|hold position|guard|guard here)\b/.test(text)) {
    return { type: 'stay', raw };
  }

  if (/^(?:inventory|inv|what do you have|what is in your inventory|items)\b/.test(text)) {
    return { type: 'inventory', raw };
  }
  if (/^(?:where are you|coords|coordinates|position|where)\b/.test(text)) {
    return { type: 'where', raw };
  }
  if (/^(?:health|hp|how much health|are you hurt)\b/.test(text)) {
    return { type: 'health', raw };
  }
  if (/^(?:food|hunger|are you hungry)\b/.test(text)) {
    return { type: 'food', raw };
  }
  if (/^(?:time|what time is it|is it day|is it night)\b/.test(text)) {
    return { type: 'time', raw };
  }
  if (/^(?:players|who is online|who is here)\b/.test(text)) {
    return { type: 'players', raw };
  }
  if (/^(?:nearby|what is nearby|surroundings|see)\b/.test(text)) {
    return { type: 'nearby', raw };
  }
  if (/^(?:stats|skills|what have you learned|memory)\b/.test(text)) {
    return { type: 'stats', raw };
  }

  const recipe = raw.match(/(?:how (?:do|can) i (?:make|craft|get)|what (?:do i need|are the ingredients) (?:for|to make))\s+(?:a|an|the)?\s*(.+)$/i);
  if (recipe) {
    return { type: 'recipe', item: extractItem(recipe[1]) || cleanItemPhrase(recipe[1]), raw };
  }

  const grind = text.match(/^(?:grind|auto|automatic|keep grinding|start grinding|go grind|work|help me grind)(?:\s+(.+))?$/);
  if (grind) {
    const goalText = (grind[1] || '').trim();
    let goal = 'auto';
    let item = null;
    if (/wood|log|tree|timber/.test(goalText)) goal = 'wood';
    else if (/stone|cobble|rock/.test(goalText)) goal = 'stone';
    else if (/coal/.test(goalText)) goal = 'coal';
    else if (/iron/.test(goalText)) goal = 'iron';
    else if (/diamond/.test(goalText)) goal = 'diamond';
    else if (/food|eat|hunt|meat/.test(goalText)) goal = 'food';
    else if (/farm|crop|wheat/.test(goalText)) goal = 'farm';
    else if (/build|shelter|house|base/.test(goalText)) goal = 'build';
    else if (goalText) item = extractItem(goalText) || cleanItemPhrase(goalText);
    return { type: 'grind', goal, item, raw };
  }

  if (/^(?:what should i do|what next|what now|plan|suggest|advice|help me)\b/.test(text)) {
    return { type: 'plan', raw };
  }

  if (/^(?:eat|feed yourself|have a snack)\b/.test(text)) return { type: 'eat', raw };
  if (/^(?:sleep|go to bed|rest)\b/.test(text)) return { type: 'sleep', raw };
  if (/^(?:farm|crops|harvest|plant)\b/.test(text)) return { type: 'farm', raw };
  if (/^(?:build|shelter|house|base|fort)\b/.test(text)) return { type: 'build', raw };
  if (/^(?:defend|protect me|kill (?:the )?(?:mob|zombie|skeleton|creeper))\b/.test(text)) {
    return { type: 'defend', raw };
  }
  if (/^(?:explore|scout|look around|roam)\b/.test(text)) {
    return { type: 'explore', radius: parseCount(text.match(/radius\s+(\d+)/)?.[1], 24), raw };
  }

  const give = text.match(/^(?:give|bring|deliver|hand|toss|drop)\s+(?:me|us)?\s*(?:(\d+)\s+)?(.+)$/);
  if (give) {
    const item = extractItem(give[2]);
    if (item) {
      return {
        type: 'deliver',
        item,
        count: parseCount(give[1], 8),
        player: 'requester',
        raw
      };
    }
  }

  const mine = text.match(/^(?:mine|dig|chop|cut|gather|collect|get|find|harvest|grind for)\s+(?:(\d+)\s+)?(.+)$/);
  if (mine) {
    const phrase = mine[2];
    const item = extractItem(phrase);
    if (item) {
      const count = parseCount(mine[1], /log|wood|timber/.test(phrase) ? 16 : 8);
      if (isLog(item) || /wood|log|timber|tree/.test(phrase)) {
        return { type: 'gather', goal: 'wood', item: item || 'oak_log', count, raw };
      }
      if (/food|meat|animal|hunt/.test(phrase)) {
        return { type: 'gather', goal: 'food', item: 'food', count, raw };
      }
      if (/stone|cobble|rock/.test(item)) {
        return { type: 'mine', item: 'stone', count, raw };
      }
      return { type: 'mine', item, count, raw };
    }
  }

  const craft = text.match(/^(?:craft|make|build|create)\s+(?:(\d+)\s+)?(.+)$/);
  if (craft) {
    const item = extractItem(craft[2]);
    if (item) {
      return { type: 'craft', item, count: parseCount(craft[1], 1), raw };
    }
  }

  const smelt = text.match(/^(?:smelt|cook|furnace)\s+(?:(\d+)\s+)?(.+)$/);
  if (smelt) {
    const item = extractItem(smelt[2]);
    if (item) return { type: 'smelt', item, count: parseCount(smelt[1], 8), raw };
  }

  const equip = text.match(/^(?:equip|wear|hold|use)\s+(.+)$/);
  if (equip) {
    const item = extractItem(equip[1]);
    if (item) return { type: 'equip', item, raw };
  }

  const attack = text.match(/^(?:attack|kill|fight|slay)\s+(.+)$/);
  if (attack) {
    const target = extractItem(attack[1]) || normalizeText(attack[1]);
    return { type: 'attack', target, raw };
  }

  const learnFact = text.match(/^(?:that|this is|my|i like|i prefer|i hate|dont|don't)\s+(.+)$/);
  if (learnFact) return { type: 'teach', text: raw, raw };

  if (/^(?:hi|hello|hey|yo|sup|hiya|good morning|good evening|how are you)\b/.test(text)) {
    return { type: 'chat', intent: 'greeting', raw };
  }
  if (/^(?:thanks|thank you|ty|nice|good job|well done|great|awesome)\b/.test(text)) {
    return { type: 'chat', intent: 'thanks', raw };
  }
  if (/^(?:yes|yeah|yep|ok|okay|sure|cool)\b/.test(text)) {
    return { type: 'chat', intent: 'acknowledge', raw };
  }
  if (/^(?:no|nope|dont|stop it)\b/.test(text)) return { type: 'stop', raw };

  if (/^(?:can|could|would|will) you\s+(.+)$/.test(text)) {
    const inner = raw.replace(/^(?:can|could|would|will)\s+you\s+/i, '');
    const parsed = parseLocalIntent(inner);
    if (parsed.type !== 'chat') return parsed;
  }

  return { type: 'chat', intent: 'question', raw };
}

function planForIntent(intent) {
  switch (intent.type) {
    case 'come':
      return [{ skill: 'comeToPlayer', args: { player: intent.player || 'requester' } }];
    case 'follow':
      return [{ skill: 'followPlayer', args: { player: intent.player || 'requester', durationMs: intent.durationMs } }];
    case 'mine':
      return [{ skill: 'mine', args: { item: intent.item, count: intent.count } }];
    case 'gather':
      if (intent.goal === 'wood') return [{ skill: 'gatherWood', args: { count: intent.count } }];
      if (intent.goal === 'food') return [{ skill: 'gatherFood', args: { count: intent.count } }];
      return [{ skill: 'gather', args: { goal: intent.goal, count: intent.count } }];
    case 'craft':
      return [{ skill: 'ensureItem', args: { item: intent.item, count: intent.count } }];
    case 'smelt':
      return [{ skill: 'smelt', args: { item: intent.item, count: intent.count } }];
    case 'deliver':
      return [{ skill: 'deliverToPlayer', args: { item: intent.item, count: intent.count, player: intent.player || 'requester' } }];
    case 'eat':
      return [{ skill: 'eat', args: {} }];
    case 'sleep':
      return [{ skill: 'sleep', args: {} }];
    case 'farm':
      return [{ skill: 'farm', args: {} }];
    case 'build':
      return [{ skill: 'buildShelter', args: {} }];
    case 'attack':
      return [{ skill: 'attackNearest', args: { target: intent.target } }];
    case 'defend':
      return [{ skill: 'defend', args: {} }];
    case 'explore':
      return [{ skill: 'explore', args: { radius: intent.radius } }];
    case 'equip':
      return [{ skill: 'equipItem', args: { item: intent.item } }];
    case 'stay':
      return [{ skill: 'stay', args: {} }];
    default:
      return [];
  }
}

function describeIntent(intent) {
  switch (intent.type) {
    case 'come': return 'come to you';
    case 'follow': return 'follow you';
    case 'mine': return `mine ${intent.count} ${intent.item.replace(/_/g, ' ')}`;
    case 'gather': return `gather ${intent.count} ${intent.goal}`;
    case 'craft': return `craft ${intent.count} ${intent.item.replace(/_/g, ' ')}`;
    case 'smelt': return `smelt ${intent.count} ${intent.item.replace(/_/g, ' ')}`;
    case 'deliver': return `bring you ${intent.count} ${intent.item.replace(/_/g, ' ')}`;
    case 'eat': return 'eat something';
    case 'sleep': return 'find a bed';
    case 'farm': return 'work the farm';
    case 'build': return 'build a shelter';
    case 'attack': return `fight ${intent.target}`;
    case 'defend': return 'defend the area';
    case 'explore': return 'scout the area';
    case 'grind': return intent.goal && intent.goal !== 'auto' ? `grind ${intent.goal}` : 'grind resources';
    case 'equip': return `equip ${intent.item.replace(/_/g, ' ')}`;
    case 'stay': return 'hold position';
    default: return intent.type;
  }
}

function inventoryFromList(list) {
  const counts = {};
  for (const entry of list || []) {
    if (!entry || !entry.name) continue;
    counts[entry.name] = (counts[entry.name] || 0) + (entry.count || 1);
  }
  return counts;
}

function total(inventory, names) {
  if (!inventory) return 0;
  if (typeof names === 'string') return inventory[names] || 0;
  return (names || []).reduce((sum, name) => sum + (inventory[name] || 0), 0);
}

function bestPickaxe(inventory) {
  let best = null;
  let tier = 0;
  for (const [name, count] of Object.entries(inventory || {})) {
    if (count > 0 && TOOL_TIER[name] && TOOL_TIER[name] > tier) {
      best = name;
      tier = TOOL_TIER[name];
    }
  }
  return best;
}

function hasFood(inventory) {
  return Object.entries(inventory || {}).some(([name, count]) => count > 0 && FOOD_NAMES.has(name));
}

function formatInventory(inventory, maximum = 12) {
  const entries = Object.entries(inventory || {}).filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, maximum)
    .map(([name, count]) => `${count} ${name.replace(/_/g, ' ')}`);
  return entries.length ? entries.join(', ') : 'empty';
}

function formatTime(observation) {
  if (!observation?.time) return 'unknown';
  const { timeOfDay, isDay, day } = observation.time;
  const phase = isDay ? 'day' : 'night';
  return `day ${day ?? '?'} ${phase} (${timeOfDay ?? '?'}/24000)`;
}

function parseTeachingRules(notes) {
  const rules = {
    keep: {},
    avoid: new Set(),
    prefer: {}
  };
  for (const note of notes || []) {
    const text = normalizeText(note);
    const keep = text.match(/(?:always |please )?(?:keep|save|reserve|hold)\s+(?:at least\s+)?(\d+)\s+([a-z0-9_ ]+)/);
    if (keep) {
      const item = extractItem(keep[2]);
      if (item) rules.keep[item] = Math.max(rules.keep[item] || 0, Number(keep[1]));
    }
    const avoid = text.match(/(?:dont|do not|never|avoid)\s+(?:mine|dig|break|touch|attack|kill)\s+(?:the\s+)?([a-z0-9_ ]+)/);
    if (avoid) {
      const item = extractItem(avoid[1]);
      if (item) rules.avoid.add(item);
    }
    if (text.includes('prefer') || text.includes('favorite') || text.includes('favourite')) {
      const prefer = text.match(/(?:prefer|favorite|favourite)\s+([a-z0-9_ ]+)/);
      if (prefer) {
        const item = extractItem(prefer[1]);
        if (item) rules.prefer[item] = true;
      }
    }
  }
  return rules;
}

function chooseGoal(observation, memory, options = {}) {
  const inventory = observation?.inventory || inventoryFromList(observation?.inventoryList);
  const health = Number(observation?.health ?? 20);
  const food = Number(observation?.food ?? 20);
  const hostiles = observation?.nearbyHostiles || [];
  const rules = parseTeachingRules(memory?.getNotes ? memory.getNotes() : []);
  const config = options.config || {};
  const forced = options.goal && options.goal !== 'auto' ? options.goal : null;
  const pickaxe = bestPickaxe(inventory);
  const hasSword = total(inventory, ['wooden_sword', 'stone_sword', 'iron_sword', 'golden_sword', 'diamond_sword', 'netherite_sword']) > 0;
  const wood = total(inventory, [...LOG_NAMES]);
  const planks = total(inventory, [...PLANK_NAMES]);
  const cobble = total(inventory, ['cobblestone', 'cobbled_deepslate', 'blackstone']);
  const coal = total(inventory, ['coal', 'charcoal']);
  const torches = total(inventory, ['torch']);
  const iron = total(inventory, ['iron_ingot', 'raw_iron', 'iron_ore']);
  const wheat = total(inventory, ['wheat', 'wheat_seeds', 'carrot', 'potato']);
  const isNight = observation?.time?.isDay === false;

  if (health <= 10 && hostiles.length) {
    return { skill: 'survive', args: {}, reason: 'Low health with hostiles nearby', priority: 100 };
  }
  if (food <= 6) {
    if (hasFood(inventory)) return { skill: 'eat', args: {}, reason: 'Hungry', priority: 95 };
    return { skill: 'gatherFood', args: { count: 8 }, reason: 'No food while hungry', priority: 94 };
  }
  if (health <= 14 && hasFood(inventory)) {
    return { skill: 'eat', args: {}, reason: 'Healing up', priority: 90 };
  }

  if (forced === 'food') return { skill: 'gatherFood', args: { count: 12 }, reason: 'Requested food grind', priority: 80 };
  if (forced === 'wood') return { skill: 'gatherWood', args: { count: 32 }, reason: 'Requested wood grind', priority: 80 };
  if (forced === 'stone') return { skill: 'mine', args: { item: 'stone', count: 32 }, reason: 'Requested stone grind', priority: 80 };
  if (forced === 'coal') return { skill: 'mine', args: { item: 'coal_ore', count: 16 }, reason: 'Requested coal grind', priority: 80 };
  if (forced === 'iron') return { skill: 'mine', args: { item: 'iron_ore', count: 12 }, reason: 'Requested iron grind', priority: 80 };
  if (forced === 'diamond') return { skill: 'mine', args: { item: 'diamond_ore', count: 4 }, reason: 'Requested diamond grind', priority: 75 };
  if (forced === 'farm') return { skill: 'farm', args: {}, reason: 'Requested farm work', priority: 80 };
  if (forced === 'build') return { skill: 'buildShelter', args: {}, reason: 'Requested shelter', priority: 80 };
  if (forced && !['auto'].includes(forced)) {
    return { skill: 'ensureItem', args: { item: forced, count: 16 }, reason: `Requested ${forced} grind`, priority: 70 };
  }

  const previousMine = memory?.getSkill?.('goal:mine');
  const mineFailedRecently = previousMine?.failures > 0 &&
    /could not find reachable/i.test(previousMine.lastDetail || '') &&
    Date.now() - Date.parse(previousMine.lastUsedAt || 0) < 5 * 60 * 1000;
  if (mineFailedRecently) {
    const visibleLogs = (observation?.nearbyBlocks || []).some(block => LOG_NAMES.has(block.name));
    return visibleLogs
      ? { skill: 'gatherWood', args: { count: 16 }, reason: 'Mining route failed recently; switching to visible wood', priority: 68 }
      : { skill: 'explore', args: { radius: 16 }, reason: 'Mining route failed recently; scouting for reachable resources', priority: 68 };
  }

  if (!pickaxe) {
    if (wood + planks >= 4) {
      return { skill: 'ensureItem', args: { item: 'wooden_pickaxe', count: 1 }, reason: 'No pickaxe yet', priority: 70 };
    }
    return { skill: 'gatherWood', args: { count: 8 }, reason: 'Need wood for a pickaxe', priority: 69 };
  }
  if (!hasSword && cobble < 2) {
    return { skill: 'mine', args: { item: 'stone', count: 8 }, reason: 'Need stone for a sword', priority: 66 };
  }
  if (!hasSword) {
    return { skill: 'ensureItem', args: { item: 'stone_sword', count: 1 }, reason: 'No sword yet', priority: 65 };
  }
  if (wood + planks < 16) {
    return { skill: 'gatherWood', args: { count: 24 }, reason: 'Low on wood', priority: 60 };
  }
  if (cobble < 24) {
    return { skill: 'mine', args: { item: 'stone', count: 32 }, reason: 'Low on stone', priority: 58 };
  }
  if (coal < 8) {
    return { skill: 'mine', args: { item: 'coal_ore', count: 16 }, reason: 'Low on coal', priority: 56 };
  }
  if (torches < 8) {
    return { skill: 'ensureItem', args: { item: 'torch', count: 16 }, reason: 'Need light for the base', priority: 54 };
  }
  if (iron < 6 && ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'].includes(pickaxe)) {
    return { skill: 'mine', args: { item: 'iron_ore', count: 12 }, reason: 'Need iron', priority: 52 };
  }
  if (isNight && !observation?.shelter) {
    return { skill: 'buildShelter', args: {}, reason: 'Night is coming', priority: 50 };
  }
  if (wheat > 0 && total(inventory, ['wheat_seeds']) > 0) {
    return { skill: 'farm', args: {}, reason: 'Tend the farm', priority: 30 };
  }
  if (rules.keep && Object.keys(rules.keep).length) {
    for (const [item, amount] of Object.entries(rules.keep)) {
      if (total(inventory, item) < amount) {
        return { skill: 'ensureItem', args: { item, count: amount }, reason: `Teaching rule: keep ${amount} ${item}`, priority: 48 };
      }
    }
  }
  if (config.digForOres && iron < 12) {
    return { skill: 'mine', args: { item: 'iron_ore', count: 8 }, reason: 'Explore for iron', priority: 25 };
  }
  return { skill: 'explore', args: { radius: 24 }, reason: 'Scout for resources', priority: 10 };
}

function describeGoal(goal) {
  if (!goal) return 'idle';
  const item = goal.args?.item ? ` ${goal.args.item.replace(/_/g, ' ')}` : '';
  const count = goal.args?.count ? ` x${goal.args.count}` : '';
  switch (goal.skill) {
    case 'eat': return 'eating';
    case 'gatherFood': return 'hunting for food';
    case 'gatherWood': return `chopping wood${count}`;
    case 'mine': return `mining${item}${count}`;
    case 'ensureItem': return `crafting${item}${count}`;
    case 'buildShelter': return 'building a shelter';
    case 'farm': return 'working the farm';
    case 'explore': return 'scouting';
    case 'survive': return 'surviving';
    default: return goal.skill.replace(/([A-Z])/g, ' $1').toLowerCase();
  }
}

function recipeAnswer(item) {
  const name = canonicalItem(item || '');
  if (RECIPE_GUIDE[name]) return RECIPE_GUIDE[name];
  if (name.endsWith('_planks')) return '1 matching log -> 4 planks.';
  if (name.endsWith('_pickaxe')) {
    const material = name.replace('_pickaxe', '');
    return `3 ${material} + 2 sticks at a crafting table.`;
  }
  if (name.endsWith('_sword')) {
    const material = name.replace('_sword', '');
    return `2 ${material} + 1 stick at a crafting table.`;
  }
  if (name.endsWith('_axe')) {
    const material = name.replace('_axe', '');
    return `3 ${material} + 2 sticks at a crafting table.`;
  }
  if (name.endsWith('_shovel')) {
    const material = name.replace('_shovel', '');
    return `1 ${material} + 2 sticks at a crafting table.`;
  }
  return '';
}

function answerKnownQuestion(rawText, observation, memory) {
  const text = normalizeText(rawText);
  if (/^(?:hi|hello|hey|yo|sup|hiya)\b/.test(text)) {
    return 'Hey! I am Virgo. Ask me to mine, craft, build, farm, fight, follow you, or just say "grind".';
  }
  if (/^(?:thanks|thank you|ty|nice|good job|well done|great|awesome)\b/.test(text)) {
    return 'Anytime. I will keep improving.';
  }
  if (/^(?:how are you|how is it going)\b/.test(text)) {
    return `I am ${observation?.health ?? '?'} health, ${observation?.food ?? '?'} food, at ${formatPosition(observation)}.`;
  }
  if (/^(?:inventory|inv|what do you have|what is in your inventory|items)\b/.test(text)) {
    return `I have ${formatInventory(observation?.inventory || inventoryFromList(observation?.inventoryList))}.`;
  }
  if (/^(?:where are you|coords|coordinates|position|where)\b/.test(text)) {
    return `I am at ${formatPosition(observation)}.`;
  }
  if (/^(?:health|hp|how much health|are you hurt)\b/.test(text)) {
    return `Health ${observation?.health ?? '?'}/20, food ${observation?.food ?? '?'}/20.`;
  }
  if (/^(?:food|hunger|are you hungry)\b/.test(text)) {
    return `Food is ${observation?.food ?? '?'}/20. ${Number(observation?.food ?? 20) <= 6 ? 'I should eat soon.' : 'I am okay.'}`;
  }
  if (/^(?:time|what time is it|is it day|is it night)\b/.test(text)) {
    return `It is ${formatTime(observation)}.`;
  }
  if (/^(?:players|who is online|who is here)\b/.test(text)) {
    const players = Object.keys(observation?.players || {});
    return players.length ? `Online: ${players.join(', ')}.` : 'I do not see other players nearby.';
  }
  if (/^(?:nearby|what is nearby|surroundings|see)\b/.test(text)) {
    const blocks = (observation?.nearbyBlocks || []).slice(0, 10).map(entry =>
      typeof entry === 'string' ? entry : `${entry.name} (${entry.distance}m)`);
    const mobs = (observation?.nearbyHostiles || []).slice(0, 5).map(entry => entry.name || entry);
    return `Nearby blocks: ${blocks.join(', ') || 'none'}. ${mobs.length ? `Hostiles: ${mobs.join(', ')}.` : 'No hostiles close.'}`;
  }
  if (/^(?:stats|skills|what have you learned|memory)\b/.test(text)) {
    const skills = (memory?.getSkills ? memory.getSkills() : []).slice(-6)
      .map(skill => `${skill.name} ${skill.successes}/${skill.attempts}`);
    return skills.length ? `Skill record: ${skills.join(', ')}.` : 'I have not recorded any skills yet.';
  }

  for (const [pattern, answer] of MC_FACTS) {
    if (pattern.test(text)) return answer;
  }
  const recipe = text.match(/(?:how (?:do|can) i (?:make|craft|get)|what (?:do i need|are the ingredients) (?:for|to make))\s+(?:a|an|the)?\s*(.+)$/);
  if (recipe) {
    const answer = recipeAnswer(extractItem(recipe[1]) || cleanItemPhrase(recipe[1]));
    if (answer) return answer;
  }
  return '';
}

function formatPosition(observation) {
  const position = observation?.position;
  if (!position) return 'an unknown position';
  return `${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)}`;
}

function suggestNext(observation, memory) {
  const goal = chooseGoal(observation, memory, {});
  return `Next: ${describeGoal(goal)} (${goal.reason}).`;
}

module.exports = {
  ANIMALS,
  COOKED_FOOD,
  FOOD_NAMES,
  HOSTILE_MOBS,
  ITEM_ALIASES,
  LOG_NAMES,
  MAX_TASK_COUNT,
  MC_FACTS,
  PLANK_NAMES,
  RAW_TO_COOKED,
  RECIPE_GUIDE,
  TOOL_TIER,
  answerKnownQuestion,
  bestPickaxe,
  canonicalItem,
  chooseGoal,
  cleanItemPhrase,
  describeGoal,
  describeIntent,
  extractItem,
  formatInventory,
  formatPosition,
  formatTime,
  hasFood,
  inventoryFromList,
  isFood,
  isLog,
  isPlank,
  normalizeText,
  parseCount,
  parseLocalIntent,
  parseTeachingRules,
  planForIntent,
  plankForLog,
  recipeAnswer,
  suggestNext,
  total
};
