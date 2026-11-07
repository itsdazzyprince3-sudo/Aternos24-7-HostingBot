'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

test('radar calculation categorizes entities correctly within 32 blocks', () => {
  const HOSTILE_SET = new Set([
    'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman'
  ]);

  const botPos = new Vec3(100, 64, 200);
  const entities = {
    1: { id: 1, type: 'player', username: 'Alex', position: new Vec3(105, 64, 205) },
    2: { id: 2, type: 'mob', name: 'zombie', position: new Vec3(102, 64, 203) },
    3: { id: 3, type: 'animal', name: 'cow', position: new Vec3(95, 64, 195) },
    4: { id: 4, type: 'item', name: 'item', position: new Vec3(101, 64, 200) },
    5: { id: 5, type: 'player', username: 'FarPlayer', position: new Vec3(500, 64, 500) } // > 32 blocks
  };

  const results = [];
  for (const entity of Object.values(entities)) {
    const dx = entity.position.x - botPos.x;
    const dy = entity.position.y - botPos.y;
    const dz = entity.position.z - botPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 32) continue;

    let category = 'other';
    const name = String(entity.name || entity.username || '').toLowerCase();
    if (entity.type === 'player' || entity.username) {
      category = 'player';
    } else if (HOSTILE_SET.has(name) || entity.type === 'hostile' || entity.type === 'mob') {
      category = HOSTILE_SET.has(name) ? 'hostile' : 'passive';
    } else if (entity.type === 'animal') {
      category = 'passive';
    } else if (entity.name === 'item' || entity.type === 'item') {
      category = 'item';
    }

    results.push({ id: entity.id, name: entity.username || entity.name, type: category, dist });
  }

  assert.equal(results.length, 4); // FarPlayer excluded
  assert.equal(results.find(r => r.name === 'Alex').type, 'player');
  assert.equal(results.find(r => r.name === 'zombie').type, 'hostile');
  assert.equal(results.find(r => r.name === 'cow').type, 'passive');
  assert.equal(results.find(r => r.name === 'item').type, 'item');
});
