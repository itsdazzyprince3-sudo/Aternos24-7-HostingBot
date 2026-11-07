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
2. In another terminal, run the viewer:
   ```
   ./cpp/bot_view --frame-port 31337 --http-port 8080 --w 480 --h 270
   ```
3. Open `http://127.0.0.1:8080/` - you see the bot's first-person view, live.

## Run without the bot (test mode)
```
./cpp/bot_view --mock --http-port 8080
```
Renders a built-in synthetic world so you can confirm the viewer works.

## What it shows
- Voxel blocks the bot has loaded, colored and face-shaded (top/side/bottom
  brightness like Minecraft), with distance fog.
- Nearby entities (mobs = red, players = green, other = yellow) as billboards.
- Live FPS / eye / yaw / grid readout at `/state`.

## Options
| flag | default | meaning |
|---|---|---|
| `--mock` | off | use built-in world instead of the bot |
| `--frame-host` | 127.0.0.1 | Node frame-server host |
| `--frame-port` | 31337 | Node frame-server port |
| `--http-port` | 8080 | HTTP viewer port |
| `--w` / `--h` | 480 / 270 | render resolution |

Env overrides for the bot side: `VIEW_FRAME_PORT`, `VIEW_W`, `VIEW_H`,
`VIEW_D`, `VIEW_FPS`.

## Honest limits
- This is reconstructed from world data, not a real game render: no entity 3D
  models (entities are colored billboards), no particles/animations, no skybox.
- Only blocks in the bot's loaded area are visible (region default 64x48x64).
- yaw/pitch convention may need a sign flip if the view is mirrored for your
  protocol build (flip the `fwd` vector in `renderFrame()`).
- Heavy CPU: ~480x270 software raycasting at ~9-12 fps. That's the tradeoff.
