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
