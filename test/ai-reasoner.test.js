'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getReasoner, requiredPickaxeTier } = require('../lib/ai-reasoner');
const { getSkillCatalog } = require('../lib/skill-catalog');

function reasoner() {
  return getReasoner({ catalog: getSkillCatalog() });
}

test('reasoner infers armor goals and plans prerequisites', () => {
  const planner = reasoner();
  const plan = planner.plan('make me a full iron armor set');
  assert.ok(plan);
  assert.ok(plan.steps.length >= 4);
  assert.ok(plan.steps.some(step => step.skill === 'ensureItem'));
  assert.match(planner.describePlan(plan), /Plan for/);
});

test('reasoner plans a diamond mining goal with the required pickaxe tier', () => {
  const planner = reasoner();
  const plan = planner.plan('mine 12 diamond ore');
  assert.ok(plan);
  assert.equal(plan.goal.kind, 'skill');
  assert.equal(plan.skill.id, 'mine:diamond_ore');
  assert.equal(plan.goal.count, 12);
  assert.equal(requiredPickaxeTier(require('minecraft-data')('26.1'), ['diamond_ore', 'deepslate_diamond_ore']), 3);
});

test('reasoner handles night survival and single skill goals', () => {
  const planner = reasoner();
  const night = planner.plan('survive the night');
  assert.ok(night);
  assert.equal(night.goal.kind, 'night');
  const single = planner.plan('hunt zombies');
  assert.ok(single);
  assert.equal(single.skill.id, 'hunt:zombie');
});
