/** Shared helpers for the SimHub probe/recorder tools. */

export const DEFAULT_SIMHUB_URL = 'http://127.0.0.1:8888/api/GetGamedata';

const CHANNEL_CANDIDATES = {
  steer: ['steering', 'steer', 'steeringwheelangle', 'steerangle', 'steeringangle', 'steeringpct', 'steerpct'],
  steerTorque: ['steeringtorque', 'steertorque', 'steeringwheeltorque'],
  throttle: ['throttle', 'throttleposition', 'throttlepos', 'gas'],
  brake: ['brake', 'brakeposition', 'brakepos', 'brakepressure'],
  speed: ['speedkmh', 'speed', 'groundspeed', 'velocity'],
  gear: ['gear', 'gearposition'],
  rpm: ['rpms', 'rpm', 'enginerpm'],
  latAccel: ['lataccel', 'lateralaccel', 'latg', 'lateralg'],
  longAccel: ['longaccel', 'longitudinalaccel', 'longg', 'longitudinalg'],
};

const CHANNEL_EXCLUDES = {
  steer: ['torque', 'force', 'raw', 'max', 'min', 'limit', 'range', 'rate', 'velocity', 'speed', 'lock', 'temp', 'damage'],
};

/**
 * Fetch the current SimHub game-data snapshot.
 * @param {string} [url]
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<unknown>}
 */
export async function fetchGameData(url = DEFAULT_SIMHUB_URL, options = {}) {
  const { timeoutMs = 2000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`SimHub returned HTTP ${response.status}`);
    }
    const text = await response.text();
    if (!text.trim()) {
      throw new Error('SimHub returned an empty response');
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Flatten a nested JSON object into dot-separated paths.
 * @param {unknown} value
 * @param {string} [prefix]
 * @param {Record<string, unknown>} [out]
 * @returns {Record<string, unknown>}
 */
export function flattenJson(value, prefix = '', out = {}) {
  if (value === null || value === undefined) {
    if (prefix) out[prefix] = value;
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenJson(item, `${prefix}[${index}]`, out));
    return out;
  }

  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flattenJson(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }

  out[prefix] = value;
  return out;
}

/** @param {string} key */
export function normalizeKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** @param {string} path */
function lastSegment(path) {
  return path.split('.').pop() ?? path;
}

/**
 * @param {Record<string, unknown>} flat
 * @param {string[]} candidates
 * @param {string[]} excludes
 */
function findBestChannel(flat, candidates, excludes = []) {
  let best = null;

  for (const [path, value] of Object.entries(flat)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;

    const full = normalizeKey(path);
    const last = normalizeKey(lastSegment(path));
    if (excludes.some((token) => last.includes(token) || full.includes(token))) continue;

    let score = 0;
    for (const candidate of candidates) {
      if (last === candidate) score = Math.max(score, 100);
      else if (last.startsWith(candidate) || last.endsWith(candidate)) score = Math.max(score, 80);
      else if (full.endsWith(candidate)) score = Math.max(score, 70);
      else if (full.includes(candidate)) score = Math.max(score, 50);
    }

    if (score === 0) continue;

    const entry = { path, value, score };
    if (
      !best ||
      score > best.score ||
      (score === best.score && path.length < best.path.length)
    ) {
      best = entry;
    }
  }

  return best;
}

/**
 * Find likely channels in a flattened SimHub snapshot.
 * @param {Record<string, unknown>} flat
 * @param {Record<string, string>} [overrides] channel -> flattened path
 * @returns {{ channels: Record<string, { path: string, value: number, score: number }>, warnings: string[] }}
 */
export function findChannels(flat, overrides = {}) {
  /** @type {Record<string, { path: string, value: number, score: number }>} */
  const channels = {};
  /** @type {string[]} */
  const warnings = [];

  for (const [channel, candidates] of Object.entries(CHANNEL_CANDIDATES)) {
    const override = overrides[channel];
    if (override) {
      const value = flat[override];
      if (typeof value === 'number' && Number.isFinite(value)) {
        channels[channel] = { path: override, value, score: 999 };
      } else {
        warnings.push(`Override ${channel}=${override} was not a finite number.`);
      }
      continue;
    }

    const found = findBestChannel(flat, candidates, CHANNEL_EXCLUDES[channel] ?? []);
    if (found) channels[channel] = found;
  }

  if (!channels.steer) {
    warnings.push('No steering channel found. Use simhub-probe --json and/or --map steer=<path>.');
  }

  return { channels, warnings };
}


const METADATA_CANDIDATES = {
  game: ['gamename', 'simname', 'game'],
  car: ['carname', 'carscreenname', 'vehiclename', 'vehicle', 'car'],
  track: ['trackname', 'trackdisplayname', 'circuitname', 'track', 'circuit'],
};

/**
 * Find display metadata from a flattened SimHub snapshot.
 * @param {Record<string, unknown>} flat
 * @returns {{ game?: string, car?: string, track?: string }}
 */
