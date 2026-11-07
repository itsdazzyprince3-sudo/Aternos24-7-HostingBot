'use strict';

const { ANIMALS, FOOD_NAMES, HOSTILE_MOBS, TOOL_TIER, bestPickaxe } = require('./ai-brain');

const BIOME_THREAT = new Map([
  ['deep_dark', 10], ['the_end', 8], ['nether_wastes', 6], ['basalt_deltas', 7],
  ['soul_sand_valley', 7], ['crimson_forest', 5], ['warped_forest', 4],
  ['swamp', 3], ['dark_forest', 4], ['jungle', 3], ['desert', 2],
  ['badlands', 2], ['savanna', 1], ['plains', 1], ['forest', 1], ['taiga', 1],
  ['mountains', 2], ['ocean', 2], ['river', 1]
]);

const STRUCTURE_LOOT = new Map([
  ['village', ['emerald', 'bread', 'iron_ingot']],
  ['stronghold', ['ender_pearl', 'eye_of_ender', 'book']],
  ['bastion_remnant', ['gold_block', 'ancient_debris', 'netherite_scrap']],
  ['nether_fortress', ['blaze_rod', 'nether_wart', 'wither_skeleton_skull']],
  ['end_city', ['elytra', 'shulker_shell', 'diamond']],
  ['woodland_mansion', ['totem_of_undying', 'diamond_block', 'enchanted_book']],
  ['buried_treasure', ['heart_of_the_sea', 'diamond', 'emerald']],
  ['shipwreck', ['map', 'iron_ingot', 'emerald']],
  ['desert_pyramid', ['golden_apple', 'diamond', 'enchanted_book']],
  ['jungle_temple', ['diamond', 'emerald', 'iron_ingot']],
  ['igloo', ['golden_apple', 'emerald']],
  ['ocean_monument', ['prismarine', 'sponge', 'gold_block']],
  ['ruined_portal', ['gold_block', 'obsidian', 'flint_and_steel']],
  ['ancient_city', ['echo_shard', 'recovery_compass', 'enchanted_book']]
]);

const ENCHANTMENT_TIER = new Map([
  ['protection', 3], ['sharpness', 3], ['efficiency', 3], ['unbreaking', 3],
  ['mending', 4], ['fortune', 3], ['looting', 3], ['power', 3], ['infinity', 3],
  ['feather_falling', 2], ['fire_protection', 2], ['blast_protection', 2], ['projectile_protection', 2],
  ['respiration', 2], ['aqua_affinity', 1], ['thorns', 2], ['depth_strider', 2], ['frost_walker', 2],
  ['soul_speed', 2], ['swift_sneak', 3], ['loyalty', 2], ['riptide', 2], ['channeling', 2],
  ['multishot', 3], ['quick_charge', 2], ['piercing', 2]
]);

const REDSTONE_COMPONENT = new Set([
  'redstone', 'redstone_block', 'redstone_torch', 'repeater', 'comparator',
  'piston', 'sticky_piston', 'observer', 'dispenser', 'dropper', 'hopper',
  'target', 'sculk_sensor', 'calibrated_sculk_sensor', 'lightning_rod',
  'daylight_detector', 'tripwire_hook', 'lever', 'button', 'pressure_plate',
  'redstone_lamp', 'note_block', 'tnt', 'rail', 'powered_rail', 'detector_rail',
  'activator_rail', 'command_block', 'chain_command_block', 'repeating_command_block'
]);

const POTION_EFFECT = new Map([
  ['speed', 'sugar'], ['slowness', 'fermented_spider_eye'], ['haste', 'nether_wart'],
  ['mining_fatigue', 'fermented_spider_eye'], ['strength', 'blaze_powder'],
  ['instant_health', 'glistering_melon_slice'], ['instant_damage', 'fermented_spider_eye'],
  ['jump_boost', 'rabbit_foot'], ['nausea', 'pufferfish'], ['regeneration', 'ghast_tear'],
  ['resistance', 'nether_wart'], ['fire_resistance', 'magma_cream'],
  ['water_breathing', 'pufferfish'], ['invisibility', 'fermented_spider_eye'],
  ['night_vision', 'golden_carrot'], ['poison', 'spider_eye'], ['wither', 'wither_rose'],
  ['luck', 'nether_wart'], ['unluck', 'fermented_spider_eye'],
  ['slow_falling', 'phantom_membrane'], ['conduit_power', 'heart_of_the_sea'],
  ['dolphins_grace', 'nautilus_shell'], ['hero_of_the_village', 'nether_wart'],
  ['bad_omen', 'nether_wart']
]);

