'use strict';

// Builds a deterministic catalog of executable Minecraft skills from the
// installed minecraft-data version. Every entry maps to a real AISkills
// method; nothing here is decorative.

const minecraftData = require('minecraft-data');
const {
  ANIMALS,
  BREED_FOODS,
  HOSTILE_MOBS,
  RAW_TO_COOKED,
  canonicalItem
} = require('./ai-brain');

const DEFAULT_VERSION = '26.1';
const MAX_SKILL_COUNT = 256;

const SKIP_BLOCK_NAMES = new Set([
  'air', 'cave_air', 'void_air', 'barrier', 'light', 'structure_void',
  'command_block', 'chain_command_block', 'repeating_command_block',
  'structure_block', 'jigsaw', 'end_portal', 'end_portal_frame',
  'end_gateway', 'nether_portal', 'frosted_ice', 'ice', 'packed_ice',
  'blue_ice', 'spawner', 'trial_spawner', 'vault', 'budding_amethyst',
  'reinforced_deepslate', 'moving_piston', 'piston_head'
]);

const SMELT_OUTPUTS = [
  'iron_ingot', 'gold_ingot', 'copper_ingot', 'charcoal', 'glass', 'stone',
  ...Object.values(RAW_TO_COOKED)
];

const SMELT_INPUT_ALIASES = {
  sand: 'glass',
  cobblestone: 'stone',
  raw_iron: 'iron_ingot',
  iron_ore: 'iron_ingot',
  deepslate_iron_ore: 'iron_ingot',
  raw_gold: 'gold_ingot',
  gold_ore: 'gold_ingot',
  deepslate_gold_ore: 'gold_ingot',
  raw_copper: 'copper_ingot',
  copper_ore: 'copper_ingot',
  deepslate_copper_ore: 'copper_ingot',
  clay_ball: 'brick',
  wet_sponge: 'sponge',
  kelp: 'dried_kelp',
  cactus: 'green_dye'
};

const EQUIP_SUFFIX = /_(?:helmet|chestplate|leggings|boots|sword|pickaxe|axe|shovel|hoe)$/;
const EQUIP_EXTRAS = new Set(['shield', 'elytra', 'totem_of_undying', 'carved_pumpkin']);

const CATEGORY_PRIORITY = {
  mine: 7,
  craft: 6,
  hunt: 6,
  breed: 5,
  smelt: 5,
  equip: 5,
  deliver: 1
};

const CATEGORY_LABELS = {
  mine: 'mining',
  craft: 'crafting',
  smelt: 'smelting',
  equip: 'equipment',
  hunt: 'hunting',
  breed: 'breeding',
  deliver: 'delivery'
};

const VERB_CATEGORY = [
  [/^(?:mine|dig|break|collect|gather|get|find|farm|harvest)\b/, 'mine'],
  [/^(?:craft|make|create|build)\b/, 'craft'],
  [/^(?:smelt|cook|burn|furnace)\b/, 'smelt'],
  [/^(?:equip|wear|wield|hold)\b/, 'equip'],
  [/^(?:deliver|bring|give|hand|toss|drop)\b/, 'deliver'],
  [/^(?:hunt|kill|slay|fight|attack)\b/, 'hunt'],
  [/^(?:breed|mate|feed)\b/, 'breed']
];

const POLITE_PREFIX = /^(?:me|us|some|a|an|the|my|please|for)\s+/;
const POLITE_SUFFIX = /\s+(?:please|now|for me)$/;

