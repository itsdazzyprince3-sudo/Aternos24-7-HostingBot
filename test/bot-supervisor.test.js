'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { BotSupervisor } = require('../lib/bot-supervisor');

const quietLog = { log() {}, error() {} };

test('supervisor restarts the bot process after it exits', async () => {
  const children = [];
  const supervisor = new BotSupervisor({
    spawn: () => {
      const child = new EventEmitter();
      child.kill = () => {};
      child.killed = false;
      children.push(child);
      return child;
    },
    command: 'node',
    args: [],
    restartDelay: 5,
    log: quietLog
  });

  supervisor.start();
  children[0].emit('exit', 1, null);
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(children.length, 2);
  supervisor.stop();
});

test('supervisor does not restart after it is stopped', async () => {
  const children = [];
  const supervisor = new BotSupervisor({
    spawn: () => {
      const child = new EventEmitter();
      child.kill = () => {};
      child.killed = false;
      children.push(child);
      return child;
    },
    command: 'node',
    args: [],
    restartDelay: 5,
    log: quietLog
  });

  supervisor.start();
  supervisor.stop();
  children[0].emit('exit', 0, 'SIGINT');
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(children.length, 1);
});