const THREAT_WEIGHT = {
  creeper: 5, ghast: 5, ravager: 5, warden: 5, elder_guardian: 5,
  enderman: 4, evoker: 4, phantom: 4, witch: 4, blaze: 4, wither_skeleton: 4,
  piglin_brute: 5, zoglin: 5, hoglin: 4, guardian: 3, shulker: 3,
  skeleton: 3, stray: 3, drowned: 3, husk: 3, pillager: 3, vindicator: 3,
  cave_spider: 3, magma_cube: 3, vex: 3, breeze: 3, bogged: 3,
  zombie: 2, spider: 2, silverfish: 1, endermite: 2, slime: 1, zombie_villager: 2
};

const ORE_VALUES = {
  diamond_ore: 5, deepslate_diamond_ore: 5, emerald_ore: 5, deepslate_emerald_ore: 5,
  ancient_debris: 5, gold_ore: 4, deepslate_gold_ore: 4, nether_gold_ore: 4,
  iron_ore: 3, deepslate_iron_ore: 3, redstone_ore: 3, deepslate_redstone_ore: 3,
  lapis_ore: 3, deepslate_lapis_ore: 3, coal_ore: 2, deepslate_coal_ore: 2,
  copper_ore: 2, deepslate_copper_ore: 2, nether_quartz_ore: 2
};

const ORE_TIERS = {
  diamond_ore: 3, deepslate_diamond_ore: 3, emerald_ore: 3, deepslate_emerald_ore: 3,
  ancient_debris: 3, gold_ore: 3, deepslate_gold_ore: 3, nether_gold_ore: 3,
  iron_ore: 2, deepslate_iron_ore: 2, redstone_ore: 3, deepslate_redstone_ore: 3,
  lapis_ore: 2, deepslate_lapis_ore: 2, coal_ore: 1, deepslate_coal_ore: 1,
  copper_ore: 2, deepslate_copper_ore: 2, nether_quartz_ore: 1
};

const DANGER_BLOCKS = new Set([
  'lava', 'fire', 'soul_fire', 'magma_block', 'campfire', 'soul_campfire',
  'powder_snow', 'cactus', 'wither_rose', 'pointed_dripstone'
]);

const FOOD_BLOCKS = new Set([
  'wheat', 'carrots', 'potatoes', 'beetroots', 'melon', 'pumpkin',
  'sweet_berry_bush', 'sugar_cane', 'cocoa', 'brown_mushroom', 'red_mushroom',
  'kelp', 'kelp_plant', 'sea_pickle', 'cave_vines', 'cave_vines_plant'
]);

const UTILITY_BLOCKS = new Set([
  'chest', 'trapped_chest', 'barrel', 'ender_chest', 'furnace', 'blast_furnace',
  'smoker', 'crafting_table', 'enchanting_table', 'anvil', 'chipped_anvil',
  'damaged_anvil', 'brewing_stand', 'beacon', 'spawner', 'trial_spawner',
  'respawn_anchor', 'lodestone', 'grindstone', 'smithing_table', 'stonecutter',
  'cartography_table', 'fletching_table', 'loom', 'composter', 'cauldron',
  'water_cauldron', 'lectern', 'bell', 'campfire', 'soul_campfire'
]);

const TOOL_PATTERN = /(?:pickaxe|axe|shovel|sword|hoe|shears|bow|crossbow|trident|fishing_rod|shield|flint_and_steel|bucket)$/;
const ARMOR_PATTERN = /(?:helmet|chestplate|leggings|boots)$/;

function classifyBlock(name) {
  if (!name || name === 'air' || name === 'cave_air' || name === 'void_air') return null;
  if (DANGER_BLOCKS.has(name)) return { kind: 'hazard', value: 0, label: 'hazard' };
  if (name === 'water' || name === 'flowing_water') return { kind: 'water', value: 1, label: 'water' };
  if (ORE_VALUES[name] || /_ore$|ancient_debris$/.test(name)) {
    return {
      kind: 'ore',
      value: ORE_VALUES[name] || 2,
      requiredTier: ORE_TIERS[name] || 1,
      label: `${name.replace(/_/g, ' ')}`
    };
  }
  if (/(?:_log|_stem|_wood|_hyphae)$/.test(name)) return { kind: 'wood', value: 2, label: 'wood' };
  if (FOOD_BLOCKS.has(name)) return { kind: 'food', value: 2, label: 'food' };
  if (UTILITY_BLOCKS.has(name) || /_bed$/.test(name)) return { kind: 'utility', value: 2, label: 'utility' };
  return { kind: 'terrain', value: 0, label: 'terrain' };
}

