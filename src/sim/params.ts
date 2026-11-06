// The single conversion layer between user-facing quantities (R0, days) and internal per-day rates,
// plus validation of every number that can reach the solver.
import type { InternalParams, UserParams } from '../shared/types';
import { ParamError } from './errors';

/** Fastest allowed rate (per day). RK4 stays accurate with step <= 0.1/rate; beyond this we refuse (too stiff). */
export const MAX_RATE_PER_DAY = 20;
export const LIMITS = {
  r0: { min: 0, max: 50 },
  days: { min: 0.05, max: 365 },
  population: { min: 1, max: 1e10 },
  horizonDays: { min: 1, max: 3650 },
} as const;

/** Collects one issue if value is not a finite number inside [min, max]. */
function checkRange(
  field: string,
  value: number,
  min: number,
  max: number,
  issues: ParamError[],
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(new ParamError(field, 'not_a_number', `${field} must be a finite number.`));
  } else if (value < min || value > max) {
    issues.push(
      new ParamError(
        field,
        'out_of_range',
        `${field} must be between ${min} and ${max} (got ${value}).`,
      ),
    );
  }
}

/** Returns every problem with the parameters (empty array = valid). Never throws; the UI uses this for inline messages. */
export function validateUserParams(p: UserParams): ParamError[] {
  const issues: ParamError[] = [];
  checkRange('r0', p.r0, LIMITS.r0.min, LIMITS.r0.max, issues);
  checkRange('infectiousDays', p.infectiousDays, LIMITS.days.min, LIMITS.days.max, issues);
  if (p.model !== 'SIR')
    checkRange('incubationDays', p.incubationDays, LIMITS.days.min, LIMITS.days.max, issues);
  checkRange('population', p.population, LIMITS.population.min, LIMITS.population.max, issues);
  checkRange('horizonDays', p.horizonDays, LIMITS.horizonDays.min, LIMITS.horizonDays.max, issues);
  checkRange('vaccineEfficacy', p.vaccineEfficacy, 0, 1, issues);
  // Zero initial infected is rejected on purpose: with nobody infectious nothing can happen, so it is almost surely a mistake.
  if (typeof p.initialInfected !== 'number' || !Number.isFinite(p.initialInfected)) {
    issues.push(
      new ParamError('initialInfected', 'not_a_number', 'initialInfected must be a finite number.'),
    );
  } else if (p.initialInfected <= 0) {
    issues.push(
      new ParamError(
        'initialInfected',
        'out_of_range',
        'initialInfected must be greater than 0: an outbreak needs at least one infectious person.',
      ),
    );
  } else if (Number.isFinite(p.population) && p.initialInfected > p.population) {
    issues.push(
      new ParamError(
        'initialInfected',
        'out_of_range',
        'initialInfected cannot exceed the population.',
      ),
    );
  }
  if (issues.length === 0) {
    const rates = toInternal(p);
    const fastest = Math.max(rates.betaPerDay, rates.gammaPerDay, rates.sigmaPerDay ?? 0);
    if (fastest > MAX_RATE_PER_DAY) {
      issues.push(
        new ParamError(
          'r0',
          'too_stiff',
          `This combination implies a rate of ${fastest.toFixed(1)} per day (limit ${MAX_RATE_PER_DAY}); shorten R0 or lengthen the periods.`,
        ),
      );
    }
  }
  return issues;
}

/** Converts already-valid user parameters to internal rates: gamma = 1/T_inf, sigma = 1/T_inc, beta = R0*gamma. */
function toInternal(p: UserParams): InternalParams {
  const gammaPerDay = 1 / p.infectiousDays;
  return {
    gammaPerDay,
    sigmaPerDay: p.model === 'SIR' ? null : 1 / p.incubationDays,
    betaPerDay: p.r0 * gammaPerDay, // beta = R0 * gamma (MODEL.md section 1)
  };
}

/** Validates then converts user-facing parameters to internal per-day rates; throws the first ParamError. */
export function userToInternal(p: UserParams): InternalParams {
  const issues = validateUserParams(p);
  const first = issues[0];
  if (first !== undefined) throw first;
  return toInternal(p);
}

/** Inverse conversion: internal rates back to R0 and day counts (used for round-trip tests and fitted-value display). */
export function internalToUser(rates: InternalParams): {
  r0: number;
  incubationDays: number | null;
  infectiousDays: number;
} {
  return {
    r0: rates.betaPerDay / rates.gammaPerDay,
    incubationDays: rates.sigmaPerDay === null ? null : 1 / rates.sigmaPerDay,
    infectiousDays: 1 / rates.gammaPerDay,
  };
}

/** Largest rate in the system (per day), including the vaccination rate; sets the integrator step size. */
export function fastestRate(rates: InternalParams, maxVaccinationRate: number): number {
  return Math.max(rates.betaPerDay, rates.gammaPerDay, rates.sigmaPerDay ?? 0, maxVaccinationRate);
}
