// Custom canvas chart for stochastic ensembles: hundreds of translucent realization lines are far too slow for
// a general chart library, so this draws them directly. Shows runs, 95% and 50% bands, the median and the deterministic curve.
import type { Bands } from '../sim/ensemble';
import { cssVar } from './dom';
import { fmtCompact, fmtInt } from './format';

export interface EnsembleDrawData {
  times: Float64Array;
  count: number;
  /** Flattened series (realization-major). */
  runs: Float64Array;
  bands: Bands;
  deterministic: Float64Array | null;
  yLabel: string;
  /** Divides values for display (e.g. N/100 to show percent); 1 = counts. */
  scale: number;
  percent: boolean;
}

/** Rounds up to a "nice" axis maximum and returns tick step. */
function niceScale(max: number, ticks = 5): { max: number; step: number } {
  const raw = max / ticks || 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  return { max: Math.ceil(max / step) * step, step };
}

export class EnsembleChart {
  private data: EnsembleDrawData | null = null;
  private hoverIndex = -1;
  private readonly margin = { left: 64, right: 16, top: 12, bottom: 40 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly readout: HTMLElement,
  ) {
    const redraw = (): void => this.draw();
    new ResizeObserver(redraw).observe(canvas);
    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('mouseleave', () => {
      this.hoverIndex = -1;
      this.draw();
    });
  }

  /** Sets new data and redraws. */
  set(data: EnsembleDrawData | null): void {
    this.data = data;
    this.hoverIndex = -1;
    this.draw();
  }

  /** PNG of the canvas as base64 (no data: prefix). */
  toPngBase64(): string {
    return this.canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  }

  private onMove(e: MouseEvent): void {
    const d = this.data;
    if (!d) return;
    const rect = this.canvas.getBoundingClientRect();
    const plotW = rect.width - this.margin.left - this.margin.right;
    const frac = (e.clientX - rect.left - this.margin.left) / plotW;
    const last = d.times.length - 1;
    this.hoverIndex = Math.min(last, Math.max(0, Math.round(frac * last)));
    this.draw();
    const k = this.hoverIndex;
    const f = (v: number): string =>
      d.percent ? `${(v / d.scale).toFixed(3)}%` : fmtInt(v / d.scale);
    this.readout.textContent = `Day ${d.times[k]}: median ${f(d.bands.median[k] as number)}; 50% of runs between ${f(d.bands.q25[k] as number)} and ${f(d.bands.q75[k] as number)}; 95% between ${f(d.bands.q025[k] as number)} and ${f(d.bands.q975[k] as number)}${d.deterministic ? `; deterministic ${f(d.deterministic[k] as number)}` : ''}.`;
  }

  /** Redraws everything for the canvas' current size and the active theme. */
  draw(): void {
    const canvas = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (w === 0 || hgt === 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssVar('--surface');
    ctx.fillRect(0, 0, w, hgt);
    const d = this.data;
    const m = this.margin;
    const pw = w - m.left - m.right;
    const ph = hgt - m.top - m.bottom;
    if (!d || pw <= 0 || ph <= 0) return;
    const nT = d.times.length;
    const tMax = d.times[nT - 1] as number;
    let yMax = 0;
    for (let i = 0; i < d.runs.length; i++)
      if ((d.runs[i] as number) > yMax) yMax = d.runs[i] as number;
    if (d.deterministic) for (const v of d.deterministic) yMax = Math.max(yMax, v);
    const ns = niceScale(Math.max(yMax, 1e-9) / d.scale);
    const yTop = ns.max * d.scale;
    const X = (t: number): number => m.left + (t / tMax) * pw;
    const Y = (v: number): number => m.top + ph - (v / yTop) * ph;
    const textColor = cssVar('--text-muted');
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = textColor;
    ctx.strokeStyle = cssVar('--border');
    ctx.lineWidth = 1;
    for (let v = 0; v <= ns.max + 1e-9; v += ns.step) {
      const py = Y(v * d.scale);
      ctx.beginPath();
      ctx.moveTo(m.left, py);
      ctx.lineTo(m.left + pw, py);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(d.percent ? `${Number(v.toPrecision(3))}%` : fmtCompact(v), m.left - 6, py + 4);
    }
    const xTicks = 6;
    for (let i = 0; i <= xTicks; i++) {
      const t = (tMax * i) / xTicks;
      ctx.textAlign = 'center';
      ctx.fillText(String(Math.round(t)), X(t), m.top + ph + 16);
    }
    ctx.fillText('Day', m.left + pw / 2, hgt - 6);
    ctx.save();
    ctx.translate(14, m.top + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(d.yLabel, 0, 0);
    ctx.restore();
    // translucent realization lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = cssVar('--c-I');
    ctx.globalAlpha = Math.min(0.5, Math.max(0.04, 12 / d.count));
    for (let r = 0; r < d.count; r++) {
      ctx.beginPath();
      for (let k = 0; k < nT; k++) {
        const px = X(d.times[k] as number);
        const py = Y(d.runs[r * nT + k] as number);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // bands
    const fillBand = (lo: Float64Array, hi: Float64Array, alpha: number): void => {
      ctx.beginPath();
      for (let k = 0; k < nT; k++) ctx.lineTo(X(d.times[k] as number), Y(hi[k] as number));
      for (let k = nT - 1; k >= 0; k--) ctx.lineTo(X(d.times[k] as number), Y(lo[k] as number));
      ctx.closePath();
      ctx.fillStyle = cssVar('--c-S');
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    fillBand(d.bands.q025, d.bands.q975, 0.14);
    fillBand(d.bands.q25, d.bands.q75, 0.24);
    const line = (series: Float64Array, color: string, width: number, dash: number[]): void => {
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (let k = 0; k < nT; k++) {
        const px = X(d.times[k] as number);
        const py = Y(series[k] as number);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(d.bands.median, cssVar('--c-S'), 2.5, []);
    if (d.deterministic) line(d.deterministic, cssVar('--text'), 2, [8, 4]);
    if (this.hoverIndex >= 0) {
      const hx = X(d.times[this.hoverIndex] as number);
      ctx.strokeStyle = textColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, m.top);
      ctx.lineTo(hx, m.top + ph);
      ctx.stroke();
    }
  }
}
