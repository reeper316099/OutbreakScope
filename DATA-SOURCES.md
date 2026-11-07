# Data sources

OutbreakScope never invents data. Every parameter preset below is either **reported** (copied from the cited source), **derived** (computed from sourced numbers; the formula is shown in the app next to the preset), or **assumed** (a hypothetical teaching example with no source, labelled as such). Presets are _illustrative values from the literature_, not predictions about any current outbreak.

Only numbers (facts) are used from these papers; no text, figures or tables are reproduced. Links are opened in the system browser only (https, allowlisted hosts).

## Parameter presets

| Preset                                    | R0 (range)                                                    | Incubation (range)                                                                                            | Infectious period (range)                                                                                                                                                                 | Sources                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seasonal influenza-like (SIR)             | 1.28 (IQR 1.19–1.37), reported                                | none sourced, so SIR                                                                                          | 4.8 d (95% CI 4.31–5.29), reported: mean viral-shedding duration used as a proxy                                                                                                          | [Biggerstaff 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4169819/) (CC BY 4.0, read in full text); [Carrat 2008](https://pubmed.ncbi.nlm.nih.gov/18230677/) (abstract)                      |
| 1918-like pandemic influenza (SIR)        | 1.80 (IQR 1.47–2.27), reported                                | none sourced                                                                                                  | same proxy as above (not measured for 1918)                                                                                                                                               | same                                                                                                                                                                                           |
| COVID-19-like, early Wuhan (SEIR)         | 2.2 (95% CI 1.4–3.9), reported                                | 5.2 d (4.1–7.0), reported                                                                                     | 2.3 d (0.1–13.8), **derived**: serial interval 7.5 d − incubation 5.2 d (SEIR identity: generation interval = incubation + infectious period); range from the serial-interval CI 5.3–19 d | [Li 2020, NEJM](https://pmc.ncbi.nlm.nih.gov/articles/PMC7121484/)                                                                                                                             |
| Measles-like (SEIR)                       | 15 (12–18), **derived**: midpoint of the commonly cited range | 10 d (3–17), **derived**: 14 d exposure-to-rash − 4 d of pre-rash transmissibility; range from 7–21 d minus 4 | 8 d, **derived**: transmissible 4 d before to 4 d after rash; no range given                                                                                                              | [Guerra 2017](https://pubmed.ncbi.nlm.nih.gov/28757186/) (abstract: "often cited 12–18"); [CDC Pink Book, measles](https://www.cdc.gov/pinkbook/hcp/table-of-contents/chapter-13-measles.html) |
| Ebola-like, West Africa 2014 (SEIR)       | 1.71 (1.44–2.26), reported (Guinea; range spans country CIs)  | 11.4 d (9.4–11.4), reported                                                                                   | 3.9 d (3.9–7.5), **derived**: serial interval 15.3 d − incubation 11.4 d; upper end = reported onset-to-death 7.5 d                                                                       | [WHO Ebola Response Team 2014, NEJM](https://pmc.ncbi.nlm.nih.gov/articles/PMC4235004/)                                                                                                        |
| Hypothetical mild / fast-spreading (SEIR) | 1.3 / 4                                                       | 3 / 2 d                                                                                                       | 5 / 4 d                                                                                                                                                                                   | **None**: invented teaching values, labelled "assumed" in the app                                                                                                                              |

Caveats worth knowing:

- Influenza has no sourced incubation period, so its presets use the SIR model.
- Derived infectious periods rest on "serial interval ≈ generation interval" and exponential stage durations; they are rough.
- The Carrat 2008 and Guerra 2017 full texts were not readable here; only the figures stated in their abstracts (as retrieved) were used. The Li 2020 and WHO 2014 numbers were read on their PMC pages. The Biggerstaff numbers were read from the full text.
- Copyright of the papers belongs to their publishers; PMC page notes for Li 2020 and WHO 2014 do not state a Creative Commons licence, which is why no text is copied.

## Sample datasets

None are bundled yet. Findings so far (more in the Phase 5 report):

- 1978 boarding-school influenza: the BMJ item is not open access (Europe PMC: not OA); the only copy found is a re-keyed version in the R `outbreaks` package, which has no data licence of its own. Not bundled; users can import it themselves.
- Kikwit 1995 Ebola: same situation (Khan et al. 1999). Not bundled.
- CDC `data.cdc.gov` datasets such as weekly hospital respiratory data (`ua7e-t2fy`) are listed as "Public Domain U.S. Government" in the catalog API; specific series will be chosen and re-checked before bundling.
- Project Tycho: licence statements conflict (CCPL / ODbL / "no restrictions"); not bundled until resolved.

## Algorithms and libraries

xoshiro128** (Blackman & Vigna, public domain), BTRS binomial sampler (Hörmann 1993), Okabe–Ito colour palette (Okabe & Ito 2008). Libraries: Electron, Chart.js, zod (all MIT).
