// Flat storage for many stochastic realizations plus summaries (bands, peaks, fizzle fraction).
import { ParamError } from './errors';
import { quantileSorted } from './stochastic';

export interface EnsembleData {
  /** Output times shared by all realizations. */
  times: Float64Array;
  count: number;
  /** Flattened infectious counts: realization r, time k -> r * times.length + k. */
  I: Float64Array;
  /** Flattened cumulative infections. */
  cumInfections: Float64Array;
  /** 1 if the realization was a major outbreak (see MAJOR_OUTBREAK_FRACTION), else 0. */
  major: Uint8Array;
  /** 1 if no one was exposed/infectious at the end. */
  extinct: Uint8Array;
}

export interface Bands {
  mean: Float64Array;
  median: Float64Array;
  q025: Float64Array;
  q25: Float64Array;
  q75: Float64Array;
  q975: Float64Array;
}

/** Interval summary (median and 95% range) of a per-realization number. */
export interface Interval {
  median: number;
  low: number;
  high: number;
}

export interface EnsembleSummary {
  count: number;
  fractionMajor: number;
  fractionFizzled: number;
  /** Over major outbreaks only (NaN-free; null when there are none). */
  peakInfectious: Interval | null;
  peakDay: Interval | null;
  finalSizeFraction: Interval | null;
  /** Final size over all realizations, including fizzled ones. */
  finalSizeFractionAll: Interval;
}

/** Per-time mean, median, 50% and 95% bands of an ensemble series. */
export function bandsOf(data: EnsembleData, series: 'I' | 'cumInfections'): Bands {
  if (data.count < 1)
    throw new ParamError('ensemble', 'out_of_range', 'Need at least one realization.');
  const m = data.times.length;
  const src = data[series];
  const mk = (): Float64Array => new Float64Array(m);
  const b: Bands = { mean: mk(), median: mk(), q025: mk(), q25: mk(), q75: mk(), q975: mk() };
  const col = new Float64Array(data.count);
  for (let k = 0; k < m; k++) {
    let sum = 0;
    for (let r = 0; r < data.count; r++) {
      const v = src[r * m + k] as number; // r < count and k < m by the loop bounds
      col[r] = v;
      sum += v;
    }
    col.sort();
    b.mean[k] = sum / data.count;
    b.median[k] = quantileSorted(col, 0.5);
    b.q025[k] = quantileSorted(col, 0.025);
    b.q25[k] = quantileSorted(col, 0.25);
    b.q75[k] = quantileSorted(col, 0.75);
    b.q975[k] = quantileSorted(col, 0.975);
  }
  return b;
}

/** Median and central 95% range of a list of numbers; null for an empty list. */
function interval(values: number[]): Interval | null {
  if (values.length === 0) return null;
  const s = Float64Array.from(values).sort();
  return {
    median: quantileSorted(s, 0.5),
    low: quantileSorted(s, 0.025),
    high: quantileSorted(s, 0.975),
  };
}

/** Summarises peaks, peak days, final sizes and the fizzle fraction across realizations. */
export function summarizeEnsemble(data: EnsembleData, population: number): EnsembleSummary {
  const m = data.times.length;
  const peaks: number[] = [];
  const days: number[] = [];
  const sizesMajor: number[] = [];
  const sizesAll: number[] = [];
  let major = 0;
  for (let r = 0; r < data.count; r++) {
    const isMajor = data.major[r] === 1;
    if (isMajor) major++;
    let best = -1;
    let bestK = 0;
    for (let k = 0; k < m; k++) {
      const v = data.I[r * m + k] as number;
      if (v > best) {
        best = v;
        bestK = k;
      }
    }
    const size = (data.cumInfections[r * m + m - 1] as number) / population;
    sizesAll.push(size);
    if (isMajor) {
      peaks.push(best);
      days.push(data.times[bestK] as number);
      sizesMajor.push(size);
    }
  }
  const all = interval(sizesAll);
  if (all === null)
    throw new ParamError('ensemble', 'out_of_range', 'Need at least one realization.');
  return {
    count: data.count,
    fractionMajor: major / data.count,
    fractionFizzled: 1 - major / data.count,
    peakInfectious: interval(peaks),
    peakDay: interval(days),
    finalSizeFraction: interval(sizesMajor),
    finalSizeFractionAll: all,
  };
}

/** Allocates empty storage for `count` realizations. */
export function emptyEnsemble(times: Float64Array, count: number): EnsembleData {
  return {
    times,
    count,
    I: new Float64Array(count * times.length),
    cumInfections: new Float64Array(count * times.length),
    major: new Uint8Array(count),
    extinct: new Uint8Array(count),
  };
}

/** Copies a worker chunk (realizations start..start+count-1) into the full ensemble. */
export function mergeChunk(
  into: EnsembleData,
  chunk: {
    start: number;
    count: number;
    I: Float64Array;
    cumInfections: Float64Array;
    major: Uint8Array;
    extinct: Uint8Array;
  },
): void {
  const m = into.times.length;
  if (
    chunk.start < 0 ||
    chunk.start + chunk.count > into.count ||
    chunk.I.length !== chunk.count * m
  ) {
    throw new ParamError('chunk', 'out_of_range', 'Worker chunk does not fit the ensemble.');
  }
  into.I.set(chunk.I, chunk.start * m);
  into.cumInfections.set(chunk.cumInfections, chunk.start * m);
  into.major.set(chunk.major, chunk.start);
  into.extinct.set(chunk.extinct, chunk.start);
}

/** Theoretical probability of a major outbreak, 1 - (1/R0)^k (MODEL.md section 3); 0 for R0 <= 1. */
export function theoreticalMajorProbability(r0: number, initialInfected: number): number {
  return r0 <= 1 ? 0 : 1 - Math.pow(1 / r0, initialInfected);
}
