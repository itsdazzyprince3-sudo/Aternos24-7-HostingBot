'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyBlock, describeRecognition, recognize } = require('../lib/ai-recognition');

test('recognition classifies ores, hazards, utilities, and wood', () => {
  assert.equal(classifyBlock('diamond_ore').kind, 'ore');
  assert.equal(classifyBlock('diamond_ore').requiredTier, 3);
  assert.equal(classifyBlock('lava').kind, 'hazard');
  assert.equal(classifyBlock('chest').kind, 'utility');
  assert.equal(classifyBlock('oak_log').kind, 'wood');
  assert.equal(classifyBlock('dirt').kind, 'terrain');
  assert.equal(classifyBlock('air'), null);
});

test('recognition ranks threats and resources and advises on pickaxe tiers', () => {
  const recognition = recognize({
    health: 14,
    food: 6,
    nearbyBlocks: [
      { name: 'diamond_ore', distance: 4 },
      { name: 'oak_log', distance: 2 },
      { name: 'lava', distance: 3 },
      { name: 'chest', distance: 7 }
    ],
    nearbyHostiles: [
      { name: 'zombie', distance: 12 },
      { name: 'creeper', distance: 6 }
    ],
    nearbyEntities: [{ name: 'cow', kind: 'mob', distance: 8 }],
    players: { virgo: { username: 'virgo', distance: 5 } },
    inventory: { stone_pickaxe: 1, bread: 2 },
    time: { isDay: true }
  });
  assert.equal(recognition.threats[0].name, 'creeper');
  assert.equal(recognition.threats[0].level, 'extreme');
  assert.equal(recognition.resources[0].name, 'diamond_ore');
  assert.equal(recognition.animals[0].name, 'cow');
  assert.equal(recognition.players[0].name, 'virgo');
  assert.ok(recognition.advice.some(line => /pickaxe tier 3/.test(line)));
  assert.ok(recognition.advice.some(line => /Food is low/.test(line)));
  assert.match(describeRecognition(recognition), /Threats: creeper 6m/);
});

test('recognition attaches learned knowledge when available', () => {
  const knowledge = {
    search: (query) => query === 'creeper'
      ? [{ title: 'Creeper', summary: 'A creeper explodes when close.' }]
      : []
  };
  const recognition = recognize({
    nearbyBlocks: [],
    nearbyHostiles: [{ name: 'creeper', distance: 9 }],
    inventory: {}
  }, { knowledge });
  assert.equal(recognition.knowledgeNotes[0], 'Creeper: A creeper explodes when close.');
});
