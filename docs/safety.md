# Safety requirements

**Ghost Driver can move a force-feedback wheel autonomously. That is a physical hazard.**

This document is part of the product contract. Safety behavior is not optional and must not be disabled by a UI preference.

---

## 1. Hazards

| Hazard | Scenario | Consequence |
| --- | --- | --- |
| Unexpected motion | Wrong target, bad calibration, stale data | Wheel strikes hands/body or objects |
| Oscillation | Excessive gains, latency, noisy telemetry | Violent shake, overheating, loss of control |
| Runaway force | Bug, stuck command, lost connection | Continuous torque against a stop |
| Overheating | Sustained high torque | Motor/driver damage, burns, fire risk |
| Hands near wheel | Hands-off mode with hands on the rim | Pinching, impact, injury |
| Sim conflict | Sim and Ghost Driver both send FFB | Unpredictable forces |
| Crash/tab close | Page closes while force applied | Force may remain until device timeout |
| Wrong direction | Inverted steering mapping | Wheel snaps to the wrong lock |
| Sudden seek | User seeks while armed | Large instantaneous target jump |
| Reconnect | Device reconnects mid-session | Unexpected force on reconnect |

---

## 2. Hard requirements

### 2.1 Arming

- The app must never auto-arm on load, connect, play, or video change.
- Arming requires a deliberate press-and-hold (about 1 second).
- The armed state must be visible at all times.
- The app must disarm on every stop condition.
- Ghost Wheel must require re-arming after seek.
- Calibration and a low-force movement test must succeed before Ghost Wheel can arm.

### 2.2 Stop

- A large Stop control must always be reachable.
- `Esc` must stop force immediately.
- Stop means: zero all force, set force drop/attenuation to maximum, and disarm.
- The stop path must not depend on the video, telemetry or control loop being healthy.

### 2.3 Force limits

- Default strength: **10%**.
- Configurable maximum: **50%** in v1. Do not expose unlimited.
- Apply a hard clamp in the controller and again in the adapter.
- Apply a slew-rate limit and a short ramp; never step from zero to full force.
- Limit wheel speed and acceleration where the device/controller allows it.
- Warn if the device is configured to output high continuous torque.
- Provide a thermal/continuous-use warning; do not run high torque indefinitely.

### 2.4 Watchdogs

Stop force if any of these is stale for more than **250 ms**:

- wheel state reports
- video time updates
- telemetry samples around the lookup time
- the control loop itself

A watchdog trip must be visible in the UI and logged with a reason.

### 2.5 Automatic stop conditions

Stop and disarm on:

- pause
- seek / seeking
- buffering / waiting
- end of video
- tab hidden (`visibilitychange`)
- window blur
- wheel disconnect
- media error
- playback rate other than 1.0
- unsupported/absent steering data
- control loop stall
- device error
- app unload/pagehide

### 2.6 Ramping

- Ramp in over 100–300 ms after arming/resuming.
- Ramp out over 100–300 ms before sending the explicit stop.
- On seek, do not interpolate the wheel across the jump. Stop, then resume from zero when re-armed.
- On reconnect, remain disarmed until the user explicitly arms again.

### 2.7 Device conflict

- Warn the user not to run a simulator or other FFB software against the same wheel.
- If the device reports unexpected torque/state or the wheel feels like it is fighting, stop.
- Do not attempt to work around another application's exclusive access.

### 2.8 Physical safety

- Recommend a physical power switch or e-stop within reach.
- Warn that hands-off mode must be used with hands clear of the wheel.
- Warn about loose clothing, cables and objects near the rim.
- Start at low force with the wheel free to move.
- Do not use the app with a child or untrained person at the controls.
- Software cannot guarantee a safe state after a browser crash or power loss.

---

## 3. UI requirements

- Persistent safety banner when armed.
- Mode, strength and wheel name visible during playback.
- Target, actual, error and loop rate visible in a diagnostics panel.
- Clear "why it stopped" message after any automatic stop.
- No dark patterns: arming is not a tiny toggle; stopping is not hidden behind a menu.
- A first-run safety acknowledgement before enabling Ghost Wheel.

---

## 4. Bench/test requirements

Before calling a wheel supported:

1. Verify direction with a small target in each direction.
2. Verify center and range.
3. Run step, sine and chirp targets at low force.
4. Log target, actual, force, loop rate and jitter.
5. Verify all stop conditions: pause, seek, hide, blur, unplug, close.
6. Verify the wheel stops after a page reload/crash as far as the device allows.
7. Test at the maximum allowed strength with the wheel unloaded.
8. Document results in the compatibility notes.

---

## 5. Failure-mode expectations

| Failure | Expected behavior |
| --- | --- |
| Video stalls | Force ramps to zero within 250 ms, disarm |
| Telemetry file ends | Hold briefly, then zero and disarm |
| Wheel disconnects | Zero immediately, disarm, show reconnect |
| Browser tab hidden | Zero and disarm before background throttling |
| Control loop overruns | Reduce/zero force, show warning, disarm if sustained |
| Direct-control send fails | Attempt zero/stop, disarm, show error |
| App crash | No guarantee; physical e-stop required |
| Wrong steering sign | Low-force test catches before arming |
| Telemetry jumps on seek | Force remains off until re-arm |

---

## 6. Non-negotiable rules

1. No auto-arm.
2. No force without a healthy video/telemetry/wheel watchdog.
3. No unlimited strength.
4. No silent recovery from a safety stop.
5. No running while another app is controlling the wheel.
6. No hands-off mode without a clear warning and low default force.
