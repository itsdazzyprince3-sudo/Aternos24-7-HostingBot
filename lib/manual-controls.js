'use strict';

const CONTROL_INPUTS = new Set([
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'sneak',
  'sprint'
]);

function setManualControl(bot, activeControls, input, pressed) {
  if (!CONTROL_INPUTS.has(input)) {
    throw new TypeError('Unsupported movement control.');
  }
  if (typeof pressed !== 'boolean') {
    throw new TypeError('pressed must be a boolean.');
  }
  if (!bot || typeof bot.setControlState !== 'function') {
    throw new Error('Movement controls are unavailable for this bot.');
  }

  if (pressed && !activeControls.has(input)) {
    if (activeControls.size === 0) bot.pathfinder?.stop();
    bot.setControlState(input, true);
    activeControls.add(input);
  } else if (!pressed && activeControls.has(input)) {
    bot.setControlState(input, false);
    activeControls.delete(input);
  }

  return [...activeControls];
}

function releaseManualControls(bot, activeControls) {
  let firstError = null;
  if (bot && typeof bot.setControlState === 'function') {
    for (const input of activeControls) {
      try {
        bot.setControlState(input, false);
      } catch (error) {
        if (!firstError) firstError = error;
      }
    }
  }
  activeControls.clear();
  if (firstError) throw firstError;
}

class ManualControlSession {
  constructor({
    getBot,
    isConnected,
    leaseMs = 5000,
    onExpire = () => {},
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout
  }) {
    this.getBot = getBot;
    this.isConnected = isConnected;
    this.leaseMs = leaseMs;
    this.onExpire = onExpire;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.active = new Set();
    this.leaseTimer = null;
  }

  set(input, pressed) {
    const active = setManualControl(this.getBot(), this.active, input, pressed);
    this.refreshLease();
    return active;
  }

  heartbeat() {
    if (!this.active.size) return [];
    if (!this.isConnected()) {
      this.disconnect();
      throw new Error('The Minecraft bot is not connected.');
    }
    this.refreshLease();
    return [...this.active];
  }

  release() {
    this.clearLease();
    releaseManualControls(this.getBot(), this.active);
    return [];
  }

  disconnect() {
    this.clearLease();
    this.active.clear();
  }

  refreshLease() {
    this.clearLease();
    if (!this.active.size) return;

    this.leaseTimer = this.setTimeoutImpl(() => {
      this.leaseTimer = null;
      if (!this.active.size) return;
      try {
        this.release();
        this.onExpire();
      } catch (error) {
        this.active.clear();
        this.onExpire(error);
      }
    }, this.leaseMs);
    this.leaseTimer.unref?.();
  }

  clearLease() {
    if (this.leaseTimer) {
      this.clearTimeoutImpl(this.leaseTimer);
      this.leaseTimer = null;
    }
  }
}

module.exports = {
  CONTROL_INPUTS,
  ManualControlSession,
  setManualControl,
  releaseManualControls
};
