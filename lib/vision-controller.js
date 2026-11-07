'use strict';

// Vision-control loop: the bot "watches" a rendered first-person view and a
// vision model picks an action each tick, which is executed on the bot.
// Render source = the C++ viewer's HTTP /frame (BMP). Reasoner = Ollama vision.
// Free/local by design. SLOW on CPU-only hosts - that is expected and unavoidable.

const zlib = require('node:zlib');

const ACTIONS = ['forward','back','left','right','turn_left','turn_right',
  'look_up','look_down','jump','mine','attack','use','stop','none'];

// ---- pure-Node PNG encoder (8-bit RGBA, no deps) ----
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function pngFromRGBA(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const rowLen = w * 4;
  const raw = Buffer.alloc((rowLen + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (rowLen + 1)] = 0; rgba.copy(raw, y * (rowLen + 1) + 1, y * rowLen, y * rowLen + rowLen); }
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---- BMP (24-bit) decoder ----
function bmpToRGBA(buf) {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) return null;
  const dataOff = buf.readUInt32LE(10);
  const w = buf.readInt32LE(18);
  let h = buf.readInt32LE(22);
  const topDown = h < 0; if (topDown) h = -h;
  const bpp = buf.readUInt16LE(28);
  if (bpp !== 24) return null;
  const rowSize = ((w * 3 + 3) & ~3);
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const srcRow = topDown ? y : (h - 1 - y);
    const rowBase = dataOff + srcRow * rowSize;
    for (let x = 0; x < w; x++) {
      const b = buf[rowBase + x * 3], g = buf[rowBase + x * 3 + 1], r = buf[rowBase + x * 3 + 2];
      const o = (y * w + x) * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  }
  return { w, h, rgba };
}

class VisionController {
  constructor(opts = {}) {
    this.getBot = opts.getBot || (() => null);
    this.isConnected = opts.isConnected || (() => true);
    this.viewerUrl = (opts.viewerUrl || 'http://127.0.0.1:8080').replace(/\/$/, '');
    this.ollamaUrl = (opts.ollamaUrl || 'http://127.0.0.1:11434/api/chat').replace(/\/$/, '');
    this.model = opts.model || 'llava';
    this.intervalMs = Number(opts.intervalMs) || 4000;
    this.dryRun = !!opts.dryRun;
    this.enabled = !!opts.enabled;
    this.onLog = opts.onLog || (() => {});
    this.timer = null;
    this.lastAction = 'none';
    this.ticks = 0;
    this.failures = 0;
    this.paused = false;
  }

