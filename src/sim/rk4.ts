// Classical fixed-step Runge-Kutta 4 (RK4) with exact stepping onto intervention boundaries and output times.
//   y_{n+1} = y_n + (h/6) (k1 + 2 k2 + 2 k3 + k4),  k1 = f(y_n),  k2 = f(y_n + h k1/2),  k3 = f(y_n + h k2/2),  k4 = f(y_n + h k3)
// Parameters are constant inside each segment, so f does not depend on t explicitly (autonomous system).
import type { InternalParams, ModelKind, ScheduleSegment, Trajectory } from '../shared/types';
import { NumericalError, ParamError } from './errors';
import { IDX, STATE_SIZE, initialState, makeRhs } from './models';
import type { Rhs } from './models';
import { fastestRate } from './params';
import { segmentAt } from './interventions';

/** Scratch arrays reused by every step so the inner loop allocates nothing. */
export interface Rk4Workspace {
  k1: Float64Array;
  k2: Float64Array;
  k3: Float64Array;
  k4: Float64Array;
  tmp: Float64Array;
}

/** Allocates scratch space for a system of the given size. */
export function makeWorkspace(size: number): Rk4Workspace {
  return {
    k1: new Float64Array(size),
    k2: new Float64Array(size),
    k3: new Float64Array(size),
    k4: new Float64Array(size),
    tmp: new Float64Array(size),
  };
}

/** Advances y in place by one RK4 step of size h. */
export function rk4Step(f: Rhs, y: Float64Array, h: number, ws: Rk4Workspace): void {
  const { k1, k2, k3, k4, tmp } = ws;
  const n = y.length;
  f(y, k1);
  for (let i = 0; i < n; i++) tmp[i] = (y[i] as number) + 0.5 * h * (k1[i] as number); // index in range: i < n
  f(tmp, k2);
  for (let i = 0; i < n; i++) tmp[i] = (y[i] as number) + 0.5 * h * (k2[i] as number);
  f(tmp, k3);
  for (let i = 0; i < n; i++) tmp[i] = (y[i] as number) + h * (k3[i] as number);
  f(tmp, k4);
  for (let i = 0; i < n; i++) {
    y[i] =
      (y[i] as number) +
      (h / 6) *
        ((k1[i] as number) + 2 * (k2[i] as number) + 2 * (k3[i] as number) + (k4[i] as number));
  }
}

/** Advances y in place over `duration` using `steps` equal RK4 steps (used directly by the convergence-order test). */
export function rk4Advance(
  f: Rhs,
  y: Float64Array,
  duration: number,
  steps: number,
  ws: Rk4Workspace,
): void {
  const h = duration / steps;
  for (let s = 0; s < steps; s++) rk4Step(f, y, h, ws);
}

/** Largest step we allow: 0.1 day, and at most 0.02/fastest-rate so that (rate * h) <= 0.02 (see MODEL.md section 4). */
export function defaultMaxStep(fastestRatePerDay: number): number {
  return fastestRatePerDay > 0 ? Math.min(0.1, 0.02 / fastestRatePerDay) : 0.1;
}

/** Output times 0, step, 2*step, ... always ending exactly at horizonDays. */
export function uniformGrid(horizonDays: number, stepDays = 1): Float64Array {
  const n = Math.floor(horizonDays / stepDays + 1e-9);
  const times: number[] = [];
  for (let k = 0; k <= n; k++) times.push(k * stepDays);
  if (horizonDays - (times[times.length - 1] as number) > 1e-9) times.push(horizonDays);
  else times[times.length - 1] = horizonDays;
  return Float64Array.from(times);
}

export interface IntegrateOptions {
  model: ModelKind;
  rates: InternalParams;
  population: number;
  initialInfected: number;
  vaccineEfficacy: number;
  schedule: readonly ScheduleSegment[];
  horizonDays: number;
  /** Increasing times in [0, horizonDays] starting at 0; defaults to daily. */
  outputTimes?: Float64Array;
  /** Override the largest internal step (days); defaults to defaultMaxStep. */
  maxStep?: number;
}

export interface IntegrationResult {
  trajectory: Trajectory;
  stats: { steps: number; clampedValues: number };
}

const KNOT_TOLERANCE = 1e-9;
/** A compartment may dip below zero by this fraction of N from roundoff; it is then reset to 0. Anything lower is an error. */
const NEGATIVE_TOLERANCE = 1e-9;

