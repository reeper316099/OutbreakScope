# Changelog

## v0.1.0

First release.

### New

- **Scenario mode.** SIR, SEIR and SEIR + leaky vaccine; plain-language parameters; sourced illustrative presets; timed contact-reduction and vaccination interventions; live compartment, incidence and R_eff charts; key numbers (peak, final size, herd immunity threshold, growth rate, doubling time); save/open scenarios; CSV and PNG export; undo/redo; light and dark mode.
- **Stochastic runs.** Exact Gillespie for small populations and chain-binomial for large ones, in background workers with progress and Cancel; reproducible from a displayed seed; fizzle-vs-take-off panel next to the branching-process theory.
- **Scenario comparison.** Save three scenarios, overlay them, and see differences in words and in a table.
- **"How this works".** Flow diagram, equations in MathML with your numbers, a worked example, an interactive RK4 step, assumptions and where they break.
- **Fit mode.** CSV import with every problem reported; bundled public-domain CDC hospital-admission series and a synthetic series; Poisson and negative-binomial likelihoods; Nelder-Mead and four-chain Metropolis in workers; fitted curve with predictive bands, posterior-vs-prior histograms, residuals, goodness of fit, identifiability and misfit warnings, R-hat, effective sample size and trace plots; non-converged fits are labelled and their numbers hidden.
- **Validation.** 250 unit tests and 29 end-to-end tests; the solver agrees with SciPy to 1.6e-9 of the population and an independent re-solve of exported scenarios to 8.1e-10.
- **Security.** Sandboxed renderer, strict CSP, custom `app://` protocol, four-function preload with validated arguments, allowlisted external links, no network at runtime.

### Known limits

- macOS and Windows builds are unsigned (you will see an "unknown developer" warning).
- Linux, Windows and the Intel macOS build were not built or run locally; the GitHub Actions workflows have not run yet.
- Fit results can be exported but not re-opened.
