'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getReasoner, requiredPickaxeTier, compileSensorySnapshot } = require('../lib/ai-reasoner');
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

test('reasoner compiles full A-Z thinking stages and Chain-of-Thought trace', () => {
  const planner = reasoner();
  const observation = {
    health: 20,
    food: 20,
    inventory: { oak_log: 8 },
    nearbyHostiles: [],
    time: { isDay: true, timeOfDay: 6000 }
  };
  const plan = planner.plan('iron pickaxe', { observation });
  assert.ok(plan);
  assert.ok(Array.isArray(plan.thought));
  assert.ok(plan.thought.some(t => t.includes('[Stage A: Perception]')));
  assert.ok(plan.thought.some(t => t.includes('[Stage B: Goal Formulation]')));
  assert.ok(plan.thought.some(t => t.includes('[Stage C: Prerequisite Tree]')));
  assert.ok(plan.thought.some(t => t.includes('[Stage D: Tool Verification]')));
  assert.ok(plan.thought.some(t => t.includes('[Stage F: Schedule Compilation]')));
  assert.ok(plan.thought.some(t => t.includes('[Stage G: Dispatch Readiness]')));
  assert.ok(plan.azTrace);
  assert.equal(plan.azTrace.stageG.status, 'ready');
  assert.ok(plan.confidence > 0 && plan.confidence <= 1);
});

test('reasoner injects tactical survival precondition when health is critical', () => {
  const planner = reasoner();
  const observation = {
    health: 6,
    food: 12,
    inventory: {},
    nearbyHostiles: [{ name: 'creeper', distance: 8 }],
    time: { isDay: false }
  };
  const plan = planner.plan('mine 8 stone', { observation });
  assert.ok(plan);
  assert.equal(plan.steps[0].skill, 'survive');
  assert.ok(plan.thought.some(t => t.includes('HIGH RISK') || t.includes('Survival precondition')));
});

test('compileSensorySnapshot summarizes multi-modal world context', () => {
  const observation = {
    health: 18,
    food: 16,
    time: { isDay: true, timeOfDay: 3000 },
    nearbyHostiles: [{ name: 'skeleton', distance: 14 }],
    armor: { chestplate: 'iron_chestplate' },
    inventory: { stone_pickaxe: 1, torch: 16 }
  };
  const snapshot = compileSensorySnapshot(observation);
  assert.equal(snapshot.health, 18);
  assert.equal(snapshot.food, 16);
  assert.equal(snapshot.armorPieces, 1);
  assert.equal(snapshot.pickTier, 2);
  assert.equal(snapshot.threat.name, 'skeleton');
  assert.match(snapshot.summary, /Health 18\/20/);
});
