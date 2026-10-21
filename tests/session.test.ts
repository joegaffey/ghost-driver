import { describe, expect, it } from 'vitest';
import {
  createSession,
  exportableVideos,
  parseSessionFile,
  serializeSession,
  telemetryTimeFromVideo,
  videoTimeFromTelemetry,
} from '../src/playback/session';
import { buildSyntheticTelemetry } from '../src/playback/telemetry';

const telemetry = buildSyntheticTelemetry(10, 60);

describe('session format', () => {
  it('round-trips a session with embedded telemetry', () => {
    const session = createSession(
      telemetry,
      [
        {
          id: 'cockpit',
          label: 'Cockpit',
          source: { type: 'youtube', videoId: 'M7lc1UVf-VE' },
          offsetMs: 120,
        },
      ],
      -50,
    );

    const result = parseSessionFile(serializeSession(session));
    expect(result.kind).toBe('session');
    if (result.kind !== 'session') return;
    expect(result.session.telemetry.samples).toHaveLength(telemetry.samples.length);
    expect(result.session.videos[0].label).toBe('Cockpit');
    expect(result.session.videos[0].offsetMs).toBe(120);
    expect(result.session.ffbLeadMs).toBe(-50);
    expect(result.session.defaultVideoId).toBe('cockpit');
  });

  it('accepts legacy telemetry files', () => {
    const result = parseSessionFile(JSON.stringify(telemetry));
    expect(result.kind).toBe('telemetry');
  });

  it('falls back to the first video when the default is missing', () => {
    const result = parseSessionFile(
      JSON.stringify({
        format: 'ghost-driver-session',
        version: 1,
        telemetry,
        videos: [
          {
            id: 'one',
            label: 'One',
            source: { type: 'url', url: 'https://example.com/one.mp4' },
            offsetMs: 0,
          },
        ],
        defaultVideoId: 'missing',
      }),
    );
    expect(result.kind).toBe('session');
    if (result.kind !== 'session') return;
    expect(result.session.defaultVideoId).toBe('one');
  });

  it('clamps video offsets and lead', () => {
    const result = parseSessionFile(
      JSON.stringify({
        format: 'ghost-driver-session',
        version: 1,
        telemetry,
        ffbLeadMs: 9999,
        videos: [
          {
            id: 'one',
            label: 'One',
            source: { type: 'url', url: 'https://example.com/one.mp4' },
            offsetMs: -9999,
          },
        ],
      }),
    );
    expect(result.kind).toBe('session');
    if (result.kind !== 'session') return;
    expect(result.session.videos[0].offsetMs).toBe(-2000);
    expect(result.session.ffbLeadMs).toBe(400);
  });

  it('maps between telemetry and video time', () => {
    expect(telemetryTimeFromVideo(10, 250)).toBe(10.25);
    expect(videoTimeFromTelemetry(10.25, 250)).toBe(10);
  });

  it('filters preview-only local videos from exports', () => {
    const session = createSession(telemetry, [
      {
        id: 'local',
        label: 'Local',
        source: { type: 'local', name: 'lap.mp4' },
        offsetMs: 0,
      },
      {
        id: 'youtube',
        label: 'YouTube',
        source: { type: 'youtube', videoId: 'M7lc1UVf-VE' },
        offsetMs: 0,
      },
    ]);
    expect(exportableVideos(session).map((video) => video.id)).toEqual(['youtube']);
  });

  it('rejects unsupported files', () => {
    expect(() => parseSessionFile('{}')).toThrow(/unsupported/i);
    expect(() => parseSessionFile('not json')).toThrow(/valid JSON/i);
  });
});