function normalizePhrase(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function singularTokens(token) {
  const variants = new Set();
  if (token.endsWith('ies') && token.length > 4) {
    variants.add(`${token.slice(0, -3)}y`);
    variants.add(token.slice(0, -1));
  } else if (token.endsWith('ses') && token.length > 4) {
    variants.add(token.slice(0, -2));
  } else if (token.endsWith('s') && token.length > 3) {
    variants.add(token.slice(0, -1));
  }
  return variants;
}

function tokenize(value) {
  const tokens = normalizePhrase(value).split(' ').filter(Boolean);
  const expanded = new Set();
  for (const token of tokens) {
    expanded.add(token);
    for (const variant of singularTokens(token)) expanded.add(variant);
  }
  return expanded;
}

function entryId(action, target) {
  return `${action}:${target.replace(/_/g, '_')}`;
}

function makeEntry(action, target, display, defaultCount, description) {
  return {
    id: entryId(action, target),
    action,
    category: action,
    target,
    display,
    defaultCount,
    description,
    targetNorm: normalizePhrase(target.replace(/_/g, ' ')),
    displayNorm: normalizePhrase(display),
    tokens: tokenize(`${target.replace(/_/g, ' ')} ${display}`)
  };
}

function buildSkillCatalog({ version = DEFAULT_VERSION, data } = {}) {
  const mcData = data || minecraftData(version);
  const skills = new Map();
  const add = entry => {
    if (!skills.has(entry.id)) skills.set(entry.id, entry);
  };
  const itemByOutputId = id => mcData.items?.[id]?.name || mcData.itemsById?.[id]?.name || null;

  for (const block of Object.values(mcData.blocksByName || {})) {
    if (!block || block.diggable === false) continue;
    if (SKIP_BLOCK_NAMES.has(block.name)) continue;
    const item = mcData.itemsByName?.[block.name];
    if (!item) continue;
    const display = block.displayName || item.displayName || block.name.replace(/_/g, ' ');
    add(makeEntry(
      'mine',
      block.name,
      display,
      8,
      `Travel to and mine ${display.toLowerCase()} until the requested amount is collected.`
    ));
  }

  for (const outputId of Object.keys(mcData.recipes || {})) {
    const name = itemByOutputId(outputId);
    if (!name) continue;
    const item = mcData.itemsByName[name];
    const display = item?.displayName || name.replace(/_/g, ' ');
    add(makeEntry(
      'craft',
      name,
      display,
      1,
      `Craft ${display.toLowerCase()}, gathering or crafting every ingredient it needs.`
    ));
  }

  for (const name of new Set(SMELT_OUTPUTS)) {
    const item = mcData.itemsByName?.[name];
    if (!item) continue;
    const display = item.displayName || name.replace(/_/g, ' ');
    add(makeEntry(
      'smelt',
      name,
      display,
      8,
      `Fuel a furnace and smelt ${display.toLowerCase()} from its raw input.`
    ));
  }

  for (const [name, item] of Object.entries(mcData.itemsByName || {})) {
    if (!EQUIP_SUFFIX.test(name) && !EQUIP_EXTRAS.has(name)) continue;
    const display = item.displayName || name.replace(/_/g, ' ');
    add(makeEntry(
      'equip',
      name,
      display,
      1,
      `Put on or hold ${display.toLowerCase()} from the inventory in the correct slot.`
    ));
  }

  const huntNames = new Set([...HOSTILE_MOBS, ...ANIMALS]);
  for (const name of huntNames) {
    const entity = mcData.entitiesByName?.[name];
    if (!entity) continue;
    const display = entity.displayName || name.replace(/_/g, ' ');
    add(makeEntry(
      'hunt',
      name,
      display,
      1,
      `Find, approach, and defeat nearby ${display.toLowerCase()}.`
    ));
  }

  for (const [name, food] of Object.entries(BREED_FOODS)) {
    const entity = mcData.entitiesByName?.[name];
    if (!entity) continue;
    const display = entity.displayName || name.replace(/_/g, ' ');
    add(makeEntry(
      'breed',
      name,
      display,
      2,
      `Feed ${food.replace(/_/g, ' ')} to two nearby ${display.toLowerCase()} and wait for a baby.`
    ));
  }

  const deliverTargets = new Set();
  for (const entry of skills.values()) {
    if (entry.action === 'mine' || entry.action === 'craft' || entry.action === 'smelt') {
      deliverTargets.add(entry.target);
    }
  }
  for (const target of deliverTargets) {
    const item = mcData.itemsByName?.[target] || mcData.itemsByName?.[target.replace(/_ore$/, '')];
    if (!item) continue;
    const display = item.displayName || target.replace(/_/g, ' ');
    add(makeEntry(
      'deliver',
      target,
      display,
      8,
      `Obtain ${display.toLowerCase()}, walk to the requester, and drop it for them.`
    ));
  }

  const byCategory = {};
  for (const entry of skills.values()) {
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
  }

  return {
    version,
    skills,
    count: skills.size,
    byCategory,
    labels: CATEGORY_LABELS
  };
}

let cachedCatalog = null;

function getSkillCatalog(options = {}) {
  if (!cachedCatalog || options.version || options.data) {
    const catalog = buildSkillCatalog(options);
    if (!options.data) cachedCatalog = catalog;
    return catalog;
  }
  return cachedCatalog;
}

function scoreEntry(entry, queryTokens, queryText, category) {
  if (category && entry.action !== category) return 0;
  if (entry.targetNorm === queryText || entry.displayNorm === queryText) return 120;
  const queryList = queryTokens instanceof Set ? [...queryTokens] : (queryTokens || []);
  if (!queryList.length) return 0;
  const hits = queryList.filter(token => entry.tokens.has(token)).length;
  const coverage = hits / queryList.length;
  if (hits === 0) {
    if (queryList.length === 1 && entry.targetNorm.includes(queryList[0])) {
      return 45 - Math.min(20, Math.floor(entry.targetNorm.length / 2));
    }
    return 0;
  }
  let score = 40 + coverage * 50;
  if (entry.targetNorm.startsWith(queryText)) score += 8;
  score += (CATEGORY_PRIORITY[entry.action] || 0) * 0.4;
  score -= Math.min(10, Math.floor(entry.targetNorm.length / 20));
  return score;
}

function searchSkills(catalog, query, { category = null, limit = 12 } = {}) {
  const text = normalizePhrase(query);
  const tokens = tokenize(query);
  const matches = [];
  for (const entry of catalog.skills.values()) {
    const score = scoreEntry(entry, tokens, text, category);
    if (score > 0) matches.push({ entry, score });
  }
  matches.sort((left, right) => right.score - left.score || left.entry.target.length - right.entry.target.length);
  return matches.slice(0, Math.max(1, limit)).map(match => match.entry);
}

function parseGoalPhrase(text) {
  let normalized = normalizePhrase(text);
  if (!normalized) return null;
  let count = null;
  const countMatch = normalized.match(/\b(\d{1,3})\b/);
  if (countMatch) {
    count = Number(countMatch[1]);
    normalized = normalized.replace(/\b\d{1,3}\b/g, ' ').replace(/\s+/g, ' ').trim();
  }
  let category = null;
  for (const [pattern, mapped] of VERB_CATEGORY) {
    const match = normalized.match(pattern);
    if (!match) continue;
    category = mapped;
    normalized = normalized.slice(match[0].length).trim();
    break;
  }
  while (POLITE_PREFIX.test(normalized)) normalized = normalized.replace(POLITE_PREFIX, '').trim();
  normalized = normalized.replace(POLITE_SUFFIX, '').trim();
  if (!normalized) return null;
  return { category, targetText: normalized, count };
}

function resolveInstruction(catalog, text) {
  const goal = parseGoalPhrase(text);
  if (!goal || !goal.targetText) return null;
  let queryText = goal.targetText;
  let category = goal.category;
  if (category === 'smelt' || category === null) {
    const alias = SMELT_INPUT_ALIASES[queryText.replace(/ /g, '_')] || SMELT_INPUT_ALIASES[queryText];
    if (alias) {
      queryText = alias.replace(/_/g, ' ');
      if (!category) category = 'smelt';
    }
  }
  let matches = searchSkills(catalog, queryText, { category, limit: 4 });
  if (matches.length === 0 && category) {
    matches = searchSkills(catalog, queryText, { limit: 4 });
  }
  if (matches.length === 0) return null;
  const skill = matches[0];
  const rawScore = scoreEntry(skill, tokenize(queryText), normalizePhrase(queryText), null);
  const confidence = Math.min(1, Math.max(0.55, rawScore / 120 + 0.25));
  return {
    skill,
    count: goal.count || skill.defaultCount,
    confidence
  };
}

function clampCount(value, fallback) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return fallback;
  return Math.max(1, Math.min(MAX_SKILL_COUNT, Math.floor(amount)));
}

