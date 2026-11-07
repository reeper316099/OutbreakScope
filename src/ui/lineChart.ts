// Chart.js line chart wrapper used for compartments, incidence, R_eff and scenario comparison.
// Chart.js is bundled from npm (no CDN); only the pieces we need are registered to keep the bundle small.
import {
  Chart,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  LogarithmicScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import type { ChartConfiguration, Plugin, TooltipItem } from 'chart.js';
import { cssVar } from './dom';
import { fmtCompact, fmtInt } from './format';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  LogarithmicScale,
  Legend,
  Tooltip,
  Filler,
);

export interface SeriesDef {
  label: string;
  /** CSS colour (already resolved). */
  color: string;
  /** Dash pattern so colour is never the only signal (empty = solid). */
  dash: number[];
  width?: number;
  /** Fill towards another dataset ('-1' = the previous one) to draw a band. */
  fill?: string | false;
  /** Draw only markers (observed data). */
  pointsOnly?: boolean;
  /** Leave out of the legend (band edges). */
  hideLegend?: boolean;
  data: { x: number; y: number | null }[];
}

export interface Band {
  startDay: number;
  endDay: number;
  label: string;
  /** 'contact' or 'vaccination' picks the band colour. */
  kind: 'contact' | 'vaccination';
}

export interface LineSpec {
  datasets: SeriesDef[];
  yTitle: string;
  yFormat: 'count' | 'percent' | 'plain';
  log?: boolean;
  bands?: Band[];
  /** Day ranges to shade (R_eff > 1). */
  shade?: { segments: [number, number][]; label: string };
  /** Horizontal reference line (e.g. R_eff = 1). */
  hline?: number;
  yMin?: number;
}

export class LineChart {
  readonly chart: Chart<'line'>;
  private decor: Pick<LineSpec, 'bands' | 'shade' | 'hline'> = {};

  constructor(canvas: HTMLCanvasElement) {
    const decorRef = (): Pick<LineSpec, 'bands' | 'shade' | 'hline'> => this.decor;
    const plugin: Plugin<'line'> = {
      id: 'outbreakDecor',
      beforeDraw(chart) {
        // Opaque background so exported PNGs are readable in both themes.
        const { ctx, width, height } = chart;
        ctx.save();
        ctx.fillStyle = cssVar('--surface');
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      },
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        const x = scales['x'];
        const y = scales['y'];
        if (!x || !y) return;
        const d = decorRef();
        ctx.save();
        ctx.beginPath();
        ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
        ctx.clip();
        for (const [a, b] of d.shade?.segments ?? []) {
          ctx.fillStyle = 'rgba(213, 94, 0, 0.12)';
          ctx.fillRect(
            x.getPixelForValue(a),
            chartArea.top,
            Math.max(1, x.getPixelForValue(b) - x.getPixelForValue(a)),
            chartArea.height,
          );
        }
        for (const band of d.bands ?? []) {
          const left = x.getPixelForValue(band.startDay);
          const right = x.getPixelForValue(band.endDay);
          ctx.fillStyle =
            band.kind === 'contact' ? 'rgba(20, 184, 166, 0.16)' : 'rgba(204, 121, 167, 0.20)';
          ctx.fillRect(left, chartArea.top, Math.max(1, right - left), chartArea.height);
          ctx.fillStyle = cssVar('--text-muted');
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillText(band.label, left + 4, chartArea.top + 12);
        }
        if (d.hline !== undefined) {
          const py = y.getPixelForValue(d.hline);
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = cssVar('--text-muted');
          ctx.beginPath();
          ctx.moveTo(chartArea.left, py);
          ctx.lineTo(chartArea.right, py);
          ctx.stroke();
        }
        ctx.restore();
      },
    };
    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: { datasets: [] },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        interaction: { mode: 'index', intersect: false },
        elements: { point: { radius: 0, hoverRadius: 4 }, line: { tension: 0 } },
        scales: {
          x: { type: 'linear', title: { display: true, text: 'Day' } },
          y: { type: 'linear' },
        },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: false, boxWidth: 36 } },
          tooltip: {},
        },
      },
      plugins: [plugin],
    };
    this.chart = new Chart(canvas, config);
  }

  /** Replaces the chart contents and redraws using the current theme colours. */
  update(spec: LineSpec): void {
    const text = cssVar('--text-muted');
    const grid = cssVar('--border');
    this.decor = { bands: spec.bands, shade: spec.shade, hline: spec.hline };
    const c = this.chart;
    c.data.datasets = spec.datasets.map((s) => ({
      label: s.label,
      data: s.data,
      borderColor: s.pointsOnly || s.fill ? (s.fill ? 'transparent' : s.color) : s.color,
      backgroundColor: s.fill ? s.color : s.color,
      borderDash: s.dash,
      borderWidth: s.pointsOnly ? 0 : (s.width ?? 2),
      showLine: !s.pointsOnly,
      pointRadius: s.pointsOnly ? 4 : 0,
      pointHoverRadius: s.pointsOnly ? 6 : 4,
      fill: s.fill ?? false,
      spanGaps: false,
    }));
    const hidden = new Set(spec.datasets.flatMap((s, i) => (s.hideLegend ? [i] : [])));
    const fmt = (v: number): string =>
      spec.yFormat === 'percent'
        ? `${Number(v.toPrecision(3))}%`
        : spec.yFormat === 'count'
          ? fmtCompact(v)
          : String(Number(v.toPrecision(3)));
    const scales = c.options.scales;
    if (scales) {
      scales['x'] = {
        type: 'linear',
        title: { display: true, text: 'Day', color: text },
        ticks: { color: text },
        grid: { color: grid },
      };
      scales['y'] = {
        type: spec.log ? 'logarithmic' : 'linear',
        title: { display: true, text: spec.yTitle, color: text },
        ticks: { color: text, callback: (v) => fmt(Number(v)) },
        grid: { color: grid },
        ...(spec.yMin !== undefined ? { min: spec.yMin } : spec.log ? {} : { beginAtZero: true }),
      };
    }
    const plugins = c.options.plugins;
    if (plugins) {
      plugins.legend = {
        position: 'top',
        labels: {
          color: cssVar('--text'),
          usePointStyle: false,
          boxWidth: 36,
          filter: (item) => !hidden.has(item.datasetIndex ?? -1),
        },
      };
      plugins.tooltip = {
        callbacks: {
          title: (items: TooltipItem<'line'>[]) => (items[0] ? `Day ${items[0].parsed.x}` : ''),
          label: (item: TooltipItem<'line'>) => {
            const y = item.parsed.y;
            if (y === null || y === undefined) return `${item.dataset.label ?? ''}: –`;
            const shown =
              spec.yFormat === 'percent'
                ? `${y.toFixed(3)}%`
                : spec.yFormat === 'count'
                  ? fmtInt(y)
                  : y.toFixed(3);
            return `${item.dataset.label ?? ''}: ${shown}`;
          },
        },
      };
    }
    c.update();
  }

  /** PNG of the chart as base64 (no data: prefix), for the native save dialog. */
  toPngBase64(): string {
    return this.chart.toBase64Image('image/png', 1).replace(/^data:image\/png;base64,/, '');
  }
}
