import { strict as assert } from 'assert';
import { scenarioValue } from '../src/scenarios';
import { resolveRange } from '../src/sensors';

const resolved = resolveRange({ low: 0, high: 100 });

describe('scenarioValue', () => {
  it('returns null for normal', () => {
    assert.equal(scenarioValue('normal', resolved, 0, 0.5), null);
  });

  it('out_of_range exceeds max', () => {
    const v = scenarioValue('out_of_range', resolved, 0, 0.5)!;
    assert.ok(v > resolved.max, `expected > ${resolved.max}, got ${v}`);
  });

  it('stable_healthy stays near midpoint', () => {
    for (let i = 0; i < 50; i++) {
      const v = scenarioValue('stable_healthy', resolved, i, Math.random())!;
      assert.ok(Math.abs(v - 50) < 5, `${v} too far from midpoint 50`);
    }
  });

  it('trending_to_breach rises over ticks', () => {
    const v0 = scenarioValue('trending_to_breach', resolved, 0,  0.5)!;
    const v50 = scenarioValue('trending_to_breach', resolved, 50, 0.5)!;
    assert.ok(v50 > v0, `expected v50 (${v50}) > v0 (${v0})`);
  });

  it('recovery starts above max and decreases', () => {
    const v0  = scenarioValue('recovery', resolved, 0,  0.5)!;
    const v60 = scenarioValue('recovery', resolved, 60, 0.5)!;
    assert.ok(v0 > resolved.max);
    assert.ok(v60 < v0);
  });

  it('oscillating swings around midpoint', () => {
    const vals = Array.from({ length: 16 }, (_, i) => scenarioValue('oscillating', resolved, i, 0.5)!);
    const hasAbove = vals.some((v) => v > 55);
    const hasBelow = vals.some((v) => v < 45);
    assert.ok(hasAbove && hasBelow, 'expected oscillation around midpoint');
  });
});
