import { describe, expect, it } from 'vitest';
import {
  buildSample,
  convertSteering,
  findChannels,
  findMetadata,
  flattenJson,
  guessSteeringUnit,
  normalizeKey,
} from '../tools/lib/simhub.mjs';

const snapshot = {
  GameData: {
    NewData: {
      Steering: 0.5,
      SteeringTorque: 1.25,
      Throttle: 40,
      Brake: 0,
      SpeedKmh: 120,
      Gear: 4,
      Rpms: 6200,
      LatAccel: -1.2,
      LongAccel: 0.3,
    },
  },
};

describe('SimHub helpers', () => {
  it('flattens nested objects to dot paths', () => {
    const flat = flattenJson(snapshot);
    expect(flat['GameData.NewData.Steering']).toBe(0.5);
    expect(flat['GameData.NewData.SpeedKmh']).toBe(120);
  });

  it('normalizes keys for matching', () => {
    expect(normalizeKey('GameData.NewData.Steering Angle')).toBe('gamedatanewdatasteeringangle');
  });

  it('finds steering without confusing it with steering torque', () => {
    const flat = flattenJson(snapshot);
    const { channels, warnings } = findChannels(flat);
    expect(channels.steer?.path).toBe('GameData.NewData.Steering');
    expect(channels.steerTorque?.path).toBe('GameData.NewData.SteeringTorque');
    expect(warnings).toEqual([]);
  });

  it('finds game, car and track metadata', () => {
    const flat = flattenJson({
      GameName: 'Assetto Corsa Competizione',
      GameData: { CarName: 'Porsche 992 GT3 R', TrackName: 'Spa-Francorchamps' },
    });
    const metadata = findMetadata(flat);
    expect(metadata.game).toBe('Assetto Corsa Competizione');
    expect(metadata.car).toBe('Porsche 992 GT3 R');
    expect(metadata.track).toBe('Spa-Francorchamps');
  });

  it('warns when steering is missing', () => {
    const flat = flattenJson({ GameData: { SpeedKmh: 100, Gear: 3 } });
    const { channels, warnings } = findChannels(flat);
    expect(channels.steer).toBeUndefined();
    expect(warnings.some((warning) => warning.includes('No steering channel'))).toBe(true);
  });

  it('supports explicit channel overrides', () => {
    const flat = flattenJson({ Custom: { Wheel: 12 } });
    const { channels } = findChannels(flat, { steer: 'Custom.Wheel' });
    expect(channels.steer?.path).toBe('Custom.Wheel');
    expect(channels.steer?.score).toBe(999);
  });

  it('guesses steering units from magnitude', () => {
    expect(guessSteeringUnit(0.4)).toBe('normalized');
    expect(guessSteeringUnit(40)).toBe('percent');
    expect(guessSteeringUnit(240)).toBe('deg');
  });

  it('converts normalized, percent and degrees to degrees', () => {
    expect(convertSteering(0.5, 'normalized', 900)).toBe(225);
    expect(convertSteering(50, 'percent', 900)).toBe(225);
    expect(convertSteering(90, 'deg', 900)).toBe(90);
    expect(convertSteering(Math.PI / 2, 'rad', 900)).toBeCloseTo(90, 6);
  });

  it('builds a canonical sample with pedal and steering conversion', () => {
    const flat = flattenJson(snapshot);
    const { channels } = findChannels(flat);
    const sample = buildSample(flat, channels, {
      t: 1.23456789,
      steeringUnit: 'normalized',
      steeringRangeDeg: 900,
    });

    expect(sample.t).toBe(1.234568);
    expect(sample.steer).toBe(225);
    expect(sample.steerTorque).toBe(1.25);
    expect(sample.throttle).toBe(0.4);
    expect(sample.brake).toBe(0);
    expect(sample.speed).toBe(120);
    expect(sample.gear).toBe(4);
    expect(sample.rpm).toBe(6200);
    expect(sample.latAccel).toBe(-1.2);
    expect(sample.longAccel).toBe(0.3);
  });
});
