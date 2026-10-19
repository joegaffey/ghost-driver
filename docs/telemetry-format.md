# Telemetry format

Ghost Driver v1 imports two telemetry formats:

1. **Canonical JSON** — the native, fully specified format.
2. **CSV** — any delimiter-separated export, mapped by the user in the import UI.

Everything is compiled into a common in-memory track before playback. Future importers (iRacing IBT, VBOX, MoTeC `.ld`, AIM) must produce the same internal representation.

---

## 1. Canonical JSON

### 1.1 Top-level shape

```json
{
  "format": "ghost-driver-telemetry",
  "version": 1,
  "meta": {
    "source": "generic",
    "car": "Porsche 992 GT3 R",
    "track": "Spa-Francorchamps",
    "recordedAt": "2026-10-19T12:00:00Z",
    "steeringUnits": "deg",
    "steeringRangeDeg": 900,
    "sampleRateHz": 60,
    "duration": 123.4,
    "notes": "Optional free text"
  },
  "samples": [
    {
      "t": 0.0,
      "steer": 0.0,
      "throttle": 0.0,
      "brake": 0.0,
      "speed": 0.0,
      "gear": 1,
      "rpm": 0
    },
    {
      "t": 0.0167,
      "steer": 1.2,
      "throttle": 0.1,
      "brake": 0.0,
      "speed": 1.4,
      "gear": 1,
      "rpm": 1200
    }
  ]
}
```

### 1.2 Required fields

| Field | Type | Notes |
| --- | --- | --- |
| `format` | string | Must be `ghost-driver-telemetry`. |
| `version` | number | Must be `1` for this version. |
| `meta` | object | See below. |
| `samples` | array | At least two samples. |
| `samples[].t` | number | Seconds from the start of the telemetry. |
| `samples[].steer` | number | Steering-wheel angle in degrees. |

`steer` is required for Ghost Wheel and Co-Driver. It may be omitted for Force-Feel/Visual-only files, but the importer must warn and disable tracking modes.

### 1.3 Metadata

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `source` | string | `generic` | e.g. `iracing`, `acc`, `simhub`, `motec-csv`, `vbox`, `generic`. |
| `car` | string | — | Display only. |
| `track` | string | — | Display only. |
| `recordedAt` | string | — | ISO 8601 timestamp. |
| `steeringUnits` | `"deg"` \| `"rad"` \| `"normalized"` | `"deg"` | Units of `samples[].steer`. |
| `steeringRangeDeg` | number | `900` | Used for normalized inputs and range checks. |
| `steeringRatio` | number | `1` | Road-wheel-angle to steering-wheel-angle ratio. |
| `sampleRateHz` | number | inferred | Informational; the importer may infer. |
| `duration` | number | inferred | Seconds; last timestamp if omitted. |
| `notes` | string | — | Free text. |

If `steeringUnits` is not `"deg"`, the importer converts:

```text
rad        -> deg:  steerDeg = steer * 180 / PI
normalized -> deg:  steerDeg = steer * steeringRangeDeg / 2
road-wheel -> deg:  steerDeg = roadWheelDeg * steeringRatio
```

### 1.4 Sample channels

| Channel | Type | Unit | Range | Required |
| --- | --- | --- | --- | --- |
| `t` | number | s | monotonic | yes |
| `steer` | number | deg | ±range | for tracking |
| `steerTorque` | number | Nm | device/telemetry-specific | no |
| `throttle` | number | 0..1 | 0..1 | no |
| `brake` | number | 0..1 | 0..1 | no |
| `speed` | number | km/h | ≥0 | no |
| `gear` | integer | — | -1, 0, 1..n | no |
| `rpm` | number | rpm | ≥0 | no |
| `latAccel` | number | g | — | no |
| `longAccel` | number | g | — | no |
| `vertAccel` | number | g | — | no |
| `wheelSlip` | number | 0..1 | 0..1 | no |
| `absActive` | boolean | — | — | no |
| `tcActive` | boolean | — | — | no |
| `kerb` | boolean | — | — | no |

Unknown channels are allowed and ignored by v1 playback. A future effects engine may consume them.

### 1.5 Ordering and gaps

- Samples must be sorted by `t` ascending.
- The importer may sort unsorted files but must warn.
- Duplicate timestamps are allowed; the last value wins for discrete channels.
- Gaps over 250 ms produce a warning. Gaps over 2 s reject the file.
- During a gap, hold the last value briefly and ramp force toward zero.

### 1.6 Example: synthetic test file

