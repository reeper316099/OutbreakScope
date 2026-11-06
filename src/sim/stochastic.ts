// Stochastic epidemic simulators (MODEL.md section 4):
//   * exact Gillespie (direct method) for small populations, with piecewise-constant rates handled by restarting at segment ends;
//   * chain-binomial (fixed small time step) for large populations: each step draws binomial numbers of transitions.
// Realization i of a run uses PRNG stream i, so results are reproducible and independent of how work is split across workers.
import type { InternalParams, ModelKind, ScheduleSegment } from '../shared/types';
import { NumericalError, ParamError } from './errors';
import { Rng } from './rng';
import { uniformGrid } from './rk4';
import { segmentAt } from './interventions';

/** Populations up to this size use exact Gillespie; larger ones use chain-binomial (cost is independent of N). */
export const GILLESPIE_MAX_POPULATION = 20000;
/** A realization is a "major outbreak" if secondary infections (beyond the initial ones) reach this fraction of N. */
export const MAJOR_OUTBREAK_FRACTION = 0.05;

export type StochasticMethod = 'gillespie' | 'chain_binomial';

export interface StochasticOptions {
  model: ModelKind;
  rates: InternalParams;
  /** Integer population size N >= 1. */
  population: number;
  /** Integer number of initially infectious people (placed in I), 1 <= I0 <= N. */
  initialInfected: number;
  vaccineEfficacy: number;
  schedule: readonly ScheduleSegment[];
  horizonDays: number;
  /** User seed, integer in [0, 2^32). */
  seed: number;
  method?: 'auto' | StochasticMethod;
  /** Largest chain-binomial time step in days (default 0.1). */
  dt?: number;
  /** Increasing output times starting at 0; defaults to daily. */
  outputTimes?: Float64Array;
}

export interface StochasticRun {
  method: StochasticMethod;
  /** Realization (stream) index. */
  index: number;
  times: Float64Array;
  /** Integer counts at each output time (stored as doubles). */
  S: Float64Array;
  E: Float64Array;
  I: Float64Array;
  R: Float64Array;
  V: Float64Array;
  cumInfections: Float64Array;
  /** True if nobody is exposed or infectious at the end of the horizon. */
  extinct: boolean;
  /** True if secondary infections reached MAJOR_OUTBREAK_FRACTION * N. */
  major: boolean;
}

/** Throws a ParamError for options the simulators cannot handle. */
function validate(o: StochasticOptions): void {
  if (!Number.isInteger(o.population) || o.population < 1)
    throw new ParamError(
      'population',
      'not_integer',
      'Stochastic runs need an integer population >= 1.',
    );
  if (
    !Number.isInteger(o.initialInfected) ||
    o.initialInfected < 1 ||
    o.initialInfected > o.population
  ) {
    throw new ParamError(
      'initialInfected',
      'out_of_range',
      'Stochastic runs need an integer number of initial infected between 1 and N.',
    );
  }
  if (!(o.horizonDays > 0) || !Number.isFinite(o.horizonDays))
    throw new ParamError('horizonDays', 'out_of_range', 'horizonDays must be positive.');
}

interface Recorder {
  times: Float64Array;
  next: number;
  S: Float64Array;
  E: Float64Array;
  I: Float64Array;
  R: Float64Array;
  V: Float64Array;
  C: Float64Array;
}

/** Writes the current counts for every pending output time <= limit. */
function recordUpTo(
  rec: Recorder,
  limit: number,
  s: number,
  e: number,
  i: number,
  r: number,
  v: number,
  c: number,
): void {
  while (rec.next < rec.times.length && (rec.times[rec.next] as number) <= limit + 1e-12) {
    const k = rec.next++;
    rec.S[k] = s;
    rec.E[k] = e;
    rec.I[k] = i;
    rec.R[k] = r;
    rec.V[k] = v;
    rec.C[k] = c;
  }
}

