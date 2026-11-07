# Contributing to OutbreakScope

Thanks for helping. This is a teaching tool for outbreak modelling, so correctness and honesty matter more than features.

## Ground rules

- **Never invent data.** Every preset and every bundled dataset needs a source (paper, agency page, DOI or dataset id) and a license that allows redistribution. Add it to [DATA-SOURCES.md](DATA-SOURCES.md) in the same pull request. If a value is derived rather than quoted, say so.
- **No network at runtime.** The app makes no requests. Do not add telemetry, CDN links or remote fonts.
- **Seeded randomness only.** Simulation code uses the seeded PRNG in `src/sim/rng.ts`. `Math.random` is banned by lint and by a test.
- **Keep the Electron security model.** `contextIsolation`, `sandbox`, the CSP and the four-function preload stay as they are. New IPC needs a zod schema and validation in the main process.
- **Say what you ran.** In a pull request, list the checks you ran and their result. "Not run" is a fine answer; guessing is not.

## Setup

Needs Node 22+.

```bash
git clone https://github.com/reeper316099/OutbreakScope.git
cd OutbreakScope
npm ci
npm run dev
```

## Before you open a pull request

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

- TypeScript is strict. No `any`.
- Prettier formats the code (`npm run format`).
- Give each function a one-line comment saying what it does.
- Maths changes need a test against an analytical result or the SciPy fixtures (`tests/fixtures`, regenerated with `npm run ref:generate`, see [tools/README.md](tools/README.md)).
- UI changes: check light and dark mode and keyboard use. Every chart needs a text-table fallback.

## Good places to start

Issues labelled [good first issue](https://github.com/reeper316099/OutbreakScope/labels/good%20first%20issue) are small and self-contained. Ask in the issue before you start so two people do not do the same work.

## Questions and ideas

Use [Discussions](https://github.com/reeper316099/OutbreakScope/discussions) for questions and open-ended ideas, and Issues for bugs and concrete tasks.

## Reporting security problems

Please do not post exploit details in a public issue. Open a Discussion asking for a private way to reach the maintainer, or use GitHub's private vulnerability reporting if the Security tab offers it.