```json
{
  "format": "ghost-driver-telemetry",
  "version": 1,
  "meta": {
    "source": "synthetic",
    "car": "Test",
    "track": "Test",
    "steeringUnits": "deg",
    "steeringRangeDeg": 900,
    "sampleRateHz": 60,
    "duration": 10
  },
  "samples": [
    { "t": 0.0, "steer": 0, "throttle": 0, "brake": 0, "speed": 0, "gear": 1, "rpm": 0 },
    { "t": 1.0, "steer": 45, "throttle": 0.2, "brake": 0, "speed": 40, "gear": 2, "rpm": 3000 },
    { "t": 2.0, "steer": 90, "throttle": 0.4, "brake": 0, "speed": 70, "gear": 3, "rpm": 4500 },
    { "t": 3.0, "steer": 0, "throttle": 0.1, "brake": 0.2, "speed": 60, "gear": 3, "rpm": 4000 },
    { "t": 4.0, "steer": -90, "throttle": 0.3, "brake": 0, "speed": 50, "gear": 2, "rpm": 3500 },
    { "t": 5.0, "steer": 0, "throttle": 0, "brake": 0, "speed": 0, "gear": 1, "rpm": 0 }
  ]
}
```

---

## 2. CSV import

### 2.1 Goal

Accept exports from MoTeC i2, SimHub, ACC/AC tools, rFactor, AIM, and generic loggers without writing a parser for each. The user maps columns once and can save a preset.

### 2.2 Detection

- Suggest delimiter by counting `,`, `;`, and tab in the first few lines.
- Detect header row; allow the user to override.
- Ignore blank lines and comment lines starting with `#`.
- Strip a UTF-8 BOM.
- Support quoted fields containing the delimiter.

### 2.3 Required mapping

| Target | Required | Notes |
| --- | --- | --- |
| Time | yes | Seconds or milliseconds. |
| Steering | for tracking | Degrees, radians, normalized, or road-wheel angle. |
| Throttle | no | 0..1 or 0..100; user selects the scale. |
| Brake | no | 0..1 or 0..100. |
| Speed | no | km/h or m/s. |
| Gear | no | Integer. |
| RPM | no | Numeric. |
| Steering torque | no | Nm. |

### 2.4 Per-channel transforms

- **Unit conversion:** time (ms→s), steering (rad→deg), speed (m/s→km/h), throttle/brake (0..100→0..1).
- **Scale:** multiply by a constant.
- **Offset:** add a constant.
- **Invert:** multiply by -1.
- **Steering range:** for normalized steering.
- **Steering ratio:** for road-wheel-angle steering.

Transforms are applied in a documented order:

```text
raw -> unit conversion -> scale -> offset -> invert -> steering mapping
```

The preview chart must reflect the final transformed steering value.

### 2.5 Header presets

Presets are matched by normalized header names and saved in `localStorage`. Candidate names:

- time: `time`, `t`, `session time`, `timestamp`, `lap time`, `seconds`
- steer: `steer`, `steering`, `steering angle`, `steer angle`, `steeringwheelangle`, `wheel angle`
- throttle: `throttle`, `throttle position`, `throttlepos`, `gas`
- brake: `brake`, `brake position`, `brakepos`, `brake pressure`
- speed: `speed`, `ground speed`, `velocity`, `gps speed`
- gear: `gear`, `gear position`
- rpm: `rpm`, `engine rpm`, `rpms`
- steer torque: `steer torque`, `steering torque`, `steeringwheel torque`

Header matching is only a suggestion; the user confirms.

### 2.6 Example

Raw CSV:

```csv
Time,Steering Angle,Throttle,Brake,Speed,Gear,RPM
0.000,0,0,0,0,1,0
1.000,45,20,0,40,2,3000
2.000,90,40,0,70,3,4500
```

Mapping:

```json
{
  "delimiter": ",",
  "time": { "column": "Time", "unit": "s" },
  "steer": { "column": "Steering Angle", "unit": "deg" },
  "throttle": { "column": "Throttle", "unit": "percent" },
  "brake": { "column": "Brake", "unit": "percent" },
  "speed": { "column": "Speed", "unit": "kmh" },
  "gear": { "column": "Gear" },
  "rpm": { "column": "RPM" }
}
```

---

## 3. Internal track

After import, the app holds:

- `times: Float64Array` (seconds)
- `steer: Float32Array` (degrees, unwrapped)
- optional channel arrays
- `meta` and a validation report

`TelemetryTrack.sample(t)` returns an interpolated state:

- continuous channels: linear interpolation
- discrete channels: previous value
- outside range: clamp with a "stale" flag
- gaps: hold with a "gap" flag and let the safety supervisor reduce force

---

## 4. Future formats

Each future importer should be a separate module with a small interface:

```ts
interface TelemetryImporter {
  id: string;
  detect(file: File, head: Uint8Array): Promise<number>; // 0..1 confidence
  parse(file: File, options: unknown): Promise<ImportedTelemetry>;
}
```

Planned:

- iRacing `.ibt`
- Racelogic `.vbo`
- MoTeC `.ld` (via a converter or WASM parser)
- AIM `.xrk`/`.drk`
- F1 game UDP captures (via a separate recorder)

No format parser should block the UI thread; all parsing runs in a Web Worker.
