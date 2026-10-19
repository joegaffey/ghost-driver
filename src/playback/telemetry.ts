export interface TelemetryMeta {
  source?: string;
  game?: string;
  car?: string;
  track?: string;
  recordedAt?: string;
  steeringUnits?: 'deg' | 'rad' | 'normalized' | 'percent';
  steeringRangeDeg?: number;
  sampleRateHz?: number;
  duration?: number;
  notes?: string;
  [key: string]: unknown;
}

export interface TelemetrySample {
  t: number;
  steer?: number;
  steerTorque?: number;
  throttle?: number;
  brake?: number;
  speed?: number;
  gear?: number;
  rpm?: number;
  latAccel?: number;
  longAccel?: number;
  [key: string]: unknown;
}

export interface TelemetryDocument {
  format: string;
  version: number;
  meta?: TelemetryMeta;
  samples: TelemetrySample[];
}

export interface SampledState {
  t: number;
  steer?: number;
  steerTorque?: number;
  throttle?: number;
  brake?: number;
  speed?: number;
  gear?: number;
  rpm?: number;
  latAccel?: number;
  longAccel?: number;
  gap: boolean;
  stale: boolean;
}

const NUMERIC_CHANNELS = [
  'steer',
  'steerTorque',
  'throttle',
  'brake',
  'speed',
  'gear',
  'rpm',
  'latAccel',
  'longAccel',
] as const;

type NumericChannel = (typeof NUMERIC_CHANNELS)[number];

const DEFAULT_RANGE_DEG = 900;
const GAP_SECONDS = 0.25;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toDegrees(value: number, units: TelemetryMeta['steeringUnits'], rangeDeg: number): number {
  switch (units) {
    case 'rad':
      return (value * 180) / Math.PI;
    case 'normalized':
      return (value * rangeDeg) / 2;
    case 'percent':
      return (value / 100) * (rangeDeg / 2);
    case 'deg':
    default:
      return value;
  }
}

function unwrapSteering(samples: TelemetrySample[]): void {
  let previous = samples[0]?.steer;
  if (previous === undefined) return;

  for (let index = 1; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample.steer === undefined) continue;

    let delta = sample.steer - previous;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    previous += delta;
    sample.steer = previous;
  }
}

export class TelemetryTrack {
  readonly meta: TelemetryMeta;
  readonly samples: readonly TelemetrySample[];
  readonly duration: number;
  readonly steeringRangeDeg: number;
  readonly sampleCount: number;

  constructor(meta: TelemetryMeta, samples: TelemetrySample[]) {
    this.meta = meta;
    this.samples = samples;
    this.sampleCount = samples.length;
    this.duration = samples.at(-1)?.t ?? 0;
    this.steeringRangeDeg = finiteNumber(meta.steeringRangeDeg) ?? DEFAULT_RANGE_DEG;
  }

  sampleAt(time: number): SampledState {
    const samples = this.samples;
    if (samples.length === 0) {
      return { t: time, gap: false, stale: true };
    }

    const first = samples[0];
    const last = samples[samples.length - 1];

    if (time <= first.t) {
      return { ...this.stateFrom(first), gap: false, stale: time < first.t - 0.1 };
    }
    if (time >= last.t) {
      return { ...this.stateFrom(last), gap: false, stale: time > last.t + 0.1 };
    }

    let low = 0;
    let high = samples.length - 1;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (samples[middle].t <= time) low = middle;
      else high = middle;
    }

    const a = samples[low];
    const b = samples[high];
    const span = b.t - a.t;
    const ratio = span > 0 ? (time - a.t) / span : 0;

    const interpolate = (channel: NumericChannel): number | undefined => {
      const av = finiteNumber(a[channel]);
      const bv = finiteNumber(b[channel]);
      if (av === undefined) return bv;
      if (bv === undefined) return av;
      return av + (bv - av) * ratio;
    };

    const state: SampledState = {
      t: time,
      gap: span > GAP_SECONDS,
      stale: false,
    };

    for (const channel of NUMERIC_CHANNELS) {
      if (channel === 'gear') {
        const value = finiteNumber(a.gear) ?? finiteNumber(b.gear);
        if (value !== undefined) state.gear = Math.round(value);
        continue;
      }

      const value = interpolate(channel);
      if (value !== undefined) state[channel] = value;
    }

