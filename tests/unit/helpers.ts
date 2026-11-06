import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Intervention, ModelKind, UserParams } from '../../src/shared/types';
import { buildSchedule } from '../../src/sim/interventions';
import { userToInternal } from '../../src/sim/params';
import { integrate } from '../../src/sim/rk4';
import type { IntegrateOptions } from '../../src/sim/rk4';

/** A reasonable default scenario that tests override field by field. */
export function params(over: Partial<UserParams> = {}): UserParams {
  return {
    model: 'SEIR',
    r0: 2.5,
    incubationDays: 5,
    infectiousDays: 7,
    population: 1e6,
    initialInfected: 10,
    vaccineEfficacy: 0,
    horizonDays: 300,
    ...over,
  };
}

/** Builds integrator options (rates, schedule) from user-facing parameters and interventions. */
export function options(
  p: UserParams,
  interventions: Intervention[] = [],
  extra: Partial<IntegrateOptions> = {},
): IntegrateOptions {
  return {
    model: p.model,
    rates: userToInternal(p),
    population: p.population,
    initialInfected: p.initialInfected,
    vaccineEfficacy: p.vaccineEfficacy,
    schedule: buildSchedule(interventions, p.horizonDays),
    horizonDays: p.horizonDays,
    ...extra,
  };
}

export function run(
  p: UserParams,
  interventions: Intervention[] = [],
  extra: Partial<IntegrateOptions> = {},
) {
  return integrate(options(p, interventions, extra));
}

const fixtureSchema = z.object({
  case: z.object({
    id: z.string(),
    model: z.enum(['SIR', 'SEIR']),
    R0: z.number(),
    incubation_days: z.number().optional(),
    infectious_days: z.number(),
    N: z.number(),
    I0: z.number(),
    days: z.number(),
    vaccine_efficacy: z.number().optional(),
    interventions: z.array(
      z.object({
        type: z.enum(['contact_reduction', 'vaccination']),
        start: z.number(),
        end: z.number(),
        strength: z.number(),
      }),
    ),
  }),
  meta: z.object({ scipy: z.string(), rtol: z.number(), atol: z.number(), method: z.string() }),
  t: z.array(z.number()),
  y: z.array(z.array(z.number())),
});
export type Fixture = z.infer<typeof fixtureSchema>;

export const FIXTURE_IDS = [
  'sir_slow_R1p5',
  'sir_fast_R6',
  'seir_near_critical_R1p05',
  'seir_exactly_R1',
  'seir_subcritical_R0p8',
  'seir_measles_like_R15',
  'seir_contact_reduction_day30',
  'seirv_vaccination_window_45_90',
  'seirv_combined',
];

/** Loads and zod-validates a SciPy reference fixture. */
export function loadFixture(id: string): Fixture {
  const file = path.resolve(import.meta.dirname, '../fixtures/reference', `${id}.json`);
  return fixtureSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

/** Converts a fixture case into the app's user-facing parameters + interventions. */
export function fixtureToScenario(f: Fixture): { p: UserParams; interventions: Intervention[] } {
  const c = f.case;
  const vaccinated = c.interventions.some((iv) => iv.type === 'vaccination');
  const model: ModelKind = c.model === 'SIR' ? 'SIR' : vaccinated ? 'SEIRV' : 'SEIR';
  return {
    p: {
      model,
      r0: c.R0,
      incubationDays: c.incubation_days ?? 1,
      infectiousDays: c.infectious_days,
      population: c.N,
      initialInfected: c.I0,
      vaccineEfficacy: c.vaccine_efficacy ?? 0,
      horizonDays: c.days,
    },
    interventions: c.interventions.map((iv) => ({
      type: iv.type,
      startDay: iv.start,
      endDay: iv.end,
      strength: iv.strength,
    })),
  };
}
