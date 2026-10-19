import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { ObsClient, createAuthString } from '../tools/lib/obs.mjs';

describe('OBS WebSocket helpers', () => {
  it('creates the documented authentication string shape', () => {
    const auth = createAuthString('supersecretpassword', {
      challenge: '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=',
      salt: 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=',
    });
    expect(auth).toBe('1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=');
  });

  it('connects, authenticates, starts and stops recording', async () => {
    const password = 'secret';
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((resolve) => wss.once('listening', resolve));

    const address = wss.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    let recording = false;

    wss.on('connection', (socket) => {
      const authentication = {
        challenge: 'Y2hhbGxlbmdl',
        salt: 'c2FsdA==',
      };

      socket.send(
        JSON.stringify({
          op: 0,
          d: {
            obsStudioVersion: 'test',
            obsWebSocketVersion: '5.5.0',
            rpcVersion: 1,
            authentication,
          },
        }),
      );

      let identified = false;

      socket.on('message', (raw) => {
        const message = JSON.parse(String(raw));

        if (!identified) {
          expect(message.op).toBe(1);
          expect(message.d.authentication).toBe(createAuthString(password, authentication));
          identified = true;
          socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
          return;
        }

        const { requestType, requestId } = message.d;
        const response = (responseData) =>
          socket.send(
            JSON.stringify({
              op: 7,
              d: {
                requestType,
                requestId,
                requestStatus: { result: true, code: 100 },
                ...(responseData ? { responseData } : {}),
              },
            }),
          );

        if (requestType === 'GetVersion') {
          response({ obsVersion: 'test', obsWebSocketVersion: '5.5.0', rpcVersion: 1 });
          return;
        }

        if (requestType === 'GetRecordStatus') {
          response({ outputActive: recording, outputPaused: false, outputDuration: 0, outputBytes: 0 });
          return;
        }

        if (requestType === 'StartRecord') {
          recording = true;
          response();
          socket.send(
            JSON.stringify({
              op: 5,
              d: {
                eventType: 'RecordStateChanged',
                eventIntent: 64,
                eventData: { outputActive: true, outputState: 'STARTED', outputPath: null },
              },
            }),
          );
          return;
        }

        if (requestType === 'StopRecord') {
          recording = false;
          response({ outputPath: 'C:/videos/test.mp4' });
          socket.send(
            JSON.stringify({
              op: 5,
              d: {
                eventType: 'RecordStateChanged',
                eventIntent: 64,
                eventData: {
                  outputActive: false,
                  outputState: 'STOPPED',
                  outputPath: 'C:/videos/test.mp4',
                },
              },
            }),
          );
        }
      });
    });

    const client = new ObsClient({ url: `ws://127.0.0.1:${port}`, password });

    try {
      await client.connect();
      const version = await client.getVersion();
      expect(version.obsVersion).toBe('test');

      await client.startRecording();
      const path = await client.stopRecording();
      expect(path).toBe('C:/videos/test.mp4');
    } finally {
      client.close();
      await new Promise((resolve) => wss.close(resolve));
    }
  });
});