    return state;
  }

  private stateFrom(sample: TelemetrySample): Omit<SampledState, 'gap' | 'stale'> {
    const state: Omit<SampledState, 'gap' | 'stale'> = { t: sample.t };
    for (const channel of NUMERIC_CHANNELS) {
      const value = finiteNumber(sample[channel]);
      if (value === undefined) continue;
      state[channel] = channel === 'gear' ? Math.round(value) : value;
    }
    return state;
  }
}

export function parseTelemetry(input: unknown): TelemetryTrack {
  if (!isRecord(input)) throw new Error('Telemetry must be a JSON object.');

  if (input.format !== 'ghost-driver-telemetry') {
    throw new Error('Unsupported telemetry format. Expected "ghost-driver-telemetry".');
  }
  if (input.version !== 1) {
    throw new Error(`Unsupported telemetry version: ${String(input.version)}.`);
  }
  if (!Array.isArray(input.samples)) {
    throw new Error('Telemetry is missing a samples array.');
  }
  if (input.samples.length < 2) {
    throw new Error('Telemetry needs at least two samples.');
  }

  const meta = isRecord(input.meta) ? (input.meta as TelemetryMeta) : {};
  const rangeDeg = finiteNumber(meta.steeringRangeDeg) ?? DEFAULT_RANGE_DEG;
  const units = meta.steeringUnits ?? 'deg';

  const samples: TelemetrySample[] = input.samples.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`Sample ${index} is not an object.`);
    const t = finiteNumber(raw.t);
    if (t === undefined) throw new Error(`Sample ${index} has no finite t.`);

    const sample: TelemetrySample = { t };
    for (const channel of NUMERIC_CHANNELS) {
      const value = finiteNumber(raw[channel]);
      if (value !== undefined) sample[channel] = value;
    }

    if (sample.steer !== undefined) {
      sample.steer = toDegrees(sample.steer, units, rangeDeg);
    }

    return sample;
  });

  samples.sort((a, b) => a.t - b.t);

  const allWithinHalfTurn = samples.every(
    (sample) => sample.steer === undefined || Math.abs(sample.steer) <= 180,
  );
  if (allWithinHalfTurn && rangeDeg > 360) unwrapSteering(samples);

  const hasSteering = samples.some((sample) => sample.steer !== undefined);
  if (!hasSteering) {
    throw new Error('Telemetry has no steering channel; tracking modes would not work.');
  }

  return new TelemetryTrack(meta, samples);
}

export function buildSyntheticTelemetry(duration = 120, hz = 60): TelemetryDocument {
  const samples: TelemetrySample[] = [];
  const count = Math.max(2, Math.round(duration * hz));

  for (let index = 0; index <= count; index += 1) {
    const t = index / hz;
    const rawSteer =
      120 * Math.sin(t * 0.9) +
      80 * Math.sin(t * 0.37 + 1.2) +
      35 * Math.sin(t * 2.1 + 0.4);
    const steer = 450 * Math.tanh(rawSteer / 220);

    const throttle = Math.max(0, Math.sin(t * 0.45 + 0.2));
    const brake = Math.max(0, -Math.sin(t * 0.45 + 0.2)) * 0.75;
    const speed = Math.max(0, 95 + 55 * Math.sin(t * 0.21 - 0.4));
    const gear = speed > 135 ? 6 : speed > 110 ? 5 : speed > 80 ? 4 : speed > 50 ? 3 : 2;
    const rpm = 3200 + ((speed * 37 + Math.abs(steer) * 4) % 4200);

    samples.push({
      t: Number(t.toFixed(4)),
      steer: Number(steer.toFixed(2)),
      throttle: Number(throttle.toFixed(3)),
      brake: Number(brake.toFixed(3)),
      speed: Number(speed.toFixed(1)),
      gear,
      rpm: Number(rpm.toFixed(0)),
      latAccel: Number((steer / 450).toFixed(3)),
    });
  }

  return {
    format: 'ghost-driver-telemetry',
    version: 1,
    meta: {
      source: 'synthetic',
      game: 'Ghost Driver demo',
      car: 'Synthetic GT',
      track: 'Sine circuit',
      steeringUnits: 'deg',
      steeringRangeDeg: 900,
      sampleRateHz: hz,
      duration,
      notes: 'Generated steering/telemetry for playback and sync testing.',
    },
    samples,
  };
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
