import { describe, expect, it } from 'vitest';
import { DRIVE_MODES, getDriveMode } from '../src/modes';

describe('drive modes', () => {
  it('defines the four v1 modes with unique ids', () => {
    expect(DRIVE_MODES).toHaveLength(4);
    const ids = DRIVE_MODES.map((mode) => mode.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps Ghost Wheel positional and hands-off', () => {
    const mode = getDriveMode('ghost-wheel');
    expect(mode.tracksPosition).toBe(true);
    expect(mode.usesFfb).toBe(true);
    expect(mode.handsOff).toBe(true);
  });

  it('keeps Co-Driver positional but hands-on', () => {
    const mode = getDriveMode('co-driver');
    expect(mode.tracksPosition).toBe(true);
    expect(mode.usesFfb).toBe(true);
    expect(mode.handsOff).toBe(false);
  });

  it('does not position-track in Force-Feel', () => {
    const mode = getDriveMode('force-feel');
    expect(mode.tracksPosition).toBe(false);
    expect(mode.usesFfb).toBe(true);
  });

  it('uses no force feedback in Visual mode', () => {
    const mode = getDriveMode('visual');
    expect(mode.usesFfb).toBe(false);
  });
});
