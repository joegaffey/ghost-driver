#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { createAuthString } from './lib/obs.mjs';

const HELP = `
Mock OBS WebSocket server for local testing

Usage:
  node tools/mock-obs.mjs [options]

Options:
  --port <number>       Port to listen on (default: 4456)
  --password <pass>     Require this WebSocket password
  -h, --help            Show this help

Then run:
  node tools/obs-capture.mjs \\
    --obs-url ws://127.0.0.1:4456 \\
    --simhub-url http://127.0.0.1:8899/api/GetGamedata \\
    --countdown 0 --duration 3
`;

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP.trim());
  process.exit(0);
}

function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  return args[index + 1] ?? fallback;
}

const port = Math.max(1, Number(argValue('--port', '4456')) || 4456);
const password = argValue('--password', '');

const wss = new WebSocketServer({ port, host: '127.0.0.1' });

let recording = false;
let recordStartedAt = 0;

/** @param {import('ws').WebSocket} client @param {number} op @param {unknown} data */
function send(client, op, data) {
  client.send(JSON.stringify({ op, d: data }));
}

/** @param {import('ws').WebSocket} client @param {string} requestType @param {string} requestId @param {Record<string, unknown>} [responseData] */
function respond(client, requestType, requestId, responseData) {
  send(client, 7, {
    requestType,
    requestId,
    requestStatus: { result: true, code: 100 },
    ...(responseData ? { responseData } : {}),
  });
}

function fail(client, requestType, requestId, code, comment) {
  send(client, 7, {
    requestType,
    requestId,
    requestStatus: { result: false, code, comment },
  });
}

function recordEvent(client, active, outputPath) {
  send(client, 5, {
    eventType: 'RecordStateChanged',
    eventIntent: 64,
    eventData: {
      outputActive: active,
      outputState: active ? 'OBS_WEBSOCKET_OUTPUT_STARTED' : 'OBS_WEBSOCKET_OUTPUT_STOPPED',
      outputPath: outputPath ?? null,
    },
  });
}

wss.on('connection', (client) => {
  const authentication = password
    ? {
        challenge: Buffer.from(`challenge-${Math.random()}`).toString('base64'),
        salt: Buffer.from(`salt-${Math.random()}`).toString('base64'),
      }
    : undefined;

  send(client, 0, {
    obsStudioVersion: '31.0.0-mock',
    obsWebSocketVersion: '5.5.0-mock',
    rpcVersion: 1,
    ...(authentication ? { authentication } : {}),
  });

  let identified = false;

  client.on('message', async (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      client.close(4002, 'MessageDecodeError');
      return;
    }

    if (!identified) {
      if (message.op !== 1) {
        client.close(4007, 'NotIdentified');
        return;
      }

      if (authentication) {
        const expected = createAuthString(password, authentication);
        if (message.d?.authentication !== expected) {
          client.close(4009, 'AuthenticationFailed');
          return;
        }
      }

      identified = true;
      send(client, 2, { negotiatedRpcVersion: 1 });
      return;
    }

    if (message.op !== 6) return;

    const requestType = message.d?.requestType;
    const requestId = message.d?.requestId ?? 'unknown';
    const requestData = message.d?.requestData ?? {};

    switch (requestType) {
      case 'GetVersion':
        respond(client, requestType, requestId, {
          obsVersion: '31.0.0-mock',
          obsWebSocketVersion: '5.5.0-mock',
          rpcVersion: 1,
          availableRequests: ['GetVersion', 'GetRecordStatus', 'StartRecord', 'StopRecord'],
          supportedImageFormats: [],
          platform: process.platform,
          platformDescription: 'Mock OBS',
        });
        return;

      case 'GetRecordStatus':
        respond(client, requestType, requestId, {
          outputActive: recording,
          outputPaused: false,
          outputTimecode: '00:00:00.000',
          outputDuration: recording ? Date.now() - recordStartedAt : 0,
          outputBytes: 0,
        });
        return;

      case 'StartRecord':
        if (recording) {
          fail(client, requestType, requestId, 500, 'OutputRunning');
          return;
        }
        recording = true;
        recordStartedAt = Date.now();
        respond(client, requestType, requestId);
        recordEvent(client, true);
        return;

      case 'StopRecord': {
        if (!recording) {
          fail(client, requestType, requestId, 501, 'OutputNotRunning');
          return;
        }
        recording = false;
        const outputDir = join(process.cwd(), 'captures', 'mock-obs');
        const outputPath = join(outputDir, `mock-${Date.now()}.mp4`);
        await mkdir(outputDir, { recursive: true });
        await writeFile(outputPath, Buffer.from('mock video'));
        respond(client, requestType, requestId, { outputPath });
        recordEvent(client, false, outputPath);
        return;
      }

      case 'SetCurrentProgramScene':
        if (!requestData.sceneName) {
          fail(client, requestType, requestId, 300, 'Missing sceneName');
          return;
        }
        respond(client, requestType, requestId);
        return;

      default:
        fail(client, requestType, requestId, 204, `Unknown request type: ${requestType}`);
    }
  });
});

console.log(`Mock OBS WebSocket: ws://127.0.0.1:${port}`);
if (password) console.log('Password required.');
console.log('Press Ctrl+C to stop.');
