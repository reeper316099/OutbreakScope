import { describe, expect, it } from 'vitest';
import {
  bandsOf,
  emptyEnsemble,
  mergeChunk,
  summarizeEnsemble,
  theoreticalMajorProbability,
} from '../../src/sim/ensemble';
import { ParamError } from '../../src/sim/errors';

describe('ensemble helpers', () => {
  const times = Float64Array.of(0, 1, 2);
  /** Builds 4 hand-made realizations of I(t) with known statistics. */
  function sample() {
    const d = emptyEnsemble(times, 4);
    d.I.set([1, 5, 2, /**/ 1, 9, 3, /**/ 1, 1, 0, /**/ 1, 7, 1]);
    d.cumInfections.set([1, 6, 8, /**/ 1, 10, 13, /**/ 1, 2, 2, /**/ 1, 8, 9]);
    d.major.set([1, 1, 0, 1]);
    d.extinct.set([0, 0, 1, 0]);
    return d;
  }
  it('computes per-time mean, median and quantile bands', () => {
    const b = bandsOf(sample(), 'I');
    expect(Array.from(b.mean)).toEqual([1, 5.5, 1.5]);
    expect(Array.from(b.median)).toEqual([1, 6, 1.5]); // day 1 values sorted: 1,5,7,9 -> median 6
    expect(b.q025[1]).toBeCloseTo(1 + 0.075 * 4, 12); // linear interpolation between 1 and 5 at position 0.075
    expect(b.q975[1]).toBeCloseTo(7 + 0.925 * 2, 12);
  });
  it('summarises peaks, peak days, final size and the fizzle fraction', () => {
    const s = summarizeEnsemble(sample(), 100);
    expect(s.fractionMajor).toBe(0.75);
    expect(s.fractionFizzled).toBe(0.25);
    expect(s.peakInfectious?.median).toBe(7); // major peaks: 5, 9, 7
    expect(s.peakDay?.median).toBe(1);
    expect(s.finalSizeFraction?.median).toBeCloseTo(0.09, 12); // major final sizes: 8, 13, 9 of 100
    expect(s.finalSizeFractionAll.median).toBeCloseTo((8 + 9) / 2 / 100, 12);
  });
  it('has no peak statistics when no run is major', () => {
    const d = sample();
    d.major.fill(0);
    expect(summarizeEnsemble(d, 100).peakInfectious).toBeNull();
  });
  it('merges worker chunks into place and rejects ones that do not fit', () => {
    const full = emptyEnsemble(times, 4);
    mergeChunk(full, {
      start: 2,
      count: 2,
      I: Float64Array.of(1, 2, 3, 4, 5, 6),
      cumInfections: new Float64Array(6),
      major: Uint8Array.of(1, 0),
      extinct: new Uint8Array(2),
    });
    expect(Array.from(full.I)).toEqual([0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6]);
    expect(Array.from(full.major)).toEqual([0, 0, 1, 0]);
    expect(() =>
      mergeChunk(full, {
        start: 3,
        count: 2,
        I: new Float64Array(6),
        cumInfections: new Float64Array(6),
        major: new Uint8Array(2),
        extinct: new Uint8Array(2),
      }),
    ).toThrow(ParamError);
  });
  it('theory: 1 - (1/R0)^k, zero for R0 <= 1', () => {
    expect(theoreticalMajorProbability(2, 1)).toBe(0.5);
    expect(theoreticalMajorProbability(2, 3)).toBe(0.875);
    expect(theoreticalMajorProbability(1, 5)).toBe(0);
    expect(theoreticalMajorProbability(0.5, 5)).toBe(0);
  });
  it('rejects an empty ensemble', () => {
    expect(() => bandsOf(emptyEnsemble(times, 0), 'I')).toThrow(ParamError);
  });
});
