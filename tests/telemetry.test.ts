import { describe, expect, it } from 'vitest';
import {
  buildSyntheticTelemetry,
  formatDuration,
  parseTelemetry,
} from '../src/playback/telemetry';

describe('telemetry parsing and sampling', () => {
  it('interpolates continuous channels and holds gear', () => {
    const track = parseTelemetry({
      format: 'ghost-driver-telemetry',
      version: 1,
      meta: { steeringRangeDeg: 900, steeringUnits: 'deg' },
      samples: [
        { t: 0, steer: 0, throttle: 0, gear: 3, speed: 10 },
        { t: 1, steer: 90, throttle: 1, gear: 4, speed: 20 },
      ],
    });

    const state = track.sampleAt(0.5);
    expect(state.steer).toBeCloseTo(45, 6);
    expect(state.throttle).toBeCloseTo(0.5, 6);
    expect(state.speed).toBeCloseTo(15, 6);
    expect(state.gear).toBe(3);
    expect(state.gap).toBe(true);
    expect(state.stale).toBe(false);
  });

  it('converts normalized steering to degrees', () => {
    const track = parseTelemetry({
      format: 'ghost-driver-telemetry',
      version: 1,
      meta: { steeringRangeDeg: 900, steeringUnits: 'normalized' },
      samples: [
        { t: 0, steer: 0 },
        { t: 1, steer: 0.5 },
      ],
    });

    expect(track.sampleAt(1).steer).toBeCloseTo(225, 6);
  });

  it('unwraps steering across the 180 degree boundary', () => {
    const track = parseTelemetry({
      format: 'ghost-driver-telemetry',
      version: 1,
      meta: { steeringRangeDeg: 900, steeringUnits: 'deg' },
      samples: [
        { t: 0, steer: 170 },
        { t: 1, steer: -170 },
      ],
    });

    expect(track.sampleAt(1).steer).toBeCloseTo(190, 6);
  });

  it('marks time outside the track as stale', () => {
    const track = parseTelemetry({
      format: 'ghost-driver-telemetry',
      version: 1,
      samples: [
        { t: 1, steer: 0 },
        { t: 2, steer: 0 },
      ],
    });

    expect(track.sampleAt(0).stale).toBe(true);
    expect(track.sampleAt(3).stale).toBe(true);
  });

  it('rejects missing steering', () => {
    expect(() =>
      parseTelemetry({
        format: 'ghost-driver-telemetry',
        version: 1,
        samples: [
          { t: 0, speed: 0 },
          { t: 1, speed: 10 },
        ],
      }),
    ).toThrow(/steering/i);
  });

  it('builds a synthetic track with steering and metadata', () => {
    const document = buildSyntheticTelemetry(10, 60);
    const track = parseTelemetry(document);
    expect(document.samples).toHaveLength(601);
    expect(track.duration).toBeCloseTo(10, 6);
    expect(track.meta.game).toBe('Ghost Driver demo');
    expect(track.steeringRangeDeg).toBe(900);
    expect(track.sampleAt(5).steer).toBeTypeOf('number');
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65.9)).toBe('1:05');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });
});
