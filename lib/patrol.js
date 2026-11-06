'use strict';

function isPatrolEnabled(config) {
  return config?.ai?.enabled !== true &&
    config?.movement?.enabled !== false &&
    config?.movement?.['circle-walk']?.enabled === true;
}

function createPatrolRoute(anchor, radius, waypointCount = 8, random = Math.random) {
  const safeRadius = Math.max(1, Math.min(16, Math.floor(Number(radius) || 1)));
  const safeWaypointCount = Math.max(4, Math.floor(Number(waypointCount) || 8));
  const points = [];
  const angleStep = (Math.PI * 2) / safeWaypointCount;
  const startAngle = random() * angleStep;

  for (let index = 0; index < safeWaypointCount; index++) {
    const angleJitter = (random() - 0.5) * angleStep * 0.4;
    const angle = startAngle + index * angleStep + angleJitter;
    const distance = safeRadius * (0.55 + random() * 0.45);
    let x = Math.round(anchor.x + Math.cos(angle) * distance);
    let z = Math.round(anchor.z + Math.sin(angle) * distance);

    while (Math.hypot(x - anchor.x, z - anchor.z) > safeRadius) {
      if (Math.abs(x - anchor.x) >= Math.abs(z - anchor.z)) {
        x -= Math.sign(x - anchor.x);
      } else {
        z -= Math.sign(z - anchor.z);
      }
    }

    points.push({
      x,
      y: anchor.y,
      z
    });
  }

  points.push({ x: anchor.x, y: anchor.y, z: anchor.z });
  return points;
}

async function runPatrol({
  anchor,
  radius,
  interval,
  shouldStop,
  shouldPause = () => false,
  goto,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  random = Math.random,
  onError = () => {}
}) {
  const pause = () => sleep(Math.round(interval * (0.75 + random() * 0.5)));

  while (!shouldStop()) {
    if (shouldPause()) {
      await sleep(interval);
      continue;
    }

    const route = createPatrolRoute(anchor, radius, 8, random);
    for (const point of route) {
      if (shouldStop()) return;
      if (shouldPause()) break;

      try {
        await goto(point);
      } catch (error) {
        if (!shouldStop() && !shouldPause()) onError(error, point);
      }

      if (shouldStop()) return;
      await pause();
    }
  }
}

module.exports = { createPatrolRoute, isPatrolEnabled, runPatrol };
