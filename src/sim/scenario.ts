// Runs a whole Scenario (validation + deterministic solution + key numbers) and compares scenarios.
import type { Scenario, Trajectory } from '../shared/types';
import {
  doublingTime,
  earlyGrowthRate,
  effectiveR,
  finalSizeFraction,
  halvingTime,
  herdImmunityThreshold,
  incidencePerDay,
  peakInfectious,
} from './derived';
import type { ParamError } from './errors';
import { buildSchedule, validateInterventions } from './interventions';
import { userToInternal, validateUserParams } from './params';
import { integrate, uniformGrid } from './rk4';

export interface KeyNumbers {
  /** Peak infectious count (I compartment) and the day it occurs. */
  peakInfectious: number;
  peakDay: number;
  /** Fraction of the population ever infected by the end of the window. */
  attackRate: number;
  /** True if infections are still active (I + E above 0.1% of the peak) at the end, so the attack rate is not final yet. */
  stillOngoing: boolean;
  herdImmunityThreshold: number;
  /** Early growth rate per day (valid with no interventions, S ~ N). */
  growthRate: number;
  doublingTimeDays: number | null;
  halvingTimeDays: number | null;
  r0: number;
  /** R_eff at day 0 and at the end of the window. */
  reffStart: number;
  reffEnd: number;
  /** Total doses given to susceptibles (SEIR+V only). */
  totalVaccinated: number;
  /** First and last day R_eff > 1 (null if never). */
  growthWindow: { startDay: number; endDay: number } | null;
  /** Analytic final size for a plain outbreak with the same R0 (no interventions or vaccination). */
  analyticFinalSize: number;
}

export interface ScenarioResult {
  scenario: Scenario;
  trajectory: Trajectory;
  /** New infections per day between consecutive output times (length = times - 1). */
  incidence: Float64Array;
  reff: Float64Array;
  numbers: KeyNumbers;
}

export type ScenarioOutcome =
  { ok: true; result: ScenarioResult } | { ok: false; issues: ParamError[] };

/** Collects every validation problem for a scenario (empty array = fine). */
export function validateScenario(s: Scenario): ParamError[] {
  const issues = validateUserParams(s.params);
  issues.push(...validateInterventions(s.interventions, s.params.model, s.params.horizonDays));
  return issues;
}

/** Validates and solves the scenario deterministically on a daily grid; never throws on bad input. */
export function runScenario(s: Scenario): ScenarioOutcome {
  const issues = validateScenario(s);
  if (issues.length > 0) return { ok: false, issues };
  const { params: p } = s;
  const rates = userToInternal(p);
  const schedule = buildSchedule(s.interventions, p.horizonDays);
  const { trajectory } = integrate({
    model: p.model,
    rates,
    population: p.population,
    initialInfected: p.initialInfected,
    vaccineEfficacy: p.vaccineEfficacy,
    schedule,
    horizonDays: p.horizonDays,
    outputTimes: uniformGrid(p.horizonDays),
  });
  const reff = effectiveR(
    trajectory,
    p.r0,
    p.population,
    p.model === 'SEIRV' ? p.vaccineEfficacy : 0,
    schedule,
  );
  const peak = peakInfectious(trajectory);
  const last = trajectory.times.length - 1;
  const growth = earlyGrowthRate(p.model, rates);
  let first = -1;
  let lastAbove = -1;
  for (let i = 0; i < reff.length; i++) {
    if ((reff[i] as number) > 1) {
      if (first < 0) first = i;
      lastAbove = i;
    }
  }
  const active = (trajectory.I[last] as number) + (trajectory.E[last] as number);
  const numbers: KeyNumbers = {
    peakInfectious: peak.value,
    peakDay: peak.day,
    attackRate: (trajectory.cumInfections[last] as number) / p.population,
    stillOngoing: active > 0.001 * peak.value,
    herdImmunityThreshold: herdImmunityThreshold(p.r0),
    growthRate: growth,
    doublingTimeDays: doublingTime(growth),
    halvingTimeDays: halvingTime(growth),
    r0: p.r0,
    reffStart: reff[0] as number,
    reffEnd: reff[last] as number,
    totalVaccinated: trajectory.cumVaccinated[last] as number,
    growthWindow:
      first < 0
        ? null
        : {
            startDay: trajectory.times[first] as number,
            endDay: trajectory.times[lastAbove] as number,
          },
    analyticFinalSize: finalSizeFraction(p.r0),
  };
  return {
    ok: true,
    result: { scenario: s, trajectory, incidence: incidencePerDay(trajectory), reff, numbers },
  };
}

/** Plain-English comparison of a scenario's peak against a baseline, e.g. "peak reduced by 42%, delayed by 11 days". */
export function describeDifference(base: KeyNumbers, other: KeyNumbers): string {
  const parts: string[] = [];
  if (base.peakInfectious > 0) {
    const change = ((other.peakInfectious - base.peakInfectious) / base.peakInfectious) * 100;
    if (Math.abs(change) < 0.5) parts.push('peak size about the same');
    else
      parts.push(`peak ${change < 0 ? 'reduced' : 'increased'} by ${Math.abs(change).toFixed(0)}%`);
  }
  const shift = other.peakDay - base.peakDay;
  if (Math.abs(shift) < 0.5) parts.push('peak day about the same');
  else parts.push(`${shift > 0 ? 'delayed' : 'earlier'} by ${Math.abs(shift).toFixed(0)} days`);
  const sizeChange = (other.attackRate - base.attackRate) * 100;
  if (Math.abs(sizeChange) >= 0.5)
    parts.push(
      `total infected ${sizeChange < 0 ? 'down' : 'up'} ${Math.abs(sizeChange).toFixed(1)} percentage points`,
    );
  return parts.join(', ');
}
