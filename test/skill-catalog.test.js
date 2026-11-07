'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  describeCatalog,
  getSkillCatalog,
  resolveCatalogSkill,
  resolveInstruction,
  searchSkills
} = require('../lib/skill-catalog');

test('catalog builds thousands of executable skills across categories', () => {
  const catalog = getSkillCatalog();
  assert.ok(catalog.count >= 3000, `expected 3000+ skills, got ${catalog.count}`);
  for (const category of ['mine', 'craft', 'deliver', 'equip', 'hunt', 'breed', 'smelt']) {
    assert.ok(catalog.byCategory[category] > 0, `missing ${category} skills`);
  }
  assert.match(describeCatalog(catalog), /mining/);
});

test('resolver maps natural language goals to catalog skill ids and counts', () => {
  const catalog = getSkillCatalog();
  assert.deepEqual(
    (({ skill, count }) => ({ id: skill.id, count }))(resolveInstruction(catalog, 'mine 12 diamond ore')),
    { id: 'mine:diamond_ore', count: 12 }
  );
  assert.equal(resolveInstruction(catalog, 'bring me 5 iron ingots').skill.id, 'deliver:iron_ingot');
  assert.equal(resolveInstruction(catalog, 'craft a stone pickaxe').skill.id, 'craft:stone_pickaxe');
  assert.equal(resolveInstruction(catalog, 'wear iron chestplate').skill.id, 'equip:iron_chestplate');
  assert.equal(resolveInstruction(catalog, 'smelt sand').skill.id, 'smelt:glass');
  assert.equal(resolveInstruction(catalog, 'make a diamond pickaxe').skill.id, 'craft:diamond_pickaxe');
});

test('resolver understands plural mobs and hunt intents', () => {
  const catalog = getSkillCatalog();
  assert.equal(resolveInstruction(catalog, 'kill zombies').skill.id, 'hunt:zombie');
  assert.equal(resolveInstruction(catalog, 'hunt a cow').skill.id, 'hunt:cow');
  assert.equal(resolveInstruction(catalog, 'feed cows').skill.id, 'breed:cow');
  assert.equal(resolveInstruction(catalog, 'get me some diamonds').skill.id, 'mine:diamond_ore');
});

test('search and direct id lookup expose catalog entries', () => {
  const catalog = getSkillCatalog();
  const matches = searchSkills(catalog, 'diamond pickaxe', { limit: 5 });
  assert.ok(matches.some(match => match.id === 'craft:diamond_pickaxe'));
  const direct = resolveCatalogSkill(catalog, 'mine:diamond_ore');
  assert.equal(direct.id, 'mine:diamond_ore');
  assert.equal(direct.category, 'mine');
  assert.equal(direct.target, 'diamond_ore');
  assert.equal(resolveCatalogSkill(catalog, 'not:a_skill'), null);
});