/** Time points the integrator must land on: all output times plus every segment boundary (output times within 1e-9 of a boundary snap onto it). */
export function buildKnots(
  outputTimes: Float64Array,
  schedule: readonly ScheduleSegment[],
  horizonDays: number,
): { knots: number[]; snapped: number[] } {
  const boundaries = schedule.map((s) => s.startDay).concat(horizonDays);
  const snapped = Array.from(
    outputTimes,
    (t) => boundaries.find((b) => Math.abs(b - t) < KNOT_TOLERANCE) ?? t,
  );
  const knots = [...new Set([...snapped, ...boundaries])].sort((a, b) => a - b);
  if ((knots[knots.length - 1] as number) > horizonDays + KNOT_TOLERANCE)
    throw new ParamError('outputTimes', 'bad_interval', 'Output times exceed the horizon.');
  return { knots, snapped };
}

/** Solves the chosen model over [0, horizon], landing exactly on every intervention boundary and output time. */
export function integrate(opts: IntegrateOptions): IntegrationResult {
  const { model, rates, population, initialInfected, vaccineEfficacy, schedule, horizonDays } =
    opts;
  const outputTimes = opts.outputTimes ?? uniformGrid(horizonDays);
  if (outputTimes.length === 0 || (outputTimes[0] as number) !== 0)
    throw new ParamError('outputTimes', 'bad_interval', 'Output times must start at 0.');
  for (let i = 1; i < outputTimes.length; i++) {
    if (!((outputTimes[i] as number) > (outputTimes[i - 1] as number)))
      throw new ParamError(
        'outputTimes',
        'bad_interval',
        'Output times must be strictly increasing.',
      );
  }
  const maxVaccination = Math.max(0, ...schedule.map((s) => s.vaccinationRatePerDay));
  const hMax =
    opts.maxStep ?? defaultMaxStep(fastestRate(rates, model === 'SEIRV' ? maxVaccination : 0));
  if (!(hMax > 0)) throw new ParamError('maxStep', 'out_of_range', 'maxStep must be positive.');

  const { knots, snapped } = buildKnots(outputTimes, schedule, horizonDays);
  const outputSet = new Set(snapped);

  const rhsBySegment = schedule.map((s) =>
    makeRhs(
      model,
      rates,
      population,
      vaccineEfficacy,
      s.contactMultiplier,
      s.vaccinationRatePerDay,
    ),
  );
  const y = initialState(population, initialInfected);
  const ws = makeWorkspace(STATE_SIZE);
  const m = outputTimes.length;
  const out: Trajectory = {
    times: Float64Array.from(snapped),
    S: new Float64Array(m),
    E: new Float64Array(m),
    I: new Float64Array(m),
    R: new Float64Array(m),
    V: new Float64Array(m),
    cumInfections: new Float64Array(m),
    cumOnsets: new Float64Array(m),
    cumVaccinated: new Float64Array(m),
  };
  let row = 0;
  const record = (): void => {
    out.S[row] = y[IDX.S] as number;
    out.E[row] = y[IDX.E] as number;
    out.I[row] = y[IDX.I] as number;
    out.R[row] = y[IDX.R] as number;
    out.V[row] = y[IDX.V] as number;
    out.cumInfections[row] = y[IDX.CUM_INF] as number;
    out.cumOnsets[row] = y[IDX.CUM_ONSET] as number;
    out.cumVaccinated[row] = y[IDX.CUM_VAC] as number;
    row++;
  };
  record(); // t = 0

  let steps = 0;
  let clamped = 0;
  const tol = NEGATIVE_TOLERANCE * population;
  for (let k = 0; k + 1 < knots.length; k++) {
    const ta = knots[k] as number;
    const tb = knots[k + 1] as number;
    const seg = segmentAt(schedule, 0.5 * (ta + tb));
    const rhs = rhsBySegment[schedule.indexOf(seg)] as Rhs; // seg came from schedule, so the index exists
    const n = Math.max(1, Math.ceil((tb - ta) / hMax - 1e-9)); // equal sub-steps no larger than hMax, ending exactly at tb
    const h = (tb - ta) / n;
    for (let s = 0; s < n; s++) {
      rk4Step(rhs, y, h, ws);
      steps++;
      for (let i = 0; i < STATE_SIZE; i++) {
        const v = y[i] as number;
        if (!Number.isFinite(v))
          throw new NumericalError(`Non-finite value in state ${i} at t=${ta + (s + 1) * h}.`);
        if (v < 0) {
          if (v < -tol)
            throw new NumericalError(
              `State ${i} went negative (${v}) at t=${ta + (s + 1) * h}; parameters may be too stiff.`,
            );
          y[i] = 0; // roundoff-level negative value: reset to zero
          clamped++;
        }
      }
    }
    if (outputSet.has(tb)) record();
  }
  if (row !== m) throw new NumericalError('Internal error: output grid was not fully recorded.');
  return { trajectory: out, stats: { steps, clampedValues: clamped } };
}
