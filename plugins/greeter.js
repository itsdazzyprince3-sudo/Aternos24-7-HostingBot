'use strict';

// Sample bot-side "mod" plugin.
// Demonstrates the plugin API: lifecycle hooks + a chat command.
//
// Lifecycle hooks a plugin may export:
//   onBotReady(bot, ctx)  - called once when the bot spawns on the server
//   onBotEnd(bot)         - called when the bot disconnects
//   onChat(username, message, ctx) - called for plain chat from other players
//
// ctx gives every plugin:
//   ctx.config            - the parsed settings.json
//   ctx.aiAgent           - the AI agent instance
//   ctx.log(msg)          - prefixed console logging
//   ctx.say(text)         - safely chat as the bot (no-op if not connected)
//   ctx.registerCommand(name, description, handler)
//                         - register a `!<name> [args]` chat command;
//                           handler receives (argsString, username)

let joinTime = 0;
let greeted = new Set();
let uptimeTimer = null;

module.exports = {
  name: 'greeter',

  onBotReady(bot, ctx) {
    joinTime = Date.now();
    greeted = new Set();
    ctx.log('ready — will greet players who say hi.');
    // Announce uptime every 10 minutes as a small demo of using the bot directly.
    if (uptimeTimer) clearInterval(uptimeTimer);
    uptimeTimer = setInterval(() => {
      if (!bot.entity) return;
      const mins = Math.floor((Date.now() - joinTime) / 60000);
      if (mins > 0 && mins % 10 === 0) ctx.say(`I've been up for ${mins} minutes.`);
    }, 60000);
  },

  onChat(username, message, ctx) {
    const text = String(message || '').toLowerCase();
    if (/\b(?:hi|hello|hey|yo|hola)\b/.test(text) && !greeted.has(username)) {
      greeted.add(username);
      ctx.say(`Hey ${username}!`);
    }
  },

  onBotEnd() {
    if (uptimeTimer) { clearInterval(uptimeTimer); uptimeTimer = null; }
  },

  commands: [
    {
      name: 'uptime',
      description: 'Show how long the bot has been running this session.',
      handler(_args, _username, ctx) {
        const mins = joinTime ? Math.floor((Date.now() - joinTime) / 60000) : 0;
        ctx.say(`Uptime this session: ${mins} minute${mins === 1 ? '' : 's'}.`);
      }
    }
  ]
};
