export interface EffectConfig {
  name: string;
  effects: Record<string, number>;
}

export type EffectState = Record<string, boolean>;

export function computeBias(
  effectConfigs: EffectConfig[],
  activeEffects: EffectState,
  metric: string,
  span: number,
): number {
  let bias = 0;
  for (const cfg of effectConfigs) {
    if (activeEffects[cfg.name] && cfg.effects[metric] !== undefined) {
      bias += cfg.effects[metric]! * span;
    }
  }
  return bias;
}

export function parseEffectCommand(
  raw: unknown,
): { effect: string; state: boolean } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  if (typeof msg['effect'] !== 'string') return null;
  if (typeof msg['state'] !== 'boolean') return null;
  return { effect: msg['effect'] as string, state: msg['state'] as boolean };
}

export function applyEffect(
  state: EffectState,
  effect: string,
  on: boolean,
): EffectState {
  return { ...state, [effect]: on };
}
