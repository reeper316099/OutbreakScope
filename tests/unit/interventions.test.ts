import { describe, expect, it } from 'vitest';
import type { Intervention } from '../../src/shared/types';
import { buildSchedule, segmentAt, validateInterventions } from '../../src/sim/interventions';

const cr = (startDay: number, endDay: number, strength: number): Intervention => ({
  type: 'contact_reduction',
  startDay,
  endDay,
  strength,
});
const vx = (startDay: number, endDay: number, strength: number): Intervention => ({
  type: 'vaccination',
  startDay,
  endDay,
  strength,
});

describe('buildSchedule', () => {
  it('has a single neutral segment with no events', () => {
    expect(buildSchedule([], 100)).toEqual([
      { startDay: 0, endDay: 100, contactMultiplier: 1, vaccinationRatePerDay: 0 },
    ]);
  });
  it('splits exactly at event boundaries', () => {
    const s = buildSchedule([cr(30, 60, 0.4)], 100);
    expect(s.map((x) => [x.startDay, x.endDay, x.contactMultiplier])).toEqual([
      [0, 30, 1],
      [30, 60, 0.6],
      [60, 100, 1],
    ]);
  });
  it('combines overlaps: contact reductions multiply, vaccination rates add', () => {
    const s = buildSchedule(
      [cr(10, 50, 0.5), cr(20, 40, 0.5), vx(20, 30, 0.01), vx(25, 45, 0.02)],
      60,
    );
    const at = (t: number) => segmentAt(s, t);
    expect(at(15).contactMultiplier).toBeCloseTo(0.5, 15);
    expect(at(22).contactMultiplier).toBeCloseTo(0.25, 15);
    expect(at(22).vaccinationRatePerDay).toBeCloseTo(0.01, 15);
    expect(at(27).vaccinationRatePerDay).toBeCloseTo(0.03, 15);
    expect(at(42).vaccinationRatePerDay).toBeCloseTo(0.02, 15);
  });
  it('is half-open [start, end) and clips events running past the horizon', () => {
    const s = buildSchedule([cr(30, 500, 0.4)], 100);
    expect(segmentAt(s, 29.999).contactMultiplier).toBe(1);
    expect(segmentAt(s, 30).contactMultiplier).toBeCloseTo(0.6, 15);
    expect(segmentAt(s, 100).contactMultiplier).toBeCloseTo(0.6, 15); // horizon maps to last segment
    expect(s[s.length - 1]?.endDay).toBe(100);
  });
});

describe('validateInterventions', () => {
  const codes = (list: Intervention[], model: 'SIR' | 'SEIR' | 'SEIRV' = 'SEIRV') =>
    validateInterventions(list, model, 100).map((e) => e.code);
  it('accepts sensible events', () => {
    expect(codes([cr(30, 60, 0.4), vx(45, 90, 0.01)])).toEqual([]);
  });
  it('rejects bad intervals, strengths, NaN and starts after the horizon', () => {
    expect(codes([cr(50, 50, 0.4)])).toContain('bad_interval');
    expect(codes([cr(60, 50, 0.4)])).toContain('bad_interval');
    expect(codes([cr(-1, 50, 0.4)])).toContain('bad_interval');
    expect(codes([cr(120, 150, 0.4)])).toContain('bad_interval');
    expect(codes([cr(10, 50, 1.5)])).toContain('out_of_range');
    expect(codes([cr(10, 50, NaN)])).toContain('not_a_number');
  });
  it('rejects vaccination unless the model is SEIR + vaccination', () => {
    expect(codes([vx(10, 50, 0.01)], 'SEIR')).toContain('unsupported_for_model');
    expect(codes([vx(10, 50, 0.01)], 'SIR')).toContain('unsupported_for_model');
  });
  it('rejects overlapping campaigns whose summed rate is too stiff', () => {
    expect(
      codes([vx(0, 50, 1), vx(0, 50, 1), ...Array.from({ length: 20 }, () => vx(0, 50, 1))]),
    ).toContain('too_stiff');
  });
});
