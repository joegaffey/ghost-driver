#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObsClient } from './lib/obs.mjs';
import { DEFAULT_SIMHUB_URL } from './lib/simhub.mjs';

const HELP = `
Capture a video and telemetry session with OBS + SimHub

Usage:
  node tools/obs-capture.mjs [options]

OBS:
  --obs-url <url>          OBS WebSocket URL (default: ws://127.0.0.1:4455)
  --obs-password <pass>    OBS WebSocket password (or set OBS_PASSWORD)
  --obs-scene <name>       Switch to this OBS scene before recording
  --countdown <seconds>    Countdown before starting (default: 3)

Telemetry:
  --simhub-url <url>       SimHub endpoint (default: ${DEFAULT_SIMHUB_URL})
  --hz <number>            Telemetry polling rate (default: 60)
  --steering-unit <unit>   auto | deg | rad | normalized | percent
  --steering-range <deg>   Steering range for normalized/percent input (default: 900)
  --map <channel=path>     Override a discovered SimHub channel. Repeatable.

Output:
  --out <dir>              Session directory (default: captures/obs-<timestamp>)
  --duration <seconds>     Stop after N seconds (default: until Ctrl+C)
  --remux                  Remux an OBS .mkv recording to .mp4 with ffmpeg
  --copy-video             Copy the final video into the session directory
  -h, --help               Show this help

Prerequisites:
  - OBS Studio with WebSocket server enabled (Tools > WebSocket Server Settings)
  - SimHub running with a game active
  - Node 22+ (global WebSocket)

The controller starts OBS, starts telemetry at the same moment, stops both on
Ctrl+C/duration, and writes capture.json with the video path and suggested sync
offset. Telemetry is written by tools/simhub-record.mjs into the same directory.
`;

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP.trim());
  process.exit(0);
}

function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  return args[index + 1] ?? fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1] !== undefined) values.push(args[index + 1]);
  }
  return values;
}

function normalizeObsUrl(value) {
  if (!value) return 'ws://127.0.0.1:4455';
  if (value.startsWith('ws://') || value.startsWith('wss://')) return value;
  if (value.startsWith('http://')) return `ws://${value.slice('http://'.length)}`;
  if (value.startsWith('https://')) return `wss://${value.slice('https://'.length)}`;
  return `ws://${value}`;
}

const obsUrl = normalizeObsUrl(argValue('--obs-url', 'ws://127.0.0.1:4455'));
const obsPassword = argValue('--obs-password', process.env.OBS_PASSWORD ?? '');
const obsScene = argValue('--obs-scene', '');
const countdown = Math.max(0, Number(argValue('--countdown', '3')) || 0);
const simhubUrl = argValue('--simhub-url', DEFAULT_SIMHUB_URL);
const hz = Math.min(240, Math.max(1, Number(argValue('--hz', '60')) || 60));
const steeringUnit = argValue('--steering-unit', 'auto');
const steeringRange = Math.max(1, Number(argValue('--steering-range', '900')) || 900);
const duration = Math.max(0, Number(argValue('--duration', '0')) || 0);
const remux = args.includes('--remux');
const copyVideo = args.includes('--copy-video');

const maps = {};
for (const entry of argValues('--map')) {
  const [channel, ...rest] = entry.split('=');
  const path = rest.join('=');
  if (!channel || !path) {
    console.error(`Invalid --map value: ${entry} (expected channel=path)`);
    process.exit(1);
  }
  maps[channel] = path;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(argValue('--out', join('captures', `obs-${stamp}`)));
const recorderPath = join(dirname(fileURLToPath(import.meta.url)), 'simhub-record.mjs');

const warnings = [];
let obsClient = null;
let child = null;
let childExited = false;
let obsStartedAt = null;
let telemetryStartedAt = null;
let obsStoppedAt = null;
let recordingStarted = false;
let startPromise = null;
let stopping = false;
let durationTimer = null;
let videoPath = null;
let videoRemuxed = false;
let videoCopied = false;
let resolveDone;
const done = new Promise((resolve) => {
  resolveDone = resolve;
});

function log(message) {
  console.log(message);
}

function sendToChild(message) {
  if (!child?.connected) return false;
  try {
    child.send(message);
    return true;
  } catch {
    return false;
  }
}

function waitForChildMessage(target, predicate, timeoutMs = 15000) {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for the telemetry recorder.'));
    }, timeoutMs);

    const onMessage = (message) => {
      if (!predicate(message)) return;
      cleanup();
      resolveMessage(message);
    };

    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `Telemetry recorder exited before it was ready (${code ?? signal ?? 'unknown'}).`,
        ),
      );
    };

    const cleanup = () => {
      clearTimeout(timer);
      target.off('message', onMessage);
      target.off('exit', onExit);
    };

    target.on('message', onMessage);
    target.on('exit', onExit);
  });
}

