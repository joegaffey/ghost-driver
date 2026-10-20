# Ghost Driver — Product and Technical Specification

**Status:** Draft 0.1 — experimental specification / scaffold  
**Product name:** Ghost Driver  
**Tagline:** *A ghost driver for your rig.*  
**Platform:** Desktop Chromium, static web app, WebHID  
**First tested wheels:** CAMMUS C5, FFBeast

---

## 1. Summary

Ghost Driver synchronizes racing or driving video with a telemetry file and drives a force-feedback steering wheel to follow the recorded steering angle. The viewer watches the lap or run while the wheel moves as if an invisible driver is holding it. Sources can be simulator laps, real onboards, track days, karting, rally, or any driving footage with matching telemetry.

The app is pure browser: video and telemetry come from files or URLs, and wheel control goes through WebHID. There is no backend, no game integration, and no live telemetry capture in v1.

Wheel support is capability-based, not tied to a model. The app uses the project author's own `webhid-wheel` library to detect position feedback, force output and device-specific control paths, then enables the modes those capabilities can support. CAMMUS C5 and FFBeast are the first two tested devices; any future wheel plugs into the same adapter and capability model.

---

## 2. Motivation

Onboard lap videos are passive. Telemetry overlays add information, but the viewer still cannot feel the car. A force-feedback wheel can close that gap: steering movement, self-aligning feel, kerbs and corrections are communicated physically.

Existing approaches usually require a running simulator, a game-specific plugin, or a native driver. Ghost Driver instead treats a recorded lap as a replayable artifact:

- video = what happened
- telemetry = the physical timeline
- wheel = the output device

---

## 3. Goals

1. Play a video and a telemetry timeline in sync.
2. Make a compatible FFB wheel physically follow recorded steering.
3. Provide a hands-on assist mode and a feel-only mode.
4. Import telemetry from common exports without a server.
5. Work as a static site, including GitHub Pages.
6. Use only the project's own `webhid-wheel` library for HID/FFB.
7. Be safe by default: explicit arming, low force, watchdogs, and automatic stop.
8. Make sync correction fast and obvious for YouTube videos.
9. Keep the wheel/telemetry layers extensible for more formats and wheels.

## 4. Non-goals for v1

- Live telemetry capture or a local telemetry bridge.
- Recording video or producing telemetry.
- Automatic video/telemetry alignment using computer vision.
- Native iRacing IBT, VBOX, MoTeC `.ld`, AIM, or F1 UDP parsing. These are follow-ups.
- Supporting every wheel's force feedback on day one.
- Mobile, Firefox, or Safari.
- Online accounts, cloud storage, or telemetry upload.
- Game-specific integrations or driver installation.

---

## 5. Naming and terminology

| Term | Meaning |
| --- | --- |
| **Ghost Driver** | The product. |
| **Ghost Wheel** | Hands-off mode. The wheel tracks the recorded steering angle. |
| **Co-Driver** | Hands-on mode. Softer tracking so the viewer can hold and override the wheel. |
| **Force-Feel** | Forces/vibration only; no absolute position tracking. |
| **Visual** | No force feedback. Video and telemetry overlay only. |
| **Target** | The steering angle demanded by telemetry at the current media time. |
| **Actual** | The wheel position reported by the device. |
| **Offset** | Manual time shift applied to telemetry relative to video. |
| **Lead** | Extra look-ahead applied to the target to compensate output/mechanical latency. |

Offset sign:

```text
telemetryTime = mediaTime + offset
targetLookupTime = telemetryTime + lead
```

Positive offset shifts telemetry later relative to the video. Positive lead looks further ahead in telemetry.

---

## 6. User experience

### 6.1 Setup flow

1. **Load video**
   - Choose a local video file, paste a direct MP4/WebM URL, or paste a YouTube URL.
2. **Load telemetry**
   - Choose a canonical JSON file or a CSV.
   - For CSV, map columns and units, preview the steering trace, and confirm.
   - The app validates required channels and reports warnings before enabling playback.
3. **Connect wheel**
   - Click Connect and pick the device in the browser's WebHID picker.
   - The app reads capabilities and shows what the wheel supports.
