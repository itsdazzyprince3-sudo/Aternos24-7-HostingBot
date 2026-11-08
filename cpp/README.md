# First-person viewer (C++ software raycaster)

A protocol bot has no renderer, so this builds a first-person view from the
world data the bot already holds (`bot.blockAt`, entity positions, eye state)
and serves it live in your browser. No GPU, no image libraries - pure C++ DDA
raycasting output as BMP.

## Build
```
cd cpp
g++ -O2 -std=c++17 -pthread bot_view.cpp -o bot_view
```

## Run with the real bot
1. Start the bot with the viewer bridge enabled:
   ```
   BOT_VIEW=1 npm start
   ```
   (or add `"view": { "enabled": true }` to settings.json)
2. In another terminal on the same machine, run the viewer (HTTP binds to
   `127.0.0.1` by default):
   ```
   ./cpp/bot_view --frame-port 31337 --http-port 8080 --w 480 --h 270
   ```
3. Open `http://127.0.0.1:8080/` for the local reconstructed view, or enter
   `DASHBOARD_TOKEN` in the bot dashboard to view it through the authenticated
   `/api/view/*` proxy.

## Run without the bot (test mode)
```
./cpp/bot_view --mock --http-port 8080
```
Renders a built-in synthetic world so you can confirm the viewer works.

## What it shows
- Voxel blocks the bot has loaded, colored and face-shaded, with approximate
  shading from server-provided block/sky light values and distance fog.
- Nearby entities (mobs = red, players = green, other = yellow) as billboards.
- Live software-renderer FPS / eye coordinates / yaw / pitch / grid readout at
  `/state` (JSON), plus F3-style data in the authenticated dashboard.

## Options
| flag | default | meaning |
|---|---|---|
| `--mock` | off | use built-in world instead of the bot |
| `--frame-host` | 127.0.0.1 | Node frame-server host |
| `--frame-port` | 31337 | Node frame-server port |
| `--http-port` | 8080 | HTTP viewer port |
| `--http-host` | 127.0.0.1 | HTTP bind IPv4 address; public binding is unauthenticated and discouraged |
| `--w` / `--h` | 480 / 270 | render resolution |

Env overrides for the bot side: `VIEW_FRAME_PORT`, `VIEW_W`, `VIEW_H`,
`VIEW_D`, `VIEW_FPS`.

## Honest limits
- This is reconstructed from world data, not a real game screenshot: no Minecraft
  textures, entity 3D models (entities are colored billboards), particles,
  animations, full sky/weather, GUI, or client-side gamma.
- The reported FPS is the software renderer's rate, not a Minecraft Java client
  FPS. Lighting uses the data Mineflayer has for loaded blocks and is approximate.
- Only blocks in the bot's loaded area are visible (region default 64x48x64).
- yaw/pitch convention may need a sign flip if the view is mirrored for your
  protocol build (set `VIEW_YAW_SIGN` or `VIEW_PITCH_SIGN`).
- Heavy CPU: ~480x270 software raycasting at ~9-12 fps. That's the tradeoff.
