# Session format

A **Ghost Driver session** is the single file the player opens. It embeds the
telemetry and lists the video cameras that can be shown against it.

Status: experimental, version 1. The format may change while the player and
editor are being built.

---

## 1. Shape

```json
{
  "format": "ghost-driver-session",
  "version": 1,
  "meta": {
    "title": "Monza lap",
    "game": "Assetto Corsa",
    "car": "McLaren MP4-12C GT3",
    "track": "Monza"
  },
  "telemetry": {
    "format": "ghost-driver-telemetry",
    "version": 1,
    "meta": {},
    "samples": []
  },
  "videos": [
    {
      "id": "cockpit",
      "label": "Cockpit",
      "source": { "type": "youtube", "videoId": "M7lc1UVf-VE" },
      "offsetMs": -120
    },
    {
      "id": "chase",
      "label": "Chase",
      "source": { "type": "url", "url": "https://example.com/chase.mp4" },
      "offsetMs": -80
    }
  ],
  "defaultVideoId": "cockpit",
  "ffbLeadMs": 0
}
```

`telemetry` is a complete [canonical telemetry document](./telemetry-format.md),
embedded so the player only has to open one file. A later ZIP package can move
the telemetry and local videos into separate files without changing the
player-facing model.

---

## 2. Video sources

| Type | Fields | Notes |
| --- | --- | --- |
| `youtube` | `videoId` | 11-character YouTube id. Timing is best-effort. |
| `url` | `url` | Direct MP4/WebM URL. |
| `local` | `name` | Preview-only for now. Local files are not portable in a JSON session and will be included in the ZIP format later. |

The editor can preview local files, but they are excluded when exporting a
session. The session panel warns when this happens.

---

## 3. Offsets

Each camera has its own `offsetMs`:

```text
telemetryTime = videoTime + offsetMs / 1000
videoTime     = telemetryTime - offsetMs / 1000
```

- Use the offset to align the video with the telemetry.
- `ffbLeadMs` is global look-ahead for wheel latency.
- Switching cameras calculates the new video time from the current telemetry
  time, so playback position is preserved.

Camera switching is intended to be seamless: force stops briefly while the new
clock loads, then resumes if the wheel was armed and the video was playing.
The player does not require a re-arm for a camera switch.

---

## 4. Player and editor

- **Player** (`play.html`) opens a session, selects a camera and plays. It does
  not expose video or telemetry import controls.
- **Editor** (`edit.html`) loads canonical telemetry, adds YouTube/direct/local
  camera previews, edits per-camera offsets, and exports a session.
- Legacy `ghost-driver-telemetry` files are still accepted and play as
  telemetry-only sessions with no cameras.

---

## 5. Limits

- `offsetMs` is clamped to -2000..2000.
- `ffbLeadMs` is clamped to -200..400.
- Videos must have unique ids and valid sources.
- `defaultVideoId` falls back to the first camera when missing.
- Local camera files are not included in an exported JSON session yet.

---

## 6. Exporting

In the editor, **Export session** writes a `.ghost.json` file containing:

- the session metadata
- the current canonical telemetry (embedded)
- all YouTube/direct-URL cameras and their offsets
- the global FFB lead

The player accepts that file directly. The ZIP format will add local video files
and a separate telemetry reference later.
