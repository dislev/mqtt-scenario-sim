import { strict as assert } from 'assert';
import { computeBias, parseEffectCommand, applyEffect } from '../src/effects';
import type { EffectConfig } from '../src/effects';

const configs: EffectConfig[] = [
  { name: 'cooler', effects: { temperature: -0.40, humidity: -0.20 } },
  { name: 'heater', effects: { temperature: +0.30 } },
];

describe('computeBias', () => {
  it('returns 0 when no effects active', () => {
    assert.equal(computeBias(configs, {}, 'temperature', 100), 0);
  });

  it('applies negative bias when cooler is on', () => {
    const bias = computeBias(configs, { cooler: true }, 'temperature', 100);
    assert.equal(bias, -40);
  });

  it('applies positive bias when heater is on', () => {
    const bias = computeBias(configs, { heater: true }, 'temperature', 100);
    assert.equal(bias, 30);
  });

  it('combines multiple active effects', () => {
    const bias = computeBias(configs, { cooler: true, heater: true }, 'temperature', 100);
    assert.equal(bias, -40 + 30);
  });

  it('returns 0 for metric not in any effect', () => {
    const bias = computeBias(configs, { cooler: true, heater: true }, 'pressure', 100);
    assert.equal(bias, 0);
  });
});

describe('parseEffectCommand', () => {
  it('parses valid command', () => {
    const cmd = parseEffectCommand({ effect: 'cooler', state: true });
    assert.deepEqual(cmd, { effect: 'cooler', state: true });
  });

  it('returns null for missing fields', () => {
    assert.equal(parseEffectCommand({ effect: 'cooler' }), null);
    assert.equal(parseEffectCommand({ state: true }), null);
    assert.equal(parseEffectCommand(null), null);
  });
});

describe('applyEffect', () => {
  it('sets effect state', () => {
    const state = applyEffect({}, 'cooler', true);
    assert.equal(state['cooler'], true);
  });

  it('toggles effect off', () => {
    const state = applyEffect({ cooler: true }, 'cooler', false);
    assert.equal(state['cooler'], false);
  });
});