/** Exact Gillespie simulation of one realization. */
function gillespie(o: StochasticOptions, rng: Rng, rec: Recorder): void {
  const { betaPerDay, gammaPerDay } = o.rates;
  const sigma = o.rates.sigmaPerDay ?? 0;
  const isSir = o.model === 'SIR';
  const leak = 1 - o.vaccineEfficacy;
  const N = o.population;
  let S = N - o.initialInfected,
    E = 0,
    I = o.initialInfected,
    R = 0,
    V = 0,
    C = o.initialInfected;
  let events = 0;
  const maxEvents = 200 * N + 10000;
  for (const seg of o.schedule) {
    const nu = o.model === 'SEIRV' ? seg.vaccinationRatePerDay : 0;
    let t = seg.startDay;
    for (;;) {
      const lambda = (seg.contactMultiplier * betaPerDay * I) / N; // force of infection per susceptible
      const rInfS = lambda * S;
      const rInfV = leak * lambda * V;
      const rVac = nu * S;
      const rProg = isSir ? 0 : sigma * E;
      const rRec = gammaPerDay * I;
      const total = rInfS + rInfV + rVac + rProg + rRec;
      const tNext = total > 0 ? t + rng.exponential(total) : Infinity;
      recordUpTo(rec, Math.min(tNext, seg.endDay), S, E, I, R, V, C);
      if (tNext >= seg.endDay) break; // memoryless: restart with the new rates at the segment boundary
      if (++events > maxEvents) throw new NumericalError('Gillespie event limit exceeded.');
      t = tNext;
      // Pick the event with probability proportional to its rate (cumulative thresholds).
      const u = rng.nextFloat() * total;
      if (u < rInfS) {
        S--;
        if (isSir) I++;
        else E++;
        C++;
      } else if (u < rInfS + rInfV) {
        V--;
        if (isSir) I++;
        else E++;
        C++;
      } else if (u < rInfS + rInfV + rVac) {
        S--;
        V++;
      } else if (u < rInfS + rInfV + rVac + rProg) {
        E--;
        I++;
      } else {
        I--;
        R++;
      }
    }
  }
}

/** Chain-binomial simulation of one realization (all transitions in a step use the start-of-step state). */
function chainBinomial(o: StochasticOptions, rng: Rng, rec: Recorder): void {
  const { betaPerDay, gammaPerDay } = o.rates;
  const sigma = o.rates.sigmaPerDay ?? 0;
  const isSir = o.model === 'SIR';
  const leak = 1 - o.vaccineEfficacy;
  const dtMax = o.dt ?? 0.1;
  const N = o.population;
  let S = N - o.initialInfected,
    E = 0,
    I = o.initialInfected,
    R = 0,
    V = 0,
    C = o.initialInfected;
  const cuts = new Set<number>([...o.schedule.map((s) => s.startDay), o.horizonDays, ...rec.times]);
  const knots = [...cuts].filter((k) => k <= o.horizonDays).sort((a, b) => a - b);
  recordUpTo(rec, 0, S, E, I, R, V, C);
  for (let k = 0; k + 1 < knots.length; k++) {
    const ta = knots[k] as number;
    const tb = knots[k + 1] as number;
    if (tb - ta < 1e-12) continue;
    const seg = segmentAt(o.schedule, 0.5 * (ta + tb));
    const nu = o.model === 'SEIRV' ? seg.vaccinationRatePerDay : 0;
    const n = Math.max(1, Math.ceil((tb - ta) / dtMax - 1e-9));
    const dt = (tb - ta) / n;
    for (let step = 0; step < n; step++) {
      const lambda = (seg.contactMultiplier * betaPerDay * I) / N;
      // Susceptibles leave by infection or vaccination (competing exponentials): leavers ~ Bin(S, 1 - exp(-(lambda+nu) dt)).
      const hazardS = lambda + nu;
      const leavers = hazardS > 0 ? rng.binomial(S, 1 - Math.exp(-hazardS * dt)) : 0;
      const infS = leavers > 0 && lambda > 0 ? rng.binomial(leavers, lambda / hazardS) : 0;
      const vac = leavers - infS;
      const infV = V > 0 && lambda > 0 ? rng.binomial(V, 1 - Math.exp(-leak * lambda * dt)) : 0;
      const prog = !isSir && E > 0 ? rng.binomial(E, 1 - Math.exp(-sigma * dt)) : 0;
      const rec1 = I > 0 ? rng.binomial(I, 1 - Math.exp(-gammaPerDay * dt)) : 0;
      const inf = infS + infV;
      S -= leavers;
      V += vac - infV;
      if (isSir) I += inf - rec1;
      else {
        E += inf - prog;
        I += prog - rec1;
      }
      R += rec1;
      C += inf;
    }
    recordUpTo(rec, tb, S, E, I, R, V, C);
  }
}

