/** Minimal OBS WebSocket v5 client for the capture tools. */
import { createHash } from 'node:crypto';

/**
 * Build the OBS WebSocket authentication string.
 * @param {string} password
 * @param {{ challenge: string, salt: string }} authentication
 */
export function createAuthString(password, authentication) {
  const sha256Base64 = (value) => createHash('sha256').update(value).digest('base64');
  const secret = sha256Base64(`${password}${authentication.salt}`);
  return sha256Base64(`${secret}${authentication.challenge}`);
}

const CLOSE_REASONS = {
  4002: 'Message decode error',
  4007: 'Not identified',
  4008: 'Already identified',
  4009: 'Authentication failed',
  4010: 'Unsupported RPC version',
  4011: 'Session invalidated',
  4012: 'Unsupported feature',
};

/** @param {string} type @param {unknown} [data] */
function obsError(type, data) {
  const message = data?.requestStatus?.comment ?? data?.requestStatus?.code ?? 'unknown error';
  return new Error(`${type} failed: ${message}`);
}

export class ObsClient {
  /**
   * @param {{ url?: string, password?: string, timeoutMs?: number }} [options]
   */
  constructor(options = {}) {
    this.url = options.url ?? 'ws://127.0.0.1:4455';
    this.password = options.password ?? '';
    this.timeoutMs = options.timeoutMs ?? 5000;
    /** @type {WebSocket | null} */
    this.ws = null;
    /** @type {Map<string, { resolve: (value: unknown) => void, reject: (error: Error) => void, timer: NodeJS.Timeout, type: string }>} */
    this.pending = new Map();
    /** @type {Set<(event: { eventType: string, eventData?: Record<string, unknown> }) => void>} */
    this.listeners = new Set();
    this.identified = false;
    this.version = null;
  }

  async connect() {
    if (typeof WebSocket === 'undefined') {
      throw new Error('This Node.js build has no global WebSocket. Use Node 22+ for OBS capture.');
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, 'obswebsocket.json');
      this.ws = ws;
      let settled = false;

      const timer = setTimeout(() => {
        fail(new Error(`Timed out connecting to OBS at ${this.url}`));
        ws.close();
      }, this.timeoutMs);

      /** @param {Error} error */
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };

      ws.addEventListener('message', (event) => {
        let message;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (message.op === 0) {
          const hello = message.d ?? {};
          /** @type {{ rpcVersion: number, authentication?: string, eventSubscriptions: number }} */
          const identify = { rpcVersion: 1, eventSubscriptions: 1 << 6 };
          if (hello.authentication) {
            if (!this.password) {
              fail(
                new Error(
                  'OBS WebSocket requires a password. Pass --obs-password or set OBS_PASSWORD.',
                ),
              );
              ws.close();
              return;
            }
            identify.authentication = createAuthString(this.password, hello.authentication);
          }
          ws.send(JSON.stringify({ op: 1, d: identify }));
          return;
        }

        if (message.op === 2) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.identified = true;
          resolve(this);
          return;
        }

        if (message.op === 7) {
          const data = message.d ?? {};
          const pending = this.pending.get(data.requestId);
          if (!pending) return;
          this.pending.delete(data.requestId);
          clearTimeout(pending.timer);
          if (data.requestStatus?.result) {
            pending.resolve(data.responseData ?? {});
          } else {
            pending.reject(obsError(pending.type, data));
          }
          return;
        }

        if (message.op === 5) {
          const event = message.d ?? {};
          for (const listener of this.listeners) {
            try {
              listener(event);
            } catch {
              // A listener must not break the protocol loop.
            }
          }
        }
      });

      ws.addEventListener('close', (event) => {
        const reason = CLOSE_REASONS[event.code] ?? event.reason ?? 'unknown';
        const error = new Error(`OBS WebSocket closed (${event.code}: ${reason})`);
        if (!settled) fail(error);
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.pending.clear();
        this.identified = false;
      });

      ws.addEventListener('error', () => {
        // A close event follows; it carries the useful error.
      });
    });
  }

  /**
   * @param {string} requestType
   * @param {Record<string, unknown>} [requestData]
   * @param {number} [timeoutMs]
   * @returns {Promise<Record<string, unknown>>}
   */
  request(requestType, requestData, timeoutMs = this.timeoutMs) {
    if (!this.ws || !this.identified) {
      return Promise.reject(new Error('OBS WebSocket is not connected.'));
    }

    const requestId = `${requestType}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${requestType} timed out after ${timeoutMs} ms`));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer, type: requestType });
      this.ws.send(
        JSON.stringify({
          op: 6,
          d: { requestType, requestId, ...(requestData ? { requestData } : {}) },
        }),
      );
    });
  }

  async getVersion() {
    const data = await this.request('GetVersion');
    this.version = data;
    return data;
  }

  async getRecordStatus() {
    return this.request('GetRecordStatus');
  }

  /**
   * Wait for an OBS event matching the predicate.
   * @param {(event: { eventType: string, eventData?: Record<string, unknown> }) => boolean} predicate
   * @param {number} [timeoutMs]
   */
  waitForEvent(predicate, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error('Timed out waiting for an OBS event.'));
      }, timeoutMs);

      const unsubscribe = this.onEvent((event) => {
        if (!predicate(event)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      });
    });
  }

  /** @param {(event: { eventType: string, eventData?: Record<string, unknown> }) => void} listener */
  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async setScene(sceneName) {
    return this.request('SetCurrentProgramScene', { sceneName });
  }

  async startRecording() {
    const status = await this.getRecordStatus();
    if (status.outputActive) {
      throw new Error('OBS is already recording. Stop the recording first.');
    }

    const started = this.waitForEvent(
      (event) =>
        event.eventType === 'RecordStateChanged' &&
        event.eventData?.outputActive === true,
      15000,
    );
    await this.request('StartRecord');
    await started;
  }

  async stopRecording() {
    const stopped = this.waitForEvent(
      (event) =>
        event.eventType === 'RecordStateChanged' &&
        event.eventData?.outputActive === false,
      15000,
    );
    const data = await this.request('StopRecord', undefined, 15000);
    await stopped;
    return typeof data.outputPath === 'string' ? data.outputPath : undefined;
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
    this.identified = false;
  }
}