4. **Calibrate**
   - Center the wheel and confirm.
   - Verify direction: steering right must produce a positive target.
   - Confirm motion range and telemetry steering mapping.
5. **Choose mode and strength**
   - Ghost Wheel, Co-Driver, Force-Feel, or Visual.
   - Default strength is deliberately low.
6. **Arm**
   - Press and hold Arm for about one second. The UI must show a clear armed state.

### 6.2 Playback flow

- Press Play. The wheel follows if armed and the mode uses FFB.
- The overlay shows target vs actual steering, speed, throttle, brake, gear, sync offset, loop rate, and tracking error.
- Pause, seek, buffer, hide the tab, blur the window, or unplug the wheel: force ramps to zero and the app disarms.
- A large Stop button and `Esc` always stop FFB immediately.
- Seeking in Ghost Wheel requires re-arming.

### 6.3 Sync workflow

YouTube timing is best-effort, so manual sync is a first-class feature.

1. Pause at a recognizable corner or steering input.
2. A ghost steering indicator shows the telemetry target for the current video frame.
3. Nudge the offset with `[`/`]` or arrow keys. Fine step is 10 ms; coarse step is 100 ms.
4. Adjust FFB lead separately if the wheel feels late but the overlay matches.
5. Save the offset/lead for this video. Use the YouTube video ID or a local file fingerprint as the key.

### 6.4 Persistence

Store in `localStorage`:

- per-video offset and lead
- mode and strength
- calibration and steering mapping
- UI preferences
- last selected video/telemetry identifiers (not file contents)

No telemetry or video is uploaded.

### 6.5 Error states

The UI must explain and recover gracefully from:

- WebHID unsupported or insecure context
- no wheel selected
- wheel without FFB
- wheel connected but no position reports
- YouTube video unavailable/embedding disabled
- YouTube ad or buffering
- telemetry missing steering
- telemetry timestamps out of order or full of gaps
- CSV mapping invalid
- wheel disconnected mid-playback
- control loop missing its deadline

---

## 7. Platform and constraints

- **Browsers:** Chromium desktop only for WebHID (Chrome, Edge, Opera, Brave).
- **Context:** HTTPS or `localhost`.
- **Hosting:** static files; no server-side code.
- **Build:** Vite + TypeScript, no UI framework.
- **Tests:** Vitest for units; Playwright for browser flows where practical.
- **HID/FFB dependency:** only the project's own `webhid-wheel` library.
- **Video:** YouTube IFrame API, HTML5 `<video>` for local/direct files.
- **Telemetry:** File API and Web Workers; no network fetch required for local files.
- **Deployment:** `dist/` suitable for GitHub Pages or any static host.

### 7.1 Browser limitations to state in the UI

- WebHID is unavailable in Firefox, Safari, and on mobile.
- YouTube sync is not frame-accurate.
- Some videos disallow embedding.
- Chrome may throttle timers in hidden tabs; FFB stops when hidden.
- Other software (sim, wheel driver) may also send FFB; do not run both.

---

## 8. Video and synchronization

### 8.1 MediaClock abstraction

All video sources implement a common clock:

```ts
interface MediaClock {
  readonly kind: 'html' | 'youtube';
  time(): number;          // seconds
  duration(): number;      // seconds, NaN/Infinity while unknown
  playing(): boolean;
  rate(): number;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): Promise<void>;
  on(event: MediaEvent, fn: () => void): () => void;
}

type MediaEvent =
  | 'play' | 'pause' | 'seeking' | 'seeked'
  | 'waiting' | 'playing' | 'ended'
  | 'ratechange' | 'error' | 'durationchange';
```

### 8.2 HTML5 video

- Use `video.currentTime` as the source of truth.
- Use `requestVideoFrameCallback` when available to observe presentation timestamps; fall back to `requestAnimationFrame`.
- Local file URLs use `URL.createObjectURL` and must be revoked on unload.
- Direct URLs use the native `<video>` element. HLS is not in v1; add `hls.js` only if needed.

### 8.3 YouTube

