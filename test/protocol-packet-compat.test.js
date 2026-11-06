'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../vendor/minecraft-data/minecraft-data/data/pc/26.3/protocol.json');
const { installProtocolPacketCompatibility } = require('../lib/protocol-packet-compat');

function createBot({ extendedTeleport = true, sendsTickEnd = true } = {}) {
  const writes = [];
  const fields = [{ name: 'teleportId' }];
  if (extendedTeleport) {
    fields.push(
      { name: 'x' },
      { name: 'y' },
      { name: 'z' },
      { name: 'yRot' },
      { name: 'xRot' }
    );
  }
  const bot = {
    _client: {
      write(name, params) {
        writes.push({ name, params });
      }
    },
    registry: { protocol: { types: { packet_teleport_confirm: ['container', fields] } } },
    entity: {
      position: { x: 10.25, y: 70.5, z: -3.75 },
      yaw: Math.PI / 2,
      pitch: -Math.PI / 12
    },
    supportFeature(name) {
      return name === 'sendsClientTickEndPacket' && sendsTickEnd;
    }
  };
  return { bot, writes };
}

test('26.3 teleport confirmation schema includes resolved position and rotation', () => {
  const schema = protocol.play.toServer.types.packet_teleport_confirm;
  assert.deepEqual(
    schema[1].map(field => [field.name, field.type]),
    [
      ['teleportId', 'varint'],
      ['x', 'f64'],
      ['y', 'f64'],
      ['z', 'f64'],
      ['yRot', 'f32'],
      ['xRot', 'f32']
    ]
  );
});

test('extended teleport confirmation echoes resolved position and wire rotation', () => {
  const { bot, writes } = createBot();
  installProtocolPacketCompatibility(bot);

  bot._client.write('teleport_confirm', { teleportId: 7 });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, 'teleport_confirm');
  assert.equal(writes[0].params.teleportId, 7);
  assert.deepEqual(
    [writes[0].params.x, writes[0].params.y, writes[0].params.z],
    [10.25, 70.5, -3.75]
  );
  assert.ok(Math.abs(writes[0].params.yRot - 90) < 1e-10);
  assert.ok(Math.abs(writes[0].params.xRot - 15) < 1e-10);
});

test('teleport debug mode reports schema and payload fields without values', () => {
  const { bot } = createBot();
  const originalDebug = process.env.MINECRAFT_PROTOCOL_DEBUG_WRITES;
  const originalLog = console.log;
  const messages = [];
  process.env.MINECRAFT_PROTOCOL_DEBUG_WRITES = '1';
  console.log = message => messages.push(message);

  try {
    installProtocolPacketCompatibility(bot);
    bot._client.write('teleport_confirm', { teleportId: 7 });
  } finally {
    console.log = originalLog;
    if (originalDebug === undefined) delete process.env.MINECRAFT_PROTOCOL_DEBUG_WRITES;
    else process.env.MINECRAFT_PROTOCOL_DEBUG_WRITES = originalDebug;
  }

  assert.match(messages[0], /schema=\[teleportId,x,y,z,yRot,xRot\]/);
  assert.match(messages[0], /payload=\[teleportId,x,y,z,yRot,xRot\]/);
  assert.doesNotMatch(messages[0], /10\.25|70\.5|-3\.75/);
});

test('protocol features are resolved when the first packets are written', () => {
  const { bot, writes } = createBot();
  bot.registry = undefined;
  bot.supportFeature = () => false;
  installProtocolPacketCompatibility(bot);
  bot.registry = {
    protocol: {
      types: {
        packet_teleport_confirm: ['container', [
          { name: 'teleportId' },
          { name: 'x' },
          { name: 'y' },
          { name: 'z' },
          { name: 'yRot' },
          { name: 'xRot' }
        ]]
      }
    }
  };

  bot._client.write('teleport_confirm', { teleportId: 8 });

  assert.equal(writes[0].params.x, 10.25);
  assert.equal(writes[0].params.yRot, 90);
});

test('legacy teleport schema receives only its declared packet fields', () => {
  const { bot, writes } = createBot({ extendedTeleport: false });
  installProtocolPacketCompatibility(bot);

  bot._client.write('teleport_confirm', { teleportId: 2 });

  assert.deepEqual(writes, [{ name: 'teleport_confirm', params: { teleportId: 2 } }]);
});

test('movement packets are followed by tick_end only on supporting versions', () => {
  const { bot, writes } = createBot();
  installProtocolPacketCompatibility(bot);

  bot._client.write('position', { x: 1, y: 2, z: 3, onGround: true });

  assert.deepEqual(writes.map(packet => packet.name), ['position', 'tick_end']);
});

test('older versions do not receive tick_end packets', () => {
  const { bot, writes } = createBot({ extendedTeleport: false, sendsTickEnd: false });
  installProtocolPacketCompatibility(bot);

  bot._client.write('position', { x: 1, y: 2, z: 3, onGround: true });

  assert.deepEqual(writes.map(packet => packet.name), ['position']);
});

test('extended teleport confirmation fails explicitly when resolved coordinates are missing', () => {
  const { bot, writes } = createBot();
  bot.entity.position = null;
  installProtocolPacketCompatibility(bot);

  assert.throws(
    () => bot._client.write('teleport_confirm', { teleportId: 7 }),
    /resolved position or rotation is unavailable/
  );
  assert.deepEqual(writes, []);
});

test('partially extended teleport schemas fail explicitly', () => {
  const { bot, writes } = createBot();
  bot.registry.protocol.types.packet_teleport_confirm[1].pop();
  installProtocolPacketCompatibility(bot);

  assert.throws(
    () => bot._client.write('teleport_confirm', { teleportId: 7 }),
    /incomplete position\/rotation payload/
  );
  assert.deepEqual(writes, []);
});
