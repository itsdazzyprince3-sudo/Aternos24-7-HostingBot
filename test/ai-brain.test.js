'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  answerKnownQuestion,
  chooseGoal,
  canonicalItem,
  extractItem,
  parseLocalIntent,
  planForIntent,
  recipeAnswer
} = require('../lib/ai-brain');

test('local intent parser maps common Minecraft chat tasks to bounded skills', () => {
  assert.deepEqual(parseLocalIntent('come'), { type: 'come', player: 'requester', raw: 'come' });
  assert.deepEqual(parseLocalIntent('Could you please step over to me?'), {
    type: 'come', player: 'requester', raw: 'Could you please step over to me?'
  });
  assert.deepEqual(parseLocalIntent('Walk over to Virgo'), {
    type: 'come', player: 'virgo', raw: 'Walk over to Virgo'
  });
  assert.deepEqual(parseLocalIntent('mine 8 stone'), {
    type: 'mine', item: 'stone', count: 8, raw: 'mine 8 stone'
  });
  assert.deepEqual(parseLocalIntent('I need you to break 8 blocks of stone for me'), {
    type: 'mine', item: 'stone', count: 8, raw: 'I need you to break 8 blocks of stone for me'
  });
  assert.deepEqual(parseLocalIntent('craft wooden_pickaxe'), {
    type: 'craft', item: 'wooden_pickaxe', count: 1, raw: 'craft wooden_pickaxe'
  });
  assert.equal(parseLocalIntent('follow me').type, 'follow');
  assert.deepEqual(parseLocalIntent('grind wood').goal, 'wood');
  assert.equal(planForIntent(parseLocalIntent('come'))[0].skill, 'comeToPlayer');
});

test('item aliases, quantities, and recipes resolve to Minecraft names', () => {
  assert.equal(extractItem('mine eight cobblestone blocks'), 'cobblestone');
  assert.equal(canonicalItem('iron pickaxes'), 'iron_pickaxe');
  assert.equal(canonicalItem('cherry_planks'), 'cherry_planks');
  assert.equal(canonicalItem('wheat_seeds'), 'wheat_seeds');
  assert.match(recipeAnswer('wooden_pickaxe'), /planks.*sticks/i);
});

test('player attack requests do not become player targets in combat skills', () => {
  assert.deepEqual(parseLocalIntent('attack virgo').target, 'virgo');
  const plan = planForIntent(parseLocalIntent('attack virgo'));
  assert.deepEqual(plan, [{ skill: 'attackNearest', args: { target: 'virgo' } }]);
});

test('known Minecraft questions use concise deterministic answers', () => {
  assert.match(answerKnownQuestion('what is nearby', {
    nearbyBlocks: [{ name: 'oak_log', distance: 4 }],
    nearbyHostiles: []
  }), /oak_log \(4m\)/);
  assert.match(answerKnownQuestion('what is a creeper'), /explode/i);
});


test('autonomous planner explores after a recent unreachable wood route', () => {
  const memory = { getSkill: name => name === 'goal:gatherWood' ? {
    failures: 2,
    lastDetail: 'I could not find reachable logs nearby, even after scouting.',
    lastUsedAt: new Date().toISOString()
  } : null };
  const goal = chooseGoal({
    health: 20,
    food: 20,
    inventory: {},
    nearbyBlocks: []
  }, memory);
  assert.equal(goal.skill, 'explore');
  assert.match(goal.reason, /wood route failed recently/i);
});

test('autonomous planner learns to avoid a recently unreachable mining route', () => {
  const memory = { getSkill: name => name === 'goal:mine' ? {
    failures: 1,
    lastDetail: 'I could not find reachable stone within 32 blocks.',
    lastUsedAt: new Date().toISOString()
  } : null };
  const goal = chooseGoal({
    health: 20,
    food: 20,
    inventory: { wooden_pickaxe: 1 },
    nearbyBlocks: []
  }, memory);
  assert.equal(goal.skill, 'explore');
  assert.match(goal.reason, /failed recently/i);
});

test('autonomous planner sleeps only at night when a bed is available and the area is safe', () => {
  const memory = { getSkill: () => null, getNotes: () => [] };
  const safeNight = chooseGoal({
    health: 20,
    food: 20,
    inventory: { white_bed: 1 },
    time: { isDay: false },
    nearbyHostiles: []
  }, memory);
  assert.equal(safeNight.skill, 'sleep');

  const daytime = chooseGoal({
    health: 20,
    food: 20,
    inventory: { white_bed: 1 },
    time: { isDay: true },
    nearbyHostiles: []
  }, memory);
  assert.notEqual(daytime.skill, 'sleep');

  const unsafeNight = chooseGoal({
    health: 20,
    food: 20,
    inventory: { white_bed: 1 },
    time: { isDay: false },
    nearbyHostiles: [{ name: 'zombie', distance: 4 }]
  }, memory);
  assert.notEqual(unsafeNight.skill, 'sleep');
});


test('memory inspection and erase phrases map to explicit local commands', () => {
  assert.equal(parseLocalIntent('memory').type, 'memory');
  assert.equal(parseLocalIntent('what have you learned').type, 'memory');
  assert.equal(parseLocalIntent('forget all').type, 'forgetAll');
  assert.equal(parseLocalIntent('clear everything').type, 'forgetAll');
});