- Use the official IFrame Player API.
- Poll `getCurrentTime()` at a modest rate and extrapolate with `performance.now()` between polls.
- Resynchronize on play, pause, seek, buffering and rate changes.
- Never download or proxy YouTube media.
- Treat ads and buffering as hazardous: stop FFB until content time is advancing normally again.
- Detect ad/abnormal state best-effort via duration changes, time jumps and player state transitions.

### 8.4 Sync algorithm

For each control tick:

```text
mediaTime      = mediaClock.time()
telemetryTime  = mediaTime + offsetSeconds
lookupTime     = telemetryTime + leadSeconds
target         = telemetryTrack.sample(lookupTime)
```

- Interpolate continuous channels linearly.
- Hold discrete channels (gear) until the next sample.
- If the lookup time is outside the telemetry range, hold the first/last sample briefly, then ramp force to zero.
- If a telemetry gap exceeds 250 ms, ramp force down and show a warning.
- Playback rate other than 1.0 disables FFB in v1.

### 8.5 Latency

- `lead` is user-adjustable, default 0 ms, range roughly -200 to +400 ms.
- The overlay shows target, actual, error and loop rate so the user can tune.
- A future version may estimate latency automatically.

---

## 9. Telemetry

### 9.1 v1 import formats

| Format | Status | Notes |
| --- | --- | --- |
| Canonical JSON | v1 | Native format, documented in `docs/telemetry-format.md`. |
| Generic CSV | v1 | Column mapping, units, scale, invert, offset. |
| iRacing IBT | Later | Requires sample files and a browser parser. |
| VBOX VBO | Later | Simple text format; add when needed. |
| MoTeC i2 CSV | v1 via CSV mapping | Recommended real-world export path. |
| SimHub/ACC/rF2/AIM CSV | v1 via CSV mapping | Presets can be added from real exports. |
| MoTeC `.ld` | Later | Reverse-engineered; use CSV export first. |
| AIM `.xrk`/`.drk` | Later | Assisted converter. |
| F1 UDP | Out of scope | Live data, not a file. |

### 9.2 Canonical JSON

The canonical schema is defined in [docs/telemetry-format.md](./docs/telemetry-format.md). Required:

- `format`, `version`
- `meta`
- `samples[]` with `t` and `steer`

`steer` is the steering-wheel angle in degrees. If the source is normalized or reports road-wheel angle, the importer or mapping UI converts it before playback.

Optional channels:

- `steerTorque` (Nm)
- `throttle`, `brake` (0..1)
- `speed` (km/h)
- `gear` (integer; 0 = neutral, -1 = reverse)
- `rpm`
- `latAccel`, `longAccel`, `vertAccel` (g)
- `wheelSlip`
- `absActive`, `tcActive`
- `kerb`

### 9.3 CSV mapping

The mapping UI must support:

- delimiter detection (`,` `;` tab)
- header row detection/override
- time column and unit (`s`, `ms`)
- steering column and unit (`deg`, `rad`, normalized `-1..1`)
- optional columns for throttle, brake, speed, gear, rpm, steering torque
- scale, invert and offset per channel
- steering range for normalized inputs
- road-wheel-to-steering ratio for sources that report road-wheel angle
- preview chart and validation summary
- saving/loading mapping presets

### 9.4 Validation

- At least two samples.
- Timestamps monotonic after sorting; warn if the file required sorting.
- No `NaN`/`Infinity` in required channels.
- Warn when sample rate is below 30 Hz; reject below 5 Hz.
- Warn on gaps over 250 ms; reject gaps over 2 s.
- Reject if `steer` is missing when the user selects Ghost Wheel or Co-Driver.
- Warn if steering exceeds the wheel's configured range.

### 9.5 Interpolation and filtering

- Binary search for the surrounding samples.
- Linear interpolation for continuous channels.
- Hold-last for discrete channels.
- Unwrap steering angles to avoid ±180° jumps.
- Optional one-euro filter for target smoothing; default mild.
- Derivative estimates use central differences with a low-pass filter.
- Never let smoothing introduce more than a configured amount of lag.

### 9.6 Worker

