# Bot-side plugins ("mods")

A Mineflayer bot is a protocol client, not a game client, so it cannot load
Fabric/Forge mods or resource packs. This loader gives you the closest real
equivalent: drop a `.js` file in this folder and the bot runs it as an
extra behavior module.

## Lifecycle

The bot loads every `*.js` file here on startup. Each file `module.exports`
an object. Hooks are optional:

```js
module.exports = {
  name: 'my-mod',

  // Called once when the bot spawns on the server.
  onBotReady(bot, ctx) { /* ... */ },

  // Called when the bot disconnects. Clear timers/locks here.
  onBotEnd(bot) { /* ... */ },

  // Called for plain chat from other players (not for !ai / !command messages).
  onChat(username, message, ctx) { /* ... */ },

  // Optional: register chat commands. Each becomes `!<name> [args]`.
  commands: [
    {
      name: 'ping',
      description: 'Reply with pong',
      handler(args, username, ctx) { ctx.say('pong!'); }
    }
  ]
};
```

## The `ctx` object

Every hook and command handler receives a `ctx`:

| member | type | notes |
|---|---|---|
| `ctx.config` | object | the parsed `settings.json` |
| `ctx.aiAgent` | object | the AI agent instance (see `lib/ai-agent.js`) |
| `ctx.log(msg)` | fn | prefixed console logging |
| `ctx.say(text)` | fn | chat as the bot; safe no-op if not connected |
| `ctx.registerCommand(name, desc, handler)` | fn | register a `!<name>` command at runtime |

`bot` is the raw Mineflayer bot in `onBotReady`/`onBotEnd` — you can read
`bot.health`, `bot.inventory.items()`, `bot.players`, listen to `bot.on(...)`,
call `bot.chat(...)`, `bot.pathfinder.goto(...)`, etc.

## Managing plugins from in-game chat

- `!ai plugins` — list loaded plugins and their commands
- `!ai plugins reload` — rescan this folder (hot-reload without restarting the bot)

Plugins reload on reconnect automatically (every spawn calls `onBotReady`).

## Notes

- A plugin throwing in a hook is caught and logged; it will not crash the bot.
- `onChat` only receives plain chat. `!ai ...` and registered `!command`
  messages are handled first and do not reach `onChat`.
- Avoid leaking intervals/listeners: clear them in `onBotEnd`, because the bot
  may reconnect and call `onBotReady` again.

See `greeter.js` for a complete working example.
