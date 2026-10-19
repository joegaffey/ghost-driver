export type MediaEvent =
  | 'play'
  | 'pause'
  | 'seeking'
  | 'seeked'
  | 'waiting'
  | 'playing'
  | 'ended'
  | 'ratechange'
  | 'error'
  | 'durationchange'
  | 'loadedmetadata';

type Listener = () => void;

export interface MediaClock {
  readonly kind: 'html' | 'youtube' | 'synthetic';
  time(): number;
  duration(): number;
  playing(): boolean;
  rate(): number;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): Promise<void>;
  on(event: MediaEvent, listener: Listener): () => void;
  destroy(): void;
}

abstract class BaseClock implements MediaClock {
  abstract readonly kind: 'html' | 'youtube' | 'synthetic';

  private listeners = new Map<MediaEvent, Set<Listener>>();

  abstract time(): number;
  abstract duration(): number;
  abstract playing(): boolean;
  abstract rate(): number;
  abstract play(): Promise<void>;
  abstract pause(): void;
  abstract seek(seconds: number): Promise<void>;

  on(event: MediaEvent, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => set?.delete(listener);
  }

  protected emit(event: MediaEvent): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  destroy(): void {
    this.listeners.clear();
  }
}

const HTML_EVENTS: MediaEvent[] = [
  'play',
  'pause',
  'seeking',
  'seeked',
  'waiting',
  'playing',
  'ended',
  'ratechange',
  'error',
  'durationchange',
  'loadedmetadata',
];

export class HtmlVideoClock extends BaseClock {
  readonly kind = 'html' as const;

  private video: HTMLVideoElement;
  private handlers: Array<[MediaEvent, EventListener]> = [];

  constructor(video: HTMLVideoElement) {
    super();
    this.video = video;

    for (const event of HTML_EVENTS) {
      const handler: EventListener = () => this.emit(event);
      video.addEventListener(event, handler);
      this.handlers.push([event, handler]);
    }
  }

  time(): number {
    return Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0;
  }

  duration(): number {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }

  playing(): boolean {
    return !this.video.paused && !this.video.ended && this.video.readyState >= 2;
  }

  rate(): number {
    return this.video.playbackRate;
  }

  async play(): Promise<void> {
    await this.video.play();
  }

  pause(): void {
    this.video.pause();
  }

  async seek(seconds: number): Promise<void> {
    const duration = this.duration();
    this.video.currentTime = Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds);
  }

  destroy(): void {
    for (const [event, handler] of this.handlers) {
      this.video.removeEventListener(event, handler);
    }
    this.handlers = [];
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    super.destroy();
  }
}

export class SyntheticClock extends BaseClock {
  readonly kind = 'synthetic' as const;

  private length: number;
  private current = 0;
  private startedAt = 0;
  private running = false;

  constructor(durationSeconds: number) {
    super();
    this.length = Math.max(0, durationSeconds);
  }

  time(): number {
    if (!this.running) return this.current;

    const value = this.current + (performance.now() - this.startedAt) / 1000;
    if (value >= this.length) {
      this.current = this.length;
      this.running = false;
      this.emit('pause');
      this.emit('ended');
      return this.length;
    }
    return value;
  }

  duration(): number {
    return this.length;
  }

  playing(): boolean {
    return this.running;
  }

  rate(): number {
    return 1;
  }

  async play(): Promise<void> {
    if (this.current >= this.length) this.current = 0;
    this.startedAt = performance.now();
    this.running = true;
    this.emit('play');
    this.emit('playing');
  }

  pause(): void {
    this.current = this.time();
    this.running = false;
    this.emit('pause');
  }

  async seek(seconds: number): Promise<void> {
    this.current = Math.max(0, Math.min(seconds, this.length));
    this.startedAt = performance.now();
    this.emit('seeking');
    this.emit('seeked');
  }

  destroy(): void {
    this.running = false;
    super.destroy();
  }
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  destroy(): void;
}

interface YTStateChangeEvent {
  data: number;
  target: YTPlayer;
}

interface YTErrorEvent {
  data: number;
  target: YTPlayer;
}

interface YTPlayerOptions {
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: () => void;
    onStateChange?: (event: YTStateChangeEvent) => void;
    onError?: (event: YTErrorEvent) => void;
  };
}

interface YTNamespace {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YTNamespace> | null = null;

export function parseYouTubeId(input: string): string | null {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value.startsWith('http') ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  let id: string | null = null;

  if (host === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      const parts = url.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) {
        id = parts[1] ?? null;
      }
    }
  }

  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timeout = 0;
    let interval = 0;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.clearInterval(interval);
      if (error) reject(error);
      else if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube IFrame API loaded without a Player.'));
    };

    timeout = window.setTimeout(() => {
      finish(new Error('YouTube IFrame API did not load within 15 seconds.'));
    }, 15000);

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      finish();
    };

    interval = window.setInterval(() => {
      if (window.YT?.Player) finish();
    }, 100);

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => finish(new Error('Failed to load the YouTube IFrame API.'));
      document.head.append(script);
    }
  });

  return youtubeApiPromise;
}

export class YouTubeClock extends BaseClock {
  readonly kind = 'youtube' as const;

  private player: YTPlayer;
  private host: HTMLElement;

  private constructor(player: YTPlayer, host: HTMLElement) {
    super();
    this.player = player;
    this.host = host;
  }

  static async create(container: HTMLElement, videoId: string): Promise<YouTubeClock> {
    const api = await loadYouTubeApi();

    return new Promise((resolve, reject) => {
      const host = document.createElement('div');
      host.className = 'yt-host';
      container.append(host);

      let clock: YouTubeClock | null = null;
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        host.remove();
        reject(error);
      };

      const player = new api.Player(host, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          controls: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
        },
        events: {
          onReady: () => {
            if (settled) return;
            settled = true;
            clock = new YouTubeClock(player, host);
            resolve(clock);
          },
          onStateChange: (event) => clock?.handleState(event.data),
          onError: () => {
            if (clock) clock.emit('error');
            else fail(new Error('YouTube player failed to load the video.'));
          },
        },
      });
    });
  }

  private handleState(state: number): void {
    switch (state) {
      case 0:
        this.emit('ended');
        break;
      case 1:
        this.emit('play');
        this.emit('playing');
        break;
      case 2:
        this.emit('pause');
        break;
      case 3:
        this.emit('waiting');
        break;
      case 5:
        this.emit('loadedmetadata');
        break;
      default:
        break;
    }
  }

  time(): number {
    const value = this.player.getCurrentTime();
    return Number.isFinite(value) ? value : 0;
  }

  duration(): number {
    const value = this.player.getDuration();
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  playing(): boolean {
    return this.player.getPlayerState() === 1;
  }

  rate(): number {
    const value = this.player.getPlaybackRate();
    return Number.isFinite(value) ? value : 1;
  }

  async play(): Promise<void> {
    this.player.playVideo();
  }

  pause(): void {
    this.player.pauseVideo();
  }

  async seek(seconds: number): Promise<void> {
    this.player.seekTo(Math.max(0, seconds), true);
  }

  destroy(): void {
    this.player.destroy();
    this.host.remove();
    super.destroy();
  }
}
