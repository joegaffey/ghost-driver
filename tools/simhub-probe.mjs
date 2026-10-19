#!/usr/bin/env node
import {
  DEFAULT_SIMHUB_URL,
  convertSteering,
  fetchGameData,
  findChannels,
  findMetadata,
  flattenJson,
  guessSteeringUnit,
  round,
  steeringKeys,
} from './lib/simhub.mjs';

const HELP = `
SimHub telemetry probe

Usage:
  node tools/simhub-probe.mjs [options]

Options:
  --url <url>         SimHub game-data endpoint (default: ${DEFAULT_SIMHUB_URL})
  --json              Print the full JSON response
  --watch             Keep polling and print the mapped channel values
  --diff              With --watch, print only keys whose values changed
  --interval <ms>     Watch interval in milliseconds (default: 500)
  -h, --help          Show this help

Run this on the PC where SimHub is running. It does not modify anything.
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

const url = argValue('--url', DEFAULT_SIMHUB_URL);
const printJson = args.includes('--json');
const watch = args.includes('--watch');
const diff = args.includes('--diff');
const interval = Math.max(100, Number(argValue('--interval', '500')) || 500);

function formatValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(round(value, 4)) : String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function printSnapshot(data, flat, channels, warnings) {
  console.log(`\nSimHub: ${url}`);
  console.log(`Top-level keys: ${Object.keys(data).join(', ') || '(none)'}`);
  console.log(`Flattened values: ${Object.keys(flat).length}`);

  const metadata = findMetadata(flat);
  if (metadata.game) console.log(`Game:  ${metadata.game}`);
  if (metadata.car) console.log(`Car:   ${metadata.car}`);
  if (metadata.track) console.log(`Track: ${metadata.track}`);

  const rows = Object.entries(channels).map(([channel, entry]) => {
    const units = channel === 'steer' ? guessSteeringUnit(entry.value) : '';
    const degrees =
      channel === 'steer' ? round(convertSteering(entry.value, 'auto', 900), 1) : '';
    return {
      channel,
      path: entry.path,
      raw: entry.value,
      units,
      degrees,
    };
  });

  if (rows.length > 0) {
    console.log('\nMapped channels:');
    for (const row of rows) {
      const suffix = row.units ? ` (${row.units} -> ${row.degrees} deg @ 900)` : '';
      console.log(`  ${row.channel.padEnd(12)} ${row.path} = ${formatValue(row.raw)}${suffix}`);
    }
  }

  if (warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of warnings) console.log(`  - ${warning}`);
  }

  const steerish = steeringKeys(flat);
  if (!channels.steer && steerish.length > 0) {
    console.log('\nSteering-like keys:');
    for (const path of steerish) console.log(`  ${path} = ${formatValue(flat[path])}`);
    console.log('\nIf one of these is the wheel angle, pass it explicitly:');
    console.log(`  npm run record -- --map steer="${steerish[0]}"`);
  }

  if (printJson) {
    console.log('\nFull response:');
    console.log(JSON.stringify(data, null, 2));
  }
}

function printDiff(previous, flat) {
  const changed = [];
  for (const [key, value] of Object.entries(flat)) {
    if (previous[key] !== value) changed.push([key, value]);
  }
  for (const key of Object.keys(previous)) {
    if (!(key in flat)) changed.push([key, undefined]);
  }

  if (changed.length === 0) return;
  console.log(`\n[${new Date().toLocaleTimeString()}] changed keys (${changed.length}):`);
  for (const [key, value] of changed.slice(0, 80)) {
    console.log(`  ${key} = ${formatValue(value)}`);
  }
  if (changed.length > 80) console.log(`  ... ${changed.length - 80} more`);
}

async function main() {
  let previous = {};

  const tick = async () => {
    try {
      const data = await fetchGameData(url);
      const flat = flattenJson(data);
      const { channels, warnings } = findChannels(flat);

      if (!watch) {
        printSnapshot(data, flat, channels, warnings);
        return;
      }

      const steer = channels.steer?.value;
      const steerText =
        steer === undefined
          ? 'steer=?'
          : `steer=${formatValue(steer)} (${guessSteeringUnit(steer)} -> ${round(convertSteering(steer, 'auto', 900), 1)} deg)`;
      const throttle = channels.throttle?.value;
      const brake = channels.brake?.value;
      const speed = channels.speed?.value;
      const gear = channels.gear?.value;
      console.log(
        `[${new Date().toLocaleTimeString()}] ${steerText} throttle=${formatValue(throttle)} brake=${formatValue(brake)} speed=${formatValue(speed)} gear=${formatValue(gear)}`,
      );
      if (diff) printDiff(previous, flat);
      previous = flat;
    } catch (error) {
      console.error(`Probe failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!watch) process.exitCode = 1;
    }
  };

  await tick();
  if (watch) {
    setInterval(tick, interval);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
