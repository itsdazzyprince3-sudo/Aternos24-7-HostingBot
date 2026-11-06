'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ManualControlSession,
  setManualControl,
  releaseManualControls
} = require('../lib/manual-controls');

function createFakeBot() {
  const calls = [];
  return {
    calls,
    pathfinder: { stop: () => calls.push(['stop']) },
    setControlState: (input, pressed) => calls.push([input, pressed])
  };
}

test('manual controls pause pathfinding once and support simultaneous inputs', () => {
  const bot = createFakeBot();
  const active = new Set();

  setManualControl(bot, active, 'forward', true);
  setManualControl(bot, active, 'jump', true);
  setManualControl(bot, active, 'forward', false);

  assert.deepEqual(bot.calls, [
    ['stop'],
    ['forward', true],
    ['jump', true],
    ['forward', false]
  ]);
  assert.deepEqual([...active], ['jump']);
});

test('release clears held controls and is safe after the bot disconnects', () => {
  const bot = createFakeBot();
  const active = new Set(['left', 'sprint']);

  releaseManualControls(bot, active);
  releaseManualControls(null, active);

  assert.deepEqual(bot.calls, [['left', false], ['sprint', false]]);
  assert.equal(active.size, 0);
});

test('manual controls reject unknown inputs and non-boolean states', () => {
  const bot = createFakeBot();
  const active = new Set();

  assert.throws(() => setManualControl(bot, active, 'attack', true), /Unsupported/);
  assert.throws(() => setManualControl(bot, active, 'forward', 'yes'), /boolean/);
  assert.equal(active.size, 0);
});

test('manual control lease releases held inputs if the web client disappears', () => {
  const bot = createFakeBot();
  const timers = [];
  const expirations = [];
  const session = new ManualControlSession({
    getBot: () => bot,
    isConnected: () => true,
    leaseMs: 1000,
    setTimeoutImpl: callback => {
      const timer = { callback, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: timer => { timer.cleared = true; },
    onExpire: error => expirations.push(error || null)
  });

  session.set('forward', true);
  session.heartbeat();
  assert.equal(timers[0].cleared, true);
  timers[1].callback();

  assert.deepEqual(bot.calls, [['stop'], ['forward', true], ['forward', false]]);
  assert.equal(session.active.size, 0);
  assert.deepEqual(expirations, [null]);
});
