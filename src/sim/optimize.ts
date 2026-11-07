// Nelder-Mead simplex optimiser (derivative-free) with multi-start restarts and a convergence report.
// Bounds are handled by the caller through variable transformations (log for positive values, logit for (0,1)).

export interface NelderMeadOptions {
  maxIterations?: number;
  /** Stop when the simplex is smaller than this in every coordinate... */
  xTolerance?: number;
  /** ...and the function values differ by less than this. */
  fTolerance?: number;
  /** Size of the initial simplex edges (one number or one per coordinate). */
  initialStep?: number | number[];
}

export interface NelderMeadResult {
  x: number[];
  value: number;
  iterations: number;
  evaluations: number;
  converged: boolean;
}

/** Treats NaN as +Infinity so a bad evaluation is simply the worst point. */
function clean(v: number): number {
  return Number.isNaN(v) ? Infinity : v;
}

/** Minimises f starting from x0 (standard coefficients: reflect 1, expand 2, contract 1/2, shrink 1/2). */
export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  opts: NelderMeadOptions = {},
): NelderMeadResult {
  const n = x0.length;
  const maxIter = opts.maxIterations ?? 200 * n;
  const xTol = opts.xTolerance ?? 1e-8;
  const fTol = opts.fTolerance ?? 1e-10;
  let evaluations = 0;
  const ev = (x: number[]): number => {
    evaluations++;
    return clean(f(x));
  };
  const simplex: { x: number[]; v: number }[] = [{ x: [...x0], v: ev(x0) }];
  for (let i = 0; i < n; i++) {
    const step = Array.isArray(opts.initialStep)
      ? (opts.initialStep[i] ?? 0.1)
      : (opts.initialStep ?? 0.1);
    const x = [...x0];
    x[i] = (x[i] as number) + (step === 0 ? 0.1 : step);
    simplex.push({ x, v: ev(x) });
  }
  let iterations = 0;
  let converged = false;
  while (iterations < maxIter) {
    simplex.sort((a, b) => a.v - b.v);
    const best = simplex[0] as { x: number[]; v: number };
    const worst = simplex[n] as { x: number[]; v: number };
    const secondWorst = simplex[n - 1] as { x: number[]; v: number };
    let spreadX = 0;
    for (let i = 1; i <= n; i++)
      for (let j = 0; j < n; j++)
        spreadX = Math.max(
          spreadX,
          Math.abs(((simplex[i] as { x: number[] }).x[j] as number) - (best.x[j] as number)),
        );
    const spreadF = Math.abs(worst.v - best.v);
    if (spreadX < xTol && (spreadF < fTol || !Number.isFinite(spreadF))) {
      converged = true;
      break;
    }
    iterations++;
    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        centroid[j] =
          (centroid[j] as number) + ((simplex[i] as { x: number[] }).x[j] as number) / n;
    const along = (t: number): number[] =>
      centroid.map((c, j) => c + t * (c - (worst.x[j] as number)));
    const xr = along(1);
    const fr = ev(xr);
    if (fr < best.v) {
      const xe = along(2);
      const fe = ev(xe);
      simplex[n] = fe < fr ? { x: xe, v: fe } : { x: xr, v: fr };
    } else if (fr < secondWorst.v) {
      simplex[n] = { x: xr, v: fr };
    } else {
      const outside = fr < worst.v;
      const xc = along(outside ? 0.5 : -0.5);
      const fc = ev(xc);
      if (fc < (outside ? fr : worst.v)) simplex[n] = { x: xc, v: fc };
      else {
        for (let i = 1; i <= n; i++) {
          const p = simplex[i] as { x: number[]; v: number };
          const x = p.x.map((xj, j) => (best.x[j] as number) + 0.5 * (xj - (best.x[j] as number)));
          simplex[i] = { x, v: ev(x) };
        }
      }
    }
  }
  simplex.sort((a, b) => a.v - b.v);
  const best = simplex[0] as { x: number[]; v: number };
  return { x: best.x, value: best.v, iterations, evaluations, converged };
}

export interface MultiStartResult {
  best: NelderMeadResult;
  all: NelderMeadResult[];
  /** How many starts ended within `agreeTolerance` of the best value (more = more trustworthy optimum). */
  agreeing: number;
  agreeTolerance: number;
  /** True if the best run converged and at least two starts agree on the optimum. */
  reliable: boolean;
}

/** Runs Nelder-Mead from several starting points, then once more from the best point, and reports how well the runs agree. */
export function multiStart(
  f: (x: number[]) => number,
  starts: number[][],
  opts: NelderMeadOptions = {},
  onProgress?: (done: number, total: number) => void,
  agreeTolerance = 0.05,
): MultiStartResult {
  const all: NelderMeadResult[] = [];
  starts.forEach((s, i) => {
    all.push(nelderMead(f, s, opts));
    onProgress?.(i + 1, starts.length + 1);
  });
  all.sort((a, b) => a.value - b.value);
  const first = all[0];
  if (first === undefined) throw new Error('multiStart needs at least one starting point');
  const polished = nelderMead(f, first.x, { ...opts, initialStep: 0.02 });
  onProgress?.(starts.length + 1, starts.length + 1);
  const best = polished.value <= first.value ? polished : first;
  const agreeing = all.filter(
    (r) => Number.isFinite(r.value) && Math.abs(r.value - best.value) <= agreeTolerance,
  ).length;
  return { best, all, agreeing, agreeTolerance, reliable: best.converged && agreeing >= 2 };
}
