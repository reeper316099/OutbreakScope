# OutbreakScope: model, numerical methods and fitting

Every equation below is implemented in `src/sim/` and checked by the tests named in section 9. Analytical results were first checked with an independent SciPy/NumPy script (section 5).
All models are simplified teaching models: homogeneous mixing, no age or space, constant parameters except user-added interventions. They are not forecasts.

## 1. Notation and the unit-conversion layer

| Symbol            | Meaning                                                                                                                            | Unit          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| N                 | total population (constant)                                                                                                        | people        |
| S, E, I, R, V     | susceptible, exposed (infected, not yet infectious), infectious, recovered/removed, vaccinated                                     | people        |
| R0                | basic reproduction number: expected infections caused by one infectious person in a fully susceptible population, no interventions | dimensionless |
| T_inc, T_inf      | mean incubation period (E to I), mean infectious period                                                                            | days          |
| gamma = 1 / T_inf | recovery rate                                                                                                                      | per day       |
| sigma = 1 / T_inc | progression rate                                                                                                                   | per day       |
| beta = R0 * gamma | transmission rate                                                                                                                  | per day       |
| c(t)              | contact multiplier, product of (1 - strength) over active contact-reduction events, in [0, 1]                                      | dimensionless |
| nu(t)             | vaccination rate: fraction of susceptibles vaccinated per day (sum of active campaigns)                                            | per day       |
| e                 | vaccine efficacy against infection, in [0, 1] (leaky)                                                                              | dimensionless |

Only `params.ts` converts between user-facing (R0, days) and internal (beta, sigma, gamma per day). Round-trip tested.
Exponential waiting times are assumed: the mean time in E is T_inc, in I is T_inf, but the distributions are exponential (a known simplification; real periods are more peaked).

## 2. Equations

Force of infection per susceptible: lambda(t) = c(t) * beta * I / N.

**SIR** (no E, no V; nu = 0)
dS/dt = -lambda S
dI/dt = lambda S - gamma I
dR/dt = gamma I

**SEIR** (nu = 0)
dS/dt = -lambda S
dE/dt = lambda S - sigma E
dI/dt = sigma E - gamma I
dR/dt = gamma I

**SEIR + V** (proposed; leaky, imperfect vaccine, no waning)
dS/dt = -lambda S - nu S
dV/dt = nu S - (1 - e) lambda V
dE/dt = lambda (S + (1 - e) V) - sigma E
dI/dt = sigma E - gamma I
dR/dt = gamma I

Vaccination assumptions: only people currently in S are vaccinated (doses are not wasted on E, I, R, which is optimistic); protection is immediate; vaccinated people stay susceptible with force of infection reduced by factor (1 - e) ("leaky"); no waning; a vaccinated person who gets infected goes to E and eventually R. Setting e = 1 makes V fully immune.

**Conservation:** summing the right-hand sides, the lambda, nu, sigma and gamma terms cancel pairwise, so d(S+E+I+R+V)/dt = 0 and S+E+I+R+V = N. (Tested at every RK4 step.)

## 3. Derived quantities

**R_eff(t)** = R0 * c(t) * (S + (1 - e) V) / N. Next-generation argument: one infectious person infects c*beta*(susceptible-equivalents)/N people per day for 1/gamma days. For SIR/SEIR (no V) it is R0 c(t) S/N. Same for SEIR since the E stage only adds delay, not offspring.

**Herd immunity threshold (HIT)** = 1 - 1/R0 (fraction immune needed so that R_eff < 1 with no interventions, homogeneous mixing, no prior immunity). With a leaky vaccine of efficacy e given to a fraction v of the population, R_eff = R0 (1 - e v), so coverage needed is (1 - 1/R0)/e (can exceed 1 if e is low, meaning herd immunity is unreachable by vaccine alone). The UI will show 1 - 1/R0 and state this caveat.

**Final size** (SIR or SEIR, no interventions or vaccination, S(0) approx N, R(0) = 0). From dS/dR = -(beta/gamma) S/N, S(inf) = S(0) exp(-R0 R(inf)/N). With z = R(inf)/N and S(0) = N: z = 1 - exp(-R0 z). Define g(z) = 1 - exp(-R0 z) - z. g(0) = 0, g'(0) = R0 - 1, g is concave, g(1) = -exp(-R0) < 0. So for R0 > 1 there is exactly one root in (0, 1); for R0 <= 1 the only root is z = 0. Near R0 = 1 the root is z approx 2 (R0 - 1). Solve with bisection/Newton on the positive branch.

