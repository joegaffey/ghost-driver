export const TRACKING_KP = 0.008;
export const TRACKING_KD = 0.002;
export const TRACKING_INTERVAL_MS = 25;
export const TRACKING_RESEND_MS = 250;

export function trackingForce(
  targetDeg: number,
  actualDeg: number,
  actualRateDegPerSecond: number,
): number {
  const error = targetDeg - actualDeg;
  const command = TRACKING_KP * error - TRACKING_KD * actualRateDegPerSecond;

  if (Math.abs(error) < 1 && Math.abs(actualRateDegPerSecond) < 20) return 0;
  return Math.max(-1, Math.min(1, command));
}
