import './styles.css';
import { DRIVE_MODES } from './modes';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app element');
}

const modeCards = DRIVE_MODES.map(
  (mode) => `
    <article class="mode-card">
      <div class="mode-head">
        <h3>${mode.name}</h3>
        <span class="tag ${mode.handsOff ? 'tag-danger' : mode.usesFfb ? 'tag-ffb' : 'tag-muted'}">
          ${mode.handsOff ? 'hands-off' : mode.usesFfb ? 'ffb' : 'no ffb'}
        </span>
      </div>
      <p class="tagline">${mode.tagline}</p>
      <p>${mode.description}</p>
    </article>
  `,
).join('');

app.innerHTML = `
  <main>
    <header class="hero">
      <p class="eyebrow">experimental prototype · v0.0.1</p>
      <h1>Ghost Driver</h1>
      <p class="lede">Watch the lap. Feel the drive.</p>
      <p class="experiment-note">Experimental build: formats, controls and hardware support may change.</p>
      <p class="intro">
        A pure-browser replay experience for racing and driving footage. Load a video and a telemetry file,
        connect a force-feedback wheel, and let an invisible driver move the wheel through the lap or run.
      </p>
      <div class="actions">
        <a class="button" href="./play.html">Open playback</a>
        <a class="button ghost" href="./SPEC.md">Read the spec</a>
        <a class="button ghost" href="./docs/roadmap.md">Roadmap</a>
      </div>
    </header>

    <section>
      <h2>Modes</h2>
      <div class="mode-grid">${modeCards}</div>
    </section>

    <section class="two-col">
      <div>
        <h2>v1 scope</h2>
        <ul class="checklist">
          <li>Static browser app — no backend, no live telemetry bridge.</li>
          <li>Local video, direct MP4/WebM URL, and YouTube.</li>
          <li>Canonical JSON and CSV telemetry with column mapping.</li>
          <li>Capability-based wheel support via our own WebHID library.</li>
          <li>Manual sync offset, nudge, and separate FFB lead.</li>
          <li>Explicit arming, low default force, watchdogs, and automatic stop.</li>
        </ul>
      </div>
      <div class="safety">
        <h2>Safety first</h2>
        <p>
          Ghost Wheel mode is hands-off. The wheel can move forcefully and unexpectedly.
          Keep hands clear, use low strength, and keep a physical power switch or e-stop within reach.
        </p>
        <a class="text-link" href="./docs/safety.md">Read the safety requirements →</a>
      </div>
    </section>

    <section>
      <h2>Design docs</h2>
      <div class="doc-grid">
        <a class="doc" href="./SPEC.md"><strong>SPEC.md</strong><span>Product and technical contract</span></a>
        <a class="doc" href="./docs/telemetry-format.md"><strong>Telemetry format</strong><span>Canonical JSON and CSV import</span></a>
        <a class="doc" href="./docs/wheel-support.md"><strong>Wheel support</strong><span>Capability model and adapters</span></a>
        <a class="doc" href="./docs/safety.md"><strong>Safety</strong><span>Hazards, limits, and stop conditions</span></a>
      </div>
    </section>

    <footer>
      <span>Ghost Driver</span>
      <span class="dot">·</span>
      <span>Pure browser · WebHID · telemetry files</span>
      <span class="dot">·</span>
      <span>License TBD</span>
    </footer>
  </main>
`;
