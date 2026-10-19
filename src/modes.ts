export type DriveModeId = 'ghost-wheel' | 'co-driver' | 'force-feel' | 'visual';

export interface DriveModeDefinition {
  readonly id: DriveModeId;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  readonly usesFfb: boolean;
  readonly tracksPosition: boolean;
  readonly handsOff: boolean;
}

export const DRIVE_MODES: readonly DriveModeDefinition[] = [
  {
    id: 'ghost-wheel',
    name: 'Ghost Wheel',
    tagline: 'Hands off. Feel the lap drive itself.',
    description:
      'The wheel tracks the recorded steering angle with the strongest position authority. Use only with hands clear of the rim.',
    usesFfb: true,
    tracksPosition: true,
    handsOff: true,
  },
  {
    id: 'co-driver',
    name: 'Co-Driver',
    tagline: 'Hands on. The wheel helps, you stay in control.',
    description:
      'Softer tracking and more damping so the viewer can hold the wheel and override the ghost driver.',
    usesFfb: true,
    tracksPosition: true,
    handsOff: false,
  },
  {
    id: 'force-feel',
    name: 'Force-Feel',
    tagline: 'Forces and vibration without position tracking.',
    description:
      'Replays steering weight and optional effects without trying to hold an absolute angle. Safer for wheels without position feedback.',
    usesFfb: true,
    tracksPosition: false,
    handsOff: false,
  },
  {
    id: 'visual',
    name: 'Visual',
    tagline: 'Video and telemetry overlay only.',
    description:
      'No force feedback. Works with any browser and is the fallback when no compatible wheel is connected.',
    usesFfb: false,
    tracksPosition: false,
    handsOff: false,
  },
];

export function getDriveMode(id: DriveModeId): DriveModeDefinition {
  const mode = DRIVE_MODES.find((candidate) => candidate.id === id);
  if (!mode) {
    throw new Error(`Unknown drive mode: ${id}`);
  }
  return mode;
}
