#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_SIMHUB_URL,
  buildMeta,
  buildSample,
  buildTelemetry,
  fetchGameData,
  findChannels,
  findMetadata,
  flattenJson,
  guessSteeringUnit,
  round,
} from './lib/simhub.mjs';

const HELP = `
Record SimHub telemetry to a Ghost Driver session

Usage:
  node tools/simhub-record.mjs [options]

Options:
  --url <url>              SimHub endpoint (default: ${DEFAULT_SIMHUB_URL})
  --hz <number>            Polling rate (default: 60, max: 240)
  --out <dir>              Output directory (default: captures/simhub-<timestamp>)
  --duration <seconds>     Stop after N seconds (default: until Ctrl+C)
  --steering-unit <unit>   auto | deg | rad | normalized | percent (default: auto)
  --steering-range <deg>   Steering range for normalized/percent input (default: 900)
  --map <channel=path>     Override a discovered channel. Repeatable.
  --raw-only               Write raw.ndjson only; skip canonical telemetry.json
  --raw-full               Include every flattened field in raw.ndjson
  --quiet                  Less console output
  --ipc                    Internal: wait for a start message (OBS capture)
  -h, --help               Show this help

Examples:
  npm run probe
  npm run record -- --duration 60
  npm run record -- --map steer=GameData.NewData.Steering --steering-unit normalized

Output:
  raw.ndjson       Selected channels per poll
  telemetry.json   Canonical ghost-driver-telemetry v1 (when steering is found)
  session.json     Capture metadata and field mapping
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

const url = argValue('--url', DEFAULT_SIMHUB_URL);
const hz = Math.min(240, Math.max(1, Number(argValue('--hz', '60')) || 60));
const requestedUnit = argValue('--steering-unit', 'auto');
const validUnits = new Set(['auto', 'deg', 'rad', 'normalized', 'percent']);
if (!validUnits.has(requestedUnit)) {
  console.error(`Invalid --steering-unit "${requestedUnit}". Use auto, deg, rad, normalized or percent.`);
  process.exit(1);
}
const steeringRangeDeg = Math.max(1, Number(argValue('--steering-range', '900')) || 900);
const duration = Math.max(0, Number(argValue('--duration', '0')) || 0);
const rawOnly = args.includes('--raw-only');
const rawFull = args.includes('--raw-full');
const quiet = args.includes('--quiet');
const ipcEnabled = args.includes('--ipc');

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
const outDir = argValue('--out', join('captures', `simhub-${stamp}`));
const rawPath = join(outDir, 'raw.ndjson');
const telemetryPath = join(outDir, 'telemetry.json');
const sessionPath = join(outDir, 'session.json');

let stopped = false;
let stopping = false;
let timer;
let rawStream;
let resolvedUnit = requestedUnit;

let startPerf = performance.now();
let startedAt = new Date().toISOString();

let sampleCount = 0;
let consecutiveErrors = 0;
let lastStatus = 0;
let channels = {};
let metadata = {};
let warnings = [];
const samples = [];

function log(message) {
  if (!quiet) console.log(message);
}

function fmt(value) {
  return typeof value === 'number' ? String(round(value, 3)) : String(value);
}

function selectedRawData(flat) {
  if (rawFull) return flat;
  const data = {};
  for (const [channel, entry] of Object.entries(channels)) {
    data[channel] = flat[entry.path];
  }
  return data;
}

async function stop(reason) {
  if (stopping) return;
  stopping = true;
  stopped = true;
  clearTimeout(timer);

  const endedAt = new Date().toISOString();
  const durationSeconds = round((performance.now() - startPerf) / 1000, 3);

  if (rawStream) {
    await new Promise((resolve) => rawStream.end(resolve));
  }

  const files = { raw: 'raw.ndjson' };

  if (!rawOnly && samples.length > 0) {
    const telemetry = buildTelemetry({
      meta: buildMeta({
        channels,
        hz,
        startedAt,
        duration: durationSeconds,
        steeringUnit: resolvedUnit,
        steeringRangeDeg,
        url,
        metadata,
      }),
      samples,
    });
    await writeFile(telemetryPath, `${JSON.stringify(telemetry, null, 2)}\n`);
    files.telemetry = 'telemetry.json';
  } else if (!rawOnly) {
    warnings.push('No canonical telemetry written because steering was not found.');
  }

  const session = {
    tool: 'simhub-record',
    version: 1,
    startedAt,
    endedAt,
    durationSeconds,
    url,
    hz,
    requestedSteeringUnit: requestedUnit,
    steeringUnit: resolvedUnit,
    steeringRangeDeg,
    sampleCount,
    canonicalSamples: samples.length,
    stopReason: reason,
    metadata,
    channels,
    warnings,
    files,
  };
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
  process.send?.({ type: 'stopped', outDir, sessionPath });
  if (process.connected) process.disconnect();

  console.log(`\nStopped (${reason}).`);
  console.log(`Samples: ${sampleCount} (${samples.length} canonical)`);
  console.log(`Output: ${outDir}`);
  if (warnings.length > 0) {
    for (const warning of warnings) console.log(`Warning: ${warning}`);
  }
}

async function tick() {
  if (stopped) return;

  const tickStart = performance.now();
  const t = (tickStart - startPerf) / 1000;

  try {
    const data = await fetchGameData(url);
    if (stopped) return;
    const flat = flattenJson(data);

    if (sampleCount === 0) {
      const discovered = findChannels(flat, maps);
      channels = discovered.channels;
      metadata = findMetadata(flat);
      warnings = discovered.warnings;

      const initialSteer = channels.steer?.value;
      if (initialSteer !== undefined) {
        if (requestedUnit === 'auto') {
          resolvedUnit = guessSteeringUnit(initialSteer);
          warnings.push(
            `Auto-detected steering unit "${resolvedUnit}" from initial value ${fmt(initialSteer)}. ` +
              'Verify with simhub-probe and pass --steering-unit if this is wrong.',
          );
        }
      } else if (requestedUnit === 'auto') {
        resolvedUnit = 'normalized';
      }

      if (channels.steer) {
        log(`Steering: ${channels.steer.path} (${resolvedUnit} -> deg, range ${steeringRangeDeg})`);
      } else {
        log('Steering: not found. Recording raw only; use --map steer=<path> to fix.');
      }
      if (!rawOnly && !channels.steer) warnings.push('Canonical file will be skipped without steering.');
    }

    const rawEntry = {
      t: round(t, 6),
      wallTime: new Date().toISOString(),
      data: selectedRawData(flat),
    };
    rawStream.write(`${JSON.stringify(rawEntry)}\n`);

    if (!rawOnly) {
      const sample = buildSample(flat, channels, {
        t,
        steeringUnit: resolvedUnit,
        steeringRangeDeg,
      });
      if (sample.steer !== undefined) {
        samples.push(sample);
      }
    }

    sampleCount += 1;
    consecutiveErrors = 0;

    if (!quiet && tickStart - lastStatus >= 1000) {
      lastStatus = tickStart;
      const steer = channels.steer ? flat[channels.steer.path] : undefined;
      console.log(
        `t=${t.toFixed(1)}s samples=${sampleCount} steer=${fmt(steer)} ` +
          `unit=${resolvedUnit} errors=${consecutiveErrors}`,
      );
    }
  } catch (error) {
    consecutiveErrors += 1;
    if (consecutiveErrors === 1 || consecutiveErrors % 10 === 0) {
      console.error(
        `Poll failed (${consecutiveErrors}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (consecutiveErrors >= 30) {
      await stop('too many consecutive poll failures');
      return;
    }
  }

  if (duration > 0 && t >= duration) {
    await stop('duration reached');
    return;
  }

  const period = 1000 / hz;
  const elapsed = performance.now() - tickStart;
  timer = setTimeout(() => void tick(), Math.max(0, period - elapsed));
}

