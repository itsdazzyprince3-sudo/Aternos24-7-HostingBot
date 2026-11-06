'use strict';

function createPatrolRoute(anchor, radius, waypointCount = 8) {
  const safeRadius = Math.max(1, Math.min(16, Math.floor(Number(radius) || 1)));
  const safeWaypointCount = Math.max(4, Math.floor(Number(waypointCount) || 8));
  const points = [];

  for (let index = 0; index < safeWaypointCount; index++) {
    const angle = (index / safeWaypointCount) * Math.PI * 2;
    let x = Math.round(anchor.x + Math.cos(angle) * safeRadius);
    let z = Math.round(anchor.z + Math.sin(angle) * safeRadius);

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

module.exports = { createPatrolRoute };
