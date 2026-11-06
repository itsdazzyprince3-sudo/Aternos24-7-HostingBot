'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPatrolRoute } = require('../lib/patrol');

test('patrol route uses a fixed anchor and ends back at that anchor', () => {
  const anchor = { x: 12, y: 64, z: -5 };
  const route = createPatrolRoute(anchor, 4);

  assert.equal(route.length, 9);
  assert.deepEqual(route.at(-1), anchor);
  assert.ok(route.slice(0, -1).every(point => point.y === anchor.y));
  assert.ok(route.slice(0, -1).every(point =>
    Math.hypot(point.x - anchor.x, point.z - anchor.z) <= 4
  ));
});

test('patrol route bounds invalid radius and waypoint count', () => {
  const route = createPatrolRoute({ x: 0, y: 70, z: 0 }, 100, 1);

  assert.equal(route.length, 5);
  assert.ok(route.slice(0, -1).every(point =>
    Math.hypot(point.x, point.z) <= 16
  ));
  assert.deepEqual(route.at(-1), { x: 0, y: 70, z: 0 });
});