export function findMetadata(flat) {
  /** @type {{ game?: string, car?: string, track?: string }} */
  const metadata = {};

  for (const [field, candidates] of Object.entries(METADATA_CANDIDATES)) {
    const strings = Object.entries(flat).filter(([, value]) => typeof value === 'string' && value.trim());
    let match = strings.find(([path]) => {
      const last = normalizeKey(path.split('.').pop() ?? path);
      return candidates.includes(last);
    });

    if (!match) {
      match = strings.find(([path]) => {
        const full = normalizeKey(path);
        return candidates.some((candidate) => full.endsWith(candidate) || full.includes(candidate));
      });
    }

    if (match) metadata[field] = match[1].trim();
  }

  return metadata;
}

/**
 * Guess the units of a raw steering value.
 * @param {number} value
 * @returns {'normalized' | 'percent' | 'deg'}
 */
export function guessSteeringUnit(value) {
  const abs = Math.abs(value);
  if (abs <= 1.5) return 'normalized';
  if (abs <= 100) return 'percent';
  return 'deg';
}

/**
 * Convert a raw steering value to degrees.
 * @param {number} value
 * @param {'auto' | 'deg' | 'rad' | 'normalized' | 'percent'} unit
 * @param {number} rangeDeg
 * @returns {number}
 */
export function convertSteering(value, unit, rangeDeg) {
  const resolved = unit === 'auto' ? guessSteeringUnit(value) : unit;
  switch (resolved) {
    case 'deg':
      return value;
    case 'rad':
      return (value * 180) / Math.PI;
    case 'normalized':
      return (value * rangeDeg) / 2;
    case 'percent':
      return (value / 100) * (rangeDeg / 2);
    default:
      return value;
  }
}

/** @param {number} value */
function normalizePedal(value) {
  return value > 1.5 ? value / 100 : value;
}

/** @param {number} value @param {number} digits */
export function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Build one canonical sample from a flattened snapshot.
 * @param {Record<string, unknown>} flat
 * @param {Record<string, { path: string }>} channels
 * @param {{ t: number, steeringUnit?: 'auto' | 'deg' | 'rad' | 'normalized' | 'percent', steeringRangeDeg?: number }} options
 */
export function buildSample(flat, channels, options) {
  const { t, steeringUnit = 'auto', steeringRangeDeg = 900 } = options;
  /** @type {Record<string, number>} */
  const sample = { t: round(t, 6) };

  const numeric = (channel) => {
    const entry = channels[channel];
    if (!entry) return undefined;
    const value = flat[entry.path];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };

  const steer = numeric('steer');
  if (steer !== undefined) sample.steer = round(convertSteering(steer, steeringUnit, steeringRangeDeg), 3);

  const steerTorque = numeric('steerTorque');
  if (steerTorque !== undefined) sample.steerTorque = round(steerTorque, 3);

  const throttle = numeric('throttle');
  if (throttle !== undefined) sample.throttle = round(normalizePedal(throttle), 4);

  const brake = numeric('brake');
  if (brake !== undefined) sample.brake = round(normalizePedal(brake), 4);

  const speed = numeric('speed');
  if (speed !== undefined) sample.speed = round(speed, 2);

  const gear = numeric('gear');
  if (gear !== undefined) sample.gear = Math.round(gear);

  const rpm = numeric('rpm');
  if (rpm !== undefined) sample.rpm = round(rpm, 1);

  const latAccel = numeric('latAccel');
  if (latAccel !== undefined) sample.latAccel = round(latAccel, 3);

  const longAccel = numeric('longAccel');
  if (longAccel !== undefined) sample.longAccel = round(longAccel, 3);

  return sample;
}

/**
 * Build canonical metadata for a recorded session.
 * @param {{ channels: Record<string, { path: string }>, hz: number, startedAt: string, duration: number, steeringUnit: string, steeringRangeDeg: number, url: string }} options
 */
export function buildMeta(options) {
  const { channels, hz, startedAt, duration, steeringUnit, steeringRangeDeg, url, metadata = {} } = options;
  const channelPaths = Object.fromEntries(
    Object.entries(channels).map(([channel, entry]) => [channel, entry.path]),
  );

  return {
    source: 'simhub',
    ...metadata,
    recordedAt: startedAt,
    steeringUnits: 'deg',
    steeringRangeDeg,
    sampleRateHz: hz,
    duration: round(duration, 3),
    notes: `Recorded from ${url}. Source steering unit: ${steeringUnit}.`,
    channels: channelPaths,
  };
}

/**
 * Wrap samples in the canonical Ghost Driver telemetry document.
 * @param {{ meta: Record<string, unknown>, samples: Record<string, number>[] }} options
 */
export function buildTelemetry(options) {
  const { meta, samples } = options;
  return {
    format: 'ghost-driver-telemetry',
    version: 1,
    meta,
    samples,
  };
}

/**
 * Describe likely steering keys for a probe report.
 * @param {Record<string, unknown>} flat
 */
export function steeringKeys(flat) {
  return Object.keys(flat).filter((path) => {
    const key = normalizeKey(path);
    return key.includes('steer') || key.includes('wheel');
  });
}
