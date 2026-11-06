'use strict';

require('../lib/protocol-compat');

const test = require('node:test');
const assert = require('node:assert/strict');
const { FullPacketParser } = require('protodef');
const { createDeserializer } = require('minecraft-protocol/src/transforms/serializer');

test('malformed framed packets fail with packet ID and state context', () => {
  const parser = new FullPacketParser({
    parsePacketBuffer() {
      throw new Error('synthetic schema mismatch');
    }
  }, 'play.toClient', true);
  let pushed = false;
  parser.push = () => { pushed = true; };

  let transformError;
  parser._transform(Buffer.from([0x2a, 0x01, 0x02]), null, error => {
    transformError = error;
  });

  assert.equal(pushed, false);
  assert.match(transformError.message, /synthetic schema mismatch/);
  assert.match(transformError.message, /parser=play\.toClient/);
  assert.match(transformError.message, /packetId=42/);
  assert.match(transformError.message, /frameBytes=3/);
  assert.deepEqual(transformError.protocolFrame, {
    parser: 'play.toClient',
    packetId: 42,
    frameBytes: 3,
    prefixHex: '2a0102'
  });
});

test('26.3 partial recipe-book packet is skipped without dropping the connection', () => {
  const parser = createDeserializer({ state: 'play', isServer: false, version: '26.3' });
  const originalError = console.error;
  const logged = [];
  console.error = message => logged.push(message);
  let transformError;
  let pushed = false;
  parser.push = () => { pushed = true; };

  try {
    parser._transform(Buffer.from([0x4b]), null, error => {
      transformError = error;
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(transformError, undefined);
  assert.equal(pushed, false);
  assert.match(logged[0], /Skipping undecodable complete frame; keeping connection open/);
  assert.match(logged[0], /packetId=75/);
});

test('full frame bytes are included only when explicitly enabled', () => {
  const previousValue = process.env.MINECRAFT_PROTOCOL_DEBUG_FRAMES;
  process.env.MINECRAFT_PROTOCOL_DEBUG_FRAMES = '1';
  try {
    const parser = new FullPacketParser({
      parsePacketBuffer() {
        throw new Error('synthetic schema mismatch');
      }
    }, 'configuration.toClient', true);
    let transformError;
    parser._transform(Buffer.from([0x0d, 0x04, 0x1e]), null, error => {
      transformError = error;
    });
    assert.equal(transformError.protocolFrame.frameHex, '0d041e');
  } finally {
    if (previousValue === undefined) delete process.env.MINECRAFT_PROTOCOL_DEBUG_FRAMES;
    else process.env.MINECRAFT_PROTOCOL_DEBUG_FRAMES = previousValue;
  }
});

test('valid framed packets continue through the parser', () => {
  const expectedPacket = { data: { ok: true }, metadata: { size: 1 } };
  const parser = new FullPacketParser({
    parsePacketBuffer: () => expectedPacket
  }, 'play.toClient', true);
  const pushed = [];
  parser.push = packet => { pushed.push(packet); };

  let transformError;
  parser._transform(Buffer.from([0x00]), null, error => {
    transformError = error;
  });

  assert.equal(transformError, undefined);
  assert.deepEqual(pushed, [expectedPacket]);
});
