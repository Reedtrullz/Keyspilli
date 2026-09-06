const DRAWBAR_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8] as const;
const DRAWBAR_HARMONICS = [1, 3, 2, 4, 6, 8, 10, 12, 16] as const;

/** Classic-rock registration: strong fundamental, sub-octave and first overtones. */
export const ROCK_REGISTRATION = [8, 8, 8, 8, 0, 0, 0, 0, 0] as const;

export const ROTARY_SPEEDS = {
  slow: { lowHz: 0.45, highHz: 0.72 },
  fast: { lowHz: 5.2, highHz: 6.8 },
} as const;

export function drawbarAmplitude(digit: number): number {
  if (digit <= 0) return 0;
  return Math.pow(10, (-3 * (8 - Math.min(8, digit))) / 20);
}

export function tonewheelFrequencies(midi: number): number[] {
  const fundamental = 440 * Math.pow(2, (midi - 69) / 12);
  return DRAWBAR_RATIOS.map((ratio) => fundamental * ratio);
}

export function buildTonewheelCoefficients(registration: readonly number[]): {
  real: Float32Array;
  imag: Float32Array;
} {
  if (registration.length !== 9 || registration.some((digit) => !Number.isInteger(digit) || digit < 0 || digit > 8)) {
    throw new RangeError("Tonewheel registration must contain nine drawbar digits from 0 to 8");
  }
  const amplitudes = registration.map(drawbarAmplitude);
  const total = amplitudes.reduce((sum, amplitude) => sum + amplitude, 0) || 1;
  const real = new Float32Array(17);
  for (let i = 0; i < DRAWBAR_HARMONICS.length; i++) {
    real[DRAWBAR_HARMONICS[i]!] = amplitudes[i]! / total;
  }
  return { real, imag: new Float32Array(17) };
}

export function organVelocityLevel(velocity: number): number {
  return 0.75 + 0.25 * Math.min(127, Math.max(0, velocity)) / 127;
}

export function buildDriveCurve(drive: number, samples = 1024): Float32Array {
  const amount = Math.min(1, Math.max(0, drive));
  const curve = new Float32Array(samples);
  const strength = 1 + amount * 3;
  const norm = Math.tanh(strength);
  for (let i = 0; i < samples; i++) {
    const x = samples === 1 ? 0 : (i / (samples - 1)) * 2 - 1;
    curve[i] = amount === 0 ? x : Math.tanh(strength * x) / norm;
  }
  return curve;
}