Parsing and validation run in a Web Worker. The main thread receives typed arrays or a compact sample table. The UI stays responsive for large files.

---

## 10. Wheel integration

### 10.1 Adapter interface

```ts
interface WheelAdapter {
  readonly id: string; // e.g. 'cammus-c5', 'ffbeast', 'generic-usb-pid'
  connect(): Promise<WheelCapabilities>;
  disconnect(): Promise<void>;
  state(): WheelState | null;
  setDirectControl?(control: DirectControl): Promise<void>;
  setConstantForce?(value: number): Promise<void>;
  stop(): Promise<void>;
  resetCenter?(): Promise<void>;
  setMotionRange?(degrees: number): Promise<void>;
}
```

Capabilities include at least:

```ts
interface WheelCapabilities {
  input: boolean;
  ffb: boolean;
  direct: boolean;
  position: boolean;
  torque: boolean;
  motionRange?: number;
}
```

### 10.2 Adapter paths and library work

The app depends only on the project's own library. Adapters expose capabilities; the app selects modes from those capabilities and does not branch on wheel model names.

#### CAMMUS C5 (first verified device)

Already verified in `webhid-wheel`:

- vendor ID `0x3416`, product ID `0x0301`, maximum rotation 1080°
- steering, buttons and axes input
- constant force over standard USB-PID

To use it for tracking:

- Treat the steering axis as absolute position feedback; validate range, center, resolution and sign on the bench.
- Drive hands-off tracking through a closed-loop constant-force controller.
- Expose `input`, `ffb`, `position` and `motionRange` capability flags.
- Measure report rate, force-update rate and latency before tuning gains.
- Support force inversion; some units pull the wrong way.
- If position or force quality is insufficient for hands-off tracking, fall back to Co-Driver, Force-Feel or Visual through the same capability rules.

#### FFBeast (direct-control device)

Add backwards-compatible support:

- FFBeast interface selection:
  - vendor ID `0x045b`
  - product ID `0x59d7`
  - usage page `0xff72`
  - usage `0xa1`
- Parse the FFBeast generic input/output report (`0xa3`) for:
  - firmware version
  - registration state
  - raw position and torque
  - `positionDegrees` using the configured motion range
  - `torqueNormalized`
- Read feature reports for motion range and effect settings.
- Direct control method sending report `0xa3` with command `0x10`:
  - spring force (int16)
  - constant force (int16)
  - periodic force (int16)
  - force drop (uint8)
- Stop method: zero forces and set force drop to 100.
- Center reset and motion range helpers.
- Capability flags exposed to the app.
- Keep the existing constant-force FFBeast profile as a fallback for firmware without direct control.
- Add fake-HID tests for report parsing, direct-control bytes, stop behavior and capability detection.
- Keep the public API backwards compatible for existing users (Magnetar).

#### Other standard USB-PID devices

- Reuse the same capability flags and force layer; do not create app-side per-wheel branches.
- Add richer PID effects (spring/damper/periodic) only when a tested device needs them.
- Any device-specific quirk stays inside `webhid-wheel`.

### 10.3 Other wheels

- Use existing `webhid-wheel` input parsing for steering/buttons/pedals.
- Use constant force where available.
- If no FFB or no position feedback, force Visual mode.
- Log capabilities so the compatibility matrix can grow.
- Do not add third-party HID/FFB runtime code.

### 10.4 Calibration

1. **Center**
   - Ask the user to release the wheel.
   - Call center reset if supported; otherwise store an offset.
2. **Direction**
   - The user turns the wheel right; the UI verifies a positive delta.
   - Apply a sign at the app layer. Do not rewrite device settings unless necessary.
3. **Range**
   - Read the motion range; default to 900°.
   - Allow the user to set it to match the wheel/car.
   - Map telemetry steering into the same range.
4. **Telemetry mapping**
   - Degrees: use directly.
   - Normalized: multiply by half the steering range.
   - Road-wheel angle: multiply by a user-provided steering ratio.
5. **Verification**
   - Show a live target slider/test before arming.
   - Require a successful low-force test before Ghost Wheel can be armed.

---