function threatFor(name, distance) {
  const weight = THREAT_WEIGHT[name] || (HOSTILE_MOBS.has(name) ? 3 : 0);
  if (!weight) return null;
  const level = weight >= 5 ? 'extreme' : weight >= 4 ? 'high' : weight >= 3 ? 'medium' : 'low';
  return { name, distance, weight, level };
}

function inventorySummary(inventory = {}) {
  const names = Object.keys(inventory);
  const tools = names.filter(name => TOOL_PATTERN.test(name));
  const armor = names.filter(name => ARMOR_PATTERN.test(name));
  const food = names
    .filter(name => FOOD_NAMES.has(name))
    .reduce((sum, name) => sum + (Number(inventory[name]) || 0), 0);
  const rare = names.filter(name => /^(?:diamond|emerald|ancient_debris|netherite_ingot|gold_ingot|iron_ingot)$/.test(name));
  return { tools, armor, food, rare, total: names.length };
}

function recognize(observation = {}, { knowledge = null } = {}) {
  const blocks = Array.isArray(observation.nearbyBlocks) ? observation.nearbyBlocks : [];
  const resources = [];
  const hazards = [];
  const seenBlocks = new Set();
  for (const block of blocks) {
    if (!block?.name || seenBlocks.has(block.name)) continue;
    seenBlocks.add(block.name);
    const classification = classifyBlock(block.name);
    if (!classification) continue;
    if (classification.kind === 'hazard') {
      hazards.push({ name: block.name, distance: block.distance, ...classification });
      continue;
    }
    if (['ore', 'wood', 'food', 'utility', 'water'].includes(classification.kind)) {
      resources.push({ name: block.name, distance: block.distance, ...classification });
    }
  }
  resources.sort((left, right) => right.value - left.value || left.distance - right.distance);

  const threats = (observation.nearbyHostiles || [])
    .map(hostile => threatFor(hostile.name, hostile.distance))
    .filter(Boolean)
    .sort((left, right) => right.weight - left.weight || left.distance - right.distance);

  const animals = (observation.nearbyEntities || [])
    .filter(entity => ANIMALS.has(entity.name) || ANIMALS.has(entity.kind))
    .map(entity => ({ name: entity.name, distance: entity.distance }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 5);

  const players = Object.values(observation.players || {})
    .map(player => ({ name: player.username, distance: player.distance }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 5);

  const inventory = inventorySummary(observation.inventory);
  // biome / structure / enchantment / redstone / potion recognition
  const biomes = (observation.nearbyBiomes || []).map(b => ({ name: b, threat: BIOME_THREAT.get(b) || 0 })).filter(b => b.threat > 0).sort((a,b)=>b.threat-a.threat);
  const structures = (observation.nearbyStructures || []).map(s => ({ name: s, loot: STRUCTURE_LOOT.get(s) || [] }));
  const enchantments = (observation.enchantments || []).map(e => ({ name: e, tier: ENCHANTMENT_TIER.get(e) || 0 })).filter(e => e.tier > 0).sort((a,b)=>b.tier-a.tier);
  const redstone = (observation.nearbyRedstone || []).filter(r => REDSTONE_COMPONENT.has(r)).map(r => r);
  const potions = (observation.activePotions || []).map(p => ({ name: p, ingredient: POTION_EFFECT.get(p) }));
  const topResource = resources[0] || null;
  const topOre = resources.find(resource => resource.kind === 'ore') || null;
  const knowledgeNotes = [];
  if (knowledge?.search) {
    for (const name of [topOre?.name, threats[0]?.name, topResource?.name].filter(Boolean)) {
      const [entry] = knowledge.search(name, { limit: 1, kind: 'knowledge' });
      if (entry?.summary) knowledgeNotes.push(`${entry.title}: ${entry.summary.slice(0, 180)}`);
      if (knowledgeNotes.length >= 2) break;
    }
  }

  const advice = [];
  const pickaxeTier = Number(observation.pickaxeTier) || TOOL_TIER[bestPickaxe(observation.inventory)] || 0;
  if (threats[0] && threats[0].distance <= 8 && Number(observation.health) <= 10) {
    advice.push(`Retreat from the ${threats[0].name}; health is too low for melee.`);
  } else if (threats[0] && threats[0].distance <= 12) {
    advice.push(`Keep space from the ${threats[0].name} and fight with a wall or water at my back.`);
  }
  if (topOre && topOre.requiredTier > pickaxeTier) {
    advice.push(`I recognize ${topOre.name.replace(/_/g, ' ')}, but it needs pickaxe tier ${topOre.requiredTier}; mine it later.`);
  }
  if (hazards.some(hazard => hazard.name === 'lava' && hazard.distance <= 6)) {
    advice.push('Lava is close; avoid digging straight down here.');
  }
  if (animals.length && inventory.food <= 6) {
    advice.push(`Food is low; a ${animals[0].name} is ${animals[0].distance} blocks away.`);
  }
  if (observation.time?.isDay === false && !observation.shelter && !observation.nearbyBedAvailable) {
    advice.push('Night with no shelter or bed nearby; dig in or head home.');
  }
  if (!advice.length && resources.some(resource => resource.kind === 'ore')) {
    advice.push('No immediate danger; the recognized ore is worth mining while the area is calm.');
  }

  const counts = {
    blocks: blocks.length,
    resources: resources.length,
    hazards: hazards.length,
    threats: threats.length,
    animals: animals.length,
    players: players.length
  };
  const summary = `I recognize ${counts.blocks} nearby blocks, ${resources.length} resource types, ${threats.length} threats, ${hazards.length} hazards, and ${players.length} players.`;

  return {
    summary,
    counts,
    threats,
    resources,
    hazards,
    animals,
    players,
    inventory,
    knowledgeNotes,
    advice,
    topResource,
    topOre,
    biomes,
    structures,
    enchantments,
    redstone,
    potions
  };
}

function describeRecognition(recognition) {
  if (!recognition) return 'I could not recognize anything nearby.';
  const parts = [recognition.summary];
  if (recognition.threats.length) {
    parts.push(`Threats: ${recognition.threats.slice(0, 3).map(threat => `${threat.name} ${threat.distance}m (${threat.level})`).join(', ')}.`);
  }
  if (recognition.resources.length) {
    parts.push(`Resources: ${recognition.resources.slice(0, 5).map(resource => `${resource.name} ${resource.distance}m`).join(', ')}.`);
  }
  if (recognition.animals.length) {
    parts.push(`Animals: ${recognition.animals.slice(0, 3).map(animal => `${animal.name} ${animal.distance}m`).join(', ')}.`);
  }
  if (recognition.players.length) {
    parts.push(`Players: ${recognition.players.slice(0, 3).map(player => `${player.name} ${player.distance}m`).join(', ')}.`);
  }
  if (recognition.biomes?.length) {
    parts.push(`Biomes: ${recognition.biomes.slice(0, 3).map(b => `${b.name} (threat ${b.threat})`).join(', ')}.`);
  }
  if (recognition.structures?.length) {
    parts.push(`Structures: ${recognition.structures.slice(0, 3).map(s => `${s.name} [${s.loot.join(', ')}]`).join(', ')}.`);
  }
  if (recognition.enchantments?.length) {
    parts.push(`Enchantments: ${recognition.enchantments.slice(0, 5).map(e => `${e.name} (tier ${e.tier})`).join(', ')}.`);
  }
  if (recognition.redstone?.length) {
    parts.push(`Redstone: ${recognition.redstone.slice(0, 5).join(', ')}.`);
  }
  if (recognition.potions?.length) {
    parts.push(`Potions: ${recognition.potions.slice(0, 5).map(p => `${p.name}${p.ingredient ? ' from ' + p.ingredient : ''}`).join(', ')}.`);
  }
  if (recognition.inventory.tools.length) parts.push(`Tools: ${recognition.inventory.tools.join(', ')}.`);
  if (recognition.advice.length) parts.push(`Assessment: ${recognition.advice.slice(0, 2).join(' ')}`);
  if (recognition.knowledgeNotes.length) parts.push(`Learned: ${recognition.knowledgeNotes[0]}`);
  return parts.join(' ');
}

module.exports = {
  DANGER_BLOCKS,
  FOOD_BLOCKS,
  ORE_TIERS,
  ORE_VALUES,
  UTILITY_BLOCKS,
  BIOME_THREAT,
  STRUCTURE_LOOT,
  ENCHANTMENT_TIER,
  REDSTONE_COMPONENT,
  POTION_EFFECT,
  classifyBlock,
  describeRecognition,
  recognize,
  threatFor
};
