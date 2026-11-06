'use strict';

function supportedVersions() {
  const minecraftData = require('minecraft-data');
  const minecraftProtocol = require('minecraft-protocol');
  const dataVersions = new Set(
    (minecraftData.versions?.pc || [])
      .map(version => version.minecraftVersion)
  );
  const protocolVersions = new Set(minecraftProtocol.supportedVersions || []);
  return [...dataVersions].filter(version => protocolVersions.has(version));
}

function resolveBotVersion(config = {}, env = process.env, supported = supportedVersions()) {
  const configured = String(config.server?.version || '').trim();
  if (!configured) return { version: false, requested: '', fallback: false };

  const supportedSet = new Set(supported);
  if (supportedSet.has(configured)) {
    return { version: configured, requested: configured, fallback: false };
  }

  const fallback = String(
    env.MINECRAFT_VERSION_FALLBACK ||
    config.server?.['proxy-version-fallback'] ||
    ''
  ).trim();

  if (fallback && supportedSet.has(fallback)) {
    return { version: fallback, requested: configured, fallback: true };
  }

  const supportedList = [...supportedSet].join(', ');
  throw new Error(
    `Minecraft version ${configured} is not supported by the installed protocol stack. ` +
    `Supported versions: ${supportedList || 'none'}. ` +
    'Install a compatible PrismarineJS release or configure a supported version.'
  );
}

module.exports = { resolveBotVersion, supportedVersions };
