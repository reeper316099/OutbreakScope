// "How this works": flow diagram, equations in MathML with the live parameter values, a worked example, RK4, and assumptions.
import type { Scenario } from '../shared/types';
import { userToInternal, validateUserParams } from '../sim/params';
import { MODEL_INFO } from '../sim/models';
import { earlyGrowthRate } from '../sim/derived';
import { clear, h, svg } from './dom';
import { fmtInt, fmtSig } from './format';
import { ddt, equation, mfrac, mi, mn, mo, mrow } from './mathml';
import { buildRk4Demo } from './rk4Demo';
import { ASSUMPTIONS } from './resultsPanel';

/** Draws the labelled compartment flow diagram for the chosen model. */
function flowDiagram(model: Scenario['params']['model']): SVGElement {
  const boxes: { id: string; x: number; label: string; cls: string }[] = [
    { id: 'S', x: 20, label: 'S\nSusceptible', cls: 'fb-S' },
  ];
  if (model !== 'SIR') boxes.push({ id: 'E', x: 190, label: 'E\nExposed', cls: 'fb-E' });
  boxes.push({ id: 'I', x: model === 'SIR' ? 190 : 360, label: 'I\nInfectious', cls: 'fb-I' });
  boxes.push({ id: 'R', x: model === 'SIR' ? 360 : 530, label: 'R\nRecovered', cls: 'fb-R' });
  const W = model === 'SIR' ? 520 : 690;
  const root = svg('svg', {
    viewBox: `0 0 ${W} ${model === 'SEIRV' ? 210 : 130}`,
    width: '100%',
    role: 'img',
    'aria-label': `Flow diagram of the ${MODEL_INFO[model].label} model`,
  });
  const text = (
    x: number,
    y: number,
    t: string,
    cls = 'fd-text',
    anchor = 'middle',
  ): SVGElement => {
    const el = svg('text', { x, y, class: cls, 'text-anchor': anchor });
    el.textContent = t;
    return el;
  };
  const arrow = (x1: number, x2: number, y: number, label: string, below = false): void => {
    root.append(
      svg('line', { x1, y1: y, x2: x2 - 6, y2: y, class: 'fd-arrow' }),
      svg('polygon', {
        points: `${x2},${y} ${x2 - 8},${y - 4} ${x2 - 8},${y + 4}`,
        class: 'fd-head',
      }),
      text((x1 + x2) / 2, below ? y + 20 : y - 8, label, 'fd-label'),
    );
  };
  for (const b of boxes) {
    root.append(
      svg('rect', { x: b.x, y: 40, width: 120, height: 56, rx: 12, class: `fd-box ${b.cls}` }),
    );
    const [a, c] = b.label.split('\n');
    root.append(text(b.x + 60, 64, a ?? '', 'fd-big'), text(b.x + 60, 84, c ?? '', 'fd-text'));
  }
  const xs = boxes.map((b) => b.x);
  const ys = 68;
  if (model === 'SIR') {
    arrow(140, 190, ys, 'β S I / N');
    arrow(310, 360, ys, 'γ I');
  } else {
    arrow(140, 190, ys, 'β S I / N');
    arrow(310, 360, ys, 'σ E');
    arrow(480, 530, ys, 'γ I');
  }
  if (model === 'SEIRV') {
    root.append(
      svg('rect', { x: xs[0] ?? 20, y: 140, width: 120, height: 56, rx: 12, class: 'fd-box fb-V' }),
      text(80, 164, 'V', 'fd-big'),
      text(80, 184, 'Vaccinated', 'fd-text'),
    );
    root.append(
      svg('line', { x1: 80, y1: 96, x2: 80, y2: 134, class: 'fd-arrow' }),
      svg('polygon', { points: '80,140 76,132 84,132', class: 'fd-head' }),
      text(88, 122, 'ν S', 'fd-label', 'start'),
    );
    root.append(
      svg('path', { d: 'M140,168 C260,168 220,100 250,98', class: 'fd-arrow', fill: 'none' }),
      svg('polygon', { points: '250,96 242,96 246,104', class: 'fd-head' }),
      text(200, 186, '(1−e) β V I / N', 'fd-label'),
    );
  }
  return root;
}

