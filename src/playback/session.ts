import type { TelemetryDocument } from './telemetry';

export type SessionVideoSource =
  | { type: 'youtube'; videoId: string }
  | { type: 'url'; url: string }
  | { type: 'local'; name: string };

export interface SessionVideo {
  id: string;
  label: string;
  source: SessionVideoSource;
  offsetMs: number;
}

export interface SessionMeta {
  title?: string;
  game?: string;
  car?: string;
  track?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface GhostDriverSession {
  format: 'ghost-driver-session';
  version: 1;
  meta: SessionMeta;
  telemetry: TelemetryDocument;
  videos: SessionVideo[];
  defaultVideoId?: string;
  ffbLeadMs: number;
}

export type SessionLoadResult =
  | { kind: 'session'; session: GhostDriverSession }
  | { kind: 'telemetry'; document: TelemetryDocument };

const MAX_VIDEO_OFFSET_MS = 2000;
const MIN_VIDEO_OFFSET_MS = -2000;
const MAX_FFB_LEAD_MS = 400;
const MIN_FFB_LEAD_MS = -200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSource(value: unknown): SessionVideoSource {
  if (!isRecord(value)) throw new Error('A video is missing its source.');

  if (value.type === 'youtube') {
    const videoId = stringValue(value.videoId);
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      throw new Error('A YouTube video is missing a valid videoId.');
    }
    return { type: 'youtube', videoId };
  }

  if (value.type === 'url') {
    const url = stringValue(value.url);
    if (!url) throw new Error('A URL video is missing its url.');
    return { type: 'url', url };
  }

  if (value.type === 'local') {
    const name = stringValue(value.name);
    if (!name) throw new Error('A local video is missing its file name.');
    return { type: 'local', name };
  }

  throw new Error('A video has an unsupported source type.');
}

function normalizeVideo(value: unknown, index: number): SessionVideo {
  if (!isRecord(value)) throw new Error(`Video ${index + 1} is not an object.`);

  return {
    id: stringValue(value.id) ?? createId(),
    label: stringValue(value.label) ?? `Camera ${index + 1}`,
    source: normalizeSource(value.source),
    offsetMs: numberInRange(
      value.offsetMs,
      0,
      MIN_VIDEO_OFFSET_MS,
      MAX_VIDEO_OFFSET_MS,
    ),
  };
}

function normalizeMeta(value: unknown): SessionMeta {
  return isRecord(value) ? (value as SessionMeta) : {};
}

function normalizeVideos(value: unknown): SessionVideo[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Session videos must be an array.');

  const videos = value.map(normalizeVideo);
  const ids = new Set<string>();
  for (const video of videos) {
    while (ids.has(video.id)) video.id = createId();
    ids.add(video.id);
  }
  return videos;
}

export function createSession(
  document: TelemetryDocument,
  videos: SessionVideo[] = [],
  ffbLeadMs = 0,
): GhostDriverSession {
  const meta = document.meta ?? {};
  const title =
    [meta.car, meta.track].filter(Boolean).join(' · ') ||
    meta.game ||
    'Ghost Driver session';

  return {
    format: 'ghost-driver-session',
    version: 1,
    meta: {
      ...meta,
      title,
    },
    telemetry: document,
    videos,
    defaultVideoId: videos[0]?.id,
    ffbLeadMs: numberInRange(ffbLeadMs, 0, MIN_FFB_LEAD_MS, MAX_FFB_LEAD_MS),
  };
}

export function parseSessionFile(text: string): SessionLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  if (!isRecord(parsed)) throw new Error('Telemetry session must be a JSON object.');

  if (parsed.format === 'ghost-driver-telemetry') {
    if (parsed.version !== 1) {
      throw new Error(`Unsupported telemetry version: ${String(parsed.version)}.`);
    }
    if (!Array.isArray(parsed.samples)) {
      throw new Error('Telemetry is missing a samples array.');
    }
    return { kind: 'telemetry', document: parsed as unknown as TelemetryDocument };
  }

  if (parsed.format !== 'ghost-driver-session') {
    throw new Error('Unsupported session or telemetry format.');
  }
  if (parsed.version !== 1) {
    throw new Error(`Unsupported session version: ${String(parsed.version)}.`);
  }
  if (!isRecord(parsed.telemetry)) {
    throw new Error('Session is missing embedded telemetry.');
  }

  const videos = normalizeVideos(parsed.videos);
  const defaultVideoId =
    stringValue(parsed.defaultVideoId) &&
    videos.some((video) => video.id === parsed.defaultVideoId)
      ? (parsed.defaultVideoId as string)
      : videos[0]?.id;

  return {
    kind: 'session',
    session: {
      format: 'ghost-driver-session',
      version: 1,
      meta: normalizeMeta(parsed.meta),
      telemetry: parsed.telemetry as unknown as TelemetryDocument,
      videos,
      defaultVideoId,
      ffbLeadMs: numberInRange(parsed.ffbLeadMs, 0, MIN_FFB_LEAD_MS, MAX_FFB_LEAD_MS),
    },
  };
}

export function serializeSession(session: GhostDriverSession): string {
  return `${JSON.stringify(session, null, 2)}\n`;
}

export function telemetryTimeFromVideo(videoTimeSeconds: number, offsetMs: number): number {
  return videoTimeSeconds + offsetMs / 1000;
}

export function videoTimeFromTelemetry(telemetryTimeSeconds: number, offsetMs: number): number {
  return telemetryTimeSeconds - offsetMs / 1000;
}

export function sessionSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'ghost-driver-session'
  );
}

export function exportableVideos(session: GhostDriverSession): SessionVideo[] {
  return session.videos.filter((video) => video.source.type !== 'local');
}
