'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPatrolRoute, runPatrol } = require('../lib/patrol');

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

test('patrol route varies between laps but always returns to its exact anchor', () => {
  const anchor = { x: -3, y: 71, z: 18 };
  const makeRandom = seed => () => {
    seed = (seed * 48271) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const firstLap = createPatrolRoute(anchor, 5, 8, makeRandom(1));
  const nextLap = createPatrolRoute(anchor, 5, 8, makeRandom(2));

  assert.notDeepEqual(firstLap, nextLap);
  for (const route of [firstLap, nextLap]) {
    assert.deepEqual(route.at(-1), anchor);
    assert.ok(route.slice(0, -1).every(point =>
      Math.hypot(point.x - anchor.x, point.z - anchor.z) <= 5
    ));
  }
});

test('patrol loop makes randomized laps and returns to the anchor each time', async () => {
  const anchor = { x: 4, y: 66, z: -9 };
  const visited = [];
  const makeRandom = seed => () => {
    seed = (seed * 48271) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  let stopped = false;
  let completedLaps = 0;

  await runPatrol({
    anchor,
    radius: 5,
    interval: 1,
    shouldStop: () => stopped,
    goto: async point => {
      visited.push(point);
      if (point.x === anchor.x && point.z === anchor.z) {
        completedLaps++;
        if (completedLaps === 2) stopped = true;
      }
    },
    sleep: async () => {},
    random: makeRandom(17)
  });

  assert.equal(completedLaps, 2);
  assert.deepEqual(visited.at(8), anchor);
  assert.deepEqual(visited.at(17), anchor);
  assert.notDeepEqual(visited.slice(0, 9), visited.slice(9, 18));
});