## 11. Control system

### 11.1 State

- `thetaTarget`: steering angle from telemetry, degrees, continuous/unwrapped.
- `omegaTarget`: target angular velocity, deg/s.
- `alphaTarget`: target angular acceleration, deg/s² (optional feedforward).
- `thetaActual`: wheel position, degrees.
- `omegaActual`: estimated wheel angular velocity, deg/s.
- `u`: normalized force command, `-10000..10000`.

### 11.2 Control law

```text
error      = thetaTarget - thetaActual
errorRate  = omegaTarget - omegaActual
u          = Kp * error + Kd * errorRate + Kff * alphaTarget
```

- Clamp `u` to the configured force limit.
- Apply a slew-rate limit and a short low-pass filter to reduce mechanical shock.
- Use a small deadband around zero error only if it does not cause limit cycles.
- Feedforward starts disabled; enable after bench tuning.

Starting values are placeholders and must be tuned on hardware:

- Ghost Wheel: moderate `Kp`, low `Kd`, low `Kff`.
- Co-Driver: lower `Kp`, higher `Kd`.
- Force-Feel: no position error term; use spring/periodic effects or a torque model.

### 11.3 Loop

- Target loop rate: 100–250 Hz.
- Measure and display actual loop rate and missed deadlines.
- Use one control loop per page; do not overlap sends.
- If a send is still in flight, skip the tick rather than queueing unbounded work.
- Stop if the loop rate falls below a safe threshold for a sustained period.

### 11.4 Force mapping

- Convert normalized force to the device's range only in the adapter.
- Apply global strength and `forceDrop` in one place.
- Ramp force in over 100–300 ms when arming/resuming.
- Ramp out over 100–300 ms when pausing/disarming, then send an explicit zero/stop.
- Hard cap in v1: default strength 10%, configurable maximum 50%.

### 11.5 Feel effects (later)

- `springForce`: centering/steering weight.
- `periodicForce`: kerbs, ABS, road texture.
- Gear-shift jolt.
- Understeer/oversteer vibration when telemetry supports it.

Effects must be optional and must never mask the target-tracking force or bypass safety limits.

---

## 12. Safety

Safety is a first-class requirement, not a polish item. See [docs/safety.md](./docs/safety.md).

### 12.1 Hazards

- Unexpected wheel motion.
- Oscillation or runaway control.
- Excessive torque or speed.
- Overheating the motor/driver.
- User hands near a moving wheel.
- Conflict with a running sim or wheel driver.
- Browser crash/tab close leaving a force applied.
- Wrong calibration causing a violent snap to target.
- Disconnect/reconnect causing a sudden force.

### 12.2 Requirements

- No auto-arm. Arm requires a deliberate press-and-hold.
- Visible armed state and a large Stop control.
- `Esc` stops force immediately.
- Default strength low; hard maximum configurable but never unlimited.
- Watchdog on wheel state, video time and telemetry samples (250 ms).
- Stop on pause, seek, buffer, end, hidden tab, window blur, device disconnect, media error, loop stall, and playback rate change.
- Disarm on seek. Ghost Wheel requires re-arming.
- Ramp force in/out; never step from zero to full strength.
- Send explicit zero force on disarm, disconnect and `pagehide`.
- Clear warning for hands-off mode.
- Recommend a physical power switch/e-stop.
- Do not run while a simulator is also controlling the wheel.
- Log safety events in memory and show the last reason for stopping.

### 12.3 Startup safety test

Before enabling Ghost Wheel, run a low-force test:

1. Read position and torque.
2. Command a small target offset in each direction.
3. Confirm movement and direction.
4. Return to zero.
5. Require explicit confirmation.

---

## 13. Architecture

