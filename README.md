# Aternos 24/7 Hosting Bot

A Minecraft bot that joins your server and keeps it alive around the clock.
It reconnects automatically if kicked or if the server restarts, and can be
hosted for free on several platforms.

---

## How It Works

The bot uses Mineflayer to join your Minecraft server as a fake player.
It moves around, swings its arm, and does small random actions so the server
does not detect it as idle. If it gets kicked or disconnected for any reason,
it reconnects on its own using an exponential backoff so it does not spam the server.

A small web server runs alongside the bot. You can visit the URL your host gives
you to see a live dashboard showing whether the bot is connected, its uptime,
and its coordinates.

---

## Compatibility status

The project now uses an experimental native 26.3 stack: the upstream Mineflayer
26.3 commit, the upstream protocol-777 branch, vendored official 26.3 data,
and local compatibility patches for Prismarine physics and chunk dispatch.

**Native Minecraft Java Edition 26.3 is implemented experimentally, not claimed
as stable.** The vendored data resolves protocol 777 and data version 5023.
The project also loads the required physics and chunk implementations for
26.3. A real login, configuration, chunk, movement, and long-running session
against an authorized 26.3 server is still required before calling the stack
fully verified.

The compatibility report is in
[`protocol-compatibility-report.md`](protocol-compatibility-report.md). It
records the dependency audit, upstream evidence, baseline tests, and the exact
requirements for a future native 26.3 verification. A ViaVersion or ViaProxy
connection may provide proxy-translated compatibility, but that is not native
26.3 support and must be tested separately.

---

## Requirements

- A GitHub account
- Node.js 18 or newer for the published dependency set
- A Minecraft server (see compatibility section below)
- A hosting account for the bot (see deployment options below)

---

## Minecraft Server Compatibility

Not all servers are the same. Here is an honest breakdown of how well the bot
will survive long-term on each type.

### Aternos (Free)

Survival rating: Low

Aternos shuts the whole server down after a period with no real player activity.
This happens at the platform level and your bot cannot stop it no matter how
good the code is. The bot handles the vanilla idle-kick fine, but Aternos's own
shutdown system will eventually end the session.

What you can do: set player-idle-timeout=0 in server.properties to stop the
vanilla kick. Beyond that, someone needs to actually log in periodically to
reset Aternos's timer. This bot is better used to keep the server alive while
real players are online and have just stepped away briefly.

### Minehut (Free)

Survival rating: Medium

Minehut is less aggressive than Aternos about shutting servers down. The bot
will last longer here, but Minehut still has its own activity detection and
will eventually hibernate your server. Same advice applies: set
player-idle-timeout=0 and expect occasional shutdowns.

### Ploudos (Free)

Survival rating: Medium

Similar to Minehut. Less restrictive than Aternos. The bot performs better here
but you are still subject to the host's inactivity rules.

### Your own VPS or Oracle Cloud Free Tier (Recommended)

Survival rating: Very High

If you run your own Paper/Spigot server on a VPS, there is no third party
shutting you down. Set player-idle-timeout=0 and the bot stays in the server
permanently as long as the bot host is running. Oracle Cloud gives you a free
ARM VM with 4 cores and 24GB RAM forever with no credit card tricks. This is
the setup that actually achieves near-permanent uptime.

### Bisect Hosting / Apex / Shockbyte (Paid shared hosting)

Survival rating: High

These hosts do not have aggressive inactivity shutdowns. The bot will stay
connected as long as the Minecraft server is running. Combined with a reliable
bot host and UptimeRobot, uptime is consistently high. Costs around $3-8/month
depending on the host.

### Hypixel, public servers, large networks

Survival rating: Very Low

Large servers have anti-bot systems. They will detect movement patterns that
are too regular, flag accounts with no purchase history, and ban the bot
quickly. This bot is designed for private SMPs and small servers, not public
networks.

---

## Setup

### Step 1 - Configure your Minecraft server

1. Install Paper or Bukkit on your server.
2. Enable offline/cracked mode so the bot can join without a paid account.
3. For native 26.3 testing, do not use ViaVersion or ViaProxy between the bot
   and the authorized 26.3 server. The bot now negotiates protocol 777 directly.
4. In server.properties, set player-idle-timeout=0.
   This stops Minecraft from kicking the bot for being idle.

---

### Step 2 - Configure the bot

Copy `settings.example.json` to `settings.json`, keep `settings.json` private,
and fill in the required fields. The runtime intentionally reads
`settings.json`, which is ignored by Git.

```json
"bot-account": {
  "username": "YourBotUsername"
}

"server": {
  "ip": "your.server.ip",
  "port": 25565,
  "version": "26.3",
  "proxy-version-fallback": "26.1"
}

"utils": {
  "auto-auth": {
    "enabled": true,
    "password": "YourAuthPassword"
  }
},
"ai": {
  "enabled": true,
  "model": "gpt-4o-mini",
  "apiUrl": "https://api.openai.com/v1/chat/completions"
}
```

