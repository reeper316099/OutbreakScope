import { describe, expect, it } from 'vitest';
import { ParamError } from '../../src/sim/errors';
import { internalToUser, userToInternal, validateUserParams } from '../../src/sim/params';
import { params } from './helpers';

describe('unit conversion layer', () => {
  it('converts R0 and days to beta, sigma, gamma per day', () => {
    const r = userToInternal(params({ r0: 3, incubationDays: 4, infectiousDays: 5 }));
    expect(r.gammaPerDay).toBeCloseTo(0.2, 15);
    expect(r.sigmaPerDay).toBeCloseTo(0.25, 15);
    expect(r.betaPerDay).toBeCloseTo(0.6, 15); // beta = R0 * gamma
  });
  it('round-trips user -> internal -> user', () => {
    for (const [r0, inc, inf] of [
      [0.5, 1, 1],
      [1, 3, 9],
      [2.7, 5.2, 7.3],
      [15, 8, 8],
      [1.0001, 0.2, 300],
    ] as const) {
      const back = internalToUser(
        userToInternal(params({ r0, incubationDays: inc, infectiousDays: inf })),
      );
      expect(back.r0).toBeCloseTo(r0, 12);
      expect(back.incubationDays).toBeCloseTo(inc, 12);
      expect(back.infectiousDays).toBeCloseTo(inf, 12);
    }
  });
  it('SIR has no sigma and ignores the incubation field', () => {
    const r = userToInternal(params({ model: 'SIR', incubationDays: NaN }));
    expect(r.sigmaPerDay).toBeNull();
    expect(internalToUser(r).incubationDays).toBeNull();
  });
});

describe('input validation', () => {
  const field = (p: Parameters<typeof params>[0]): string[] =>
    validateUserParams(params(p)).map((e) => e.field);
  it('accepts the defaults and boundary-ish valid values (R0 = 1 exactly, R0 = 0)', () => {
    expect(validateUserParams(params())).toEqual([]);
    expect(validateUserParams(params({ r0: 1 }))).toEqual([]);
    expect(validateUserParams(params({ r0: 0 }))).toEqual([]);
  });
  it('rejects NaN, Infinity, negative, zero and huge values with the right field', () => {
    expect(field({ r0: NaN })).toContain('r0');
    expect(field({ r0: -1 })).toContain('r0');
    expect(field({ r0: 51 })).toContain('r0');
    expect(field({ population: 0 })).toContain('population');
    expect(field({ population: Infinity })).toContain('population');
    expect(field({ population: 1e12 })).toContain('population');
    expect(field({ initialInfected: 0 })).toContain('initialInfected');
    expect(field({ initialInfected: -5 })).toContain('initialInfected');
    expect(field({ initialInfected: 2e6 })).toContain('initialInfected');
    expect(field({ infectiousDays: 0 })).toContain('infectiousDays');
    expect(field({ incubationDays: -2 })).toContain('incubationDays');
    expect(field({ horizonDays: 0 })).toContain('horizonDays');
    expect(field({ vaccineEfficacy: 1.2 })).toContain('vaccineEfficacy');
  });
  it('rejects extremely stiff parameter combinations', () => {
    const issues = validateUserParams(params({ r0: 50, infectiousDays: 1 })); // beta = 50 per day
    expect(issues.map((e) => e.code)).toContain('too_stiff');
  });
  it('userToInternal throws a typed ParamError instead of returning garbage', () => {
    expect(() => userToInternal(params({ r0: NaN }))).toThrow(ParamError);
    try {
      userToInternal(params({ population: 0 }));
    } catch (e) {
      expect(e).toBeInstanceOf(ParamError);
      expect((e as ParamError).field).toBe('population');
    }
  });
});
