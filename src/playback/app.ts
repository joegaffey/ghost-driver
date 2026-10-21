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
import { drawInputGraph } from './input-graph';
import {
  TRACKING_INTERVAL_MS,
  TRACKING_RESEND_MS,
  trackingForce,
} from './tracking';
import {
  createSession,
  exportableVideos,
  parseSessionFile,
  serializeSession,
  sessionSlug,
  videoTimeFromTelemetry,
  type GhostDriverSession,
  type SessionVideo,
} from './session';

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

const SETTINGS_KEY = 'ghost-driver.playback.settings';
const SETTINGS_VERSION = 2;
const DEFAULT_WHEEL_STRENGTH = 0.25;
const MAX_WHEEL_STRENGTH = 0.5;
const FULLSCREEN_IDLE_MS = 2500;

export function initPlaybackApp(
  root: HTMLElement,
  mode: 'player' | 'editor' = 'editor',
): void {
  const isEditor = mode === 'editor';
  root.innerHTML = `
    <div class="play-shell">
      <header class="play-header">
        <a class="brand" href="./">Ghost Driver</a>
        <span class="play-badge">experimental · ${isEditor ? 'editor' : 'player'}</span>
        <span id="status" class="status">${isEditor ? 'Load a video and telemetry to begin.' : 'Open a session to begin.'}</span>
        <a class="header-link" href="${isEditor ? './play.html' : './edit.html'}">${isEditor ? 'Player' : 'Editor'}</a>
      </header>

      <main class="play-main">
        <section class="stage">
          <div id="player" class="player">
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

              <div class="hud-graph">
                <canvas id="inputGraph" role="img" aria-label="Rolling driver inputs: steering, throttle and brake"></canvas>
              </div>

              <div class="hud-bottom">
                <div class="hud-row">
                  <div class="hud-stat"><span>Speed</span><strong id="hudSpeed">0</strong><em>km/h</em></div>
                  <div class="hud-stat"><span>Gear</span><strong id="hudGear">—</strong></div>
                  <div class="hud-stat"><span>RPM</span><strong id="hudRpm">0</strong></div>
                </div>
                <div class="steer-row">
                  <span>Steering</span>
                  <div class="steer-track">
                    <span class="steer-center"></span>
                    <span id="steerMarker" class="steer-marker"></span>
                    <span id="wheelMarker" class="steer-marker wheel-marker" hidden></span>
                  </div>
                  <em id="hudSteer">0°</em>
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
            <select id="cameraSelect" class="camera-select" aria-label="Camera" hidden></select>
            <button id="hudToggle" type="button" class="transport-button active" aria-pressed="true" title="Hide HUD">HUD</button>
            <button id="fullscreen" type="button" class="transport-button" title="Maximize video">Maximize</button>
          </div>
          </div>

          <div class="stage-panels"${isEditor ? '' : ' hidden'}>
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
          </div>
        </section>

        <aside class="side">
          <section class="panel"${isEditor ? '' : ' hidden'}>
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

          <section class="panel"${isEditor ? '' : ' hidden'}>
            <h2>Telemetry</h2>
            <label class="file-label">
              Load canonical JSON
              <input id="telemetryFile" type="file" accept=".json,application/json" />
            </label>
            <button id="loadSample" type="button">Use synthetic sample</button>
            <p id="telemetryInfo" class="hint">No telemetry loaded.</p>
          </section>

          <section class="panel">
            <h2>Session</h2>
            <label class="file-label">
              ${isEditor ? 'Import session' : 'Open session'}
              <input id="sessionFile" type="file" accept=".json,.ghost.json,application/json" />
            </label>
            <div id="sessionEditorFields"${isEditor ? '' : ' hidden'}>
              <input id="sessionTitle" type="text" placeholder="Session title" />
              <button id="exportSession" type="button">Export session</button>
            </div>
            <p id="sessionInfo" class="hint">No session loaded.</p>
            <p id="sessionWarning" class="hint warn"></p>
            <div id="cameraList" class="camera-list"${isEditor ? '' : ' hidden'}></div>
            <a class="text-link" href="${isEditor ? './play.html' : './edit.html'}">${isEditor ? 'Open player' : 'Open editor'}</a>
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
              <dt>Target</dt><dd id="wheelTarget">—</dd>
              <dt>Error</dt><dd id="wheelError">—</dd>
              <dt>Command</dt><dd id="wheelCommand">—</dd>
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



        </aside>
      </main>
    </div>
  `;

  const videoHost = el<HTMLDivElement>('#videoHost');
  const videoEmpty = el<HTMLDivElement>('#videoEmpty');
  const statusEl = el<HTMLSpanElement>('#status');
  const player = el<HTMLDivElement>('#player');
  const playButton = el<HTMLButtonElement>('#playPause');
  const fullscreenButton = el<HTMLButtonElement>('#fullscreen');
  const hudToggle = el<HTMLButtonElement>('#hudToggle');
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
  const cameraSelect = el<HTMLSelectElement>('#cameraSelect');
  const sessionFile = el<HTMLInputElement>('#sessionFile');
  const sessionTitleInput = el<HTMLInputElement>('#sessionTitle');
  const exportSessionButton = el<HTMLButtonElement>('#exportSession');
  const sessionInfo = el<HTMLParagraphElement>('#sessionInfo');
  const sessionWarning = el<HTMLParagraphElement>('#sessionWarning');
  const cameraList = el<HTMLDivElement>('#cameraList');
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
  const wheelTarget = el<HTMLElement>('#wheelTarget');
  const wheelError = el<HTMLElement>('#wheelError');
  const wheelCommand = el<HTMLElement>('#wheelCommand');
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
  const hudSteer = el<HTMLElement>('#hudSteer');
  const inputGraph = el<HTMLCanvasElement>('#inputGraph');
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
  let telemetryDocument: TelemetryDocument | null = null;
  let session: GhostDriverSession | null = null;
  let activeVideoId: string | null = null;
  const localVideoUrls = new Map<string, string>();
  let offsetMs = 0;
  let leadMs = 0;
  let loadToken = 0;
  let scrubbing = false;
  let lastDuration = 0;
  let lastTimelineValue = -1;
  let wheel: WebHIDWheel | null = null;
  let hudVisible = true;
  let wheelStrength = DEFAULT_WHEEL_STRENGTH;
  let wheelInvert = false;
  let connectingWheel = false;
  let controlsTimer = 0;
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

  function activeSessionVideo(): SessionVideo | null {
    if (!session || !activeVideoId) return null;
    return session.videos.find((video) => video.id === activeVideoId) ?? null;
  }

  function videoSourceLabel(video: SessionVideo): string {
    if (video.source.type === 'youtube') return 'YouTube';
    if (video.source.type === 'url') return 'Direct URL';
    return 'Local file';
  }

  function updateSessionUi(): void {
    const videos = session?.videos ?? [];

    cameraSelect.innerHTML = videos
      .map(
        (video) =>
          `<option value="${escapeHtml(video.id)}"${video.id === activeVideoId ? ' selected' : ''}>${escapeHtml(video.label)}</option>`,
      )
      .join('');
    cameraSelect.hidden = videos.length === 0;

    sessionInfo.textContent = session
      ? `${session.meta.title ?? 'Ghost Driver session'} · ${videos.length} camera${videos.length === 1 ? '' : 's'}${track ? ` · ${formatDuration(track.duration)}` : ''}`
      : isEditor
        ? 'No session loaded. Use synthetic telemetry or import a session.'
        : 'Open a session to begin.';

    const localCount = videos.filter((video) => video.source.type === 'local').length;
    sessionWarning.textContent =
      localCount > 0
        ? `${localCount} local camera${localCount === 1 ? ' is' : 's are'} preview-only and will not be included in the exported session until ZIP support lands.`
        : '';

    if (document.activeElement !== sessionTitleInput) {
      sessionTitleInput.value = session?.meta.title ?? '';
    }

    cameraList.innerHTML = videos.length
      ? videos
          .map(
            (video) => `<div class="camera-item${video.id === activeVideoId ? ' active' : ''}" data-camera-id="${escapeHtml(video.id)}">
              <button type="button" class="camera-pick" data-camera-action="select">
                <span>${escapeHtml(video.label)}</span>
                <em>${videoSourceLabel(video)}</em>
              </button>
              <span class="camera-offset">${video.offsetMs} ms</span>
              <button type="button" class="camera-remove" data-camera-action="remove">Remove</button>
            </div>`,
          )
          .join('')
      : '<p class="hint">No cameras yet. Load a video to add one.</p>';
  }

  function updateActiveVideoOffset(): void {
    const video = activeSessionVideo();
    if (!video) return;
    video.offsetMs = offsetMs;
    updateSessionUi();
  }

  function applyHudVisibility(): void {
    const hud = document.querySelector<HTMLElement>('.hud');
    if (hud) hud.hidden = !hudVisible;
    hudToggle.classList.toggle('active', hudVisible);
    hudToggle.setAttribute('aria-pressed', String(hudVisible));
    hudToggle.title = hudVisible ? 'Hide HUD' : 'Show HUD';
  }

  function showVideoEmpty(mode: 'video' | 'telemetry'): void {
    videoEmpty.innerHTML =
      mode === 'telemetry'
        ? '<strong>Telemetry only</strong><span>No video loaded. Press Play for telemetry-only, or load a video from the panel.</span>'
        : isEditor
          ? '<strong>Load a video</strong><span>Local file, direct URL, or YouTube. The telemetry overlay works without a wheel.</span>'
          : '<strong>Open a session</strong><span>Load a Ghost Driver session to play. Use the editor to create one.</span>';
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

    if (!trackingArmed) {
      wheelTarget.textContent = '—';
      wheelError.textContent = '—';
      wheelCommand.textContent = '—';
    }

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
      wheelTarget.textContent = '—';
      wheelError.textContent = '—';
      wheelCommand.textContent = '—';
      return;
    }

    const range = wheel.maxRotation;
    const target = clamp(sample.steer, -range / 2, range / 2);
    const error = target - actual;

    if (dt > 0 && lastActualAngle !== undefined) {
      const rawRate = (actual - lastActualAngle) / dt;
      actualRate = actualRate * 0.75 + rawRate * 0.25;
    }
    lastActualAngle = actual;

    const command = trackingForce(target, actual, actualRate);

    wheelTarget.textContent = `${Math.round(target)}°`;
    wheelError.textContent = `${Math.round(error)}°`;
    wheelCommand.textContent = command.toFixed(2);

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
        JSON.stringify({
          version: SETTINGS_VERSION,
          offsetMs,
          leadMs,
          wheelStrength,
          wheelInvert,
          hudVisible,
        }),
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
        hudVisible?: boolean;
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
      hudVisible = parsed.hudVisible !== false;
    } catch {
      offsetMs = 0;
      leadMs = 0;
      wheelStrength = DEFAULT_WHEEL_STRENGTH;
      wheelInvert = false;
      hudVisible = true;
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
    hudSteer.textContent = `${Math.round(steer)}°`;
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

  function newVideoId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `camera-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function revokeLocalVideos(): void {
    for (const url of localVideoUrls.values()) URL.revokeObjectURL(url);
    localVideoUrls.clear();
  }

  function sameSource(
    left: SessionVideo['source'],
    right: SessionVideo['source'],
  ): boolean {
    if (left.type !== right.type) return false;
    if (left.type === 'youtube' && right.type === 'youtube') return left.videoId === right.videoId;
    if (left.type === 'url' && right.type === 'url') return left.url === right.url;
    if (left.type === 'local' && right.type === 'local') return left.name === right.name;
    return false;
  }

  function addSessionVideo(video: SessionVideo): void {
    if (!session) {
      if (!telemetryDocument) {
        setStatus('Load telemetry before adding a camera.', 'error');
        return;
      }
      session = createSession(telemetryDocument, [], leadMs);
    }

    const existing = session.videos.find((candidate) => sameSource(candidate.source, video.source));
    if (existing) {
      void switchCamera(existing.id);
      updateSessionUi();
      return;
    }

    session.videos.push(video);
    if (!session.defaultVideoId) session.defaultVideoId = video.id;
    updateSessionUi();
    void activateVideo(video);
  }

  function addLocalVideo(file: File): void {
    const id = newVideoId();
    const objectUrl = URL.createObjectURL(file);
    localVideoUrls.set(id, objectUrl);
    addSessionVideo({
      id,
      label: file.name.replace(/\.[^.]+$/, '') || 'Local camera',
      source: { type: 'local', name: file.name },
      offsetMs: 0,
    });
  }

  function addYouTubeById(videoId: string): void {
    addSessionVideo({
      id: newVideoId(),
      label: `YouTube ${videoId}`,
      source: { type: 'youtube', videoId },
      offsetMs: 0,
    });
  }

  function addDirectUrl(): void {
    const value = videoUrl.value.trim();
    if (!value) {
      setStatus('Paste a direct video URL first.', 'error');
      return;
    }

    const youtubeId = parseYouTubeId(value);
    if (youtubeId) {
      addYouTubeById(youtubeId);
      return;
    }

    let label = 'Direct video';
    try {
      const path = new URL(value).pathname.split('/').filter(Boolean).pop();
      if (path) label = decodeURIComponent(path).replace(/\.[^.]+$/, '');
    } catch {
      // Keep the fallback label.
    }

    addSessionVideo({
      id: newVideoId(),
      label,
      source: { type: 'url', url: value },
      offsetMs: 0,
    });
  }

  async function addYouTubeVideo(): Promise<void> {
    const id = parseYouTubeId(youtubeUrl.value);
    if (!id) {
      setStatus('That does not look like a YouTube video URL.', 'error');
      return;
    }
    addYouTubeById(id);
  }

  function createHtmlVideoClock(source: string): Promise<HtmlVideoClock> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.className = 'video-el';
      video.playsInline = true;
      video.preload = 'auto';
      video.src = source;

      let settled = false;
      const cleanup = (): void => {
        window.clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };
      const onLoaded = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(new HtmlVideoClock(video));
      };
      const onError = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Could not load the video.'));
      };
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Timed out while loading the video.'));
      }, 15000);

      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
      videoHost.append(video);
      video.load();
    });
  }

  async function activateVideo(
    video: SessionVideo,
    options: { startTime?: number; autoplay?: boolean } = {},
  ): Promise<boolean> {
    const token = ++loadToken;
    const previous = clock;
    clock = null;
    stopWheelForce();
    previous?.destroy();
    videoHost.replaceChildren();
    videoEmpty.hidden = true;
    setStatus(`Loading ${video.label}...`);

    let next: MediaClock;
    try {
      if (video.source.type === 'youtube') {
        next = await YouTubeClock.create(videoHost, video.source.videoId);
      } else if (video.source.type === 'url') {
        next = await createHtmlVideoClock(video.source.url);
      } else {
        const objectUrl = localVideoUrls.get(video.id);
        if (!objectUrl) throw new Error('This local camera is not available in this session.');
        next = await createHtmlVideoClock(objectUrl);
      }
    } catch (error) {
      if (token !== loadToken) return false;
      videoHost.replaceChildren();
      showVideoEmpty('video');
      updateSessionUi();
      updateTransport();
      setStatus(error instanceof Error ? error.message : 'Could not load the camera.', 'error');
      return false;
    }

    if (token !== loadToken) {
      next.destroy();
      return false;
    }

    clock = next;
    activeVideoId = video.id;
    offsetMs = clamp(video.offsetMs, -2000, 2000);
    bindClock(next);
    updateSyncLabels();
    updateSessionUi();

    try {
      if (options.startTime !== undefined) {
        const duration = next.duration();
        const target =
          duration > 0
            ? clamp(options.startTime, 0, duration)
            : Math.max(0, options.startTime);
        await next.seek(target);
      }
      if (options.autoplay) {
        await next.play();
      }
      setStatus(`Camera: ${video.label}.`, 'ok');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Camera loaded. Press Play.',
        'info',
      );
    }

    renderHud(stateAtPlayhead());
    updateTransport();
    updateWheelUi();
    return true;
  }

  async function switchCamera(id: string): Promise<void> {
    if (!session || id === activeVideoId) return;
    const video = session.videos.find((candidate) => candidate.id === id);
    if (!video) return;

    const wasPlaying = clock?.playing() ?? false;
    const telemetryTime = clock ? clock.time() + offsetMs / 1000 : 0;
    const startTime = videoTimeFromTelemetry(telemetryTime, video.offsetMs);
    await activateVideo(video, { startTime, autoplay: wasPlaying });
  }

  function removeVideo(id: string): void {
    if (!session) return;
    const index = session.videos.findIndex((video) => video.id === id);
    if (index < 0) return;

    const [removed] = session.videos.splice(index, 1);
    const wasActive = activeVideoId === id;
    if (session.defaultVideoId === id) {
      session.defaultVideoId = session.videos[0]?.id;
    }

    if (wasActive) {
      activeVideoId = null;
      const next = session.videos[0];
      if (next) {
        void switchCamera(next.id);
      } else {
        clearClock();
        if (track) {
          clock = new SyntheticClock(track.duration);
          bindClock(clock);
          showVideoEmpty('telemetry');
        }
        updateSessionUi();
      }
    }

    const objectUrl = localVideoUrls.get(id);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      localVideoUrls.delete(id);
    }
    if (removed.source.type === 'local') updateSessionUi();
    updateSessionUi();
  }

  async function loadSessionFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const result = parseSessionFile(text);
      clearClock();
      revokeLocalVideos();
      session = null;
      activeVideoId = null;

      if (result.kind === 'telemetry') {
        if (!loadTelemetryDocument(result.document)) return;
        session = createSession(result.document, [], leadMs);
        updateSessionUi();
        setStatus('Telemetry loaded. Add video sources or import a session.', 'ok');
        return;
      }

      const loaded = result.session;
      session = loaded;
      leadMs = loaded.ffbLeadMs;
      updateSyncLabels();
      sessionTitleInput.value = loaded.meta.title ?? '';

      if (!loadTelemetryDocument(loaded.telemetry, { createClock: false })) {
        session = null;
        updateSessionUi();
        return;
      }

      updateSessionUi();
      const preferred =
        loaded.videos.find((video) => video.id === loaded.defaultVideoId) ??
        loaded.videos[0];
      const playable =
        preferred && preferred.source.type !== 'local'
          ? preferred
          : loaded.videos.find((video) => video.source.type !== 'local');

      if (playable) {
        const activated = await activateVideo(playable);
        if (!activated) return;
      } else if (track) {
        clock = new SyntheticClock(track.duration);
        bindClock(clock);
        showVideoEmpty('telemetry');
      }

      setStatus(`Session loaded: ${loaded.meta.title ?? 'Untitled'}.`, 'ok');
    } catch (error) {
      clearClock();
      session = null;
      activeVideoId = null;
      updateSessionUi();
      setStatus(error instanceof Error ? error.message : 'Could not load the session.', 'error');
    }
  }

  function exportSessionFile(): void {
    if (!session || !telemetryDocument) {
      setStatus('Load telemetry before exporting a session.', 'error');
      return;
    }

    const currentSession = session;
    const title =
      sessionTitleInput.value.trim() ||
      currentSession.meta.title ||
      'Ghost Driver session';
    const videos = exportableVideos(currentSession);
    const defaultVideoId = videos.some((video) => video.id === currentSession.defaultVideoId)
      ? currentSession.defaultVideoId
      : videos[0]?.id;

    const payload: GhostDriverSession = {
      ...currentSession,
      meta: { ...currentSession.meta, title },
      telemetry: telemetryDocument,
      videos,
      defaultVideoId,
      ffbLeadMs: leadMs,
    };

    const blob = new Blob([serializeSession(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sessionSlug(title)}.ghost.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    if (videos.length < currentSession.videos.length) {
      setStatus('Session exported without local camera files. ZIP support comes later.', 'info');
    } else {
      setStatus('Session exported.', 'ok');
    }
  }

  function loadTelemetryDocument(
    document: TelemetryDocument,
    options: { createClock?: boolean } = {},
  ): boolean {
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
      telemetryDocument = document;
      const meta = track.meta;
      const title = [meta.game, meta.car, meta.track].filter(Boolean).join(' · ') || meta.source || 'Telemetry';
      telemetryInfo.textContent = `${title} · ${track.sampleCount} samples · ${formatDuration(track.duration)} · ${track.steeringRangeDeg}° range`;
      if (options.createClock !== false && !clock) {
        clock = new SyntheticClock(track.duration);
        bindClock(clock);
        showVideoEmpty('telemetry');
      }
      setStatus('Telemetry loaded.', 'ok');
      renderHud(stateAtPlayhead());
      updateWheelUi();
      return true;
    } catch (error) {
      track = null;
      telemetryDocument = null;
      telemetryInfo.textContent = error instanceof Error ? error.message : 'Invalid telemetry.';
      setStatus('Telemetry could not be loaded.', 'error');
      renderHud(null);
      updateWheelUi();
      return false;
    }
  }

  async function loadTelemetryFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as TelemetryDocument;
      if (!loadTelemetryDocument(parsed)) return;
      if (session) session.telemetry = parsed;
      else session = createSession(parsed, [], leadMs);
      updateSessionUi();
    } catch (error) {
      track = null;
      telemetryDocument = null;
      telemetryInfo.textContent = error instanceof Error ? error.message : 'Could not read telemetry.';
      setStatus('Telemetry could not be loaded.', 'error');
      renderHud(null);
      updateWheelUi();
      updateSessionUi();
    }
  }

  function loadSampleTelemetry(): void {
    const document = buildSyntheticTelemetry(120, 60);
    if (!loadTelemetryDocument(document)) return;
    if (session) session.telemetry = document;
    else session = createSession(document, [], leadMs);
    updateSessionUi();
  }

  function scheduleControlsHide(): void {
    window.clearTimeout(controlsTimer);
    controlsTimer = window.setTimeout(() => {
      if (document.fullscreenElement !== player) return;
      const transport = player.querySelector<HTMLElement>('.transport');
      const active = document.activeElement;
      const keyboardFocus =
        active instanceof HTMLElement && active.matches(':focus-visible');
      if (
        transport &&
        (transport.matches(':hover') ||
          (keyboardFocus && transport.contains(active)))
      ) {
        scheduleControlsHide();
        return;
      }
      player.classList.remove('controls-visible');
    }, FULLSCREEN_IDLE_MS);
  }

  function showFullscreenControls(): void {
    if (document.fullscreenElement !== player) return;
    player.classList.add('controls-visible');
    scheduleControlsHide();
  }

  function updateFullscreenUi(): void {
    const active = document.fullscreenElement === player;
    fullscreenButton.textContent = active ? 'Restore' : 'Maximize';
    fullscreenButton.title = active ? 'Exit fullscreen' : 'Maximize video';
    player.classList.toggle('is-fullscreen', active);
    if (active) {
      fullscreenButton.blur();
      showFullscreenControls();
    }
    else {
      window.clearTimeout(controlsTimer);
      player.classList.remove('controls-visible');
    }
  }

  async function toggleFullscreen(): Promise<void> {
    if (!document.fullscreenEnabled) {
      setStatus('Fullscreen is not available in this browser.', 'error');
      return;
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await player.requestFullscreen();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not toggle fullscreen.', 'error');
    }
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
    updateActiveVideoOffset();
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
  applyHudVisibility();
  updateWheelUi();
  updateSessionUi();
  updateFullscreenUi();
  if (!document.fullscreenEnabled) {
    fullscreenButton.disabled = true;
    fullscreenButton.title = 'Fullscreen is not available in this browser';
  }

  videoFile.addEventListener('change', () => {
    const file = videoFile.files?.[0];
    if (file) addLocalVideo(file);
  });

  loadUrl.addEventListener('click', addDirectUrl);
  videoUrl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addDirectUrl();
  });

  loadYouTube.addEventListener('click', () => void addYouTubeVideo());
  youtubeUrl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void addYouTubeVideo();
  });

  sessionFile.addEventListener('change', () => {
    const file = sessionFile.files?.[0];
    if (file) void loadSessionFile(file);
    sessionFile.value = '';
  });

  exportSessionButton.addEventListener('click', exportSessionFile);

  sessionTitleInput.addEventListener('input', () => {
    if (!session) return;
    session.meta.title = sessionTitleInput.value.trim() || session.meta.title;
  });

  cameraSelect.addEventListener('change', () => {
    void switchCamera(cameraSelect.value);
  });

  cameraList.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const item = target.closest<HTMLElement>('[data-camera-id]');
    if (!item) return;
    const id = item.dataset.cameraId;
    if (!id) return;
    if (target.closest('[data-camera-action="remove"]')) {
      removeVideo(id);
      return;
    }
    if (target.closest('[data-camera-action="select"]')) {
      void switchCamera(id);
    }
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
  fullscreenButton.addEventListener('click', () => void toggleFullscreen());
  hudToggle.addEventListener('click', () => {
    hudVisible = !hudVisible;
    applyHudVisibility();
    saveSettings();
  });
  document.addEventListener('fullscreenchange', updateFullscreenUi);
  player.addEventListener('pointermove', showFullscreenControls);
  player.addEventListener('pointerdown', showFullscreenControls);

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
    updateActiveVideoOffset();
    saveSettings();
    renderHud(stateAtPlayhead());
  });

  leadInput.addEventListener('input', () => {
    leadMs = clamp(Number(leadInput.value), -200, 400);
    if (session) session.ffbLeadMs = leadMs;
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

    showFullscreenControls();

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
    } else if (event.key.toLowerCase() === 'h') {
      event.preventDefault();
      hudVisible = !hudVisible;
      applyHudVisibility();
      saveSettings();
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      void toggleFullscreen();
    }
  });

  window.addEventListener('beforeunload', () => {
    revokeLocalVideos();
    stopWheelForce();
    void wheel?.disconnect();
    clock?.destroy();
  });

  const tick = (now: number): void => {
    updateWheelTracking(now);
    renderHud(stateAtPlayhead());
    if (hudVisible) {
      drawInputGraph(inputGraph, track, clock?.time() ?? 0, (offsetMs + leadMs) / 1000);
    }
    updateTransport();
    requestAnimationFrame(tick);
  };

  if (isEditor) {
    loadSampleTelemetry();
    setStatus('Synthetic telemetry loaded. Add cameras or import a session.');
  } else {
    showVideoEmpty('video');
    setStatus('Open a session to begin.');
  }
  requestAnimationFrame(tick);
}