function waitForChildExit(target, timeoutMs = 10000) {
  if (childExited) return Promise.resolve(true);

  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      cleanup();
      resolveExit(false);
    }, timeoutMs);

    const onExit = () => {
      cleanup();
      resolveExit(true);
    };

    const cleanup = () => {
      clearTimeout(timer);
      target.off('exit', onExit);
    };

    target.on('exit', onExit);
  });
}

function spawnRecorder() {
  const childArgs = [
    recorderPath,
    '--url',
    simhubUrl,
    '--hz',
    String(hz),
    '--out',
    outDir,
    '--steering-unit',
    steeringUnit,
    '--steering-range',
    String(steeringRange),
    '--ipc',
  ];

  for (const [channel, path] of Object.entries(maps)) {
    childArgs.push('--map', `${channel}=${path}`);
  }

  const recorder = spawn(process.execPath, childArgs, {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });

  recorder.on('exit', (code, signal) => {
    childExited = true;
    if (!stopping && recordingStarted) {
      warnings.push(`Telemetry recorder exited unexpectedly (${code ?? signal ?? 'unknown'}).`);
      void stop('telemetry recorder exited');
    }
  });

  return recorder;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function remuxMkv(inputPath) {
  const outputPath = join(outDir, 'video.mp4');
  log(`Remuxing ${inputPath} -> ${outputPath}`);

  const code = await new Promise((resolveCode, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-y', '-i', inputPath, '-c', 'copy', outputPath], {
      stdio: 'inherit',
    });
    ffmpeg.on('error', reject);
    ffmpeg.on('exit', (exitCode) => resolveCode(exitCode));
  });

  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
  return outputPath;
}