For AI mode, set these as environment variables on the bot host. Do not put
provider or dashboard secrets in `settings.json` or commit them:

| Variable | What it does |
|----------|--------------|
| `AI_API_KEY` | API key for your model provider |
| `AI_MODEL` | Optional model name; overrides `ai.model` |
| `AI_API_URL` | Optional OpenAI-compatible chat-completions endpoint; overrides `ai.apiUrl` |
| `DASHBOARD_TOKEN` | Required private token for submitting and stopping tasks from the dashboard |

The configured provider must support OpenAI-compatible chat completions with
tool/function calling. The bot uses the model to plan bounded actions, inspect
inventory, gather blocks, craft items, and navigate nearby. AI mode does not
run random movement, combat, or unsolicited chat modules. It is opt-in; with
`ai.enabled` set to `false`, the existing AFK behavior remains in use.
When AFK movement is enabled, the patrol uses pathfinding to visit fixed
waypoints and returns to its starting position at the end of each lap. It does
not dig blocks to clear a route. Server-side AFK policies or shutdowns can
still disconnect the bot.

Add your Minecraft username to the tp whitelist so only you can move the bot:

```json
"chat": {
  "tpWhitelist": ["YourMinecraftUsername"]
}
```

Upload all the files to a new GitHub repository when done.

---

## Run on Termux, Windows, macOS, or proot

The bot runs on Node.js and uses the same `npm start` command on each platform.
Node.js 18 or newer is required; use a current Node.js LTS release when possible.
Run the commands from the repository folder. Keep `settings.json` private.

### Termux (Android)

In the Termux app (install Termux from F-Droid or its official GitHub releases):

```sh
pkg update
pkg install nodejs-lts git
git clone https://github.com/itsdazzyprince3-sudo/Aternos24-7-HostingBot.git
cd Aternos24-7-HostingBot
cp settings.example.json settings.json
nano settings.json
npm install
npm start
```

Keep Termux open while the bot runs. Android may stop background apps to save
battery; allow Termux to run unrestricted in Android battery settings. A bot
running on your phone also needs an active internet connection.

### Linux inside Termux proot-distro

You can run it directly in Termux as above; proot is optional. If you prefer a
Linux distribution, install and enter one from Termux:

```sh
pkg update
pkg install proot-distro
proot-distro install ubuntu
proot-distro login ubuntu
```

Then, inside the Linux shell, install Git and Node.js 18 or newer using that
distribution's current package instructions. Confirm `node --version` is at
least 18 before installing the bot:

```sh
apt update
apt install -y git nodejs npm
git clone https://github.com/itsdazzyprince3-sudo/Aternos24-7-HostingBot.git
cd Aternos24-7-HostingBot
cp settings.example.json settings.json
nano settings.json
npm install
npm start
```

If the distribution's `nodejs` package is older than version 18, install a
supported Node.js LTS version before running `npm install`. Proot does not keep
processes running after the Termux/proot session or Android itself is stopped.

### Windows PowerShell

Install Node.js LTS, open PowerShell in the repository folder, and run:

```powershell
Copy-Item settings.example.json settings.json
notepad settings.json
npm.cmd install
npm.cmd start
```

PowerShell may block the `npm.ps1` wrapper due to the system execution policy.
Using `npm.cmd` avoids changing that policy. You can also use `node index.js`
after installing dependencies.

To start the bot in a separate PowerShell window and open its dashboard
automatically, run this from the repository folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-bot-new-window.ps1
```

For diagnosing protocol disconnects, add `-ProtocolDebug`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-bot-new-window.ps1 -ProtocolDebug
```

The new bot window then includes `frameHex` for failed packets up to 512 bytes.
The browser opens the dashboard, where the AI instruction box is available
when `ai.enabled` is `true`. Set `AI_API_KEY` and `DASHBOARD_TOKEN` in the
PowerShell session before running the launcher if AI task control is needed.

### Windows Command Prompt

Install Node.js LTS, open Command Prompt in the repository folder, and run:

```bat
copy settings.example.json settings.json
notepad settings.json
npm install
npm start
```

### macOS Terminal

Install Node.js LTS (for example, with Homebrew), then run:

```sh
brew install node
cp settings.example.json settings.json
open -e settings.json
npm install
npm start
```

On any of these systems, stop the bot with `Ctrl+C`. To run the automated tests,
use `npm test` (or `npm.cmd test` in PowerShell).

---

## Deployment Options

Pick one platform to host the bot. All of them run Node.js and work with this bot.
The build command is always `npm install` and the start command is always `npm start`.

---

### Railway (Recommended - Free tier, no sleep)

Best for: people who want the easiest setup and reliable free hosting.

