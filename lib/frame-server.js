'use strict';

// Streams the bot's first-person world to a local C++ raycaster.
// Binary frame over TCP. No rendering here - this just packs the voxel grid
// the bot already has (bot.blockAt) plus eye + entities, and the C++ side draws it.

const net = require('node:net');

const DEFAULT_FRAME_PORT = Number(process.env.VIEW_FRAME_PORT) || 31337;
const DEFAULT_W = Number(process.env.VIEW_W) || 64;   // x
const DEFAULT_H = Number(process.env.VIEW_H) || 48;   // y
const DEFAULT_D = Number(process.env.VIEW_D) || 64;   // z
const DEFAULT_FPS = Number(process.env.VIEW_FPS) || 6;
const MAX_GRID_DIMENSION = 128;

function clampDimension(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(8, Math.min(MAX_GRID_DIMENSION, Math.floor(number)));
}

function daylightFactor(timeOfDay, dimension) {
  if (dimension && dimension !== 'overworld') return 0;
  const time = Number(timeOfDay);
  if (!Number.isFinite(time)) return 1;
  const dayTime = ((time % 24000) + 24000) % 24000;
  if (dayTime < 12000) return 1;
  if (dayTime < 13000) return 1 - (dayTime - 12000) / 1000;
  if (dayTime < 23000) return 0;
  return (dayTime - 23000) / 1000;
}

// block.name -> uint8 render kind (0 = air/transparent, renderer skips it)
function blockKind(name) {
  if (!name || name === 'air' || name === 'cave_air' || name === 'void_air') return 0;
  if (name === 'water') return 7;
  if (name === 'lava') return 9;
  if (/glass$/.test(name)) return 11;
  if (name === 'snow' || name === 'snow_block' || /ice$/.test(name)) return 10;
  if (name === 'grass_block' || name === 'grass' || name === 'moss_block') return 3;
  if (/_log$/.test(name)) return 4;
  if (/leaves$/.test(name) || name === 'azalea' || name === 'mangrove_roots') return 5;
  if (/sand$/.test(name) || name === 'gravel' || name === 'red_sand') return 6;
  if (/_ore$/.test(name)) return 8;
  if (name === 'netherrack' || name === 'nether_bricks' || name === 'soul_sand' || name === 'soul_soil') return 13;
  if (name === 'bedrock' || name === 'obsidian' || name === 'crying_obsidian') return 14;
  if (/_sapling$/.test(name) || /_stem$/.test(name) || name === 'vine' || /flower$/.test(name) || name === 'tall_grass' || name === 'fern') return 12;
  if (name === 'dirt' || name === 'farmland' || name === 'podzol' || name === 'coarse_dirt' || name === 'rooted_dirt') return 2;
  if (name === 'stone' || name === 'cobblestone' || /deepslate$/.test(name) || /_bricks$/.test(name) || name === 'bedrock') return 1;
  return 15; // generic solid
}

class FrameServer {
  constructor({ getBot, isConnected, port = DEFAULT_FRAME_PORT, w = DEFAULT_W, h = DEFAULT_H, d = DEFAULT_D, fps = DEFAULT_FPS } = {}) {
    this.getBot = getBot;
    this.isConnected = isConnected || (() => true);
    this.port = port;
    this.w = clampDimension(w, DEFAULT_W);
    this.h = clampDimension(h, DEFAULT_H);
    this.d = clampDimension(d, DEFAULT_D);
    this.fps = Math.max(1, Math.min(fps, 30));
    this.server = null;
    this.clients = new Set();
    this.timer = null;
  }

