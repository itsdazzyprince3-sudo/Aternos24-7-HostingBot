# First-person viewer (C++ software raycaster)

A protocol bot has no renderer, so this builds a first-person view from the
world data the bot already receives, and streams it live. It is also the bot's
eyes: every frame it reports a compact perception summary (FREE space, obstacle
distance, visible entities) back to Node, and the reflex layer plays from it.

No GPU, no OpenGL, no image libraries except the vendored single-header
`stb_image_write.h` (public domain, JPEG encoder).

## Build

```sh
g++ -O2 -std=c++17 -pthread cpp/bot_view.cpp -o cpp/bot_view
```

Android/Termux works; ARM64 Cortex-A55 at 320x180 measures ~150 fps with 8
render threads (`--bench 3`).

## Run

Normally you do not start it by hand: with `view.enabled: true` in
`settings.json` (or `BOT_VIEW=1`) the Node bot spawns it and restarts it if it
dies. To run it standalone:

```sh
./cpp/bot_view --frame-port 31337 --http-port 8080 --w 320 --h 180 --fps 60
./cpp/bot_view --mock --http-port 8080        # synthetic world, no bot needed
./cpp/bot_view --bench 5 --threads 8          # headless fps benchmark
./cpp/bot_view --selftest                     # protocol + render smoke test
```

Open `http://<host>:8080/` for the live view (MJPEG). Endpoints:

- `/stream`     multipart MJPEG, live
- `/frame`      single JPEG
- `/frame.bmp`  24-bit BMP (the Node LLM layer reads this)
- `/state`      fps, eye pose, perception summary

## Protocol (v2)

TCP, every message is `tag(4 ascii) + u32le length + payload`.

Node -> viewer:

- `VWLD` `i32 ox,oy,oz; u16 W,H,D; u8 grid[W*H*D]` — full world snapshot,
  index `x + W*(z + D*y)`. Sent on connect, on origin drift, on resync.
- `VBLK` `u16 count; {i16 rx,ry,rz; u8 kind}` — block deltas relative to origin.
- `VFRM` `f32 eyeX,eyeY,eyeZ; f32 yaw,pitch; u16 entCount;
  {f32 rx,ry,rz; u8 kind; u8 nameLen; name}` — pose + entities each tick.

Viewer -> Node:

- `PERC` 28-byte perception summary: sequence, render fps, flags, free-space
  percentages (center/left/right, lower-band ground coverage, upper-band sky),
  forward clearance, nearest obstacle, nearest visible entity (screen position,
  kind, distance). Sent at 10 Hz.

Block kinds: 0 air, 1 stone, 2 dirt, 3 grass, 4 wood, 5 leaves, 6 sand,
7 water, 8 ore, 9 lava, 10 snow/ice, 11 glass, 12 plant, 13 netherrack,
14 bedrock/obsidian, 15 generic. Entities: 1 mob (red), 2 player (green),
3 other (yellow).

## Notes

- Pose is smoothed between packets (20 Hz input, 60+ fps render), so the view
  stays fluid without sending full frames from Node.
- The render loop is capped by `--fps`; the MJPEG stream by `--stream-fps`.
- Render resolution is independent of the voxel grid: lower `--w/--h` for more
  fps on weak CPUs.