Railway gives you $5 of credit per month on the free tier, which is enough to
run this bot 24/7. It does not sleep the way Render does.

1. Go to railway.app and sign in with GitHub.
2. Click New Project, then Deploy from GitHub Repo.
3. Select your repository.
4. Railway detects Node.js and deploys automatically.
5. Go to Variables and add your environment variables (see below).
6. The bot starts within a minute.

Environment variable to add:
- RAILWAY_STATIC_URL is set automatically by Railway, which activates the self-ping system.

---

### Render (Free tier, but sleeps after 15 minutes)

Best for: people already using Render, or who pair it with UptimeRobot.

Render's free tier sleeps services that have no inbound traffic for 15 minutes.
The self-ping system in this bot helps, but Render changed their free tier in
2024 and self-pinging is no longer fully reliable. You must use UptimeRobot
alongside Render to keep it awake.

1. Go to render.com and create an account.
2. Click New, then Web Service.
3. Connect your GitHub repository.
4. Set Build Command to: npm install
5. Set Start Command to: npm start
6. Deploy.
7. Copy the URL Render gives you.
8. Go to uptimerobot.com, create a free monitor pointing to your Render URL + /ping.
9. Set interval to 5 minutes.

Environment variable to add in Render's dashboard:
- RENDER_EXTERNAL_URL: your full Render URL, example https://your-bot.onrender.com

Without that variable the self-ping will not activate.

---

### Oracle Cloud Free Tier (Best long-term option - Truly free forever)

Best for: people who want maximum uptime and full control at zero cost.

Oracle gives you a free ARM VM (4 cores, 24GB RAM) that never expires and
has no inactivity shutdowns. You run both the Minecraft server and the bot
on the same machine if you want. This is the most powerful free option available.

Setup takes about 30 minutes but you never have to touch it again.

1. Go to cloud.oracle.com and create a free account. You need a credit card
   to verify identity but you will not be charged.
2. Go to Compute, then Instances, then Create Instance.
3. Change the shape to Ampere (ARM), which is part of the always-free tier.
4. Download the SSH key it gives you.
5. Once the VM is running, SSH into it:
   ssh -i your-key.key ubuntu@YOUR_VM_IP
6. Install Node.js:
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
7. Clone your GitHub repo:
   git clone https://github.com/YourUsername/YourRepo.git
   cd YourRepo
   npm install
8. Install pm2 to keep the bot running after you close SSH:
   sudo npm install -g pm2
   pm2 start index.js --name afkbot
   pm2 save
   pm2 startup
9. The bot now runs permanently and restarts automatically if it crashes.

To check status: pm2 status
To see logs: pm2 logs afkbot
To restart: pm2 restart afkbot

---

### AWS EC2 Free Tier (12 months free, then costs money)

Best for: people already familiar with AWS or who need AWS specifically.

AWS gives you a t2.micro or t3.micro instance free for 12 months.
After 12 months it costs around $8-10/month. If you want free forever,
use Oracle Cloud instead.

1. Go to aws.amazon.com and create an account.
2. Go to EC2 and click Launch Instance.
3. Choose Ubuntu 22.04 as the OS.
4. Choose t2.micro (free tier eligible).
5. Create or select a key pair and download it.
6. In Security Groups, allow inbound traffic on port 5000 (or whatever PORT you set).
7. Launch the instance.
8. SSH into it:
   ssh -i your-key.pem ubuntu@YOUR_EC2_IP
9. Install Node.js and follow the same steps as Oracle Cloud above (steps 6-9).

Note: set a billing alert in AWS so you know if you accidentally go over the free tier.

---

### Fly.io (Free tier available)

Best for: people comfortable with a CLI-based workflow.

Fly.io has a generous free tier and does not sleep like Render.

1. Install the Fly CLI: https://fly.io/docs/getting-started/installing-flyctl/
2. Run: fly auth signup
3. In your project folder run: fly launch
4. Follow the prompts. Choose the free plan.
5. Deploy with: fly deploy
6. Set environment variables with: fly secrets set BOT_USERNAME=YourName

---

## Keep It Alive with UptimeRobot (Recommended for Render and Railway)

UptimeRobot pings your bot's /ping endpoint every 5 minutes for free.
This guarantees your bot host never sleeps.

1. Go to uptimerobot.com and create a free account.
2. Click Add New Monitor.
3. Set type to HTTP(s).
4. Set the URL to your deployment URL + /ping.
   Example: https://your-bot.railway.app/ping
5. Set interval to 5 minutes.
6. Save.

---

## Environment Variables

Set these in your hosting platform's dashboard instead of putting credentials in settings.json.
This keeps your passwords off GitHub.

