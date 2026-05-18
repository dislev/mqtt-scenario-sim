import { ResolvedRange } from './sensors';

export type ScenarioId =
  | 'normal'
  | 'out_of_range'
  | 'trending_to_breach'
  | 'stable_healthy'
  | 'recovery'
  | 'oscillating';

export const SCENARIO_KEYS: Record<string, ScenarioId> = {
  '0':                   'normal',
  'n':                   'normal',
  'normal':              'normal',
  '1':                   'out_of_range',
  'out_of_range':        'out_of_range',
  '2':                   'trending_to_breach',
  'trending_to_breach':  'trending_to_breach',
  '3':                   'stable_healthy',
  'stable_healthy':      'stable_healthy',
  '4':                   'recovery',
  'recovery':            'recovery',
  '5':                   'oscillating',
  'oscillating':         'oscillating',
};

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  normal:             "0 / n  — Normal (uses each metric's configured mode)",
  out_of_range:       '1      — Out of range       (values 30% above max)',
  trending_to_breach: '2      — Trending to breach  (rising toward max; visible after ~2 min)',
  stable_healthy:     '3      — Stable & healthy    (held at midpoint ideal)',
  recovery:           '4      — Recovery            (starts out-of-range, decays to ideal over ~5 min)',
  oscillating:        '5      — Oscillating         (±10% swing around ideal)',
};

export const SCENARIO_DETAIL: Record<ScenarioId, string> = {
  normal:
    "Each metric runs its configured mode: sinusoidal, drift, normal, or spike.",
  out_of_range:
    'All metrics emit 30% above their max boundary. Tests threshold breach detection.',
  trending_to_breach:
    'Metrics rise from 70% toward 99% of max (0.5% of span per tick). ' +
    'Tests early-warning alert logic. Allow ~2 min for analysis caches to fill.',
  stable_healthy:
    'All metrics held at their midpoint ideal (±0.3% noise). Tests steady-state handling.',
  recovery:
    'Starts 30% above max; decays linearly to midpoint ideal over ~5 min. ' +
    'Tests resolved-alert and recovery detection.',
  oscillating:
    'Rapid ±10% oscillation around midpoint ideal (full cycle every 8 ticks). ' +
    'Tests alert flapping suppression and jitter handling.',
};

export function scenarioValue(
  id: ScenarioId,
  resolved: ResolvedRange,
  tick: number,
  rand: number,
): number | null {
  if (id === 'normal') return null;

  const { min, max } = resolved;
  const span  = max - min;
  const ideal = (min + max) / 2;

  switch (id) {
    case 'out_of_range':
      return round2(max + span * 0.30);

    case 'trending_to_breach': {
      const start   = min + span * 0.70;
      const ceiling = min + span * 0.99;
      const rising  = Math.min(start + tick * span * 0.005, ceiling);
      return round2(rising + (rand - 0.5) * span * 0.003);
    }

    case 'stable_healthy':
      return round2(ideal + (rand - 0.5) * span * 0.003);

    case 'recovery': {
      const DECAY_TICKS = 60;
      const start    = max + span * 0.30;
      const progress = Math.min(tick / DECAY_TICKS, 1);
      return round2(start + (ideal - start) * progress + (rand - 0.5) * span * 0.003);
    }

    case 'oscillating': {
      const amplitude = span * 0.10;
      const wave = Math.sin((2 * Math.PI * tick) / 8) * amplitude;
      return round2(ideal + wave + (rand - 0.5) * span * 0.005);
    }
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