**Early growth rate.** Linearize E and I with S = N: d/dt (E, I) = J (E, I), J = [[-sigma, beta], [sigma, -gamma]]. Eigenvalues solve lambda^2 + (sigma + gamma) lambda + sigma gamma - sigma beta = 0, giving
r = [ -(sigma + gamma) + sqrt( (sigma - gamma)^2 + 4 sigma beta ) ] / 2.
r > 0 exactly when beta > gamma, i.e. R0 > 1. As sigma goes to infinity r tends to beta - gamma (SIR). Doubling time = ln 2 / r, valid only for r > 0 (for r < 0 the app shows a halving time instead). Applies to the early phase only, with no interventions.

**Peak:** in SIR, dI/dt = 0 where S/N = 1/R0, so the peak of I coincides with R_eff = 1. In SEIR, d(E+I)/dt = gamma I (R_eff - 1), so it is the _total prevalence E+I_ that peaks exactly where R_eff = 1 and S/N = 1/R0; the peak of I alone comes slightly later (its derivative is sigma E - gamma I). Found while writing the Phase 3 test; the original prompt statement holds for SIR only.

**Probability of a major outbreak** with k initial infectious individuals: 1 - (1/R0)^k for R0 > 1. Derivation: during one infectious period an infectious person makes infections at rate beta (early, S approx N) until recovery at rate gamma, so the number of offspring is geometric with p = beta/(beta+gamma), mean R0, probability generating function f(s) = 1/(1 + R0 (1 - s)). Extinction probability q solves f(q) = q, i.e. R0 q^2 - (1 + R0) q + 1 = 0, roots 1 and 1/R0. Independent lineages give q^k. Holds when: large N (S approx N early), exponential infectious period (other period distributions change the offspring distribution), constant parameters, no interventions, individuals acting independently. If initial individuals are in E, the same q applies (each E eventually becomes I). In finite N the outbreak must also be "major", so the code defines it explicitly (see below). Not accurate for tiny N or R0 very close to 1 (long fizzling tails blur "major").
Code definition (to be tested): a realization is "major" if cumulative infections exceed 5% of N (threshold to be justified by sensitivity test in Phase 3).

## 4. Numerical methods (decisions)

**RK4**: y_{n+1} = y_n + (h/6)(k1 + 2 k2 + 2 k3 + k4), k1 = f(t, y), k2 = f(t + h/2, y + h k1/2), k3 = f(t + h/2, y + h k2/2), k4 = f(t + h, y + h k3). Local error O(h^5), global O(h^4).
Because c(t) and nu(t) are piecewise constant, the integrator splits [0, T] at every intervention start/end and uses an integer number of steps per segment (h adjusted to land exactly on the boundary). Output values are recorded at step points and interpolated only for display, so results do not depend on the output grid.
Default step: h <= min(0.1 day, 0.02 / fastest rate), so (rate * h) <= 0.02. Chosen from the SciPy comparison: with 0.1/rate the fast SIR case (R0 = 6, 3-day infectious period) had error 9.7e-7 N; 0.05/rate gave 6.2e-8 N; 0.02/rate gives a worst case below 1e-8 N. A 365-day run still takes about 2 ms. RK4 is stable for |rate * h| below about 2.78, so the margin is large. Very stiff combinations (any rate above 20 per day) are rejected with a typed error rather than integrated badly.

Roundoff: tiny negative compartment values (> -1e-9 * N) are clamped to 0 and the clamped amount is moved to keep the sum equal to N; anything more negative is an error.

**Stochastic:** exact Gillespie (direct method) when N is small (threshold ~2e4, so a run is a few 1e4 events); chain-binomial with fixed step dt (about 0.1 day) above that: new infections ~ Binomial(S, 1 - exp(-lambda dt)), progressions ~ Binomial(E, 1 - exp(-sigma dt)), recoveries ~ Binomial(I, 1 - exp(-gamma dt)). Chain-binomial conserves N and stays non-negative by construction, but treats rates as constant within a step (small bias; the cost is O(steps) regardless of N). Both are validated against the deterministic mean and the branching probability.