| Variable          | What it does                              |
|-------------------|-------------------------------------------|
| BOT_USERNAME      | The bot's Minecraft username              |
| BOT_PASSWORD      | The bot's Minecraft password (if needed)  |
| BOT_AUTH_PASSWORD | The password for /login on the server     |
| AI_API_KEY        | Model provider API key (AI mode)           |
| AI_MODEL          | Optional model name override               |
| AI_API_URL        | Optional OpenAI-compatible API URL         |
| DASHBOARD_TOKEN   | Required to control bot tasks from dashboard |
| PORT              | The port for the web dashboard (optional) |

---

## Dashboard

Once the bot is running, visit your deployment URL to see the status dashboard.
It shows whether the bot is connected, its uptime, coordinates, and server IP.

Visit /tutorial on the same URL for a quick setup reminder.
Visit /health for a raw JSON status response.
Visit /ping to confirm the service is running.
When AI mode is enabled, use the instruction box on the dashboard to give the
bot a goal. The dashboard control token is required because the dashboard may
be internet-accessible. Tasks are limited to 30 model actions, and a task can
be stopped from the same page.

If the bot is disconnected, /health and the dashboard show the most recent
server kick or disconnect reason. Reconnect backoff now persists across short
connections; the bot cannot prevent server-host shutdowns, authentication
failures, unsupported protocol versions, bans, or server anti-bot policies.

### Troubleshooting protocol parse errors

If the log contains `Parse error for play.toClient` with a packet ID, the client
could not decode a server packet. Check that `server.version` matches the
version advertised by your server first. For example, packet ID 75 is
`recipe_book_add` when using the native 26.3 protocol.

To temporarily include the full hex for small failed packets while testing in
PowerShell:

```powershell
$env:MINECRAFT_PROTOCOL_DEBUG_FRAMES = "1"
npm.cmd start
```

The setting only applies to that PowerShell window; remove it afterward with:

```powershell
$env:MINECRAFT_PROTOCOL_DEBUG_FRAMES = $null
```

The full frame is printed only for failed packets no larger than 512 bytes.
Length-delimited packets that fail only with a partial-read/schema error are
logged and skipped so one malformed packet does not immediately close the
connection. Other malformed protocol errors still close it. Skipping a packet
can affect that feature (for example, packet 75 may contain recipe-book data).
Do not post logs publicly; send the complete parse error and `frameHex`
privately when asking for help, since packet contents can include server data.

---

## Testing

Run the automated checks without a server configuration:

```bash
npm ci
npm test
npm ls --depth=0
```

The tests cover native 26.3 protocol and data compatibility, packet decoding,
and version selection. To start the bot and connect to a server, separately copy
`settings.example.json` to a private `settings.json` and configure an authorized
test server. Do not use a public server or bypass authentication and hosting
restrictions.

---

## settings.json Reference

| Key | What it does |
|-----|-------------|
| bot-account.username | The bot's Minecraft username |
| bot-account.type | Set to "offline" for cracked servers |
| server.ip | Your server's IP address |
| server.port | Your server's port (default 25565) |
| server.version | Native server version; use `26.3` for protocol 777 |
| server.proxy-version-fallback | Optional fallback for an unsupported target version |
| utils.auto-auth.enabled | Turn on if the server uses AuthMe or similar |
| utils.chat-messages.repeat-delay | Seconds between periodic chat messages |
| movement.circle-walk.enabled | Repeats a patrol around the position where the bot spawned |
| movement.circle-walk.radius | Maximum patrol distance from the spawn position, in blocks |
| movement.circle-walk.speed | Pause in milliseconds between patrol waypoints |
| modules.combat | Bot attacks nearby mobs |
| modules.avoidMobs | Bot runs from mobs (turn off if combat is on) |
| ai.enabled | Enable instruction-driven AI mode instead of AFK modules |
| ai.model | Model name for the configured OpenAI-compatible API |
| ai.apiUrl | Chat-completions API URL; can be overridden with AI_API_URL |
| discord.enabled | Send connect/disconnect events to Discord |
| discord.webhookUrl | Your Discord webhook URL |
| chat.tpWhitelist | Usernames allowed to use the !tp command |

---

## Discord Notifications (Optional)

1. In Discord, go to your server settings, then Integrations, then Webhooks.
2. Create a webhook and copy the URL.
3. In settings.json set discord.enabled to true and paste the URL.
4. Choose which events to send under discord.events.

---

## Notes

- The bot username must not be the same as any real player on the server.
- On Aternos and similar free hosts, the server itself may shut down regardless
  of what the bot does. player-idle-timeout=0 only prevents the vanilla idle kick.
- This project is not affiliated with Aternos, Mojang, or Microsoft.
  Use it responsibly and make sure it complies with your server's rules.

---

## Credits

- Slobos (Discord: sloboscc) - Original idea and creator
- MrJuice (Discord: MrJuice3046) - Rewrites, fixes, and maintenance

License: MIT
