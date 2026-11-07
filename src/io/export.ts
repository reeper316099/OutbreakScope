// CSV text builders for exports. Every file starts with comment rows recording model, parameters, seed and app version.
import type { Scenario } from '../shared/types';
import type { Bands } from '../sim/ensemble';
import type { ScenarioResult } from '../sim/scenario';

/** Comment header describing exactly how the numbers were produced. */
export function csvHeader(scenario: Scenario, appVersion: string, extra: string[] = []): string[] {
  const p = scenario.params;
  const lines = [
    `# OutbreakScope ${appVersion} export (teaching model, not a forecast)`,
    `# model=${p.model} R0=${p.r0} incubation_days=${p.incubationDays} infectious_days=${p.infectiousDays} population=${p.population} initial_infected=${p.initialInfected} vaccine_efficacy=${p.vaccineEfficacy} horizon_days=${p.horizonDays}`,
    `# interventions=${scenario.interventions.length === 0 ? 'none' : scenario.interventions.map((iv) => `${iv.type}[${iv.startDay}-${iv.endDay}):${iv.strength}`).join(';')}`,
    `# seed=${scenario.seed} ensemble_size=${scenario.ensembleSize}`,
    ...extra.map((e) => `# ${e}`),
  ];
  return lines;
}

/** Formats a number for CSV with enough digits to round-trip comfortably. */
function num(x: number): string {
  return Number.isFinite(x) ? String(Number(x.toPrecision(12))) : '';
}

/** Deterministic time series: compartments, daily new infections, cumulative infections and R_eff per day. */
export function deterministicCsv(result: ScenarioResult, appVersion: string): string {
  const t = result.trajectory;
  const rows = [
    ...csvHeader(result.scenario, appVersion),
    'day,S,E,I,R,V,new_infections_per_day,cumulative_infections,R_eff',
  ];
  for (let i = 0; i < t.times.length; i++) {
    const inc = i < result.incidence.length ? (result.incidence[i] as number) : NaN; // no interval after the last point
    rows.push(
      [t.times[i], t.S[i], t.E[i], t.I[i], t.R[i], t.V[i], inc, t.cumInfections[i], result.reff[i]]
        .map((x) => num(x as number))
        .join(','),
    );
  }
  return rows.join('\n') + '\n';
}

/** Stochastic ensemble summary series (infectious people): mean, median, 50% and 95% bands per day. */
export function ensembleCsv(
  scenario: Scenario,
  times: Float64Array,
  bands: Bands,
  appVersion: string,
  method: string,
): string {
  const rows = [
    ...csvHeader(scenario, appVersion, [`stochastic_method=${method}`]),
    'day,I_mean,I_median,I_q025,I_q25,I_q75,I_q975',
  ];
  for (let i = 0; i < times.length; i++) {
    rows.push(
      [
        times[i],
        bands.mean[i],
        bands.median[i],
        bands.q025[i],
        bands.q25[i],
        bands.q75[i],
        bands.q975[i],
      ]
        .map((x) => num(x as number))
        .join(','),
    );
  }
  return rows.join('\n') + '\n';
}