  start() {
    if (this.server) return;
    this.server = net.createServer((socket) => {
      socket.setNoDelay(true);
      this.clients.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => this.clients.delete(socket));
    });
    this.server.on('error', (e) => console.error(`[View] frame server error: ${e.message}`));
    this.server.listen(this.port, '127.0.0.1', () => {
      console.log(`[View] frame server on 127.0.0.1:${this.port} (${this.w}x${this.h}x${this.d} @ ${this.fps}fps)`);
    });
    this.timer = setInterval(() => this.broadcast(), Math.round(1000 / this.fps));
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const c of this.clients) { try { c.destroy(); } catch {} }
    this.clients.clear();
    if (this.server) { try { this.server.close(); } catch {} this.server = null; }
  }

  buildFrame() {
    const bot = this.getBot && this.getBot();
    if (!bot || !bot.entity || !bot.entity.position) return null;
    const pos = bot.entity.position;
    const yaw = Number(bot.entity.yaw) || 0;
    const pitch = Number(bot.entity.pitch) || 0;
    const eyeX = pos.x, eyeY = pos.y + 1.62, eyeZ = pos.z;
    const W = this.w, H = this.h, D = this.d;
    const ox = Math.floor(pos.x) - (W >> 1);
    const oy = Math.floor(eyeY) - (H >> 1);
    const oz = Math.floor(pos.z) - (D >> 1);
    const grid = Buffer.alloc(W * H * D);
    const lights = Buffer.alloc(W * H * D, 255);
    const skyFactor = daylightFactor(bot.time?.timeOfDay, bot.game?.dimension || 'overworld');
    let idx = 0;
    for (let y = 0; y < H; y++) {
      for (let z = 0; z < D; z++) {
        for (let x = 0; x < W; x++) {
          let kind = 0;
          try {
            const b = bot.blockAt ? bot.blockAt({ x: ox + x, y: oy + y, z: oz + z }) : null;
            if (b && b.name) {
              kind = blockKind(b.name);
              const blockLight = Number(b.light);
              const skyLight = Number(b.skyLight);
              if (Number.isFinite(blockLight) || Number.isFinite(skyLight)) {
                const blockLevel = Number.isFinite(blockLight) ? Math.max(0, Math.min(15, blockLight)) : 0;
                const skyLevel = Number.isFinite(skyLight) ? Math.max(0, Math.min(15, skyLight)) * skyFactor : 0;
                lights[idx] = Math.round(Math.max(blockLevel, skyLevel));
              }
            }
          } catch { /* unloaded -> air */ }
          grid[idx++] = kind;
        }
      }
    }
    // entities near the bot (relative to eye), capped
    const ents = [];
    try {
      const list = Object.values(bot.entities || {});
      for (const e of list) {
        if (!e || e === bot.entity || !e.position) continue;
        const dx = e.position.x - eyeX, dy = e.position.y - eyeY, dz = e.position.z - eyeZ;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > Math.max(W, D)) continue;
        let kind = 3;
        if (e.type === 'player') kind = 2;
        else if (e.type === 'mob') kind = 1;
        ents.push({ x: dx, y: dy, z: dz, kind, name: String(e.username || e.name || e.type || '') });
        if (ents.length >= 64) break;
      }
    } catch { /* ignore */ }
    // V2 header: magic(4), version(1), eye(12), yaw/pitch(8), origin(12),
    // dimensions(6), and current daylight factor(4) = 47 bytes.
    const head = Buffer.alloc(47);
    head.write('VFRM', 0, 'ascii');
    head.writeUInt8(2, 4);
    head.writeFloatLE(eyeX, 5); head.writeFloatLE(eyeY, 9); head.writeFloatLE(eyeZ, 13);
    head.writeFloatLE(yaw, 17); head.writeFloatLE(pitch, 21);
    head.writeInt32LE(ox, 25); head.writeInt32LE(oy, 29); head.writeInt32LE(oz, 33);
    head.writeUInt16LE(W, 37); head.writeUInt16LE(H, 39); head.writeUInt16LE(D, 41);
    head.writeFloatLE(skyFactor, 43);
    // entities: count(2) + per entity float32x3 rel + uint8 kind + uint8 nameLen + name bytes
    const entBuf = Buffer.alloc(2);
    entBuf.writeUInt16LE(ents.length, 0);
    const entPieces = [entBuf];
    for (const e of ents) {
      const nameBuf = Buffer.from(e.name.slice(0, 31), 'utf8');
      const piece = Buffer.alloc(14 + nameBuf.length);
      piece.writeFloatLE(e.x, 0); piece.writeFloatLE(e.y, 4); piece.writeFloatLE(e.z, 8);
      piece.writeUInt8(e.kind, 12); piece.writeUInt8(nameBuf.length, 13);
      nameBuf.copy(piece, 14);
      entPieces.push(piece);
    }
    return Buffer.concat([head, grid, lights, ...entPieces]);
  }

  broadcast() {
    if (!this.clients.size) return;
    if (!this.isConnected()) return;
    const frame = this.buildFrame();
    if (!frame) return;
    for (const c of this.clients) {
      try { c.write(frame); } catch { this.clients.delete(c); }
    }
  }
}

module.exports = { FrameServer, blockKind, daylightFactor, clampDimension, MAX_GRID_DIMENSION };
