# Roadmap

Sequenced so the riskiest part — moving the wheel safely and accurately — is proven before the playback UI is built.

---

## M0 — Specification and scaffold

- [x] New repository and spec.
- [x] Naming and mode hierarchy.
- [x] Canonical telemetry format.
- [x] Safety contract.
- [x] Wheel adapter plan.

Exit: repository builds and the spec is reviewable.

---

## M1 — `webhid-wheel` capability and adapter layers

Work in the `webhid-wheel` repository. Keep the app-facing contract wheel-agnostic; CAMMUS C5 and FFBeast are the first two devices that exercise it.

- [ ] Expose uniform capability flags (input, ffb, direct, position, torque, motion range).
- [ ] Validate C5 position feedback from the steering axis.
- [ ] Confirm C5 constant-force quality, update rate and force inversion.
- [ ] Select the correct FFBeast HID interface.
- [ ] Parse `0xa3` state reports.
- [ ] Expose position, torque, motion range, firmware.
- [ ] Add FFBeast direct control (`spring`, `constant`, `periodic`, `forceDrop`).
- [ ] Add `stop`, `resetCenter`, `setMotionRange`.
- [ ] Keep constant-force fallback.
- [ ] Add fake-HID tests and capability tests.
- [ ] Keep API backwards compatible.

Exit: unit tests pass; both first devices report correct capabilities and drive force over the shared API.

---

## M2 — Wheel bench

New page in this repo, driven by capabilities rather than device names:

- [ ] Connect and calibrate the first available supported wheel (CAMMUS C5 or FFBeast).
- [ ] Read position/torque at rate.
- [ ] Send step/sine/chirp targets.
- [ ] Log target, actual, error, force, loop rate and jitter.
- [ ] Tune conservative gains.
- [ ] Validate every stop condition.
- [ ] Record measured limits per tested wheel in the compatibility notes.

Exit: stable low-force tracking on at least one tested wheel; go/no-go for Ghost Wheel.

---

## M3 — Telemetry import

- [ ] Canonical JSON parser.
- [ ] CSV delimiter/header detection.
- [ ] Column mapping and unit conversion UI.
- [ ] Validation report.
- [ ] Web Worker parsing.
- [ ] Synthetic telemetry generator.
- [ ] Unit tests and fixtures.

Exit: load/map/validate a JSON or CSV file and preview the steering trace.

---

## M4 — Video and sync

- [ ] `MediaClock` abstraction.
- [ ] Local HTML5 video source.
- [ ] Direct MP4/WebM URL source.
- [ ] YouTube IFrame source.
- [ ] Play/pause/seek/buffer/rate handling.
- [ ] Offset and lead controls.
- [ ] Sync nudge with ghost steering indicator.
- [ ] Per-video persistence.
- [ ] Overlay: target/actual/error/speed/throttle/brake/gear.

Exit: synthetic telemetry follows a local video; YouTube works with manual sync.

---

## M5 — Modes and safety UI

- [ ] Controller with clamps and ramps.
- [ ] Ghost Wheel mode.
- [ ] Co-Driver mode.
- [ ] Force-Feel mode.
- [ ] Visual mode.
- [ ] Calibration flow.
- [ ] Arm/stop/Esc.
- [ ] Watchdogs and automatic stops.
- [ ] Safety banner and stop reason.
- [ ] Settings persistence.

Exit: full v1 acceptance criteria in `SPEC.md`.

---

## M6 — Polish and deploy

- [ ] README/setup/safety docs.
- [ ] Sample telemetry and bench data.
- [ ] Error states and diagnostics export.
- [ ] Static build and GitHub Pages workflow.
- [ ] Performance pass on large files.
- [ ] Manual test matrix.

Exit: deployable v1.

---

## M7 — Format and wheel breadth

- [ ] iRacing IBT browser parser.
- [ ] VBOX VBO parser.
- [ ] MoTeC `.ld` converter/WASM.
- [ ] AIM exports.
- [ ] CSV presets for common tools.
- [ ] More wheel FFB profiles.
- [ ] Optional HLS video.
- [ ] Optional assisted telemetry recorder.

---

## Deferred ideas

- Automatic video/telemetry alignment.
- Steering-wheel detection in video.
- Kerb/ABS/understeer effects from richer telemetry.
- Ghost-car comparison.
- Session sharing (video + telemetry + offset settings).
- Mobile viewer with a non-HID control.
- Live telemetry bridge.
