# tools/

`gen_reference.py` generates SciPy reference trajectories into `tests/fixtures/reference/`.
It is a development tool and is NOT shipped in the app.

    python3 -m pip install -r tools/requirements.txt
    npm run ref:generate

`gen_rng_kat.py` writes known-answer vectors for the PRNG (an independent Python implementation) to `tests/fixtures/rng_kat.json`.

`crosscheck.py` re-solves scenarios exported from the app with SciPy and prints the largest differences:

    CROSSCHECK_DIR=/some/folder npx playwright test tests/e2e/crosscheck.spec.ts   # exports three scenarios through the real app
    python3 -I tools/crosscheck.py /some/folder/*.csv

`make-icons.cjs` renders `build/icon.svg` to `build/icon.png`, `icon.ico` and (on macOS) `icon.icns`: `npm run icons`.