function waitForStartMessage(timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.off('message', onMessage);
      reject(new Error('Timed out waiting for the capture controller to start recording.'));
    }, timeoutMs);

    const onMessage = (message) => {
      if (message?.type === 'start') {
        clearTimeout(timer);
        process.off('message', onMessage);
        resolve(true);
      } else if (message?.type === 'stop') {
        clearTimeout(timer);
        process.off('message', onMessage);
        resolve(false);
      }
    };

    process.on('message', onMessage);
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  rawStream = createWriteStream(rawPath, { flags: 'w' });

  log(`SimHub recorder -> ${outDir}`);
  log(`Endpoint: ${url}`);
  log(`Rate: ${hz} Hz, steering range: ${steeringRangeDeg} deg`);
  log('Press Ctrl+C to stop.\n');

  process.on('SIGINT', () => {
    console.log('\nStopping…');
    void stop('SIGINT');
  });

  if (ipcEnabled) {
    process.send?.({ type: 'ready', outDir });
    const shouldStart = await waitForStartMessage(30000);
    if (!shouldStart) {
      await stop('stopped before start');
      return;
    }
  }

  startPerf = performance.now();
  startedAt = new Date().toISOString();
  process.send?.({ type: 'started', startedAt });

  process.on('message', (message) => {
    if (message?.type === 'stop') void stop('IPC stop');
  });

  await tick();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await stop('fatal error');
  } catch {
    // ignore
  }
  process.exitCode = 1;
});
