import { strict as assert } from 'assert';
import { createSensorState, nextValue, resolveRange } from '../src/sensors';

const range = { low: 0, high: 100 };

describe('resolveRange', () => {
  it('derives baseline and amplitude from range', () => {
    const r = resolveRange(range);
    assert.equal(r.baseline, 50);
    assert.equal(r.amplitude, 50);
    assert.equal(r.min, 0);
    assert.equal(r.max, 100);
  });

  it('respects explicit overrides', () => {
    const r = resolveRange(range, { baseline: 40, amplitude: 10 });
    assert.equal(r.baseline, 40);
    assert.equal(r.amplitude, 10);
  });
});

describe('nextValue', () => {
  it('sinusoidal stays within range', () => {
    const state = createSensorState({ mode: 'sinusoidal', range, intervalMs: 5000 });
    for (let i = 0; i < 100; i++) {
      const v = nextValue(state);
      assert.ok(v >= range.low && v <= range.high, `${v} out of [${range.low}, ${range.high}]`);
    }
  });

  it('normal stays within range', () => {
    const state = createSensorState({ mode: 'normal', range, intervalMs: 5000 });
    for (let i = 0; i < 200; i++) {
      const v = nextValue(state);
      assert.ok(v >= range.low && v <= range.high);
    }
  });

  it('drift stays within range', () => {
    const state = createSensorState({ mode: 'drift', range, intervalMs: 5000 });
    for (let i = 0; i < 500; i++) {
      const v = nextValue(state);
      assert.ok(v >= range.low && v <= range.high);
    }
  });

  it('spike stays within range between spikes', () => {
    const state = createSensorState({ mode: 'spike', range, intervalMs: 5000, spikeProbability: 0 });
    for (let i = 0; i < 100; i++) {
      const v = nextValue(state);
      assert.ok(v >= range.low && v <= range.high);
    }
  });

  it('applies positive bias', () => {
    const state = createSensorState({ mode: 'normal', range: { low: 40, high: 60 }, intervalMs: 5000 });
    const vals = Array.from({ length: 50 }, () => nextValue(state, 10));
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    assert.ok(avg > 50, `expected avg > 50 with bias, got ${avg}`);
  });
});
