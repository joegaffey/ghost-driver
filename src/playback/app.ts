import {
  HtmlVideoClock,
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

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const SETTINGS_KEY = 'ghost-driver.playback.settings';

export function initPlaybackApp(root: HTMLElement): void {
  root.innerHTML = `
    <div class="play-shell">
      <header class="play-header">
        <a class="brand" href="./">Ghost Driver</a>
        <span class="play-badge">experimental · no FFB yet</span>
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

          <section class="panel muted">
            <h2>Force feedback</h2>
            <p>FFB is not connected yet. Playback, overlay and sync can be tested now; WebHID/FFBeast comes next.</p>
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
  const steerAngle = el<HTMLDivElement>('#steerAngle');
  const steerMarker = el<HTMLSpanElement>('#steerMarker');
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

  function saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ offsetMs, leadMs }));
    } catch {
      // localStorage may be unavailable.
    }
  }

  function loadSettings(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { offsetMs?: number; leadMs?: number };
      offsetMs = clamp(Number(parsed.offsetMs) || 0, -2000, 2000);
      leadMs = clamp(Number(parsed.leadMs) || 0, -200, 400);
    } catch {
      offsetMs = 0;
      leadMs = 0;
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
    next.on('error', () => setStatus('The video reported an error.', 'error'));
    updateTransport();
  }

  function clearClock(): void {
    loadToken += 1;
    if (clock) {
      clock.destroy();
      clock = null;
    }
    videoHost.replaceChildren();
    videoEmpty.hidden = false;
    lastDuration = 0;
    lastTimelineValue = -1;
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
      videoEmpty.hidden = false;
      setStatus(error instanceof Error ? error.message : 'Could not load YouTube.', 'error');
    }
  }

  function loadTelemetryDocument(document: TelemetryDocument): void {
    try {
      track = parseTelemetry(document);
      const meta = track.meta;
      const title = [meta.game, meta.car, meta.track].filter(Boolean).join(' · ') || meta.source || 'Telemetry';
      telemetryInfo.textContent = `${title} · ${track.sampleCount} samples · ${formatDuration(track.duration)} · ${track.steeringRangeDeg}° range`;
      setStatus('Telemetry loaded.', 'ok');
      renderHud(stateAtPlayhead());
    } catch (error) {
      track = null;
      telemetryInfo.textContent = error instanceof Error ? error.message : 'Invalid telemetry.';
      setStatus('Telemetry could not be loaded.', 'error');
      renderHud(null);
    }
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
    }
  }

  function loadSampleTelemetry(): void {
    loadTelemetryDocument(buildSyntheticTelemetry(120, 60));
  }

  async function togglePlay(): Promise<void> {
    if (!clock) {
      setStatus('Load a video first.', 'error');
      return;
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

  timeline.addEventListener('pointerdown', () => {
    scrubbing = true;
  });
  window.addEventListener('pointerup', () => {
    scrubbing = false;
  });
  timeline.addEventListener('input', () => {
    if (clock) void clock.seek(Number(timeline.value));
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
      void clock.seek(clock.time() - 5);
    } else if (event.key === 'ArrowRight' && clock) {
      event.preventDefault();
      void clock.seek(clock.time() + 5);
    } else if (event.key === '[') {
      nudgeOffset(-10);
    } else if (event.key === ']') {
      nudgeOffset(10);
    }
  });

  window.addEventListener('beforeunload', () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    clock?.destroy();
  });

  const tick = (): void => {
    renderHud(stateAtPlayhead());
    updateTransport();
    requestAnimationFrame(tick);
  };

  loadSampleTelemetry();
  setStatus('Synthetic telemetry loaded. Load a video to test playback.');
  requestAnimationFrame(tick);
}
