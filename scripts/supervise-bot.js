'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { BotSupervisor } = require('../lib/bot-supervisor');

const supervisor = new BotSupervisor({
  spawn,
  command: process.execPath,
  args: [path.join(__dirname, '..', 'index.js')],
  env: process.env
});

const signals = ['SIGINT', 'SIGTERM'];
if (process.platform === 'win32') signals.push('SIGBREAK');

for (const signal of signals) {
  process.once(signal, () => supervisor.stop(signal));
}

supervisor.start();