```text
┌────────────────────┐
│ Video source       │  local / direct URL / YouTube
│ MediaClock         │
└─────────┬──────────┘
          │ media time
          ▼
┌────────────────────┐      ┌────────────────────┐
│ Sync               │◄─────│ Offset / lead      │
└─────────┬──────────┘      └────────────────────┘
          │ lookup time
          ▼
┌────────────────────┐
│ TelemetryTrack     │  interpolated target + channels
└─────────┬──────────┘
          │ target angle / rate
          ▼
┌────────────────────┐      ┌────────────────────┐
│ Controller         │◄─────│ Wheel state        │
│ PD + feedforward   │      │ position / torque  │
└─────────┬──────────┘      └────────────────────┘
          │ force
          ▼
┌────────────────────┐
│ WheelAdapter       │  FFBeast direct / generic
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ SafetySupervisor   │  arm, watchdog, stop conditions
└────────────────────┘
```

### 13.1 Modules

- `src/video/` — `MediaClock`, HTML5 and YouTube sources.
- `src/telemetry/` — schema, importers, CSV mapping, track, worker.
- `src/wheel/` — adapter, FFBeast, generic, calibration, controller.
- `src/safety/` — arm state, watchdog, stop conditions.
- `src/sync/` — offset, lead, nudge, per-video persistence.
- `src/ui/` — landing page, player, overlay, panels.
- `src/storage/` — localStorage settings and session metadata.
- `tests/` — unit and component tests.
- `docs/` — format, safety, wheel support, roadmap.

### 13.2 Data flow rules

- Video time is the only playback clock.
- Telemetry never drives playback.
- The controller only sees target state and latest wheel state.
- The safety supervisor can veto/zero any force command.
- The UI reads status; it does not send force directly.
- Parsing never blocks the control loop.

### 13.3 Storage

- `localStorage` for settings, calibration, per-video offset/lead and mapping presets.
- No files are uploaded.
- Optional IndexedDB cache for parsed telemetry is a later enhancement.

---

## 14. Acceptance criteria for v1

A v1 build is acceptable when:

1. It builds to static files and runs from a simple static server.
2. It loads a local video, a direct MP4/WebM URL, and a YouTube URL.
3. It imports canonical JSON and CSV with mapping/validation.
4. It connects to a supported wheel over WebHID (CAMMUS C5 first) and reports position, torque and capabilities.
5. It calibrates center, direction and range.
6. Ghost Wheel follows a synthetic telemetry file at low force without oscillation.
7. Ghost Wheel follows a real telemetry file with visible target/actual/error.
8. Co-Driver runs with lower authority and can be overridden by hand.
9. Offset/lead can be nudged and saved per video.
10. Force stops on pause, seek, buffer, hide, blur, disconnect and media error.
11. The watchdog stops force if video/telemetry/wheel state goes stale.
12. The app passes typecheck and unit tests.
13. The bench logs show a stable control loop and documented gains.
14. No third-party HID/FFB runtime dependency is present.

Hardware-dependent targets (tracking error, maximum stable gains, loop rate) are recorded from the tested-wheel bench rather than guessed in advance.

---

## 15. Testing strategy

### 15.1 Unit tests

- Canonical JSON validation.
- CSV delimiter/header detection and mapping.
- Unit conversion and steering normalization.
- Interpolation, unwrapping, gap handling.
- Media clock extrapolation and resync logic.
- Controller stability against a simulated wheel plant (inertia, friction, latency).
- Safety watchdog and stop conditions.
- Per-video settings keying.

### 15.2 Fake HID tests

- CAMMUS C5 and FFBeast input report parsing.
- Position degrees conversion.
- Direct-control report bytes.
- Stop/zero behavior.
- Capability detection and fallback.
- Disconnect behavior.

### 15.3 Browser tests

- Load local video + JSON telemetry with a fake wheel adapter.
- Load CSV and map columns.
- Arm, play, pause, seek, hide, disconnect.
- Verify force commands are zeroed in all stop paths.

### 15.4 Hardware tests

- CAMMUS C5 and FFBeast bench with step, sine and chirp targets.
- Log target, actual, force, loop rate, jitter.
- Verify direction, range and center.
- Test pause/seek/buffer/tab hide/unplug.
- Test thermal behavior at the configured strength.
- Repeat at low, medium and maximum allowed strength.

---

## 16. Milestones