**PRNG:** xoshiro128** (state 4 x uint32, output uint32; reference C code checked at prng.di.unimi.it). Seed = unsigned 32-bit integer shown in decimal. For realization i the 128-bit state is derived from (seed, i) by absorbing both numbers through the murmur3 finalizer fmix32 with cross-word diffusion (src/sim/rng.ts). Streams are hash-derived, not provably disjoint; with a 128-bit state and at most a few thousand streams the overlap probability is negligible. Doubles use 53 random bits from two outputs. Binomial draws: inversion for n*p < 10, BTRS (Hormann 1993) otherwise. The known-answer vectors come from an independent Python re-implementation (tools/gen_rng_kat.py), not from official test vectors, except the raw state {1,2,3,4} outputs 11520, 0, 5927040, 70819200 which match the published algorithm.

## 5. Checks run (Phase 1, SciPy 1.11.1 / NumPy 1.24.3, Python 3.11.5)

- Final size: solved z = 1 - exp(-R0 z) vs. simulated SIR (N=1e7, I0=1): R0=1.2: 0.313698 vs 0.313699; R0=2: 0.796812 vs 0.796812; R0=4: 0.980173 vs 0.980173; R0 <= 1: root 0, simulated ~6e-5 (just the 1 seed case).
- Growth rate: formula vs eigenvalue of J vs. slope of log I in a simulation (R0=0.9/1.5/3): -0.012808 / 0.056512 / 0.185489 vs -0.012808 / 0.056512 / 0.185489 vs -0.012808 / 0.056511 / 0.184980 (the R0=3 slope is slightly low because the fit window runs into susceptible depletion). Sigma large limit: 0.3999998 vs beta-gamma = 0.4.
- Peak: S/N at the peak of I for R0=3 was 0.33314 vs 1/R0 = 0.33333.
- Major-outbreak probability (Gillespie, N=20000, major = cumulative > 5% N, 2000 SIR runs and 1000 SEIR runs per cell): all 18 cells within about 0.03 of 1-(1/R0)^k (R0 in {1.5, 2, 3}, k in {1, 2, 5}); standard error is about 0.011 to 0.016. Example R0=2, k=1: 0.497 / 0.494 vs 0.500.
- Reference trajectories: 9 cases regenerated by `tools/gen_reference.py` (DOP853, rtol 1e-10, atol 1e-12); conservation error in SciPy output is at most 7e-10 on N = 1e6.

Section 9 lists the checks of the TypeScript implementation.

## 6. State vector and conventions (Phase 3 implementation)

The integrator carries 8 numbers for every model: S, E, I, R, V and three cumulative flows (infections, entries into I, vaccinations). Daily incidence is the difference of the cumulative infections at consecutive output times, which is exact to RK4 accuracy (no finite-difference of prevalence). SIR leaves E at 0; models without vaccination leave V at 0. A realization is a "major outbreak" if secondary infections (beyond the initial ones) reach 5% of N. Overlapping events: contact reductions multiply, vaccination rates add; events are active on [start, end).

## 7. Observation model (fit mode)

Reported cases are **not** infections. The expected number of reported cases in an observation interval (day or week) is

mu_k = rho * (number of onsets in the interval, delayed by d days)

where an _onset_ is a flow into the infectious class I (sigma E for SEIR, new infections for SIR), rho in (0, 1] is the reporting fraction (it absorbs under-reporting, testing changes and hospitalisation share), and d is a fixed reporting delay chosen by the user (0 to 14 days). Onsets are the difference of the cumulative-onset state of the solver (section 6) at the interval edges, so no finite differencing of prevalence is involved. Model day 0 is the start of the first observation interval.

Likelihoods (`src/sim/likelihood.ts`): Poisson, log P(y) = y ln mu - mu - ln y!; and negative binomial with mean mu and dispersion k, ln G(y+k) - ln G(k) - ln y! + k ln(k/(k+mu)) + y ln(mu/(k+mu)) (variance mu + mu^2/k; k -> infinity recovers Poisson). Both are unit-tested against hand-computed values and normalisation sums.

## 8. Fitting methods

**Parameter space.** Positive parameters (R0, I0, dispersion, periods) are fitted as ln(x); the reporting fraction as logit(rho), so every proposal is valid. Priors are expressed in natural units and carry the change-of-variables term: lognormal priors (median and spread = standard deviation of ln x) and a Beta(a, b) prior on rho (density in the logit coordinate: rho^a (1-rho)^b / B(a, b)). Defaults and ranges are visible and editable in the UI. Fixing parameters (the default for the incubation and infectious periods) is the honest choice because the data typically determine only a combination of parameters.

**Optimiser.** Nelder-Mead (reflect 1, expand 2, contract 1/2, shrink 1/2) on the negative log posterior, from the configured values plus random prior draws, then once more from the best point. The report states how many starts reached the same value.

