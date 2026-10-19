# Ghost Driver — Experimental

> **Experimental prototype.** This project is under active research and development. Formats, controls, APIs, safety behavior and hardware support may change without notice. Do not treat it as production software.

**A pure-browser replay experience for sim racing: watch a lap, replay its telemetry, and let a force-feedback wheel physically follow the drive.**

Ghost Driver is a static web app. You load a video (local file, direct URL or YouTube), load a telemetry file, connect a compatible wheel over WebHID, and the wheel moves with the recorded steering. The wheel behaves like a ghost driver.

> **Status: playback + wheel tracking.** Video (local, direct URL and YouTube), synthetic telemetry, the sync overlay, WebHID wheel connection, manual force tests and armed telemetry tracking work. Gain and safety tuning continue. The product and technical contract live in [SPEC.md](./SPEC.md).

## Modes

| Mode | What it does |
| --- | --- |
| **Ghost Wheel** | Hands-off. The wheel tracks the recorded steering angle. |
| **Co-Driver** | Hands-on. The wheel follows with softer authority so the viewer can hold and override it. |
| **Force-Feel** | Replays forces/vibration without absolute position tracking. |
| **Visual** | No force feedback; video and telemetry overlay only. |

## v1 scope

- **Browser only.** Static site, no backend, no live telemetry bridge.
- **Video:** local file, direct MP4/WebM URL, and YouTube via the IFrame API.
- **Telemetry:** canonical JSON and generic CSV with a column-mapping UI. Native binary formats come later.
- **Wheel:** capability-based, using only our own [`webhid-wheel`](../webhid-wheel) library. Modes are selected from what each device reports (position feedback, force output, direct control). CAMMUS C5 and FFBeast are the first tested devices; other wheels use the same adapter model.
- **Sync:** manual offset, fine nudge, and a separate FFB lead control.
- **Safety:** explicit arming, low default force, watchdogs, and automatic stop on pause, seek, buffer, tab hide, blur, disconnect and media error.

## Safety

A force-feedback wheel can move unexpectedly and forcefully. Ghost Wheel mode is hands-off and must only be used with hands clear of the wheel. Keep a physical power switch or e-stop within reach. Read [docs/safety.md](./docs/safety.md) before running force feedback.

## Documentation

- [SPEC.md](./SPEC.md) — product and technical specification.
- [docs/telemetry-format.md](./docs/telemetry-format.md) — canonical JSON and CSV import contract.
- [docs/safety.md](./docs/safety.md) — hazard analysis and safety requirements.
- [docs/wheel-support.md](./docs/wheel-support.md) — capability model, adapter contract, and notes for the first tested devices.
- [docs/roadmap.md](./docs/roadmap.md) — milestones and sequencing.

## Capture tools

The repo includes SimHub and OBS capture helpers for producing video + telemetry sessions.

Prerequisites:

- OBS Studio with the WebSocket server enabled (Tools → WebSocket Server Settings)
- SimHub running with the game active
- Node 22+ for the OBS WebSocket client

```sh
# Confirm SimHub fields and steering
npm run probe
npm run probe -- --watch --diff

# Telemetry only
npm run record -- --duration 90

# OBS video + telemetry together
npm run capture -- --countdown 3 --duration 90 --obs-scene "ACC"
```

OBS password:

```sh
OBS_PASSWORD=secret npm run capture -- --duration 90
# or
npm run capture -- --obs-password secret --duration 90
```

If OBS records MKV, remux and keep the video beside the telemetry:

```sh
npm run capture -- --remux --copy-video --duration 90
```

Output goes to `captures/obs-<timestamp>/`:

- `telemetry.json` — canonical Ghost Driver telemetry
- `raw.ndjson` — selected channels per poll
- `session.json` — SimHub mapping and timing
- `capture.json` — OBS video path and suggested sync offset

SimHub channel overrides:

```sh
npm run capture --   --map steer=GameData.NewData.Steering   --steering-unit normalized   --steering-range 540
```

For local testing without OBS or SimHub:

```sh
npm run mock:simhub
node tools/mock-obs.mjs --port 4456
```

Then point `--simhub-url` and `--obs-url` at the mock servers. Capture files are gitignored.

## Development

```sh
npm install
npm run dev        # Vite dev server
npm run typecheck  # tsc --noEmit
npm test           # Vitest
npm run build      # static build in dist/
npm run preview    # preview the build
```

Requires Node 20+ and a Chromium-based desktop browser with WebHID for wheel work. The scaffold itself runs in any modern browser.

## Dependencies

The finished app will use only the project author's [`webhid-wheel`](../webhid-wheel) library for HID and force feedback. No third-party HID/FFB runtime dependency is planned.

## Name

- Product: **Ghost Driver**
- Hands-off mode: **Ghost Wheel**
- Hands-on mode: **Co-Driver**
- Feel-only mode: **Force-Feel**
- Tagline: *A ghost driver for your rig.*

## License

TBD.
