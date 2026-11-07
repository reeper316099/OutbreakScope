// Special functions needed by the likelihoods and priors.

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** ln Gamma(x) for x > 0 (Lanczos approximation, g = 7, n = 9; relative error ~1e-15). */
export function logGamma(x: number): number {
  if (!(x > 0)) return NaN;
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x); // reflection formula
  const z = x - 1;
  let a = LANCZOS[0] as number;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += (LANCZOS[i] as number) / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Trigamma function psi'(x) for x > 0 (recurrence to x >= 12, then the asymptotic series). */
export function trigamma(x: number): number {
  let acc = 0;
  let y = x;
  while (y < 12) {
    acc += 1 / (y * y);
    y += 1;
  }
  const y2 = y * y;
  return (
    acc +
    1 / y +
    1 / (2 * y2) +
    1 / (6 * y2 * y) -
    1 / (30 * y2 * y2 * y) +
    1 / (42 * y2 * y2 * y2 * y)
  );
}

/** ln of the Beta function B(a, b). */
export function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/** Logistic function 1 / (1 + e^-x). */
export function invLogit(x: number): number {
  return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
}

/** Logit ln(p / (1 - p)). */
export function logit(p: number): number {
  return Math.log(p / (1 - p));
}