async function stop(reason) {
  if (stopping) return;
  stopping = true;
  clearTimeout(durationTimer);

  log(`\nStopping (${reason})...`);

  if (child && !childExited) {
    const stoppedMessage = waitForChildMessage(
      child,
      (message) => message?.type === 'stopped',
      8000,
    ).catch(() => null);
    sendToChild({ type: 'stop' });
    await stoppedMessage;
    const exited = await waitForChildExit(child, 8000);
    if (!exited) {
      warnings.push('Telemetry recorder did not exit; killing it.');
      child.kill('SIGKILL');
    }
  }

  if (startPromise) {
    try {
      await startPromise;
    } catch {
      // The start failure is handled by main; nothing to stop.
    }
  }

  if (obsClient && recordingStarted) {
    try {
      const path = await obsClient.stopRecording();
      if (typeof path === 'string') videoPath = path;
    } catch (error) {
      warnings.push(
        `Could not stop OBS recording cleanly: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    obsStoppedAt = new Date().toISOString();
  }

  let telemetrySession = null;
  try {
    telemetrySession = JSON.parse(await readFile(join(outDir, 'session.json'), 'utf8'));
  } catch {
    warnings.push('Telemetry session.json was not found.');
  }

  if (videoPath && (remux || extname(videoPath).toLowerCase() === '.mkv')) {
    try {
      videoPath = await remuxMkv(videoPath);
      videoRemuxed = true;
    } catch (error) {
      warnings.push(
        `Remux failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (videoPath && copyVideo && !videoRemuxed) {
    try {
      const destination = join(outDir, `video${extname(videoPath)}`);
      await copyFile(videoPath, destination);
      videoPath = destination;
      videoCopied = true;
    } catch (error) {
      warnings.push(
        `Video copy failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const offsetSeconds =
    obsStartedAt && telemetryStartedAt
      ? (Date.parse(obsStartedAt) - Date.parse(telemetryStartedAt)) / 1000
      : null;

  const capture = {
    tool: 'obs-capture',
    version: 1,
    createdAt: new Date().toISOString(),
    outDir,
    obs: {
      url: obsUrl,
      scene: obsScene || null,
      startedAt: obsStartedAt,
      stoppedAt: obsStoppedAt,
      outputPath: videoPath,
    },
    telemetry: {
      dir: outDir,
      startedAt: telemetrySession?.startedAt ?? telemetryStartedAt,
      session: telemetrySession,
    },
    sync: {
      obsStartedAt,
      telemetryStartedAt,
      suggestedOffsetSeconds: offsetSeconds,
      note:
        'suggestedOffsetSeconds matches Ghost Driver: telemetryTime = mediaTime + offset. ' +
        'Positive means telemetry started before the video.',
    },
    video: {
      path: videoPath,
      remuxed: videoRemuxed,
      copied: videoCopied,
    },
    warnings,
  };

  await writeFile(join(outDir, 'capture.json'), `${JSON.stringify(capture, null, 2)}\n`);

  obsClient?.close();
  resolveDone?.();

  log(`Session: ${outDir}`);
  log(`Video:   ${videoPath ?? '(OBS did not return a path)'}`);
  if (offsetSeconds !== null) log(`Suggested offset: ${offsetSeconds.toFixed(3)} s`);
  if (warnings.length > 0) {
    for (const warning of warnings) log(`Warning: ${warning}`);
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });

  log(`OBS capture -> ${outDir}`);
  log(`OBS: ${obsUrl}`);
  log(`SimHub: ${simhubUrl}`);
  log(`Telemetry: ${hz} Hz, steering range ${steeringRange} deg`);
  log('');

  obsClient = new ObsClient({ url: obsUrl, password: obsPassword });
  await obsClient.connect();
  const version = await obsClient.getVersion();
  log(
    `Connected to OBS ${version.obsVersion ?? '?'} / obs-websocket ${version.obsWebSocketVersion ?? '?'}`,
  );

  obsClient.onEvent((event) => {
    if (event.eventType !== 'RecordStateChanged') return;
    if (typeof event.eventData?.outputPath === 'string') {
      videoPath = event.eventData.outputPath;
    }
  });

  if (obsScene) {
    await obsClient.setScene(obsScene);
    log(`Scene: ${obsScene}`);
  }

  const status = await obsClient.getRecordStatus();
  if (status.outputActive) {
    throw new Error('OBS is already recording. Stop the current recording first.');
  }

  child = spawnRecorder();
  await waitForChildMessage(child, (message) => message?.type === 'ready', 15000);
  log('Telemetry recorder ready.');

  for (let remaining = countdown; remaining > 0; remaining -= 1) {
    log(`Starting in ${remaining}...`);
    await sleep(1000);
  }

  if (stopping) return;

  try {
    startPromise = obsClient.startRecording().then(() => {
      recordingStarted = true;
    });
    await startPromise;
  } finally {
    startPromise = null;
  }
  obsStartedAt = new Date().toISOString();
  log('OBS recording started.');

  if (stopping) return;

  const startedMessage = waitForChildMessage(
    child,
    (message) => message?.type === 'started',
    15000,
  );
  sendToChild({ type: 'start' });
  let started;
  try {
    started = await startedMessage;
  } catch (error) {
    if (stopping) return;
    throw error;
  }
  telemetryStartedAt = started.startedAt ?? new Date().toISOString();
  log('Telemetry recording started.');

  if (stopping) return;
  log('Press Ctrl+C to stop.\n');

  if (duration > 0) {
    durationTimer = setTimeout(() => {
      void stop('duration reached');
    }, duration * 1000);
  }

  await done;
}

process.on('SIGINT', () => {
  if (stopping) {
    console.error('Force exiting.');
    process.exit(1);
  }
  void stop('SIGINT');
});

main().catch(async (error) => {
  console.error(`Capture failed: ${error instanceof Error ? error.message : String(error)}`);
  try {
    await stop('error');
  } catch {
    // ignore
  }
  process.exitCode = 1;
});
