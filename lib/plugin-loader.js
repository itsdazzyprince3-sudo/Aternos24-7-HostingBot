'use strict';

// Bot-side plugin loader ("mods" for a protocol bot).
// Drop a .js file in ./plugins/ that exports an object with lifecycle hooks;
// the bot loads it on startup and calls the hooks as the bot session runs.

const fs = require('node:fs');
const path = require('node:path');

const PLUGINS_DIR = path.resolve(__dirname, '..', 'plugins');

class PluginLoader {
  constructor() {
    this.plugins = [];      // { module, name, path, commands }
    this.commands = new Map(); // commandName(lower) -> { description, handler, plugin }
    this.ctx = null;
    this.bot = null;
  }

  init({ config, aiAgent }) {
    this.ctx = { config, aiAgent };
    this.load();
  }

  load() {
    this.plugins = [];
    this.commands.clear();
    if (!fs.existsSync(PLUGINS_DIR)) {
      try { fs.mkdirSync(PLUGINS_DIR, { recursive: true }); } catch { /* ignore */ }
      console.log('[Plugins] No plugins/ folder; created an empty one. Add .js files there for bot-side mods.');
      return;
    }
    let files;
    try {
      files = fs.readdirSync(PLUGINS_DIR).filter(f => f.toLowerCase().endsWith('.js'));
    } catch (e) {
      console.error(`[Plugins] Could not read plugins directory: ${e.message}`);
      return;
    }
    if (!files.length) {
      console.log('[Plugins] No plugins loaded (plugins/ is empty).');
      return;
    }
    for (const file of files) {
      const fullPath = path.join(PLUGINS_DIR, file);
      try {
        delete require.cache[require.resolve(fullPath)];
        const mod = require(fullPath);
        if (typeof mod !== 'object' || mod === null) throw new Error('plugin must export an object');
        const name = String(mod.name || file.replace(/\.js$/i, ''));
        this.plugins.push({ module: mod, name, path: fullPath, commands: [] });
        console.log(`[Plugins] Loaded: ${name} (${file})`);
      } catch (e) {
        console.error(`[Plugins] Failed to load ${file}: ${e.message}`);
      }
    }
  }

  reload() {
    const before = this.plugins.map(p => p.name).join(', ') || 'none';
    try { if (this.bot) this.onBotEnd(this.bot); } catch { /* ignore */ }
    this.load();
    try { if (this.bot) this.onBotReady(this.bot); } catch { /* ignore */ }
    const after = this.plugins.map(p => p.name).join(', ') || 'none';
    return { before, after };
  }

  registerCommand(name, description, handler, plugin) {
    if (typeof name !== 'string' || typeof handler !== 'function') return;
    this.commands.set(name.toLowerCase(), {
      description: description || '',
      handler,
      plugin: plugin || null,
      ctx: plugin ? this.makeCtx(plugin) : null
    });
  }

  onBotReady(bot) {
    this.bot = bot;
    for (const p of this.plugins) {
      try {
        if (typeof p.module.onBotReady === 'function') p.module.onBotReady(bot, this.makeCtx(p));
      } catch (e) {
        console.error(`[Plugins] ${p.name}.onBotReady failed: ${e.message}`);
      }
      // Auto-register a `commands` array the plugin may export.
      if (Array.isArray(p.module.commands)) {
        for (const c of p.module.commands) {
          if (c && c.name && typeof c.handler === 'function') {
            this.registerCommand(c.name, c.description, c.handler, p);
            p.commands.push(c.name);
          }
        }
      }
    }
  }

  onBotEnd(bot) {
    for (const p of this.plugins) {
      try {
        if (typeof p.module.onBotEnd === 'function') p.module.onBotEnd(bot);
      } catch (e) {
        console.error(`[Plugins] ${p.name}.onBotEnd failed: ${e.message}`);
      }
    }
    this.bot = null;
  }

  // Returns true if a registered plugin command consumed the message.
  handleChatCommand(message, username) {
    const trimmed = String(message || '').trim();
    if (!trimmed.startsWith('!')) return false;
    const rest = trimmed.slice(1);
    const spaceIdx = rest.search(/\s/);
    const cmd = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).toLowerCase();
    if (!cmd || !this.commands.has(cmd)) return false;
    const arg = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();
    const entry = this.commands.get(cmd);
    try {
      entry.handler(arg, username, entry.ctx);
    } catch (e) {
      console.error(`[Plugins] command !${cmd} failed: ${e.message}`);
    }
    return true;
  }

  // Call every plugin's onChat hook for plain chat (not for !ai / plugin commands).
  onChat(username, message) {
    for (const p of this.plugins) {
      try {
        if (typeof p.module.onChat === 'function') p.module.onChat(username, message, this.makeCtx(p));
      } catch (e) {
        console.error(`[Plugins] ${p.name}.onChat failed: ${e.message}`);
      }
    }
  }

  makeCtx(plugin) {
    const self = this;
    return {
      config: this.ctx && this.ctx.config,
      aiAgent: this.ctx && this.ctx.aiAgent,
      log: (msg) => console.log(`[Plugin:${plugin.name}] ${msg}`),
      say: (text) => { if (self.bot) { try { self.bot.chat(String(text)); } catch { /* ignore */ } } },
      registerCommand: (name, description, handler) => {
        self.registerCommand(name, description, handler, plugin);
        plugin.commands.push(name);
      }
    };
  }

  list() {
    return this.plugins.map(p => ({
      name: p.name,
      file: path.basename(p.path),
      commands: p.commands.slice(),
      hasOnBotReady: typeof p.module.onBotReady === 'function',
      hasOnChat: typeof p.module.onChat === 'function'
    }));
  }
}

const loader = new PluginLoader();
module.exports = loader;
module.exports.PluginLoader = PluginLoader;
module.exports.PLUGINS_DIR = PLUGINS_DIR;
