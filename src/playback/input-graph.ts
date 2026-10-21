import type { TelemetryTrack } from './telemetry';

export const INPUT_GRAPH_WINDOW_SECONDS = 6;
const SAMPLE_HZ = 30;

const STEER_COLOR = '#3b82f6';
const THROTTLE_COLOR = '#2e9e5b';
const BRAKE_COLOR = '#d94b4b';

interface GraphPoint {
  steer: number;
  throttle: number;
  brake: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  points: GraphPoint[],
  width: number,
  height: number,
  valueOf: (point: GraphPoint) => number,
  color: string,
): void {
  if (points.length < 2) return;

  const inset = 3;
  const chartTop = inset;
  const chartBottom = height - inset;
  const chartHeight = chartBottom - chartTop;

  ctx.beginPath();
  for (let index = 0; index < points.length; index += 1) {
    const x = (index / (points.length - 1)) * width;
    const y = chartBottom - clamp(valueOf(points[index]), 0, 1) * chartHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

export function drawInputGraph(
  canvas: HTMLCanvasElement,
  track: TelemetryTrack | null,
  mediaTime: number,
  shiftSeconds: number,
): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  if (!track) return;

  const count = Math.max(2, Math.round(INPUT_GRAPH_WINDOW_SECONDS * SAMPLE_HZ));
  const step = INPUT_GRAPH_WINDOW_SECONDS / (count - 1);
  const start = mediaTime - INPUT_GRAPH_WINDOW_SECONDS;
  const halfRange = Math.max(1, track.steeringRangeDeg / 2);
  const points: GraphPoint[] = [];

  for (let index = 0; index < count; index += 1) {
    const sample = track.sampleAt(start + index * step + shiftSeconds);
    points.push({
      steer: 0.5 + clamp((sample.steer ?? 0) / halfRange, -1, 1) * 0.5,
      throttle: clamp(sample.throttle ?? 0, 0, 1),
      brake: clamp(sample.brake ?? 0, 0, 1),
    });
  }

  drawLine(ctx, points, width, height, (point) => point.throttle, THROTTLE_COLOR);
  drawLine(ctx, points, width, height, (point) => point.brake, BRAKE_COLOR);
  drawLine(ctx, points, width, height, (point) => point.steer, STEER_COLOR);
}
