// Small canvas charts for fit results: posterior histogram with prior overlay, pairwise scatter and trace plots.
import { cssVar } from './dom';

/** Prepares a canvas for crisp drawing at the device pixel ratio and returns its 2D context and CSS size. */
function prepare(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 180;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cssVar('--surface');
  ctx.fillRect(0, 0, w, h);
  return { ctx, w, h };
}

/** Rounds a number for axis labels. */
function lab(x: number): string {
  return Math.abs(x) >= 100 ? String(Math.round(x)) : String(Number(x.toPrecision(3)));
}

const M = { l: 40, r: 10, t: 14, b: 32 };

/** Posterior histogram (filled) with the prior's histogram as an outline, on shared bins. */
export function drawHistogram(
  canvas: HTMLCanvasElement,
  posterior: ArrayLike<number>,
  prior: ArrayLike<number>,
  title: string,
  mark?: { median: number; low: number; high: number },
): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const post = Array.from(posterior).sort((a, b) => a - b);
  const priorSorted = Array.from(prior).sort((a, b) => a - b);
  const pLo = post[0] ?? 0;
  const pHi = post[post.length - 1] ?? 1;
  const width = Math.max(pHi - pLo, Math.abs(pHi) * 1e-6, 1e-9);
  // Focus on the posterior (padded by 1.5 widths each side), but never beyond the prior's 1st-99th percentile range.
  const priorLo = priorSorted[Math.floor(priorSorted.length * 0.01)] ?? pLo - 3 * width;
  const priorHi = priorSorted[Math.floor(priorSorted.length * 0.99)] ?? pHi + 3 * width;
  const min = Math.max(pLo - 1.5 * width, Math.min(priorLo, pLo));
  const max = Math.min(pHi + 1.5 * width, Math.max(priorHi, pHi));
  const bins = 30;
  const bw = (max - min) / bins || 1;
  const hist = (xs: ArrayLike<number>): number[] => {
    const c = new Array<number>(bins).fill(0);
    for (let i = 0; i < xs.length; i++) {
      const b = Math.floor(((xs[i] as number) - min) / bw);
      if (b >= 0 && b < bins) c[b] = (c[b] as number) + 1;
    }
    return c.map((v) => v / (xs.length * bw));
  };
  const hp = hist(posterior);
  const hq = hist(prior);
  const top = Math.max(...hp, ...hq) * 1.1 || 1;
  const X = (x: number): number => M.l + ((x - min) / (max - min)) * (w - M.l - M.r);
  const Y = (d: number): number => h - M.b - (d / top) * (h - M.b - M.t);
  ctx.fillStyle = cssVar('--c-S');
  ctx.globalAlpha = 0.55;
  hp.forEach((d, i) =>
    ctx.fillRect(
      X(min + i * bw),
      Y(d),
      Math.max(1, X(min + (i + 1) * bw) - X(min + i * bw) - 1),
      h - M.b - Y(d),
    ),
  );
  ctx.globalAlpha = 1;
  ctx.strokeStyle = cssVar('--c-I');
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  hq.forEach((d, i) => {
    const x0 = X(min + i * bw);
    const x1 = X(min + (i + 1) * bw);
    if (i === 0) ctx.moveTo(x0, Y(d));
    else ctx.lineTo(x0, Y(d));
    ctx.lineTo(x1, Y(d));
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = cssVar('--text-muted');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(M.l, h - M.b);
  ctx.lineTo(w - M.r, h - M.b);
  ctx.stroke();
  ctx.fillStyle = cssVar('--text-muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++)
    ctx.fillText(lab(min + ((max - min) * i) / 4), X(min + ((max - min) * i) / 4), h - M.b + 14);
  ctx.textAlign = 'left';
  ctx.fillStyle = cssVar('--text');
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillText(title, M.l, 11);
  if (mark) {
    ctx.strokeStyle = cssVar('--text');
    ctx.lineWidth = 2;
    for (const v of [mark.low, mark.high]) {
      ctx.beginPath();
      ctx.moveTo(X(Math.min(max, Math.max(min, v))), M.t);
      ctx.lineTo(X(Math.min(max, Math.max(min, v))), h - M.b);
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** Scatter of two parameters' posterior draws. */
export function drawScatter(
  canvas: HTMLCanvasElement,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  xLabel: string,
  yLabel: string,
): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const n = xs.length;
  const step = Math.max(1, Math.floor(n / 1500));
  const xv = Array.from(xs).sort((a, b) => a - b);
  const yv = Array.from(ys).sort((a, b) => a - b);
  const bounds = (v: number[]): [number, number] => {
    const lo = v[Math.floor(v.length * 0.005)] ?? 0;
    const hi = v[Math.floor(v.length * 0.995)] ?? 1;
    const pad = (hi - lo) * 0.05 || 1;
    return [lo - pad, hi + pad];
  };
  const [x0, x1] = bounds(xv);
  const [y0, y1] = bounds(yv);
  const X = (x: number): number => M.l + ((x - x0) / (x1 - x0)) * (w - M.l - M.r);
  const Y = (y: number): number => h - M.b - ((y - y0) / (y1 - y0)) * (h - M.b - M.t);
  ctx.fillStyle = cssVar('--c-S');
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < n; i += step) {
    ctx.beginPath();
    ctx.arc(X(xs[i] as number), Y(ys[i] as number), 2.2, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = cssVar('--text-muted');
  ctx.beginPath();
  ctx.moveTo(M.l, M.t);
  ctx.lineTo(M.l, h - M.b);
  ctx.lineTo(w - M.r, h - M.b);
  ctx.stroke();
  ctx.fillStyle = cssVar('--text-muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++)
    ctx.fillText(lab(x0 + ((x1 - x0) * i) / 4), X(x0 + ((x1 - x0) * i) / 4), h - M.b + 14);
  ctx.fillText(xLabel, (M.l + w - M.r) / 2, h - 4);
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++)
    ctx.fillText(lab(y0 + ((y1 - y0) * i) / 4), M.l - 4, Y(y0 + ((y1 - y0) * i) / 4) + 4);
  ctx.save();
  ctx.translate(10, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

const DASHES: number[][] = [[], [8, 4], [2, 3], [12, 4, 2, 4]];

/** Trace plot: each chain's draws in order, with a different dash pattern per chain (colour is not the only cue). */
export function drawTrace(
  canvas: HTMLCanvasElement,
  chains: ArrayLike<number>[],
  title: string,
): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of chains)
    for (let i = 0; i < c.length; i++) {
      lo = Math.min(lo, c[i] as number);
      hi = Math.max(hi, c[i] as number);
    }
  if (!(hi > lo)) hi = lo + 1;
  const n = chains[0]?.length ?? 1;
  const X = (i: number): number => M.l + (i / Math.max(1, n - 1)) * (w - M.l - M.r);
  const Y = (v: number): number => h - M.b - ((v - lo) / (hi - lo)) * (h - M.b - M.t);
  const colors = ['--c-S', '--c-E', '--c-I', '--c-R', '--c-V'];
  chains.forEach((c, k) => {
    ctx.strokeStyle = cssVar(colors[k % colors.length] as string);
    ctx.setLineDash(DASHES[k % DASHES.length] as number[]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < c.length; i++) {
      if (i === 0) ctx.moveTo(X(i), Y(c[i] as number));
      else ctx.lineTo(X(i), Y(c[i] as number));
    }
    ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.strokeStyle = cssVar('--text-muted');
  ctx.beginPath();
  ctx.moveTo(M.l, M.t);
  ctx.lineTo(M.l, h - M.b);
  ctx.lineTo(w - M.r, h - M.b);
  ctx.stroke();
  ctx.fillStyle = cssVar('--text-muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 3; i++)
    ctx.fillText(lab(lo + ((hi - lo) * i) / 3), M.l - 4, Y(lo + ((hi - lo) * i) / 3) + 4);
  ctx.textAlign = 'center';
  ctx.fillText('draw number (after burn-in)', (M.l + w - M.r) / 2, h - 4);
  ctx.textAlign = 'left';
  ctx.fillStyle = cssVar('--text');
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillText(title, M.l, 11);
}
