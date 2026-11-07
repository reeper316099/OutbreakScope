// Colour + dash styling. Compartment colours are the Okabe-Ito palette (published colour-blind-safe);
// each line also has its own dash pattern so colour is never the only signal.
import type { Compartment } from '../shared/types';
import { cssVar } from './dom';

export const COMPARTMENT_DASH: Record<Compartment, number[]> = {
  S: [],
  E: [8, 4],
  I: [2, 3],
  R: [12, 4, 2, 4],
  V: [3, 3, 10, 3],
};

export const COMPARTMENT_NAME: Record<Compartment, string> = {
  S: 'Susceptible (S)',
  E: 'Exposed (E)',
  I: 'Infectious (I)',
  R: 'Recovered (R)',
  V: 'Vaccinated (V)',
};

/** Resolved colour for a compartment in the active theme. */
export function compartmentColor(c: Compartment): string {
  return cssVar(`--c-${c}`);
}

/** Colour and dash for scenario overlays: current + saved A, B, C (all distinguishable without colour). */
export const SCENARIO_STYLES = [
  { key: 'current', label: 'Current', color: '--text', dash: [] as number[] },
  { key: 'A', label: 'Scenario A', color: '--c-S', dash: [8, 4] },
  { key: 'B', label: 'Scenario B', color: '--c-I', dash: [2, 3] },
  { key: 'C', label: 'Scenario C', color: '--c-R', dash: [12, 4, 2, 4] },
] as const;
