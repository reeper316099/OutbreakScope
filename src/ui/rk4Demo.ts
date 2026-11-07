// Interactive one-step RK4 visualisation on the toy problem y' = r*y (early exponential growth), where the exact answer is known.
import { clear, h, svg } from './dom';

const W = 560;
const H = 280;
const STEP_TEXT = [
  'Start at day 0 with y = 1. The true answer (black curve) is y = e^(r t). We want to jump ahead by one step of size h.',
  'k1: the slope at the start of the step. Euler’s method would stop here and walk straight along k1, which drifts away from the curve.',
  'k2: walk half a step along k1, then measure the slope there. This is a better guess for the slope in the middle of the step.',
  'k3: walk half a step along k2 instead, and measure the slope again. This corrects the middle-of-step slope further.',
  'k4: walk a full step along k3 and measure the slope at the end of the step.',
  'Blend: the step uses (k1 + 2·k2 + 2·k3 + k4) / 6 as its slope. The result (filled dot) lands much closer to the true curve than Euler (hollow dot).',
];

/** Builds the demo into `root` for growth rate r (per day); returns nothing, controls are self-contained. */
export function buildRk4Demo(root: HTMLElement, rate: number): void {
  const r = Math.abs(rate) < 1e-6 ? 0.2 : rate;
  let stepSize = Math.min(6, Math.max(0.5, 1.5 / Math.abs(r)));
  let stage = 0;
  const canvas = h('div', { class: 'rk4-svg' });
  const text = h('p', { id: 'rk4-text', 'aria-live': 'polite' });
  const slider = h('input', {
    type: 'range',
    min: 0.2,
    max: 8,
    step: 0.1,
    value: stepSize,
    id: 'rk4-h',
    'aria-label': 'Step size h in days',
  });
  const label = h('span', { class: 'mono' });
  const back = h('button', { type: 'button', class: 'btn small-btn' }, 'Back');
  const next = h('button', { type: 'button', class: 'btn small-btn', id: 'rk4-next' }, 'Next step');
  const reset = h('button', { type: 'button', class: 'btn small-btn' }, 'Restart');

  /** Redraws the SVG for the current step size and stage. */
  function draw(): void {
    const hh = stepSize;
    const f = (y: number): number => r * y;
    const y0 = 1;
    const k1 = f(y0);
    const k2 = f(y0 + 0.5 * hh * k1);
    const k3 = f(y0 + 0.5 * hh * k2);
    const k4 = f(y0 + hh * k3);
    const rk4 = y0 + (hh / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    const euler = y0 + hh * k1;
    const exact = Math.exp(r * hh);
    const xMax = hh * 1.15;
    const yVals = [y0, exact, rk4, euler, y0 + hh * k4, y0 + hh * k3];
    const yMin = Math.min(...yVals) * 0.9;
    const yMax = Math.max(...yVals) * 1.1;
    const X = (t: number): number => 50 + (t / xMax) * (W - 70);
    const Y = (y: number): number => H - 30 - ((y - yMin) / (yMax - yMin)) * (H - 50);
    const root2 = svg('svg', {
      viewBox: `0 0 ${W} ${H}`,
      width: '100%',
      role: 'img',
      'aria-label': 'One RK4 step on y prime equals r y',
    });
    let path = '';
    for (let i = 0; i <= 60; i++) {
      const t = (xMax * i) / 60;
      path += `${i === 0 ? 'M' : 'L'}${X(t).toFixed(1)},${Y(Math.exp(r * t)).toFixed(1)} `;
    }
    root2.append(svg('path', { d: path, class: 'rk-exact', fill: 'none' }));
    root2.append(
      svg('line', { x1: 50, y1: H - 30, x2: W - 20, y2: H - 30, class: 'tl-axis' }),
      svg('line', { x1: 50, y1: 10, x2: 50, y2: H - 30, class: 'tl-axis' }),
    );
    const svgText = (x: number, y: number, t: string, anchor = 'middle'): SVGElement => {
      const el = svg('text', { x, y, class: 'tl-tick', 'text-anchor': anchor });
      el.textContent = t;
      return el;
    };
    root2.append(
      svgText(X(0), H - 12, '0'),
      svgText(X(hh), H - 12, `h = ${hh.toFixed(1)}`),
      svgText(30, 16, 'y', 'middle'),
    );
    /** Draws a slope segment starting at (t, y) with slope s across half or full step. */
    const slope = (t: number, y: number, s: number, len: number, cls: string): void => {
      root2.append(
        svg('line', { x1: X(t), y1: Y(y), x2: X(t + len), y2: Y(y + s * len), class: cls }),
      );
    };
    const dot = (t: number, y: number, cls: string): void =>
      void root2.append(svg('circle', { cx: X(t), cy: Y(y), r: 5, class: cls }));
    dot(0, y0, 'rk-start');
    if (stage >= 1) slope(0, y0, k1, hh, 'rk-k1');
    if (stage >= 2) slope(hh / 2, y0 + 0.5 * hh * k1, k2, hh / 2, 'rk-k2');
    if (stage >= 3) slope(hh / 2, y0 + 0.5 * hh * k2, k3, hh / 2, 'rk-k3');
    if (stage >= 4) slope(hh, y0 + hh * k3, k4, Math.min(hh * 0.15, xMax - hh), 'rk-k4');
    if (stage >= 5) {
      dot(hh, euler, 'rk-euler');
      dot(hh, rk4, 'rk-rk4');
      dot(hh, exact, 'rk-true');
      root2.append(
        svgText(X(hh) + 8, Y(rk4) - 8, 'RK4', 'start'),
        svgText(X(hh) + 8, Y(euler) + 16, 'Euler', 'start'),
      );
    }
    clear(canvas);
    canvas.append(root2);
    text.textContent = STEP_TEXT[stage] ?? '';
    const errRk = Math.abs(rk4 - exact) / exact;
    const errEu = Math.abs(euler - exact) / exact;
    label.textContent =
      stage >= 5
        ? `error: Euler ${(errEu * 100).toFixed(2)}%, RK4 ${(errRk * 100).toFixed(4)}%`
        : `r = ${r.toFixed(3)} per day`;
    back.disabled = stage === 0;
    next.disabled = stage === STEP_TEXT.length - 1;
  }

  slider.addEventListener('input', () => {
    stepSize = Number(slider.value);
    draw();
  });
  back.addEventListener('click', () => {
    stage = Math.max(0, stage - 1);
    draw();
  });
  next.addEventListener('click', () => {
    stage = Math.min(STEP_TEXT.length - 1, stage + 1);
    draw();
  });
  reset.addEventListener('click', () => {
    stage = 0;
    draw();
  });
  clear(root);
  root.append(
    canvas,
    text,
    h(
      'div',
      { class: 'row-gap' },
      h('label', {}, 'Step size h (days) ', slider),
      back,
      next,
      reset,
      label,
    ),
  );
  draw();
}
