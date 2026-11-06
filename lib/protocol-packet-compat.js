'use strict';

const MOVEMENT_PACKETS = new Set(['position', 'position_look', 'look', 'flying']);
const TELEPORT_FIELDS = ['x', 'y', 'z', 'yRot', 'xRot'];

function getTeleportConfirmFields(bot) {
  const schema = bot.registry?.protocol?.types?.packet_teleport_confirm;
  return Array.isArray(schema?.[1]) ? schema[1].map(field => field?.name) : [];
}

function toNotchianYaw(yaw) {
  return (Math.PI - yaw) * (180 / Math.PI);
}

function toNotchianPitch(pitch) {
  return -pitch * (180 / Math.PI);
}

function installProtocolPacketCompatibility(bot) {
  const client = bot?._client;
  if (!client || typeof client.write !== 'function') {
    throw new TypeError('Mineflayer client is not available for protocol compatibility setup.');
  }

  const originalWrite = client.write;
  const write = originalWrite.bind(client);

  function writeWithCompatibility(name, params) {
    let packet = params;
    if (name === 'teleport_confirm') {
      const teleportFields = getTeleportConfirmFields(bot);
      const hasExtendedTeleportConfirm = TELEPORT_FIELDS.every(field => teleportFields.includes(field));
      const hasPartialExtendedTeleportConfirm = TELEPORT_FIELDS.some(field => teleportFields.includes(field)) &&
        !hasExtendedTeleportConfirm;
      if (hasPartialExtendedTeleportConfirm) {
        throw new Error('The active teleport_confirm schema has an incomplete position/rotation payload.');
      }

      if (hasExtendedTeleportConfirm) {
        const position = bot.entity?.position;
        const { yaw, pitch } = bot.entity || {};
        if (
          !position ||
          ![position.x, position.y, position.z, yaw, pitch].every(Number.isFinite)
        ) {
          throw new Error('Cannot confirm teleport: resolved position or rotation is unavailable.');
        }

        packet = {
          ...params,
          x: position.x,
          y: position.y,
          z: position.z,
          yRot: toNotchianYaw(yaw),
          xRot: toNotchianPitch(pitch)
        };
      }

      if (process.env.MINECRAFT_PROTOCOL_DEBUG_WRITES === '1') {
        console.log(
          `[Protocol] teleport_confirm schema=[${teleportFields.join(',')}] ` +
          `payload=[${Object.keys(packet || {}).join(',')}]`
        );
      }
    }

    const result = write(name, packet);
    if (
      MOVEMENT_PACKETS.has(name) &&
      typeof bot.supportFeature === 'function' &&
      bot.supportFeature('sendsClientTickEndPacket')
    ) {
      write('tick_end', {});
    }
    return result;
  }

  client.write = writeWithCompatibility;
  return () => {
    if (client.write === writeWithCompatibility) client.write = originalWrite;
  };
}

module.exports = { installProtocolPacketCompatibility };