/** Equations for the model as MathML: symbolic first, then with the live numbers substituted. */
function equations(s: Scenario, beta: number, sigma: number | null, gamma: number): Element[] {
  const p = s.params;
  const N = fmtInt(p.population);
  const b = fmtSig(beta, 4);
  const g = fmtSig(gamma, 4);
  const sg = sigma === null ? '' : fmtSig(sigma, 4);
  const lam = (betaEl: Element, nEl: Element): Element =>
    mfrac(mrow(betaEl, mi('S'), mi('I')), nEl);
  const out: Element[] = [];
  const sym = {
    beta: mi('β'),
    N: mi('N'),
    gamma: mi('γ'),
    sigma: mi('σ'),
  };
  const num = { beta: mn(b), N: mn(N), gamma: mn(g), sigma: mn(sg) };
  const system = (t: typeof sym | typeof num): Element[] => {
    const infection = lam(t.beta, t.N);
    const rows: Element[] = [equation(ddt('S'), mo('='), mo('−'), infection)];
    if (p.model === 'SIR') {
      rows.push(equation(ddt('I'), mo('='), infection, mo('−'), t.gamma, mi('I')));
    } else {
      rows.push(equation(ddt('E'), mo('='), infection, mo('−'), t.sigma, mi('E')));
      rows.push(equation(ddt('I'), mo('='), t.sigma, mi('E'), mo('−'), t.gamma, mi('I')));
    }
    rows.push(equation(ddt('R'), mo('='), t.gamma, mi('I')));
    return rows;
  };
  out.push(...system(sym));
  out.push(h('p', { class: 'small muted' }, 'With your numbers (no interventions):'));
  out.push(...system(num));
  if (p.model === 'SEIRV') {
    out.push(
      h(
        'p',
        { class: 'small' },
        'Vaccination adds the V compartment. Susceptibles are vaccinated at rate ν (the campaign rate); vaccinated people are infected at (1 − e) times the normal rate, where e is the vaccine efficacy:',
      ),
    );
    out.push(equation(ddt('S'), mo('='), mo('−'), mi('λ'), mi('S'), mo('−'), mi('ν'), mi('S')));
    out.push(
      equation(
        ddt('V'),
        mo('='),
        mi('ν'),
        mi('S'),
        mo('−'),
        mo('('),
        mn(1),
        mo('−'),
        mi('e'),
        mo(')'),
        mi('λ'),
        mi('V'),
      ),
    );
    out.push(
      equation(
        ddt('E'),
        mo('='),
        mi('λ'),
        mo('('),
        mi('S'),
        mo('+'),
        mo('('),
        mn(1),
        mo('−'),
        mi('e'),
        mo(')'),
        mi('V'),
        mo(')'),
        mo('−'),
        mi('σ'),
        mi('E'),
      ),
    );
    out.push(
      h(
        'p',
        { class: 'small muted' },
        `Here λ = c(t) β I / N is the force of infection (c(t) is the contact multiplier from your interventions), e = ${p.vaccineEfficacy}.`,
      ),
    );
  }
  return out;
}

/** The "where it breaks" assumption list. */
const BREAKS: [string, string][] = [
  [
    'Everyone mixes equally.',
    'Breaks when people live in clusters (households, schools, cities). Real outbreaks are lumpier and can spread unevenly.',
  ],
  ['Constant population.', 'Breaks over long periods (births, deaths) or with travel.'],
  [
    'Lasting immunity after recovery.',
    'Breaks for diseases like flu and COVID-19, where immunity fades or the virus changes.',
  ],
  [
    'Exponential waiting times.',
    'Real incubation and infectious periods are more bunched around their average, which changes the speed of growth.',
  ],
  [
    'Fixed parameters.',
    'Breaks when behaviour, seasons or testing change on their own; only your timed interventions can change rates here.',
  ],
  [
    'One value for R0.',
    'Different people spread the disease very differently (super-spreading), which matters a lot early on and for small outbreaks.',
  ],
];