| Milestone | Deliverable |
| --- | --- |
| **M0** | Repository, specification, scaffold. |
| **M1** | `webhid-wheel` capability flags, CAMMUS C5 path and FFBeast direct control/state + fake-HID tests. |
| **M2** | Ghost Driver bench page; position tracking validated on the first tested wheel. |
| **M3** | Canonical JSON + CSV mapping + telemetry track + worker. |
| **M4** | Local/direct video + YouTube + media clock + sync nudge. |
| **M5** | Ghost Wheel / Co-Driver controller, calibration, safety, UI. |
| **M6** | Polish, docs, sample generator, static deploy. |
| **M7** | IBT/VBO parsers, MoTeC/AIM converters, more wheel FFB adapters. |

Detailed sequencing is in [docs/roadmap.md](./docs/roadmap.md).

---

## 17. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Device-specific path unavailable (e.g. FFBeast direct control) | High | Bench first; keep constant-force and capability-driven fallbacks. |
| Position tracking oscillates or lags | High | Conservative gains, bench logs, feedforward, force limits, Visual/Feel fallback. |
| YouTube sync is inaccurate | Medium | Manual offset/lead, local video option, stop on buffer/ads. |
| CSV exports vary wildly | Medium | Mapping UI, presets, validation, sample fixtures. |
| Telemetry has no steering | Medium | Disable tracking modes; allow Force-Feel/Visual. |
| Unsafe wheel motion | High | Arm/stop/watchdog/ramps/physical e-stop; default low force. |
| Scope creep into live telemetry | Medium | Keep v1 file-only; converters later. |
| Relying only on our own library slows delivery | Medium | Accept; keep the library API small and testable. |
| Browser timer throttling | Medium | Stop FFB when hidden; measure loop rate. |
| Naming/search conflicts | Low | Product name chosen; check trademark before public launch. |

---

## 18. Decisions log

| Decision | Choice | Reason |
| --- | --- | --- |
| Product name | Ghost Driver | Evokes a ghost lap and an invisible driver. |
| Hands-off mode | Ghost Wheel | Wheel-focused, distinct mode name. |
| Hands-on mode | Co-Driver | Communicates assistive control. |
| Feel-only mode | Force-Feel | Descriptive; used as a mode, not the brand. |
| Architecture | Pure static browser | No backend, easy hosting. |
| Telemetry input | Files only | Simple v1; no live bridge. |
| v1 formats | JSON + CSV mapping | Covers most exports with least parser risk. |
| Wheel support | Capability-based; CAMMUS C5 + FFBeast first tested | Avoid model-specific app logic; grow with bench evidence. |
| HID/FFB dependency | Own `webhid-wheel` only | Control, reuse, no third-party runtime. |
| Video sources | Local, direct URL, YouTube | User requirement; local is the precision path. |
| Sync | Manual offset + lead | YouTube cannot be frame-accurate. |
| Safety stance | Arm + watchdog + low force | Autonomous wheel motion is hazardous. |

---

## 19. Open questions

1. Does the CAMMUS C5 steering axis provide stable absolute position across its full range (center, resolution, sign)?
2. What are the maximum stable gains and loop rates on the CAMMUS C5 and FFBeast?
3. Does the installed FFBeast firmware support the direct-control report and state feedback?
4. What motion range does each tested wheel expose or require, and how is it configured?
5. Which force units/release does each tested device expect (Nm, raw, normalized)?
5. Do we need HLS direct URLs in v1 or later?
6. What license should the project use?
7. What is the public repo URL/domain?
8. Which sample telemetry files can we obtain for real-world validation?
9. Should Co-Driver auto-resume after seek, or require re-arming like Ghost Wheel?
10. Should the app expose raw device settings, or hide them behind a bench/diagnostics page?

---

## 20. References

- WebHID API: https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API
- YouTube IFrame Player API: https://developers.google.com/youtube/iframe_api_reference
- FFBeast project: https://ffbeast.github.io/
- FFBeast community docs: https://coronafighter08.github.io/FFBeast-Wheel-Docs/
- FFBeast WebHID protocol reference (MIT, reference only): https://github.com/shubham0x13/ffbeast-wheel-webhid-api
- Project library: https://github.com/joegaffey/webhid-wheel
