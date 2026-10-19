#!/usr/bin/env node
import { createServer } from 'node:http';

const HELP = `
Mock SimHub game-data endpoint for local testing

Usage:
  node tools/mock-simhub.mjs [options]

Options:
  --port <number>   Port to listen on (default: 8899)
  -h, --help        Show this help

Then run:
  node tools/simhub-probe.mjs --url http://127.0.0.1:8899/api/GetGamedata
  node tools/simhub-record.mjs --url http://127.0.0.1:8899/api/GetGamedata --duration 5
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

const port = Math.max(1, Number(argValue('--port', '8899')) || 8899);
const start = performance.now();

function snapshot() {
  const t = (performance.now() - start) / 1000;
  const steer = Math.sin(t * 0.9) * 0.8;
  const throttle = Math.max(0, Math.sin(t * 0.35));
  const brake = Math.max(0, -Math.sin(t * 0.35)) * 0.6;
  const speed = 80 + Math.sin(t * 0.2) * 40;

  return {
    GameName: 'Ghost Driver Mock',
    GameRunning: true,
    GameData: {
      NewData: {
        Steering: steer,
        SteeringTorque: steer * 2.5,
        Throttle: throttle,
        Brake: brake,
        SpeedKmh: speed,
        Gear: speed > 100 ? 4 : speed > 60 ? 3 : 2,
        Rpms: 3000 + Math.abs(steer) * 4000,
        SessionTime: t,
        LatAccel: -steer * 1.2,
        LongAccel: throttle * 0.4 - brake * 0.7,
      },
    },
  };
}

const server = createServer((request, response) => {
  if (request.url?.startsWith('/api/GetGamedata') || request.url === '/') {
    const body = JSON.stringify(snapshot());
    response.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    response.end(body);
    return;
  }

  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock SimHub: http://127.0.0.1:${port}/api/GetGamedata`);
  console.log('Press Ctrl+C to stop.');
});
