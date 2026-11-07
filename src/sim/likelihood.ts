// Observation model and log-likelihoods for fitting reported case counts.
//
// Observation model (MODEL.md section 7): the expected number of reported cases in an observation interval
//   mu_k = rho * (number of onsets in the interval), shifted back in time by a fixed reporting delay.
// "Onsets" are the flow into the infectious class I: sigma*E for SEIR (E -> I), and new infections for SIR.
// rho in (0, 1] is the reporting fraction. Reported cases are NOT true infections: rho absorbs under-reporting.
import { logGamma } from './special';

/** log P(Y = y) for Y ~ Poisson(mu): y ln(mu) - mu - ln(y!). */
export function poissonLogPmf(y: number, mu: number): number {
  if (mu <= 0) return y === 0 ? 0 : -Infinity;
  return y * Math.log(mu) - mu - logGamma(y + 1);
}

/**
 * log P(Y = y) for Y ~ NegativeBinomial with mean mu and dispersion k (variance mu + mu^2/k; k -> infinity is Poisson):
 * ln G(y+k) - ln G(k) - ln(y!) + k ln(k/(k+mu)) + y ln(mu/(k+mu)).
 */
export function negbinLogPmf(y: number, mu: number, k: number): number {
  if (mu <= 0) return y === 0 ? 0 : -Infinity;
  return (
    logGamma(y + k) -
    logGamma(k) -
    logGamma(y + 1) +
    k * Math.log(k / (k + mu)) +
    y * Math.log(mu / (k + mu))
  );
}

export type LikelihoodKind = 'poisson' | 'negbin';

/** Total log-likelihood of observed counts given expected counts (and dispersion k for negbin). */
export function logLikelihood(
  kind: LikelihoodKind,
  counts: ArrayLike<number>,
  expected: ArrayLike<number>,
  dispersion = Infinity,
): number {
  let total = 0;
  for (let i = 0; i < counts.length; i++) {
    const y = counts[i] as number; // i < length
    const mu = Math.max(expected[i] as number, 1e-10); // tiny floor keeps ln(mu) finite when the model predicts ~0
    total += kind === 'poisson' ? poissonLogPmf(y, mu) : negbinLogPmf(y, mu, dispersion);
  }
  return total;
}

/** Variance of a count with the given mean under the chosen likelihood (used for standardised residuals). */
export function countVariance(kind: LikelihoodKind, mu: number, dispersion = Infinity): number {
  return kind === 'poisson' ? mu : mu + (mu * mu) / dispersion;
}
