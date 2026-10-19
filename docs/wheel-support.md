# Wheel support

Ghost Driver uses only the project author's [`webhid-wheel`](../../webhid-wheel) library for HID and force feedback.

Support is **capability-based, not model-based**. The app asks what a device can do — position feedback, force output, direct control — and enables the modes those capabilities allow. It must not branch on wheel names.

CAMMUS C5 and FFBeast are the first two tested devices. They are evidence that the capability contract works, not special cases in the app.

---

## 1. Adapter model

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

The controller never talks to `HIDDevice` directly. It sees normalized force commands and a `WheelState`. The adapter owns report IDs, byte layouts and device quirks. `id` is for diagnostics and persistence only.

---

## 2. Capability detection

```ts
interface WheelCapabilities {
  input: boolean;
  ffb: boolean;
  direct: boolean;      // direct spring/constant/periodic control
  position: boolean;    // absolute wheel position feedback
  torque: boolean;      // output torque feedback
  motionRange?: number;
}
```

`position` may come from a dedicated report or from the steering axis. `ffb` may be direct control or constant force. The app consumes the capability, not the mechanism.

| Capability | Modes available |
| --- | --- |
| `position` + `ffb` | Ghost Wheel, Co-Driver, Force-Feel, Visual |
| `ffb` only | Force-Feel, Visual |
| `input` only | Visual |
| no wheel | Visual |

A wheel without position feedback cannot run hands-off tracking. A wheel with position but poor force response or excessive friction may still be limited to Co-Driver/Force-Feel after bench testing.

---

## 3. Tracking model

Hands-off tracking is always a closed loop: the controller compares recorded steering with the wheel's reported position and commands force to reduce the error.

- **Constant-force devices** (CAMMUS C5): the app's PD/feedforward loop outputs constant force.
- **Direct-control devices** (FFBeast): the same loop can output constant force, or the adapter can use device-side spring/periodic effects where they improve feel.

The controller and safety rules are identical. Whether force comes from a standard USB-PID effect or a vendor report is an adapter detail.

---

## 4. First tested devices

### 4.1 CAMMUS C5

Verified in `webhid-wheel` on Windows 11 with Chrome:

- Vendor ID `0x3416`, product ID `0x0301`
- Maximum rotation 1080°
- Steering, buttons and axes input
- Constant force over standard USB-PID (**verified**)

Position feedback is the steering axis. Before enabling Ghost Wheel, the bench must confirm:

- absolute range and center
- resolution and noise
- direction/sign, including force inversion
- input report rate and force-update rate
- latency and jitter
- tracking quality at 5%, 10% and 20% force

Force inversion is a user-facing option; some units pull the wrong way. If constant-force tracking is not stable enough, this device falls back to Co-Driver, Force-Feel or Visual by capability rule.

### 4.2 FFBeast

Reference notes for the direct-control adapter:

- Vendor ID `0x045b` (1115)
- Product ID `0x59d7` (22999)
- Interface usage page `0xff72`
- Interface usage `0xa1`

The FFBeast may expose multiple HID interfaces. The adapter must select/filter the interface with the usage above. Do not assume the first returned device is the right one.

Reference protocol, to be validated on the actual firmware:

- Report size: 64 bytes.
- Generic input/output report ID: `0xa3`.
- Input state report fields:
  - firmware release type, major, minor, patch
  - registration state
  - raw position (`int16`, roughly `-10000..10000`)
  - raw torque (`int16`, roughly `-10000..10000`)
- Direct control command `0x10` in report `0xa3`:
  - `int16` spring force
  - `int16` constant force
  - `int16` periodic force
  - `uint8` force drop (0 = no attenuation, 100 = full attenuation)
- Feature reports:
  - effect settings (report `0x22`)
  - hardware settings (report `0x21`)
- Settings writes use report `0xa3` with command `0x14`.
- Center reset command `0x04` in report `0xa3`.
- Stop: zero spring/constant/periodic and set force drop to 100.

Motion range and position:

```text
positionDegrees = rawPosition / 10000 * motionRange / 2
```

Confirm sign, scaling and range on hardware. Keep the existing constant-force profile as a fallback for firmware without direct control.

Bench requirements:

- Validate that direct control actually moves the wheel.
- Measure input report rate, send latency and loop jitter.
- Determine stable `Kp`/`Kd` ranges.
- Test at 5%, 10%, 20% and 50% strength, unloaded first.
- Verify stop on disconnect/pagehide.
- Verify fallback behavior if direct control is unsupported.

---

## 5. Other wheels

Use the same capability contract:

- Steering/buttons/pedals come from the generic HID descriptor fallback or a per-model profile.
- Constant force is used only if the device supports it.
- No position feedback means no Ghost Wheel/Co-Driver; use Force-Feel or Visual.
- Add profiles and FFB support only from real hardware or diagnostics.
- Device-specific quirks stay inside `webhid-wheel`; do not add app-side model branches.
- Do not add third-party HID/FFB runtime libraries.

Any standard USB-PID device that exposes position and constant force can potentially run tracking. It graduates to "supported" only after the bench.

---

## 6. Calibration

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

## 7. Compatibility matrix

| Wheel | Input | Position | Force path | Modes | Status |
| --- | --- | --- | --- | --- | --- |
| CAMMUS C5 | verified | steering axis, bench to confirm | constant force (USB-PID, verified) | Ghost Wheel/Co-Driver if bench passes; Force-Feel/Visual fallback | First test device |
| FFBeast | expected | direct report (planned) | direct control + constant-force fallback | Ghost Wheel, Co-Driver, Force-Feel, Visual | Bench required |
| Thrustmaster T300/T248 | existing input | no | no | Visual; Force-Feel if constant works | Unverified |
| Logitech DFGT/G29 | existing/partial input | no | no | Visual | Unverified |
| Generic HID wheel | descriptor fallback | device-dependent | device-dependent | Visual/Feel; tracking if position + force | Unverified |

The matrix grows only with bench evidence. "Supported" means tested on real hardware, not merely parsed by a descriptor.

---

## 8. Adding a wheel

1. Capture diagnostics from `webhid-wheel` (descriptor, input sweep, force test).
2. Add or extend a device profile inside the library.
3. Map its capabilities to the shared flags.
4. Add fake-HID tests for parsing and force output.
5. Run the bench: calibration, rate, latency, low-force tracking.
6. Record the result in the matrix, including any mode restrictions.

---

## 9. Diagnostics

The app should expose:

- device name, vendor/product ID
- selected report IDs and usage page/usage
- capabilities
- position/torque rates
- last error
- a downloadable JSON report

Do not include personal data. Diagnostics are local until the user chooses to share them.