**Sampler.** Random-walk Metropolis. The proposal covariance starts from the inverse finite-difference Hessian at the optimum (a ridge is added if it is not positive definite) and is then adapted by the Haario rule (2.38^2 / d times the running covariance, with acceptance-rate steering) **during burn-in only**; after burn-in it is frozen, so the retained chain targets the posterior. Four chains start from over-dispersed points (the optimum plus a draw with twice the approximate posterior spread) and run in parallel workers with independent PRNG streams.

**Diagnostics.** Split R-hat (Gelman-Rubin on half-chains) and effective sample size (Geyer's initial monotone positive-pair estimator on split chains, as in Stan). A fit is labelled _converged_ only if R-hat < 1.05 and ESS >= 200 for every parameter; otherwise the UI withholds the fitted curve and intervals until the user asks to see them, marked UNRELIABLE.

**Predictive bands.** For up to 250 posterior draws the expected counts are recomputed and observation noise is simulated (Poisson, or a gamma-Poisson mixture for negative binomial) to give 50% and 95% bands.

**Misfit and identifiability warnings.** Plain-language warnings fire when (a) fewer than 80% of observations fall in the model's own 95% band, chi-square per observation exceeds 2, or R-squared is below 0.5 (the intervals are then too optimistic); (b) two parameters have posterior correlation of at least 0.8 (the data fix a combination of them); (c) a posterior is at least 80% as wide as its prior (the data taught little); (d) the reporting fraction piles up near 1, R0 hits its upper limit, or a 95% interval spans more than a factor of 10.

Worked example of (b): with data from the early exponential phase only, expected counts are about rho * I0 * exp(r t). The growth rate r (hence R0 when the periods are fixed) is determined, but only the product rho * I0 is, so ln I0 and logit rho are almost perfectly anti-correlated (measured -0.89 in the test). With full-wave data the strong link is between R0 and I0 (-0.91 to -0.98 in our runs): a faster epidemic seeded by fewer people peaks at the same time.

## 9. What the tests show (numbers from real runs)

| Check                                                                              | Result                                                                                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| RK4 vs SciPy DOP853 (rtol 1e-10), 9 reference cases                                | worst error 1.6e-9 of N; test tolerance 1e-7 of N                                                                              |
| Three scenarios exported by the app vs a fresh SciPy solve (`tools/crosscheck.py`) | worst difference 8.1e-10 of N (8.2e-4 people at N = 1e6)                                                                       |
| RK4 convergence order (halving h)                                                  | measured 4.08, 4.04, 4.02 (linear test problem); 3.79, 3.90 (nonlinear SIR vs a 64x finer RK4 reference)                       |
| Conservation S+E+I+R+V = N, 10 parameter regimes                                   | within 1e-9 N                                                                                                                  |
| SIR final size vs root of z = 1 - exp(-R0 z)                                       | within 1e-6                                                                                                                    |
| SEIR early growth vs eigenvalue formula                                            | within 1e-4 relative; SIR beta - gamma within 1e-6                                                                             |
| Peak of prevalence E+I vs R_eff = 1 and S/N = 1/R0                                 | within 3e-3 (R_eff), 1e-3 (S/N)                                                                                                |
| Probability of fizzling vs (1/R0)^k (R0 = 2, 1500 runs, SE <= 0.013)               | 0.502 vs 0.500 (k = 1), 0.249 vs 0.250 (k = 2), 0.489 vs 0.500 (SEIR), 0.496 vs 0.500 (chain-binomial)                         |
| Mean of stochastic runs vs ODE                                                     | final size within 1.5%                                                                                                         |
| PRNG                                                                               | known-answer vectors from an independent Python implementation; chi-square uniformity < 27.9 (p = 0.001)                       |
| MCMC on known normals                                                              | means, variances and correlation (0.9) recovered within stated tolerances                                                      |
| Parameter recovery, 6 synthetic trials (weekly, 26 points)                         | 95% intervals contained the truth: R0 6/6, I0 6/6, rho 5/6; all 6 fits converged. Six trials only detect gross miscalibration. |

## 10. Known limits

Homogeneous mixing, constant parameters except user interventions, exponential stage durations, no waning immunity, leaky vaccine with immediate effect and doses given only to susceptibles. Fit mode fits a single wave without interventions and treats the population and the reporting delay as fixed inputs. On the bundled real hospital-admission series the one-wave model fits poorly (only 51% and 69% of points inside the model's own 95% band), which the app reports instead of hiding.
