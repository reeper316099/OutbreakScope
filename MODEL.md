# OutbreakScope: model and numerical methods (Phase 1 draft)

Status: equations below were checked numerically with an independent SciPy/NumPy script (see "Checks run"). This file will grow into the full write-up in Phase 8.
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

Nothing above has yet been checked against the TypeScript implementation, which does not exist yet.

## 6. State vector and conventions (Phase 3 implementation)

The integrator carries 8 numbers for every model: S, E, I, R, V and three cumulative flows (infections, entries into I, vaccinations). Daily incidence is the difference of the cumulative infections at consecutive output times, which is exact to RK4 accuracy (no finite-difference of prevalence). SIR leaves E at 0; models without vaccination leave V at 0. A realization is a "major outbreak" if secondary infections (beyond the initial ones) reach 5% of N. Overlapping events: contact reductions multiply, vaccination rates add; events are active on [start, end).
