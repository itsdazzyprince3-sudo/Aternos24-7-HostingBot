'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { AISkills } = require('../lib/ai-skills');

function makeSkills(bot) {
  const agent = { runId: 1, requestedBy: 'virgo' };
  return new AISkills({ agent, getBot: () => bot, memory: null, runId: 1 });
}

test('combat skill ignores players and only selects known hostile mobs', async () => {
  const attacks = [];
  const bot = {
    username: 'commotozze',
    entity: { position: new Vec3(0, 64, 0) },
    entities: {
      player: { id: 1, type: 'player', name: 'virgo', position: new Vec3(1, 64, 0) }
    },
    inventory: { items: () => [] },
    attack: entity => attacks.push(entity)
  };
  const result = await makeSkills(bot).attackNearest('virgo');
  assert.deepEqual(result, { message: 'No hostile mobs nearby.' });
  assert.deepEqual(attacks, []);
});


test('observation includes dimension, weather, equipped armor, hazards, and recent events', () => {
  const bot = {
    username: 'commotozze',
    entity: { position: new Vec3(0, 64, 0), equipment: [null, null, { name: 'iron_boots' }, null, { name: 'iron_chestplate' }, { name: 'iron_helmet' }] },
    inventory: { items: () => [] },
    findBlocks: () => [new Vec3(2, 64, 0)],
    blockAt: () => ({ name: 'lava', position: new Vec3(2, 64, 0) }),
    entities: {}, players: {}, health: 18, food: 14, oxygenLevel: 20,
    time: { timeOfDay: 13000, day: 4, isDay: false },
    game: { dimension: 'overworld' }, isRaining: true, thunderState: 1,
    aiRecentEvents: [{ type: 'damage', detail: 'Health fell', at: 1 }]
  };
  const observation = makeSkills(bot).observation();
  assert.equal(observation.dimension, 'overworld');
  assert.deepEqual(observation.weather, { raining: true, thunder: true });
  assert.equal(observation.armor.boots, 'iron_boots');
  assert.equal(observation.armor.chestplate, 'iron_chestplate');
  assert.equal(observation.hazards[0].name, 'lava');
  assert.equal(observation.recentEvents[0].type, 'damage');
});

test('navigation retries once after a pathfinding failure and then succeeds', async () => {
  let attempts = 0;
  const bot = {
    pathfinder: {
      goto: async () => { attempts += 1; if (attempts === 1) throw new Error('No path'); return 'arrived'; },
      stop() {}
    },
    clearControlStates() {}
  };
  const result = await makeSkills(bot).goto({ x: 1, y: 64, z: 1 }, { timeoutMs: 1000 });
  assert.equal(result, 'arrived');
  assert.equal(attempts, 2);
});


test('combat equips better available armor before engaging a hostile mob', async () => {
  const equipped = [];
  const bot = {
    username: 'commotozze',
    entity: { position: new Vec3(0, 64, 0), equipment: [null, null, { name: 'leather_boots' }, null, null, null] },
    entities: {},
    inventory: { items: () => [
      { name: 'iron_boots', count: 1 },
      { name: 'diamond_chestplate', count: 1 }
    ] },
    equip: async (item, slot) => { equipped.push([item.name, slot]); }
  };
  const skills = makeSkills(bot);
  const result = await skills.equipBestArmor();
  assert.deepEqual(result, ['iron_boots', 'diamond_chestplate']);
  assert.deepEqual(equipped, [['iron_boots', 'feet'], ['diamond_chestplate', 'torso']]);
});


test('wood gathering fails honestly when log blocks break but no log items enter inventory', async () => {
  const logPosition = new Vec3(1, 64, 0);
  let scans = 0;
  const progress = [];
  const bot = {
    username: 'commotozze',
    entity: { position: new Vec3(0, 64, 0), equipment: [] },
    inventory: { items: () => [] },
    registry: { blocksByName: { oak_log: { id: 1 } } },
    findBlocks: () => (++scans === 1 ? [logPosition] : []),
    blockAt: position => position.y < 64
      ? { name: 'dirt', position }
      : { name: 'oak_log', position, diggable: true },
    entities: {}, players: {}, health: 20, food: 20,
    game: { dimension: 'overworld' }
  };
  const skills = makeSkills(bot);
  skills.goto = async () => {};
  skills.chopReachableLogs = async () => 8;
  skills.explore = async () => ({ message: 'scouted' });
  skills.onProgress = message => progress.push(message);
  await assert.rejects(skills.gatherWood(8), /chopped 8 log block\(s\), but no log drops reached my inventory/i);
  assert.equal(skills.countItem('oak_log'), 0);
  assert.equal(progress.some(message => /8 collected/i.test(message)), false);
});
