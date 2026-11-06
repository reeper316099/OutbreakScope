// SIR / SEIR / SEIR+V right-hand sides (MODEL.md section 2) and compartment metadata.
// State vector layout (always 8 numbers so every model shares one integrator):
//   0 S, 1 E, 2 I, 3 R, 4 V, 5 cumulative infections, 6 cumulative onsets (entries to I), 7 cumulative vaccinations.
import type { Compartment, InternalParams, ModelKind } from '../shared/types';

export const STATE_SIZE = 8;
export const IDX = { S: 0, E: 1, I: 2, R: 3, V: 4, CUM_INF: 5, CUM_ONSET: 6, CUM_VAC: 7 } as const;

export const MODEL_INFO: Record<
  ModelKind,
  { label: string; compartments: readonly Compartment[]; description: string }
> = {
  SIR: {
    label: 'SIR',
    compartments: ['S', 'I', 'R'],
    description:
      'People are susceptible, infectious, or recovered. Infection makes someone infectious immediately.',
  },
  SEIR: {
    label: 'SEIR',
    compartments: ['S', 'E', 'I', 'R'],
    description:
      'Adds an exposed stage: infected people are not infectious until the incubation period ends.',
  },
  SEIRV: {
    label: 'SEIR + vaccination',
    compartments: ['S', 'E', 'I', 'R', 'V'],
    description:
      'SEIR plus a leaky vaccine: vaccinated people can still be infected, but less easily.',
  },
};

/** A derivative function: writes dy/dt into `out` for state `y` (no allocation, so it is safe in hot loops). */
export type Rhs = (y: Float64Array, out: Float64Array) => void;

/** Builds the right-hand side for one constant-parameter segment (contact multiplier c, vaccination rate nu). */
export function makeRhs(
  model: ModelKind,
  rates: InternalParams,
  population: number,
  vaccineEfficacy: number,
  contactMultiplier: number,
  vaccinationRate: number,
): Rhs {
  const { betaPerDay, gammaPerDay } = rates;
  const sigma = rates.sigmaPerDay ?? 0;
  const leak = 1 - vaccineEfficacy; // vaccinated people keep this fraction of the susceptibility
  const nu = model === 'SEIRV' ? vaccinationRate : 0;
  const c = contactMultiplier;
  return (y, out) => {
    const S = y[IDX.S] as number; // indices are constants inside an 8-element array
    const E = y[IDX.E] as number;
    const I = y[IDX.I] as number;
    const V = y[IDX.V] as number;
    const lambda = (c * betaPerDay * I) / population; // force of infection per susceptible
    const infS = lambda * S;
    const infV = leak * lambda * V;
    const infections = infS + infV;
    const vaccinations = nu * S;
    out[IDX.S] = -infS - vaccinations;
    out[IDX.V] = vaccinations - infV;
    if (model === 'SIR') {
      out[IDX.E] = 0;
      out[IDX.I] = infections - gammaPerDay * I; // infection goes straight to I
      out[IDX.CUM_ONSET] = infections;
    } else {
      out[IDX.E] = infections - sigma * E;
      out[IDX.I] = sigma * E - gammaPerDay * I;
      out[IDX.CUM_ONSET] = sigma * E;
    }
    out[IDX.R] = gammaPerDay * I;
    out[IDX.CUM_INF] = infections;
    out[IDX.CUM_VAC] = vaccinations;
  };
}

/** Initial state: everyone susceptible except I0 infectious people. Cumulative infections start at I0. */
export function initialState(population: number, initialInfected: number): Float64Array {
  const y = new Float64Array(STATE_SIZE);
  y[IDX.S] = population - initialInfected;
  y[IDX.I] = initialInfected;
  y[IDX.CUM_INF] = initialInfected;
  y[IDX.CUM_ONSET] = initialInfected;
  return y;
}