async function executeCatalogSkill(skills, entry, { count } = {}) {
  if (!entry || !entry.action) throw new Error('Unknown skill.');
  switch (entry.action) {
    case 'mine':
      return skills.mine(entry.target, clampCount(count, entry.defaultCount));
    case 'craft':
      return skills.ensureItem(entry.target, clampCount(count, entry.defaultCount));
    case 'smelt':
      return skills.smelt(entry.target, clampCount(count, entry.defaultCount));
    case 'equip': {
      const item = await skills.equipItem(entry.target);
      return { message: `Equipped ${(item?.name || entry.target).replace(/_/g, ' ')}.` };
    }
    case 'hunt':
      return skills.huntMob(entry.target, clampCount(count, entry.defaultCount));
    case 'breed':
      return skills.breedAnimal(entry.target, clampCount(count, Math.max(2, entry.defaultCount)));
    case 'deliver':
      return skills.deliverToPlayer(entry.target, clampCount(count, entry.defaultCount));
    default:
      throw new Error(`I do not have an executor for ${entry.action}.`);
  }
}

function describeCatalog(catalog) {
  return Object.entries(catalog.byCategory)
    .sort((left, right) => right[1] - left[1])
    .map(([category, count]) => `${count} ${catalog.labels[category] || category}`)
    .join(', ');
}

function resolveCatalogSkill(catalog, raw) {
  if (!raw) return null;
  const id = String(raw).trim().toLowerCase();
  if (catalog.skills.has(id)) return catalog.skills.get(id);
  const spaced = id.replace(/:/g, ' ');
  const [action, ...rest] = spaced.split(' ');
  if (rest.length && catalog.skills.has(entryId(action, rest.join('_')))) {
    return catalog.skills.get(entryId(action, rest.join('_')));
  }
  if (id.includes(':')) return null;
  return resolveInstruction(catalog, id)?.skill || null;
}

module.exports = {
  DEFAULT_VERSION,
  buildSkillCatalog,
  describeCatalog,
  executeCatalogSkill,
  getSkillCatalog,
  normalizePhrase,
  parseGoalPhrase,
  resolveCatalogSkill,
  resolveInstruction,
  searchSkills,
  tokenize
};