  start() {
    this.paused = false;
    this.failures = 0;
    if (this.timer || !this.enabled) return;
    this.onLog(`vision-control ON (model=${this.model}, every ${Math.round(this.intervalMs / 1000)}s, dryRun=${this.dryRun})`);
    this.timer = setInterval(() => this.tick().catch(e => this.onLog(`vision error: ${e.message}`)), this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.clearControls();
    this.onLog('vision-control OFF');
  }
  status() { return { enabled: !!this.timer, model: this.model, ticks: this.ticks, lastAction: this.lastAction, dryRun: this.dryRun }; }

  async captureFrame() {
    const res = await fetch(`${this.viewerUrl}/frame`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`viewer /frame HTTP ${res.status}`);
    const bmp = Buffer.from(await res.arrayBuffer());
    const dec = bmpToRGBA(bmp);
    if (!dec) throw new Error('could not decode viewer frame (expected 24-bit BMP)');
    return dec;
  }

  botState() {
    const bot = this.getBot();
    if (!bot || !bot.entity) return '';
    const ents = Object.values(bot.entities || {})
      .filter(e => e && e !== bot.entity && e.position)
      .slice(0, 6)
      .map(e => `${e.name || e.username || e.type}@${Math.round(e.position.x)},${Math.round(e.position.y)},${Math.round(e.position.z)}`)
      .join('; ');
    return `health ${bot.health}/20, food ${bot.food}/20, holding ${bot.heldItem?.name || 'nothing'}, nearby: ${ents || 'none'}`;
  }

  async askModel(pngBase64, stateText) {
    if (this.dryRun) {
      // canned reasoning so the loop is testable without a vision model installed
      const choice = ['forward', 'turn_left', 'none', 'look_down'][this.ticks % 4];
      return `ACTION: ${choice} - (dry-run simulated)`;
    }
    const system = 'You control a Minecraft bot by watching its first-person view. The image is a software-raycasted view: blocks are colored cubes with face shading; entities are colored squares (RED=mob/hostile, GREEN=player, YELLOW=other). Keep the bot alive and gather resources. Reply with exactly one line: "ACTION: <action> - <reason>". Valid actions: ' + ACTIONS.join(' ') + '. Pick one.';
    const user = `State: ${stateText}. What should I do next?`;
    const body = {
      model: this.model,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user, images: [pngBase64] }
      ],
      options: { temperature: 0.2, num_ctx: 2048 }
    };
    const res = await fetch(this.ollamaUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60000)
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}: ${await res.text().catch(()=>'')}`);
    const data = await res.json();
    return String(data?.message?.content || data?.response || '').trim();
  }

  parseAction(text) {
    const m = String(text || '').match(/ACTION:\s*([a-z_]+)/i);
    let a = m ? m[1].toLowerCase() : '';
    if (!ACTIONS.includes(a)) {
      for (const act of ACTIONS) if (String(text).toLowerCase().includes(act)) { a = act; break; }
    }
    return ACTIONS.includes(a) ? a : 'none';
  }

  async tick() {
    if (this.paused || !this.isConnected()) return;
    try {
      const frame = await this.captureFrame();
      const png = pngFromRGBA(frame.rgba, frame.w, frame.h);
      const b64 = png.toString('base64');
      const stateText = this.botState();
      const reply = await this.askModel(b64, stateText);
      const action = this.parseAction(reply);
      this.lastAction = action;
      this.ticks += 1;
      this.failures = 0;
      this.applyAction(action);
      this.onLog(`vision tick #${this.ticks}: ${action} | ${String(reply).split('\n')[0].slice(0, 120)}`);
    } catch (e) {
      this.failures += 1;
      // throttle noise: log first failure, then every 5th
      if (this.failures === 1 || this.failures % 5 === 0) {
        this.onLog(`error #${this.failures}: ${e.message}`);
      }
      if (this.failures >= 3 && !this.paused) {
        this.paused = true;
        this.onLog(`paused after ${this.failures} failures (last: ${e.message}). Is Ollama + a vision model running? Is the C++ viewer up (BOT_VIEW=1)? Say "!ai vision on" to retry.`);
        this.stop();
      }
    }
  }

  clearControls() {
    const bot = this.getBot();
    if (!bot || !bot.entity) return;
    try { for (const k of ['forward','back','left','right','jump','sprint']) bot.setControlState?.(k, false); } catch {}
  }

  applyAction(action) {
    const bot = this.getBot();
    if (!bot || !bot.entity) return;
    this.clearControls();
    try {
      switch (action) {
        case 'forward': bot.setControlState?.('forward', true); break;
        case 'back': bot.setControlState?.('back', true); break;
        case 'left': bot.setControlState?.('left', true); break;
        case 'right': bot.setControlState?.('right', true); break;
        case 'jump': bot.setControlState?.('jump', true); break;
        case 'turn_left': bot.look?.(bot.entity.yaw - 0.35, bot.entity.pitch); break;
        case 'turn_right': bot.look?.(bot.entity.yaw + 0.35, bot.entity.pitch); break;
        case 'look_up': bot.look?.(bot.entity.yaw, bot.entity.pitch - 0.3); break;
        case 'look_down': bot.look?.(bot.entity.yaw, bot.entity.pitch + 0.3); break;
        case 'mine': this.digForward(bot); break;
        case 'attack': this.attackNearest(bot); break;
        case 'use': bot.activateItem?.(); break;
        case 'stop': break; // controls already cleared
        case 'none': default: break;
      }
    } catch (e) { this.onLog(`vision apply error: ${e.message}`); }
  }

  digForward(bot) {
    if (!bot.blockAt || !bot.dig) return;
    const e = bot.entity.position;
    const fwd = { x: -Math.sin(bot.entity.yaw), y: 0, z: Math.cos(bot.entity.yaw) };
    const target = bot.blockAt({ x: Math.floor(e.x + fwd.x), y: Math.floor(e.y + 1.5), z: Math.floor(e.z + fwd.z) });
    if (target && target.name && target.name !== 'air') bot.dig(target).catch(() => {});
  }
  attackNearest(bot) {
    if (!bot.entities || !bot.attack) return;
    const e = bot.entity.position;
    let best = null, bd = 5;
    for (const en of Object.values(bot.entities)) {
      if (!en || en === bot.entity || !en.position || en.type !== 'mob') continue;
      const d = en.position.distanceTo(e); if (d < bd) { bd = d; best = en; }
    }
    if (best) bot.attack(best).catch(() => {});
  }
}

module.exports = { VisionController, pngFromRGBA, bmpToRGBA, ACTIONS };
