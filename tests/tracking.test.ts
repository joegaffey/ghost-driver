import { describe, expect, it } from 'vitest';
import { trackingForce } from '../src/playback/tracking';

describe('trackingForce', () => {
  it('drives toward the target when there is a large error', () => {
    expect(trackingForce(180, 0, 0)).toBeGreaterThan(0);
    expect(trackingForce(-180, 0, 0)).toBeLessThan(0);
  });

  it('damps motion toward the target', () => {
    const stationary = trackingForce(100, 0, 0);
    const moving = trackingForce(100, 0, 500);
    expect(moving).toBeLessThan(stationary);
  });

  it('zeroes force inside the deadband', () => {
    expect(trackingForce(0.4, 0, 5)).toBe(0);
    expect(trackingForce(-0.4, 0, -5)).toBe(0);
  });

  it('clamps the command to the normalized force range', () => {
    expect(trackingForce(2000, 0, 0)).toBe(1);
    expect(trackingForce(-2000, 0, 0)).toBe(-1);
  });
});
