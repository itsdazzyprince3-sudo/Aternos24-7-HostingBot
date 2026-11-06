'use strict';

class BotSupervisor {
  constructor({ spawn, command, args, env = process.env, restartDelay = 5000, log = console }) {
    this.spawnProcess = spawn;
    this.command = command;
    this.args = args;
    this.env = env;
    this.restartDelay = restartDelay;
    this.log = log;
    this.child = null;
    this.restartTimer = null;
    this.stopping = false;
  }

  start() {
    if (this.stopping || this.child || this.restartTimer) return;
    this.log.log('[Supervisor] Starting Minecraft bot process.');

    try {
      const child = this.spawnProcess(this.command, this.args, {
        stdio: 'inherit',
        env: this.env
      });
      this.child = child;
      child.once('error', error => {
        this.log.error(`[Supervisor] Bot process error: ${error.message}`);
        this.scheduleRestart(child);
      });
      child.once('exit', (code, signal) => {
        this.log.error(`[Supervisor] Bot process exited (code=${code}, signal=${signal || 'none'}).`);
        this.scheduleRestart(child);
      });
    } catch (error) {
      this.log.error(`[Supervisor] Could not start bot process: ${error.message}`);
      this.scheduleRestart(null);
    }
  }

  scheduleRestart(child) {
    if (this.stopping || this.restartTimer || (child && this.child !== child)) return;
    if (child && this.child === child) this.child = null;
    this.log.log(`[Supervisor] Restarting bot in ${this.restartDelay / 1000}s. Press Ctrl+C to stop.`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, this.restartDelay);
  }

  stop(signal = 'SIGINT') {
    if (this.stopping) return;
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.log.log(`[Supervisor] ${signal} received; stopping without restarting.`);
    if (this.child && !this.child.killed) this.child.kill(signal);
  }
}

module.exports = { BotSupervisor };
