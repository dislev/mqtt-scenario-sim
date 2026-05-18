export type SensorMode = 'sinusoidal' | 'normal' | 'drift' | 'spike';

export interface SensorRange {
  low: number;
  high: number;
}

export interface ResolvedRange {
  baseline: number;
  amplitude: number;
  min: number;
  max: number;
  driftRate: number;
  spikeProbability: number;
  spikeMagnitude: number;
}

export interface SensorState {
  config: {
    mode: SensorMode;
    periodSeconds: number;
    intervalMs: number;
  };
  resolved: ResolvedRange;
  phase: number;
  driftValue: number;
  currentBias: number;
  lastValue: number | null;
  lastPublishedAt: number | null;
}

export function resolveRange(
  range: SensorRange,
  overrides: {
    baseline?: number;
    amplitude?: number;
    driftRate?: number;
    spikeProbability?: number;
    spikeMagnitude?: number;
    min?: number;
    max?: number;
  } = {},
): ResolvedRange {
  const span = range.high - range.low;
  return {
    baseline:         overrides.baseline         ?? (range.low + range.high) / 2,
    amplitude:        overrides.amplitude         ?? span / 2,
    min:              overrides.min               ?? range.low,
    max:              overrides.max               ?? range.high,
    driftRate:        overrides.driftRate         ?? span * 0.002,
    spikeProbability: overrides.spikeProbability  ?? 0.03,
    spikeMagnitude:   overrides.spikeMagnitude    ?? span * 0.25,
  };
}

export function createSensorState(cfg: {
  mode: SensorMode;
  range: SensorRange;
  baseline?: number;
  amplitude?: number;
  driftRate?: number;
  spikeProbability?: number;
  spikeMagnitude?: number;
  min?: number;
  max?: number;
  periodSeconds?: number;
  intervalMs: number;
}): SensorState {
  const resolved = resolveRange(cfg.range, cfg);
  return {
    config: {
      mode: cfg.mode,
      periodSeconds: cfg.periodSeconds ?? 3600,
      intervalMs: cfg.intervalMs,
    },
    resolved,
    phase: Math.random() * 2 * Math.PI,
    driftValue: resolved.baseline,
    currentBias: 0,
    lastValue: null,
    lastPublishedAt: null,
  };
}

export function nextValue(state: SensorState, bias: number = 0): number {
  const { resolved, config } = state;
  const { baseline, amplitude, min, max } = resolved;

  let raw: number;

  switch (config.mode) {
    case 'sinusoidal': {
      const ticksPerPeriod = (config.periodSeconds * 1000) / config.intervalMs;
      state.phase += (2 * Math.PI) / ticksPerPeriod;
      raw = baseline + amplitude * Math.sin(state.phase);
      break;
    }
    case 'normal': {
      const u1 = Math.random(), u2 = Math.random();
      const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      raw = baseline + (amplitude * 0.3) * z;
      break;
    }
    case 'drift': {
      state.driftValue += resolved.driftRate * (Math.random() > 0.5 ? 1 : -1);
      if (state.driftValue > max) state.driftValue = max - resolved.driftRate;
      if (state.driftValue < min) state.driftValue = min + resolved.driftRate;
      raw = state.driftValue;
      break;
    }
    case 'spike': {
      const spike = Math.random() < resolved.spikeProbability
        ? (Math.random() > 0.5 ? 1 : -1) * resolved.spikeMagnitude
        : 0;
      const u1 = Math.random(), u2 = Math.random();
      const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      raw = baseline + (amplitude * 0.2) * z + spike;
      break;
    }
  }

  const clamped = Math.max(min, Math.min(max, raw + bias));
  return Math.round(clamped * 100) / 100;
}

export function advanceBias(state: SensorState, target: number): void {
  const alpha = 0.2;
  state.currentBias = state.currentBias + alpha * (target - state.currentBias);
}
