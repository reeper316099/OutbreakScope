// Key numbers derived from a solution or from the parameters alone (MODEL.md section 3).
import type { InternalParams, ModelKind, ScheduleSegment, Trajectory } from '../shared/types';
import { ParamError } from './errors';
import { segmentAt } from './interventions';

/** Herd immunity threshold 1 - 1/R0: the immune fraction at which R_eff drops below 1 (0 when R0 <= 1). */
export function herdImmunityThreshold(r0: number): number {
  if (!Number.isFinite(r0) || r0 < 0)
    throw new ParamError('r0', 'out_of_range', 'R0 must be a finite non-negative number.');
  return r0 <= 1 ? 0 : 1 - 1 / r0;
}

/** Final epidemic size z (fraction ever infected): positive root of z = 1 - exp(-R0 z); 0 if R0 <= 1. Newton from z = 1 (monotone since g is concave). */
export function finalSizeFraction(r0: number): number {
  if (!Number.isFinite(r0) || r0 < 0)
    throw new ParamError('r0', 'out_of_range', 'R0 must be a finite non-negative number.');
  if (r0 <= 1) return 0;
  let z = 1;
  for (let i = 0; i < 500; i++) {
    const e = Math.exp(-r0 * z);
    const g = 1 - e - z; // g(z) = 1 - exp(-R0 z) - z
    const dg = r0 * e - 1; // g'(z)
    const next = z - g / dg;
    if (Math.abs(next - z) < 1e-15) return next;
    z = next;
  }
  return z;
}

/** Early exponential growth rate r (per day): SEIR positive eigenvalue [-(s+g) + sqrt((s-g)^2 + 4 s b)]/2; SIR: b - g. */
export function earlyGrowthRate(model: ModelKind, rates: InternalParams): number {
  const { betaPerDay: b, gammaPerDay: g, sigmaPerDay: s } = rates;
  if (model === 'SIR' || s === null) return b - g;
  return (-(s + g) + Math.sqrt((s - g) * (s - g) + 4 * s * b)) / 2;
}

/** Doubling time ln(2)/r in days for r > 0, otherwise null (the epidemic is not growing). */
export function doublingTime(growthRate: number): number | null {
  return growthRate > 0 ? Math.LN2 / growthRate : null;
}

/** Halving time ln(2)/|r| in days for r < 0, otherwise null. */
export function halvingTime(growthRate: number): number | null {
  return growthRate < 0 ? Math.LN2 / -growthRate : null;
}

/** Peak of a sampled curve; refines the grid maximum with a parabola through the three points around it. */
export function peakOf(times: Float64Array, values: Float64Array): { day: number; value: number } {
  let k = 0;
  for (let i = 1; i < values.length; i++) if ((values[i] as number) > (values[k] as number)) k = i;
  const v1 = values[k] as number;
  if (k === 0 || k === values.length - 1) return { day: times[k] as number, value: v1 };
  const [t0, t1, t2] = [times[k - 1] as number, times[k] as number, times[k + 1] as number];
  const [v0, v2] = [values[k - 1] as number, values[k + 1] as number];
  // Vertex of the parabola through (t0,v0),(t1,v1),(t2,v2) (non-uniform spacing allowed).
  const d1 = (v1 - v0) / (t1 - t0);
  const d2 = (v2 - v1) / (t2 - t1);
  const curvature = (d2 - d1) / (t2 - t0); // second divided difference = a in v = a t^2 + ...
  if (!(curvature < 0)) return { day: t1, value: v1 };
  const day = 0.5 * (t0 + t1) - d1 / (2 * curvature);
  const value = v1 + d1 * (day - t1) + curvature * (day - t1) * (day - t0);
  return { day, value: Math.max(value, v1) };
}

/** Peak number infectious (the I compartment) and the day it occurs. */
export function peakInfectious(traj: Trajectory): { day: number; value: number } {
  return peakOf(traj.times, traj.I);
}

/** Effective reproduction number at every output time: R_eff = R0 * c(t) * (S + (1-e) V) / N. */
export function effectiveR(
  traj: Trajectory,
  r0: number,
  population: number,
  vaccineEfficacy: number,
  schedule: readonly ScheduleSegment[],
): Float64Array {
  const out = new Float64Array(traj.times.length);
  for (let i = 0; i < out.length; i++) {
    const c = segmentAt(schedule, traj.times[i] as number).contactMultiplier;
    const susceptible = (traj.S[i] as number) + (1 - vaccineEfficacy) * (traj.V[i] as number);
    out[i] = (r0 * c * susceptible) / population;
  }
  return out;
}

/** New infections per day between consecutive output times (cumulative-infection differences divided by the interval). Length = n - 1. */
export function incidencePerDay(traj: Trajectory): Float64Array {
  const n = traj.times.length - 1;
  const out = new Float64Array(Math.max(0, n));
  for (let i = 0; i < n; i++) {
    out[i] =
      ((traj.cumInfections[i + 1] as number) - (traj.cumInfections[i] as number)) /
      ((traj.times[i + 1] as number) - (traj.times[i] as number));
  }
  return out;
}

/** Fraction of the population ever infected by the end of the run (the true final size once the epidemic is over). */
export function attackRate(traj: Trajectory, population: number): number {
  return (traj.cumInfections[traj.cumInfections.length - 1] as number) / population;
}

/** Least-squares slope of ln(values) against times over [tMin, tMax]; used to measure early growth in tests/UI. Needs >= 2 positive points. */
export function logSlope(
  times: Float64Array,
  values: Float64Array,
  tMin: number,
  tMax: number,
): number {
  let n = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i] as number;
    const v = values[i] as number;
    if (t < tMin || t > tMax || !(v > 0)) continue;
    const y = Math.log(v);
    n++;
    sx += t;
    sy += y;
    sxx += t * t;
    sxy += t * y;
  }
  if (n < 2)
    throw new ParamError(
      'window',
      'out_of_range',
      'Need at least two positive points to fit a growth rate.',
    );
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}
