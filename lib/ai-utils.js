'use strict';

function withTimeout(promise, milliseconds, label = 'Operation', onTimeout = null) {
  const timeoutMs = Math.max(1, Number(milliseconds) || 1);
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // Cleanup is best effort.
      }
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function moveTo(bot, goal, {
  timeoutMs = 15000,
  label = 'Walking'
} = {}) {
  if (!bot?.pathfinder) throw new Error('Pathfinding is not available.');
  try {
    return await withTimeout(
      bot.pathfinder.goto(goal),
      timeoutMs,
      label,
      () => bot.pathfinder.stop()
    );
  } catch (error) {
    try {
      bot.pathfinder.stop();
    } catch {
      // The pathfinder may already be stopped.
    }
    throw error;
  }
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function distanceBetween(left, right) {
  if (!left || !right) return Infinity;
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function safeBlockAt(bot, position) {
  try {
    return bot.blockAt(position) || null;
  } catch {
    return null;
  }
}

module.exports = {
  clamp,
  distanceBetween,
  moveTo,
  safeBlockAt,
  withTimeout
};