/** Renders the whole explainer for the scenario's current values. */
export function renderExplainer(root: HTMLElement, s: Scenario): void {
  clear(root);
  const p = s.params;
  root.append(
    h('h2', { id: 'h-explainer' }, 'How this works'),
    h(
      'p',
      { class: 'muted' },
      'A step-by-step walk from a few simple assumptions to an outbreak curve, using the values currently set in the Simulator.',
    ),
  );
  if (validateUserParams(p).length > 0) {
    root.append(
      h(
        'p',
        { class: 'error-note', role: 'alert' },
        'Some current parameter values are invalid, so the examples below cannot be filled in. Fix them in the Simulator first.',
      ),
    );
    return;
  }
  const rates = userToInternal(p);
  const { betaPerDay: beta, sigmaPerDay: sigma, gammaPerDay: gamma } = rates;

  root.append(
    h(
      'section',
      { class: 'card ex' },
      h('h3', {}, '1. People move between compartments'),
      h(
        'p',
        {},
        `The ${MODEL_INFO[p.model].label} model sorts everyone into boxes (called compartments). ${MODEL_INFO[p.model].description} Arrows show how many people move each day.`,
      ),
      flowDiagram(p.model),
    ),
  );

  const ratesTable = h(
    'table',
    { class: 'data-table' },
    h(
      'thead',
      {},
      h('tr', {}, h('th', {}, 'You chose'), h('th', {}, 'Rate used inside the model')),
    ),
    h(
      'tbody',
      {},
      h(
        'tr',
        {},
        h('td', {}, `Infectious period = ${p.infectiousDays} days`),
        h('td', {}, `γ = 1 / ${p.infectiousDays} = ${fmtSig(gamma, 4)} per day (recovery rate)`),
      ),
      sigma !== null
        ? h(
            'tr',
            {},
            h('td', {}, `Incubation period = ${p.incubationDays} days`),
            h(
              'td',
              {},
              `σ = 1 / ${p.incubationDays} = ${fmtSig(sigma, 4)} per day (progression rate)`,
            ),
          )
        : null,
      h(
        'tr',
        {},
        h('td', {}, `R0 = ${p.r0}`),
        h(
          'td',
          {},
          `β = R0 × γ = ${p.r0} × ${fmtSig(gamma, 4)} = ${fmtSig(beta, 4)} per day (transmission rate)`,
        ),
      ),
    ),
  );
  root.append(
    h(
      'section',
      { class: 'card ex' },
      h('h3', {}, '2. Plain-language settings become rates'),
      h(
        'p',
        {},
        'The app lets you think in days and R0, then converts to the per-day rates the equations need (this happens in exactly one place in the code).',
      ),
      ratesTable,
    ),
  );

  const eqBox = h('div', { class: 'math-box' });
  for (const e of equations(s, beta, sigma, gamma)) eqBox.append(e);
  root.append(
    h(
      'section',
      { class: 'card ex' },
      h('h3', {}, '3. The equations'),
      h(
        'p',
        {},
        'Each line says how fast one compartment changes. New infections come from susceptible people (S) meeting infectious people (I) in a population of size N; people leave I at the recovery rate γ.',
      ),
      eqBox,
    ),
  );

  const S0 = p.population - p.initialInfected;
  const newInf = (beta * S0 * p.initialInfected) / p.population;
  const rec = gamma * p.initialInfected;
  root.append(
    h(
      'section',
      { class: 'card ex' },
      h('h3', {}, '4. A worked example: day 0'),
      h(
        'p',
        {},
        `On day 0 there are ${fmtInt(S0)} susceptible people and ${fmtInt(p.initialInfected)} infectious people, out of ${fmtInt(p.population)}.`,
      ),
      h(
        'p',
        {},
        `New infections per day = β × S × I / N = ${fmtSig(beta, 4)} × ${fmtInt(S0)} × ${fmtInt(p.initialInfected)} / ${fmtInt(p.population)} = `,
        h('strong', {}, `${fmtSig(newInf, 4)} people per day`),
        '.',
      ),
      h(
        'p',
        {},
        `New recoveries per day = γ × I = ${fmtSig(gamma, 4)} × ${fmtInt(p.initialInfected)} = `,
        h('strong', {}, `${fmtSig(rec, 4)} people per day`),
        `. Infections outpace recoveries only if β S/N > γ, i.e. if R_eff = R0 × S/N is above 1; here it starts at ${fmtSig((p.r0 * S0) / p.population, 3)}.`,
      ),
    ),
  );

  const demo = h('div', { id: 'rk4-demo' });
  buildRk4Demo(demo, earlyGrowthRate(p.model, rates));
  root.append(
    h(
      'section',
      { class: 'card ex' },
      h('h3', {}, '5. How the computer solves the equations (RK4)'),
      h(
        'p',
        {},
        'The equations tell us the speed of change right now, but not the whole curve, so the computer takes many small steps in time. Euler’s method walks along the current slope for one step, which drifts off the true curve. Runge–Kutta 4 (RK4) measures the slope four times per step (start, twice in the middle, end) and blends them with weights 1, 2, 2, 1 (divided by 6). That makes each step far more accurate: halving the step size shrinks the error about 16 times. The app steps exactly onto the days where your interventions start or stop.',
      ),
      h(
        'p',
        { class: 'small muted' },
        'The demo below uses a simpler one-variable equation, y′ = r·y (early exponential growth with your model’s growth rate), so you can see one step. The real model does the same thing for all compartments at once.',
      ),
      demo,
    ),
  );

  root.append(
    h(
      'section',
      { class: 'card ex' },
      h('h3', {}, '6. What each assumption means, and where it breaks'),
      h('ul', {}, ...BREAKS.map(([a, b]) => h('li', {}, h('strong', {}, `${a} `), b))),
      h('p', { class: 'small muted' }, 'The full list shown next to results:'),
      h('ul', { class: 'small' }, ...ASSUMPTIONS.map((a) => h('li', {}, a))),
    ),
  );
}
