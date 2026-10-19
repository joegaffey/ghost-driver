import WebHIDWheel, { type WheelState } from 'webhid-wheel';
import {
  HtmlVideoClock,
  SyntheticClock,
  YouTubeClock,
  parseYouTubeId,
  type MediaClock,
} from './media-clock';
import {
  buildSyntheticTelemetry,
  formatDuration,
  parseTelemetry,
  type SampledState,
  type TelemetryDocument,
  type TelemetryTrack,
} from './telemetry';
import {
  TRACKING_INTERVAL_MS,
  TRACKING_RESEND_MS,
  trackingForce,
} from './tracking';

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const SETTINGS_KEY = 'ghost-driver.playback.settings';
const SETTINGS_VERSION = 2;
const DEFAULT_WHEEL_STRENGTH = 0.25;
const MAX_WHEEL_STRENGTH = 0.5;

export function initPlaybackApp(root: HTMLElement): void {
  root.innerHTML = `
    <div class="play-shell">
      <header class="play-header">
        <a class="brand" href="./">Ghost Driver</a>
        <span class="play-badge">experimental · wheel test</span>
        <span id="status" class="status">Load a video to begin.</span>
      </header>

      <main class="play-main">
        <section class="stage">
          <div id="videoFrame" class="video-frame">
            <div id="videoHost" class="video-host"></div>
            <div id="videoEmpty" class="video-empty">
              <strong>Load a video</strong>
              <span>Local file, direct URL, or YouTube. The telemetry overlay works without a wheel.</span>
            </div>
            <div class="hud">
              <div class="hud-top">
                <div class="ghost-wheel-card">
                  <svg viewBox="0 0 200 200" class="ghost-wheel-svg" aria-hidden="true">
                    <circle cx="100" cy="100" r="76" class="rim-base"></circle>
                    <g id="ghostWheelRim">
                      <circle cx="100" cy="100" r="76" class="rim"></circle>
                      <line x1="100" y1="24" x2="100" y2="58" class="spoke"></line>
                      <line x1="34" y1="138" x2="66" y2="121" class="spoke"></line>
                      <line x1="166" y1="138" x2="134" y2="121" class="spoke"></line>
                      <circle cx="100" cy="100" r="13" class="hub"></circle>
                      <line x1="100" y1="24" x2="100" y2="42" class="marker"></line>
                    </g>
                  </svg>
                  <div id="steerAngle" class="steer-angle">0°</div>
                </div>
              </div>

              <div class="hud-bottom">
                <div class="steer-track">
                  <span class="steer-center"></span>
                  <span id="steerMarker" class="steer-marker"></span>
                  <span id="wheelMarker" class="steer-marker wheel-marker" hidden></span>
                </div>
                <div class="hud-row">
                  <div class="hud-stat"><span>Speed</span><strong id="hudSpeed">0</strong><em>km/h</em></div>
                  <div class="hud-stat"><span>Gear</span><strong id="hudGear">—</strong></div>
                  <div class="hud-stat"><span>RPM</span><strong id="hudRpm">0</strong></div>
                </div>
                <div class="pedal-row">
                  <div class="pedal">
                    <span>Throttle</span>
                    <div class="bar"><div id="throttleBar" class="fill"></div></div>
                    <em id="throttleValue">0%</em>
                  </div>
                  <div class="pedal">
                    <span>Brake</span>
                    <div class="bar brake"><div id="brakeBar" class="fill"></div></div>
                    <em id="brakeValue">0%</em>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="transport">
            <button id="playPause" class="primary" type="button">Play</button>
            <input id="timeline" class="timeline" type="range" min="0" max="1" step="0.01" value="0" />
            <span id="timeReadout" class="time-readout">0:00 / 0:00</span>
          </div>
        </section>

        <aside class="side">
          <section class="panel">
            <h2>Video</h2>
            <div class="tabs" role="tablist">
              <button type="button" class="active" data-source="local">Local file</button>
              <button type="button" data-source="url">URL</button>
              <button type="button" data-source="youtube">YouTube</button>
            </div>
            <div id="source-local" class="source-panel">
              <label class="file-label">
                Choose a video
                <input id="videoFile" type="file" accept="video/*" />
              </label>
            </div>
            <div id="source-url" class="source-panel" hidden>
              <input id="videoUrl" type="url" placeholder="https://.../lap.mp4" />
              <button id="loadUrl" type="button">Load URL</button>
            </div>
            <div id="source-youtube" class="source-panel" hidden>
              <input id="youtubeUrl" type="url" placeholder="https://youtube.com/watch?v=..." />
              <button id="loadYouTube" type="button">Load YouTube</button>
              <p class="hint">YouTube timing is best-effort. Use offset/lead to align.</p>
            </div>
          </section>

          <section class="panel">
            <h2>Telemetry</h2>
            <label class="file-label">
              Load canonical JSON
              <input id="telemetryFile" type="file" accept=".json,application/json" />
            </label>
            <button id="loadSample" type="button">Use synthetic sample</button>
            <p id="telemetryInfo" class="hint">No telemetry loaded.</p>
          </section>

          <section class="panel">
            <h2>Wheel</h2>
            <button id="wheelConnect" type="button">Connect wheel</button>
            <p id="wheelInfo" class="hint">No wheel connected. WebHID requires desktop Chromium over HTTPS or localhost.</p>
            <dl class="readout wheel-readout">
              <dt>Device</dt><dd id="wheelDevice">—</dd>
              <dt>Profile</dt><dd id="wheelProfile">—</dd>
              <dt>Angle</dt><dd id="wheelAngle">—</dd>
              <dt>FFB</dt><dd id="wheelFfb">—</dd>
              <dt>Tracking</dt><dd id="wheelTracking">off</dd>
            </dl>
            <div class="control-row">
              <label for="wheelStrength">Test strength</label>
              <span id="wheelStrengthValue" class="value">25%</span>
            </div>
            <input id="wheelStrength" type="range" min="0" max="50" step="1" value="25" />
            <label class="check-row">
              <input id="wheelInvert" type="checkbox" />
              Invert force
            </label>
            <label class="check-row arm-row">
              <input id="wheelArm" type="checkbox" disabled />
              Arm telemetry tracking
            </label>
            <div class="nudge-row">
              <button id="wheelCenter" type="button" disabled>Set center</button>
              <button id="wheelTestLeft" type="button" disabled>Test left</button>
              <button id="wheelTestRight" type="button" disabled>Test right</button>
              <button id="wheelStop" type="button" disabled>Stop FFB</button>
            </div>
            <p class="hint">Use Test left/right to confirm FFB. Start around 25%; raise toward 50% if needed. If tracking pulls away from the target, enable Invert force.</p>
          </section>

          <section class="panel">
            <h2>Sync</h2>
            <div class="control-row">
              <label for="offset">Offset</label>
              <span id="offsetValue" class="value">0 ms</span>
            </div>
            <input id="offset" type="range" min="-2000" max="2000" step="10" value="0" />
            <div class="nudge-row">
              <button type="button" data-nudge="-100">−100</button>
              <button type="button" data-nudge="-10">−10</button>
              <button type="button" data-nudge="10">+10</button>
              <button type="button" data-nudge="100">+100</button>
            </div>
            <div class="control-row">
              <label for="lead">FFB lead</label>
              <span id="leadValue" class="value">0 ms</span>
            </div>
            <input id="lead" type="range" min="-200" max="400" step="10" value="0" />
            <p class="hint">Offset shifts telemetry against video. Lead is look-ahead for wheel latency.</p>
          </section>

          <section class="panel">
            <h2>At the playhead</h2>
            <dl class="readout">
              <dt>Time</dt><dd id="readTime">—</dd>
              <dt>Steer</dt><dd id="readSteer">—</dd>
              <dt>Throttle</dt><dd id="readThrottle">—</dd>
              <dt>Brake</dt><dd id="readBrake">—</dd>
              <dt>Speed</dt><dd id="readSpeed">—</dd>
              <dt>Gear</dt><dd id="readGear">—</dd>
              <dt>RPM</dt><dd id="readRpm">—</dd>
              <dt>Sample</dt><dd id="readState">—</dd>
            </dl>
          </section>

        </aside>
      </main>
    </div>
  `;

  const videoHost = el<HTMLDivElement>('#videoHost');
  const videoEmpty = el<HTMLDivElement>('#videoEmpty');
  const statusEl = el<HTMLSpanElement>('#status');
  const playButton = el<HTMLButtonElement>('#playPause');
  const timeline = el<HTMLInputElement>('#timeline');
  const timeReadout = el<HTMLSpanElement>('#timeReadout');
  const videoFile = el<HTMLInputElement>('#videoFile');
  const videoUrl = el<HTMLInputElement>('#videoUrl');
  const loadUrl = el<HTMLButtonElement>('#loadUrl');
  const youtubeUrl = el<HTMLInputElement>('#youtubeUrl');
  const loadYouTube = el<HTMLButtonElement>('#loadYouTube');
  const telemetryFile = el<HTMLInputElement>('#telemetryFile');
  const loadSample = el<HTMLButtonElement>('#loadSample');
  const telemetryInfo = el<HTMLParagraphElement>('#telemetryInfo');
  const offsetInput = el<HTMLInputElement>('#offset');
  const offsetValue = el<HTMLSpanElement>('#offsetValue');
  const leadInput = el<HTMLInputElement>('#lead');
  const leadValue = el<HTMLSpanElement>('#leadValue');
  const wheelConnect = el<HTMLButtonElement>('#wheelConnect');
  const wheelInfo = el<HTMLParagraphElement>('#wheelInfo');
  const wheelDevice = el<HTMLElement>('#wheelDevice');
  const wheelProfile = el<HTMLElement>('#wheelProfile');
  const wheelAngle = el<HTMLElement>('#wheelAngle');
  const wheelFfb = el<HTMLElement>('#wheelFfb');
  const wheelTracking = el<HTMLElement>('#wheelTracking');
  const wheelArm = el<HTMLInputElement>('#wheelArm');
  const wheelStrengthInput = el<HTMLInputElement>('#wheelStrength');
  const wheelStrengthValue = el<HTMLSpanElement>('#wheelStrengthValue');
  const wheelInvertInput = el<HTMLInputElement>('#wheelInvert');
  const wheelCenter = el<HTMLButtonElement>('#wheelCenter');
  const wheelTestLeft = el<HTMLButtonElement>('#wheelTestLeft');
  const wheelTestRight = el<HTMLButtonElement>('#wheelTestRight');
  const wheelStop = el<HTMLButtonElement>('#wheelStop');
  const steerAngle = el<HTMLDivElement>('#steerAngle');
  const steerMarker = el<HTMLSpanElement>('#steerMarker');
  const wheelMarker = el<HTMLSpanElement>('#wheelMarker');
  const hudSpeed = el<HTMLElement>('#hudSpeed');
  const hudGear = el<HTMLElement>('#hudGear');
  const hudRpm = el<HTMLElement>('#hudRpm');
  const throttleBar = el<HTMLDivElement>('#throttleBar');
  const brakeBar = el<HTMLDivElement>('#brakeBar');
  const throttleValue = el<HTMLElement>('#throttleValue');
  const brakeValue = el<HTMLElement>('#brakeValue');
  const readTime = el<HTMLElement>('#readTime');
  const readSteer = el<HTMLElement>('#readSteer');
  const readThrottle = el<HTMLElement>('#readThrottle');
  const readBrake = el<HTMLElement>('#readBrake');
  const readSpeed = el<HTMLElement>('#readSpeed');
  const readGear = el<HTMLElement>('#readGear');
  const readRpm = el<HTMLElement>('#readRpm');
  const readState = el<HTMLElement>('#readState');
  const ghostWheelRim = document.querySelector<SVGGElement>('#ghostWheelRim');

  if (!ghostWheelRim) throw new Error('Missing ghost wheel.');
  const wheelRim = ghostWheelRim;

  let clock: MediaClock | null = null;
  let track: TelemetryTrack | null = null;
  let offsetMs = 0;
  let leadMs = 0;
  let objectUrl: string | null = null;
  let loadToken = 0;
  let scrubbing = false;
  let lastDuration = 0;
  let lastTimelineValue = -1;
  let wheel: WebHIDWheel | null = null;
  let wheelStrength = DEFAULT_WHEEL_STRENGTH;
  let wheelInvert = false;
  let connectingWheel = false;
  let wheelCenterOffset = 0;
  let trackingArmed = false;
  let trackingForceActive = false;
  let forceSending = false;
  let pendingForce: number | null = null;
  let pendingStop = false;
  let forceIsOff = true;
  let lastTrackingAt = 0;
  let lastForceSentAt = 0;
  let lastSentForce = 0;
  let lastActualAngle: number | undefined;
  let actualRate = 0;

  function setStatus(message: string, tone: 'info' | 'ok' | 'error' = 'info'): void {
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  }

  function updateSyncLabels(): void {
    offsetValue.textContent = `${offsetMs} ms`;
    leadValue.textContent = `${leadMs} ms`;
    offsetInput.value = String(offsetMs);
    leadInput.value = String(leadMs);
  }

  function showVideoEmpty(mode: 'video' | 'telemetry'): void {
    videoEmpty.innerHTML =
      mode === 'telemetry'
        ? '<strong>Telemetry only</strong><span>No video loaded. Press Play for telemetry-only, or load a video from the panel.</span>'
        : '<strong>Load a video</strong><span>Local file, direct URL, or YouTube. The telemetry overlay works without a wheel.</span>';
    videoEmpty.hidden = false;
  }

  function webHidAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'hid' in navigator;
  }

  function wheelFfbLabel(): string {
    if (!wheel?.isConnected) return '—';
    if (wheel.ffbCaps?.constant) return 'constant';
    if (wheel.ffbCaps?.periodic) return 'periodic';
    if (wheel.ffbCaps?.any) return 'yes';
    return 'none';
  }

  function updateWheelUi(): void {
    const connected = Boolean(wheel?.isConnected);
    const supported = webHidAvailable();

    wheelConnect.textContent = connectingWheel
      ? 'Connecting…'
      : connected
        ? 'Disconnect wheel'
        : 'Connect wheel';
    wheelConnect.disabled = connectingWheel || !supported;

    const canForce = connected && Boolean(wheel?.ffbCaps?.any);
    const canTrack = canForce && Boolean(track) && Boolean(clock);

    if (!canTrack && trackingArmed) {
      trackingArmed = false;
      stopTrackingForce();
    }

    wheelArm.disabled = !canTrack;
    wheelArm.checked = trackingArmed;
    wheelTracking.textContent = trackingArmed
      ? trackingForceActive
        ? 'active'
        : clock?.playing()
          ? 'armed'
          : 'armed · press Play'
      : 'off';

    wheelCenter.disabled = !connected || typeof wheel?.state.rotation !== 'number';
    wheelTestLeft.disabled = !canForce || trackingArmed;
    wheelTestRight.disabled = !canForce || trackingArmed;
    wheelStop.disabled = !canForce;

    wheelDevice.textContent = connected ? (wheel?.name ?? 'Unknown wheel') : '—';
    wheelProfile.textContent = connected ? (wheel?.parserName ?? '—') : '—';
    wheelFfb.textContent = wheelFfbLabel();

    if (connected) {
      const range = wheel?.maxRotation ?? 900;
      wheelInfo.textContent = `${wheel?.name ?? 'Wheel'} · ${range}° range · ${wheelFfbLabel()}`;
      return;
    }

    wheelAngle.textContent = '—';
    wheelMarker.hidden = true;
    wheelInfo.textContent = supported
      ? 'No wheel connected. WebHID requires desktop Chromium over HTTPS or localhost.'
      : 'WebHID is not available in this browser. Use desktop Chromium over HTTPS or localhost.';
  }

  function updateWheelInput(state: WheelState): void {
    const rotation =
      typeof state.rotation === 'number' && Number.isFinite(state.rotation)
        ? state.rotation - wheelCenterOffset
        : undefined;

    if (rotation === undefined) {
      wheelAngle.textContent = '—';
      wheelMarker.hidden = true;
      return;
    }

    wheelAngle.textContent = `${Math.round(rotation)}°`;
    const range = track?.steeringRangeDeg ?? wheel?.maxRotation ?? 900;
    const fraction = clamp(rotation / (range / 2), -1, 1);
    wheelMarker.hidden = false;
    wheelMarker.style.left = `${50 + fraction * 50}%`;
  }

  async function flushWheelForce(): Promise<void> {
    if (forceSending || !wheel?.isConnected) return;

    if (pendingStop) {
      pendingStop = false;
      forceSending = true;
      try {
        await wheel.stopEffects();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not stop wheel force.', 'error');
      } finally {
        forceSending = false;
        if (pendingStop || pendingForce !== null) void flushWheelForce();
      }
      return;
    }

    if (pendingForce === null) return;

    const value = pendingForce;
    pendingForce = null;
    forceSending = true;
    try {
      await wheel.setConstantForce(value);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not send force.', 'error');
      if (trackingArmed) setTrackingArmed(false, 'Tracking stopped after a wheel error.');
    } finally {
      forceSending = false;
      if (pendingStop || pendingForce !== null) void flushWheelForce();
    }
  }

  function queueWheelForce(value: number): void {
    if (!wheel?.isConnected || !wheel.ffbCaps?.any) return;
    pendingForce = value;
    pendingStop = false;
    forceIsOff = false;
    void flushWheelForce();
  }

  function stopWheelForce(): void {
    if (!wheel?.isConnected) return;
    if (forceIsOff && !pendingStop && !forceSending && pendingForce === null) return;
    pendingStop = true;
    pendingForce = null;
    forceIsOff = true;
    void flushWheelForce();
  }

  function setWheelTestForce(value: number): void {
    if (!wheel?.isConnected || !wheel.ffbCaps?.any) return;
    queueWheelForce(value);
    setStatus(
      `Test force ${value < 0 ? 'left' : 'right'} at ${Math.round(wheelStrength * 100)}% strength.`,
    );
  }

  function resetWheelForceState(): void {
    forceSending = false;
    pendingForce = null;
    pendingStop = false;
    forceIsOff = true;
    trackingForceActive = false;
    lastSentForce = 0;
  }

  function stopTrackingForce(): void {
    lastTrackingAt = 0;
    lastActualAngle = undefined;
    actualRate = 0;
    lastSentForce = 0;
    if (!trackingForceActive) return;
    trackingForceActive = false;
    stopWheelForce();
    wheelTracking.textContent = trackingArmed ? 'armed' : 'off';
  }

  function setTrackingArmed(armed: boolean, reason?: string): void {
    if (armed) {
      if (!wheel?.isConnected) {
        setStatus('Connect a wheel before arming tracking.', 'error');
        wheelArm.checked = false;
        return;
      }
      if (!wheel.ffbCaps?.any) {
        setStatus('This wheel does not report force-feedback support.', 'error');
        wheelArm.checked = false;
        return;
      }
      if (!track) {
        setStatus('Load telemetry before arming tracking.', 'error');
        wheelArm.checked = false;
        return;
      }
      if (!clock) {
        setStatus('Load a video before arming tracking.', 'error');
        wheelArm.checked = false;
        return;
      }
    }

    if (trackingArmed === armed) {
      if (!armed) stopTrackingForce();
      return;
    }

    trackingArmed = armed;
    wheelArm.checked = armed;
    if (armed) {
      setStatus('Wheel tracking armed. Press Play, and keep hands clear.', 'ok');
    } else {
      stopTrackingForce();
      setStatus(reason ?? 'Wheel tracking disarmed.');
    }
    updateWheelUi();
  }

  function updateWheelTracking(now: number): void {
    if (!trackingArmed) {
      stopTrackingForce();
      return;
    }

    if (!wheel?.isConnected || !wheel.ffbCaps?.any || !clock || !clock.playing() || !track) {
      stopTrackingForce();
      return;
    }

    if (document.hidden) {
      stopTrackingForce();
      return;
    }

    if (now - lastTrackingAt < TRACKING_INTERVAL_MS) return;

    const dt = lastTrackingAt > 0 ? (now - lastTrackingAt) / 1000 : 0;
    lastTrackingAt = now;

    const sample = stateAtPlayhead();
    const rawActual = wheel.state.rotation;
    const actual =
      typeof rawActual === 'number' && Number.isFinite(rawActual)
        ? rawActual - wheelCenterOffset
        : undefined;

    if (
      !sample ||
      sample.stale ||
      sample.steer === undefined ||
      actual === undefined ||
      !Number.isFinite(actual)
    ) {
      stopTrackingForce();
      wheelTracking.textContent = trackingArmed ? 'waiting' : 'off';
      return;
    }

    const range = wheel.maxRotation;
    const target = clamp(sample.steer, -range / 2, range / 2);

    if (dt > 0 && lastActualAngle !== undefined) {
      const rawRate = (actual - lastActualAngle) / dt;
      actualRate = actualRate * 0.75 + rawRate * 0.25;
    }
    lastActualAngle = actual;

    const command = trackingForce(target, actual, actualRate);

    if (command === 0) {
      if (trackingForceActive) {
        trackingForceActive = false;
        stopWheelForce();
      }
      lastSentForce = 0;
      wheelTracking.textContent = 'armed';
      return;
    }

    const elapsed = now - lastForceSentAt;
    if (Math.abs(command - lastSentForce) < 0.01 && elapsed < TRACKING_RESEND_MS) return;

    lastSentForce = command;
    lastForceSentAt = now;
    trackingForceActive = true;
    wheelTracking.textContent = 'active';
    queueWheelForce(command);
  }

  function ensureWheel(): WebHIDWheel | null {
    if (wheel) return wheel;
    if (!webHidAvailable()) {
      updateWheelUi();
      setStatus('WebHID is not available in this browser.', 'error');
      return null;
    }

    try {
      const next = new WebHIDWheel({
        ffbStrength: wheelStrength,
        ffbInvert: wheelInvert,
        deadzone: 0.01,
      });
      next.on('connect', () => {
        next.ffbStrength = wheelStrength;
        next.ffbInvert = wheelInvert;
        wheelCenterOffset = 0;
        resetWheelForceState();
        updateWheelUi();
        console.info('[ghost-driver] wheel connected', {
          name: next.name,
          profile: next.parserName,
          ffbCaps: next.ffbCaps,
          maxRotation: next.maxRotation,
        });
        setStatus(
          next.ffbCaps?.any
            ? `Wheel connected: ${next.name ?? 'unknown device'}. Set center, arm tracking, then press Play.`
            : `Wheel connected: ${next.name ?? 'unknown device'}, but no force feedback was detected on this interface.`,
          next.ffbCaps?.any ? 'ok' : 'error',
        );
      });
      next.on('disconnect', () => {
        wheelCenterOffset = 0;
        resetWheelForceState();
        updateWheelUi();
        setStatus('Wheel disconnected.');
      });
      next.on('input', (state) => updateWheelInput(state));
      next.on('error', (error) => {
        setStatus(error instanceof Error ? error.message : 'Wheel error.', 'error');
      });
      wheel = next;
      return next;
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Could not initialize the wheel.',
        'error',
      );
      return null;
    }
  }

  async function toggleWheelConnection(): Promise<void> {
    if (connectingWheel) return;

    if (wheel?.isConnected) {
      stopWheelForce();
      try {
        await wheel.disconnect();
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : 'Could not disconnect the wheel.',
          'error',
        );
      } finally {
        wheelCenterOffset = 0;
        resetWheelForceState();
        updateWheelUi();
      }
      return;
    }

    const instance = ensureWheel();
    if (!instance) return;

    connectingWheel = true;
    updateWheelUi();
    try {
      const device = await instance.connect();
      if (!device) setStatus('No wheel selected.');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Could not connect the wheel.',
        'error',
      );
    } finally {
      connectingWheel = false;
      updateWheelUi();
    }
  }

  function bindHoldForce(button: HTMLButtonElement, value: number): void {
    const start = (event: Event): void => {
      event.preventDefault();
      setWheelTestForce(value);
    };
    const stop = (): void => {
      stopWheelForce();
      if (!trackingArmed) setStatus('Test force stopped.');
    };

    button.addEventListener('pointerdown', start);
    button.addEventListener('pointerup', stop);
    button.addEventListener('pointerleave', stop);
    button.addEventListener('pointercancel', stop);
    button.addEventListener('keydown', (event) => {
      if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) start(event);
    });
    button.addEventListener('keyup', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        stop();
      }
    });
    button.addEventListener('blur', stop);
  }

  function saveSettings(): void {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ version: SETTINGS_VERSION, offsetMs, leadMs, wheelStrength, wheelInvert }),
      );
    } catch {
      // localStorage may be unavailable.
    }
  }

  function loadSettings(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        version?: number;
        offsetMs?: number;
        leadMs?: number;
        wheelStrength?: number;
        wheelInvert?: boolean;
      };
      offsetMs = clamp(Number(parsed.offsetMs) || 0, -2000, 2000);
      leadMs = clamp(Number(parsed.leadMs) || 0, -200, 400);
      wheelStrength = clamp(
        Number.isFinite(Number(parsed.wheelStrength))
          ? Number(parsed.wheelStrength)
          : DEFAULT_WHEEL_STRENGTH,
        0,
        MAX_WHEEL_STRENGTH,
      );
      if (parsed.version !== SETTINGS_VERSION && Math.abs(wheelStrength - 0.1) < 0.001) {
        wheelStrength = DEFAULT_WHEEL_STRENGTH;
      }
      wheelInvert = Boolean(parsed.wheelInvert);
    } catch {
      offsetMs = 0;
      leadMs = 0;
      wheelStrength = DEFAULT_WHEEL_STRENGTH;
      wheelInvert = false;
    }
  }

  function stateAtPlayhead(): SampledState | null {
    if (!track) return null;
    const mediaTime = clock?.time() ?? 0;
    return track.sampleAt(mediaTime + (offsetMs + leadMs) / 1000);
  }

  function renderHud(sample: SampledState | null): void {
    const range = track?.steeringRangeDeg ?? 900;
    const steer = sample?.steer ?? 0;
    const clampedSteer = clamp(steer, -range / 2, range / 2);
    const fraction = range > 0 ? clampedSteer / (range / 2) : 0;

    wheelRim.setAttribute('transform', `rotate(${clampedSteer.toFixed(2)} 100 100)`);
    steerAngle.textContent = `${Math.round(clampedSteer)}°`;
    steerMarker.style.left = `${50 + clamp(fraction, -1, 1) * 50}%`;

    hudSpeed.textContent = String(Math.round(sample?.speed ?? 0));
    hudGear.textContent = sample?.gear === undefined ? '—' : String(sample.gear);
    hudRpm.textContent = String(Math.round(sample?.rpm ?? 0));

    const throttle = clamp(sample?.throttle ?? 0, 0, 1);
    const brake = clamp(sample?.brake ?? 0, 0, 1);
    throttleBar.style.width = `${throttle * 100}%`;
    brakeBar.style.width = `${brake * 100}%`;
    throttleValue.textContent = `${Math.round(throttle * 100)}%`;
    brakeValue.textContent = `${Math.round(brake * 100)}%`;

    readTime.textContent = sample ? `${sample.t.toFixed(2)} s` : '—';
    readSteer.textContent = sample ? `${Math.round(steer)}°` : '—';
    readThrottle.textContent = sample ? `${Math.round(throttle * 100)}%` : '—';
    readBrake.textContent = sample ? `${Math.round(brake * 100)}%` : '—';
    readSpeed.textContent = sample ? `${Math.round(sample.speed ?? 0)} km/h` : '—';
    readGear.textContent = sample?.gear === undefined ? '—' : String(sample.gear);
    readRpm.textContent = sample ? `${Math.round(sample.rpm ?? 0)}` : '—';
    readState.textContent = sample ? (sample.stale ? 'stale' : sample.gap ? 'gap' : 'ok') : '—';
  }

  function updateTransport(): void {
    const duration = clock?.duration() ?? 0;
    const time = clock?.time() ?? 0;

    if (Math.abs(duration - lastDuration) > 0.01) {
      lastDuration = duration;
      timeline.max = String(Math.max(duration, 0.01));
    }

    if (!scrubbing && (lastTimelineValue < 0 || Math.abs(time - lastTimelineValue) > 0.01)) {
      lastTimelineValue = time;
      timeline.value = String(clamp(time, 0, Math.max(duration, 0.01)));
    }

    timeReadout.textContent = `${formatDuration(time)} / ${formatDuration(duration)}`;
    playButton.textContent = clock?.playing() ? 'Pause' : 'Play';
  }

  function bindClock(next: MediaClock): void {
    next.on('play', updateTransport);
    next.on('pause', updateTransport);
    next.on('playing', updateTransport);
    next.on('ended', updateTransport);
    next.on('durationchange', updateTransport);
    next.on('loadedmetadata', updateTransport);
    next.on('ratechange', updateTransport);
    next.on('pause', stopTrackingForce);
    next.on('seeking', stopTrackingForce);
    next.on('waiting', stopTrackingForce);
    next.on('ended', stopTrackingForce);
    next.on('error', () => {
      stopTrackingForce();
      setStatus('The video reported an error.', 'error');
    });
    updateTransport();
    updateWheelUi();
  }

  function clearClock(): void {
    loadToken += 1;
    trackingArmed = false;
    wheelArm.checked = false;
    stopTrackingForce();
    if (clock) {
      clock.destroy();
      clock = null;
    }
    videoHost.replaceChildren();
    showVideoEmpty('video');
    lastDuration = 0;
    lastTimelineValue = -1;
    updateWheelUi();
  }

  function loadVideoElement(source: string, label: string): void {
    clearClock();
    const video = document.createElement('video');
    video.className = 'video-el';
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = source;
    videoHost.append(video);
    videoEmpty.hidden = true;

    clock = new HtmlVideoClock(video);
    bindClock(clock);
    setStatus(`${label} loaded.`);
    video.load();
  }

  function loadLocalFile(file: File): void {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    loadVideoElement(objectUrl, file.name);
  }

  function loadDirectUrl(): void {
    const value = videoUrl.value.trim();
    if (!value) {
      setStatus('Paste a direct video URL first.', 'error');
      return;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    loadVideoElement(value, 'Direct video');
  }

  async function loadYouTubeVideo(): Promise<void> {
    const id = parseYouTubeId(youtubeUrl.value);
    if (!id) {
      setStatus('That does not look like a YouTube video URL.', 'error');
      return;
    }

    clearClock();
    const token = ++loadToken;
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    videoEmpty.hidden = true;
    setStatus('Loading YouTube player...');

    try {
      const next = await YouTubeClock.create(videoHost, id);
      if (token !== loadToken) {
        next.destroy();
        return;
      }
      clock = next;
      bindClock(next);
      setStatus('YouTube loaded. Timing is best-effort; use offset/lead.');
    } catch (error) {
      if (token !== loadToken) return;
      videoHost.replaceChildren();
      showVideoEmpty('video');
      setStatus(error instanceof Error ? error.message : 'Could not load YouTube.', 'error');
    }
  }

  function loadTelemetryDocument(document: TelemetryDocument): void {
    trackingArmed = false;
    wheelArm.checked = false;
    stopTrackingForce();
    if (clock?.kind === 'synthetic') {
      clock.destroy();
      clock = null;
      showVideoEmpty('video');
    }
    try {
      track = parseTelemetry(document);
      const meta = track.meta;
      const title = [meta.game, meta.car, meta.track].filter(Boolean).join(' · ') || meta.source || 'Telemetry';
      telemetryInfo.textContent = `${title} · ${track.sampleCount} samples · ${formatDuration(track.duration)} · ${track.steeringRangeDeg}° range`;
      if (!clock) {
        clock = new SyntheticClock(track.duration);
        bindClock(clock);
        showVideoEmpty('telemetry');
      }
      setStatus('Telemetry loaded.', 'ok');
      renderHud(stateAtPlayhead());
    } catch (error) {
      track = null;
      telemetryInfo.textContent = error instanceof Error ? error.message : 'Invalid telemetry.';
      setStatus('Telemetry could not be loaded.', 'error');
      renderHud(null);
    }
    updateWheelUi();
  }

  async function loadTelemetryFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      loadTelemetryDocument(parsed as TelemetryDocument);
    } catch (error) {
      track = null;
      telemetryInfo.textContent = error instanceof Error ? error.message : 'Could not read telemetry.';
      setStatus('Telemetry could not be loaded.', 'error');
      renderHud(null);
      updateWheelUi();
    }
  }

  function loadSampleTelemetry(): void {
    loadTelemetryDocument(buildSyntheticTelemetry(120, 60));
  }

  async function togglePlay(): Promise<void> {
    if (!clock) {
      if (!track) {
        setStatus('Load a video or telemetry first.', 'error');
        return;
      }
      clock = new SyntheticClock(track.duration);
      bindClock(clock);
      showVideoEmpty('telemetry');
      setStatus('Telemetry-only playback. Load a video for visual sync.');
    }
    if (clock.playing()) {
      clock.pause();
      return;
    }
    try {
      await clock.play();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not play the video.', 'error');
    }
  }

  function seekClock(seconds: number): void {
    if (trackingArmed) setTrackingArmed(false, 'Tracking disarmed on seek.');
    if (clock) void clock.seek(seconds);
  }

  function nudgeOffset(delta: number): void {
    offsetMs = clamp(offsetMs + delta, -2000, 2000);
    updateSyncLabels();
    saveSettings();
    renderHud(stateAtPlayhead());
  }

  function selectSource(source: string): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-source]')) {
      button.classList.toggle('active', button.dataset.source === source);
    }
    for (const panel of document.querySelectorAll<HTMLElement>('.source-panel')) {
      panel.hidden = panel.id !== `source-${source}`;
    }
  }

  loadSettings();
  updateSyncLabels();
  wheelStrengthInput.value = String(Math.round(wheelStrength * 100));
  wheelStrengthValue.textContent = `${Math.round(wheelStrength * 100)}%`;
  wheelInvertInput.checked = wheelInvert;
  updateWheelUi();

  videoFile.addEventListener('change', () => {
    const file = videoFile.files?.[0];
    if (file) loadLocalFile(file);
  });

  loadUrl.addEventListener('click', loadDirectUrl);
  videoUrl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadDirectUrl();
  });

  loadYouTube.addEventListener('click', () => void loadYouTubeVideo());
  youtubeUrl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void loadYouTubeVideo();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-source]')) {
    button.addEventListener('click', () => selectSource(button.dataset.source ?? 'local'));
  }

  telemetryFile.addEventListener('change', () => {
    const file = telemetryFile.files?.[0];
    if (file) void loadTelemetryFile(file);
  });

  loadSample.addEventListener('click', loadSampleTelemetry);
  playButton.addEventListener('click', () => void togglePlay());

  wheelConnect.addEventListener('click', () => void toggleWheelConnection());

  wheelStrengthInput.addEventListener('input', () => {
    wheelStrength = clamp(Number(wheelStrengthInput.value) / 100, 0, MAX_WHEEL_STRENGTH);
    wheelStrengthValue.textContent = `${Math.round(wheelStrength * 100)}%`;
    if (wheel) wheel.ffbStrength = wheelStrength;
    saveSettings();
  });

  wheelInvertInput.addEventListener('change', () => {
    wheelInvert = wheelInvertInput.checked;
    if (wheel) wheel.ffbInvert = wheelInvert;
    saveSettings();
  });

  wheelArm.addEventListener('change', () => setTrackingArmed(wheelArm.checked));

  wheelCenter.addEventListener('click', () => {
    const rotation = wheel?.state.rotation;
    if (!wheel?.isConnected || typeof rotation !== 'number' || !Number.isFinite(rotation)) {
      setStatus('No wheel position available to center.', 'error');
      return;
    }
    wheelCenterOffset = rotation;
    updateWheelInput(wheel.state);
    setStatus('Wheel center set.', 'ok');
  });

  bindHoldForce(wheelTestLeft, -1);
  bindHoldForce(wheelTestRight, 1);
  wheelStop.addEventListener('click', stopWheelForce);

  const hid = (navigator as Navigator & { hid?: EventTarget }).hid;
  hid?.addEventListener('disconnect', () => {
    if (wheel && !wheel.isConnected) {
      wheelCenterOffset = 0;
      resetWheelForceState();
      updateWheelUi();
      setStatus('Wheel disconnected.');
    }
  });

  const safetyStopWheel = (reason: string): void => {
    if (trackingArmed) setTrackingArmed(false, reason);
    else stopWheelForce();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) safetyStopWheel('Tracking disarmed: tab hidden.');
  });
  window.addEventListener('blur', () => safetyStopWheel('Tracking disarmed: window lost focus.'));

  timeline.addEventListener('pointerdown', () => {
    scrubbing = true;
  });
  window.addEventListener('pointerup', () => {
    scrubbing = false;
  });
  timeline.addEventListener('input', () => {
    seekClock(Number(timeline.value));
  });

  offsetInput.addEventListener('input', () => {
    offsetMs = clamp(Number(offsetInput.value), -2000, 2000);
    updateSyncLabels();
    saveSettings();
    renderHud(stateAtPlayhead());
  });

  leadInput.addEventListener('input', () => {
    leadMs = clamp(Number(leadInput.value), -200, 400);
    updateSyncLabels();
    saveSettings();
    renderHud(stateAtPlayhead());
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-nudge]')) {
    button.addEventListener('click', () => nudgeOffset(Number(button.dataset.nudge) || 0));
  }

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      void togglePlay();
    } else if (event.key === 'ArrowLeft' && clock) {
      event.preventDefault();
      seekClock(clock.time() - 5);
    } else if (event.key === 'ArrowRight' && clock) {
      event.preventDefault();
      seekClock(clock.time() + 5);
    } else if (event.key === '[') {
      nudgeOffset(-10);
    } else if (event.key === ']') {
      nudgeOffset(10);
    }
  });

  window.addEventListener('beforeunload', () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    stopWheelForce();
    void wheel?.disconnect();
    clock?.destroy();
  });

  const tick = (now: number): void => {
    updateWheelTracking(now);
    renderHud(stateAtPlayhead());
    updateTransport();
    requestAnimationFrame(tick);
  };

  loadSampleTelemetry();
  setStatus('Synthetic telemetry loaded. Connect a wheel and arm tracking, or load a video.');
  requestAnimationFrame(tick);
}
