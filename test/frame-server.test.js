'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FrameServer, blockKind, daylightFactor, clampDimension, MAX_GRID_DIMENSION } = require('../lib/frame-server');

function parseEntities(frame, offset, count) {
  const entities = [];
  for (let i = 0; i < count; i++) {
    const x = frame.readFloatLE(offset);
    const y = frame.readFloatLE(offset + 4);
    const z = frame.readFloatLE(offset + 8);
    const kind = frame.readUInt8(offset + 12);
    const length = frame.readUInt8(offset + 13);
    const name = frame.toString('utf8', offset + 14, offset + 14 + length);
    entities.push({ x, y, z, kind, name });
    offset += 14 + length;
  }
  return { entities, offset };
}

test('frame protocol v2 streams aligned entity records and sampled block lighting', () => {
  const bot = {
    entity: { position: { x: 4.25, y: 64, z: -2.5 }, yaw: 0.4, pitch: -0.1 },
    time: { timeOfDay: 6000 },
    game: { dimension: 'overworld' },
    blockAt: () => ({ name: 'stone', light: 4, skyLight: 12 }),
    entities: {
      1: { type: 'player', username: 'A', position: { x: 5, y: 64, z: -2 } },
      2: { type: 'mob', name: 'zombie', position: { x: 8, y: 64, z: -2 } }
    }
  };
  const server = new FrameServer({ getBot: () => bot, w: 8, h: 8, d: 8 });
  const frame = server.buildFrame();
  assert.equal(frame.toString('ascii', 0, 4), 'VFRM');
  assert.equal(frame.readUInt8(4), 2);
  assert.equal(frame.readFloatLE(43), 1);
  assert.deepEqual([frame.readUInt16LE(37), frame.readUInt16LE(39), frame.readUInt16LE(41)], [8, 8, 8]);

  const gridSize = 8 ** 3;
  const gridOffset = 47;
  const lightOffset = gridOffset + gridSize;
  assert.equal(frame.readUInt8(gridOffset), blockKind('stone'));
  assert.equal(frame.readUInt8(lightOffset), 12, 'daytime skylight should dominate weaker block light');

  const countOffset = lightOffset + gridSize;
  const entityCount = frame.readUInt16LE(countOffset);
  assert.equal(entityCount, 2);
  const parsed = parseEntities(frame, countOffset + 2, entityCount);
  assert.deepEqual(parsed.entities.map(entity => entity.name), ['A', 'zombie']);
  assert.deepEqual(parsed.entities.map(entity => entity.kind), [2, 1]);
  assert.equal(parsed.offset, frame.length, 'no padding byte may desynchronize the next streamed frame');
});

test('frame dimensions are bounded and daylight follows time and dimension', () => {
  assert.equal(clampDimension(0, 64), 8);
  assert.equal(clampDimension(100000, 64), MAX_GRID_DIMENSION);
  assert.equal(clampDimension(Number.NaN, 64), 64);
  assert.equal(daylightFactor(6000, 'overworld'), 1);
  assert.equal(daylightFactor(12500, 'overworld'), 0.5);
  assert.equal(daylightFactor(18000, 'overworld'), 0);
  assert.equal(daylightFactor(6000, 'the_nether'), 0);
});