/** Runs realization number `index` of the configured stochastic model. */
export function runRealization(o: StochasticOptions, index: number): StochasticRun {
  validate(o);
  const method: StochasticMethod =
    o.method === 'gillespie' || o.method === 'chain_binomial'
      ? o.method
      : o.population <= GILLESPIE_MAX_POPULATION
        ? 'gillespie'
        : 'chain_binomial';
  const times = o.outputTimes ?? uniformGrid(o.horizonDays);
  const m = times.length;
  const rec: Recorder = {
    times,
    next: 0,
    S: new Float64Array(m),
    E: new Float64Array(m),
    I: new Float64Array(m),
    R: new Float64Array(m),
    V: new Float64Array(m),
    C: new Float64Array(m),
  };
  const rng = Rng.forStream(o.seed, index);
  if (method === 'gillespie') gillespie(o, rng, rec);
  else chainBinomial(o, rng, rec);
  if (rec.next !== m)
    throw new NumericalError('Stochastic run did not cover the whole output grid.');
  const last = m - 1;
  const secondary = (rec.C[last] as number) - o.initialInfected;
  return {
    method,
    index,
    times,
    S: rec.S,
    E: rec.E,
    I: rec.I,
    R: rec.R,
    V: rec.V,
    cumInfections: rec.C,
    extinct: (rec.E[last] as number) + (rec.I[last] as number) === 0,
    major: secondary >= MAJOR_OUTBREAK_FRACTION * o.population,
  };
}

/** Runs realizations start .. start+count-1 (call from several workers with disjoint ranges; results match a single sequential run). */
export function runEnsemble(
  o: StochasticOptions,
  start: number,
  count: number,
  onProgress?: (done: number) => void,
): StochasticRun[] {
  const runs: StochasticRun[] = [];
  for (let k = 0; k < count; k++) {
    runs.push(runRealization(o, start + k));
    onProgress?.(k + 1);
  }
  return runs;
}

/** Linear-interpolated quantile of an ascending-sorted array (q in [0,1]). */
export function quantileSorted(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] as number) + (pos - lo) * ((sorted[hi] as number) - (sorted[lo] as number));
}

export interface EnsembleBands {
  times: Float64Array;
  mean: Float64Array;
  median: Float64Array;
  q025: Float64Array;
  q25: Float64Array;
  q75: Float64Array;
  q975: Float64Array;
}

/** Per-time mean, median, 50% band (q25-q75) and 95% band (q2.5-q97.5) of one compartment across realizations. */
export function ensembleBands(
  runs: readonly StochasticRun[],
  compartment: 'S' | 'E' | 'I' | 'R' | 'V' | 'cumInfections',
): EnsembleBands {
  const first = runs[0];
  if (first === undefined)
    throw new ParamError('runs', 'out_of_range', 'Need at least one realization.');
  const m = first.times.length;
  const mk = (): Float64Array => new Float64Array(m);
  const bands: EnsembleBands = {
    times: first.times,
    mean: mk(),
    median: mk(),
    q025: mk(),
    q25: mk(),
    q75: mk(),
    q975: mk(),
  };
  const column = new Float64Array(runs.length);
  for (let k = 0; k < m; k++) {
    let sum = 0;
    runs.forEach((r, j) => {
      const v = r[compartment][k] as number;
      column[j] = v;
      sum += v;
    });
    column.sort();
    bands.mean[k] = sum / runs.length;
    bands.median[k] = quantileSorted(column, 0.5);
    bands.q025[k] = quantileSorted(column, 0.025);
    bands.q25[k] = quantileSorted(column, 0.25);
    bands.q75[k] = quantileSorted(column, 0.75);
    bands.q975[k] = quantileSorted(column, 0.975);
  }
  return bands;
}
