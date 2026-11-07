// About / limitations page: what the app is and is not, assumptions, sources, validation summary, licences.
import type { AppInfo } from '../shared/types';
import { PRESETS } from '../sim/presets';
import { manifest } from './datasetFiles';
import { clear, h } from './dom';
import { ASSUMPTIONS } from './resultsPanel';

/** Link that opens through the allowlisted bridge instead of navigating the app. */
function link(label: string, url: string, open: (url: string) => void): HTMLElement {
  const a = h('a', { href: url, class: 'ext-link' }, label);
  a.addEventListener('click', (e) => {
    e.preventDefault();
    open(url);
  });
  return a;
}

/** Renders the About page. */
export function renderAbout(
  root: HTMLElement,
  info: AppInfo | null,
  open: (url: string) => void,
): void {
  clear(root);
  root.append(
    h('h2', { id: 'h-about' }, 'About OutbreakScope'),
    h(
      'p',
      { id: 'about-info', class: 'muted' },
      info
        ? `Version ${info.version} · Electron ${info.electron} · Chromium ${info.chrome} · ${info.platform}`
        : 'Version information unavailable.',
    ),
    h(
      'section',
      { class: 'card ex' },
      h('h3', {}, 'What this is – and is not'),
      h(
        'p',
        {},
        'OutbreakScope is an educational tool that shows how a few simple assumptions about a disease turn into an outbreak curve, how interventions change it, and how sure we can be when a model is fitted to data. The numerical methods (RK4 solver, stochastic simulators, random number generator) are written from scratch in this project and checked against analytical formulas and SciPy.',
      ),
      h(
        'p',
        { class: 'disclaimer' },
        'Educational use only. These are simplified teaching models, not forecasts. They must not be used to make public-health, medical or policy decisions, and nothing here is a prediction about any real outbreak. Preset values are illustrative values from the literature, not statements about any current situation.',
      ),
    ),
    h(
      'section',
      { class: 'card ex' },
      h('h3', {}, 'Model assumptions'),
      h('ul', {}, ...ASSUMPTIONS.map((a) => h('li', {}, a))),
    ),
    h(
      'section',
      { class: 'card ex', id: 'about-sources' },
      h('h3', {}, 'Parameter presets and their sources'),
      h(
        'p',
        { class: 'small muted' },
        'Each value is marked as reported (copied from the source), derived (computed from sourced numbers; the formula is shown in the preset description) or assumed (hypothetical teaching example).',
      ),
      h(
        'ul',
        {},
        ...PRESETS.map((p) =>
          h(
            'li',
            {},
            h('strong', {}, `${p.name}: `),
            `R0 ${p.r0.value} (${p.r0.kind}), infectious ${p.infectiousDays.value} days (${p.infectiousDays.kind})${p.incubationDays ? `, incubation ${p.incubationDays.value} days (${p.incubationDays.kind})` : ''}. `,
            ...p.sources.flatMap((s) => [link(s.label, s.url, open), ' ']),
            p.sources.length === 0 ? 'No source (hypothetical).' : null,
          ),
        ),
      ),
    ),
    h(
      'section',
      { class: 'card ex', id: 'about-datasets' },
      h('h3', {}, 'Bundled sample datasets'),
      h(
        'p',
        { class: 'small muted' },
        'Used only by Fit mode. Each is shown with its source, licence and caveats when selected. You can also import your own CSV file.',
      ),
      manifest.ok
        ? h(
            'ul',
            {},
            ...manifest.datasets.map((d) =>
              h(
                'li',
                {},
                h('strong', {}, `${d.title}. `),
                d.kind === 'synthetic' ? 'Synthetic (made by this app; not real data). ' : '',
                ...(d.source
                  ? [
                      'Source: ',
                      link(d.source.name, d.source.url, open),
                      `, retrieved ${d.source.retrieved}. `,
                    ]
                  : []),
                ...(d.license
                  ? [`Licence: ${d.license.name} (`, link('terms', d.license.termsUrl, open), '). ']
                  : []),
              ),
            ),
          )
        : h('p', { class: 'error-note' }, manifest.message),
    ),
    h(
      'section',
      { class: 'card ex', id: 'about-validation' },
      h('h3', {}, 'Validation summary (what was tested)'),
      h(
        'ul',
        {},
        h(
          'li',
          {},
          'RK4 solver vs SciPy (DOP853, rtol 1e-10): 9 reference cases (slow, fast, R0 = 1.05, R0 = 1, R0 < 1, R0 = 15, contact reduction, vaccination window, both together). Largest difference: 1.6e-9 of the population.',
        ),
        h(
          'li',
          {},
          'RK4 convergence order measured at 4.0–4.1 on a linear test problem and 3.8–3.9 on the nonlinear SIR system (halving the step cuts the error about 16×).',
        ),
        h(
          'li',
          {},
          'Population is conserved (S+E+I+R+V = N) within 1e-9 of N in every tested regime; no compartment goes negative.',
        ),
        h(
          'li',
          {},
          'Final size matches the root of z = 1 − exp(−R0 z) to better than 1e-6; early SEIR growth matches the eigenvalue formula to 1e-4 (relative).',
        ),
        h(
          'li',
          {},
          'Re-solving three scenarios exported from the app with SciPy (an independent implementation): the largest difference was 8.1e-10 of the population.',
        ),
        h(
          'li',
          {},
          'Fitting: parameter recovery from synthetic data (95% intervals contained the true R0, I0 and reporting fraction in 6, 6 and 5 of 6 trials; all 6 fits converged); the MCMC sampler reproduces the mean, variance and correlation of known normal distributions; R-hat and effective sample size flag deliberately bad chains.',
        ),
        h(
          'li',
          {},
          'Stochastic simulators: reproducible from the seed, independent of worker count, mean close to the ODE, and the chance an outbreak fizzles out matches (1/R0)^k within sampling error (e.g. 0.502 measured vs 0.500 expected for k = 1, R0 = 2).',
        ),
      ),
      h('p', { class: 'small muted' }, 'Run npm test to reproduce these checks.'),
    ),
    h(
      'section',
      { class: 'card ex' },
      h('h3', {}, 'Licences'),
      h(
        'p',
        {},
        'OutbreakScope source code: MIT licence. Built with Electron (MIT), Chart.js (MIT) and zod (MIT). The random number generator is xoshiro128** by Blackman and Vigna (public domain). Link to the project: ',
        link(
          'github.com/reeper316099/OutbreakScope',
          'https://github.com/reeper316099/OutbreakScope',
          open,
        ),
        '.',
      ),
    ),
  );
}
