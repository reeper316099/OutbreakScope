"""Independent cross-check: re-solve the scenario described in an OutbreakScope time-series export with SciPy and compare.

Usage: python3 tools/crosscheck.py file1.csv [file2.csv ...]
Reads the '# model=... R0=...' and '# interventions=...' comment lines of each export, integrates the same equations
with scipy.integrate.solve_ivp (DOP853, rtol 1e-10, atol 1e-12) segment by segment, and prints the largest absolute
difference for every column (S, E, I, R, V, cumulative infections), also as a fraction of the population.
This script shares no code with the TypeScript solver.
"""
import re
import sys

import numpy as np
from scipy.integrate import solve_ivp


def parse_header(lines):
    params = {}
    for l in lines:
        if l.startswith('# model='):
            for k, v in re.findall(r'(\w+)=(\S+)', l[2:]):
                params[k] = v
        if l.startswith('# interventions='):
            body = l[len('# interventions='):].strip()
            params['interventions'] = [] if body == 'none' else [
                (m.group(1), float(m.group(2)), float(m.group(3)), float(m.group(4)))
                for m in (re.match(r'(\w+)\[([\d.]+)-([\d.]+)\):([\d.eE+-]+)', t) for t in body.split(';'))
            ]
    return params


def solve(p):
    model = p['model']
    N = float(p['population']); T = float(p['horizon_days'])
    R0 = float(p['R0']); gamma = 1 / float(p['infectious_days'])
    sigma = 1 / float(p['incubation_days']) if model != 'SIR' else None
    beta = R0 * gamma
    eff = float(p['vaccine_efficacy']) if model == 'SEIRV' else 0.0
    ivs = p['interventions']
    cuts = sorted({0.0, T, *[x for _, a, b, _ in ivs for x in (a, b) if 0 < x < T]})
    I0 = float(p['initial_infected'])
    y = [N - I0, 0.0, I0, 0.0, 0.0, I0]  # S, E, I, R, V, cumulative infections
    ts, ys = [0.0], [list(y)]
    for a, b in zip(cuts[:-1], cuts[1:]):
        c = 1.0; nu = 0.0
        for kind, s, e, strength in ivs:
            if s <= a < e:
                if kind == 'contact_reduction': c *= 1 - strength
                else: nu += strength
        def rhs(_t, y):
            S, E, I, R, V, C = y
            lam = c * beta * I / N
            inf = lam * S + (1 - eff) * lam * V
            dV = nu * S - (1 - eff) * lam * V
            dS = -lam * S - nu * S
            if model == 'SIR':
                return [dS, 0.0, inf - gamma * I, gamma * I, dV, inf]
            return [dS, inf - sigma * E, sigma * E - gamma * I, gamma * I, dV, inf]
        t_eval = np.arange(np.floor(a) + 1 if a == int(a) else np.ceil(a), b + 1e-9, 1.0)
        t_eval = t_eval[(t_eval > a) & (t_eval <= b + 1e-9)]
        sol = solve_ivp(rhs, (a, b), y, method='DOP853', rtol=1e-10, atol=1e-12, t_eval=t_eval)
        for k in range(sol.y.shape[1]):
            ts.append(float(sol.t[k])); ys.append(sol.y[:, k].tolist())
        y = sol.y[:, -1].tolist()
    return np.array(ts), np.array(ys)


def main(paths):
    worst_overall = 0.0
    for path in paths:
        lines = open(path).read().splitlines()
        p = parse_header([l for l in lines if l.startswith('#')])
        head = next(i for i, l in enumerate(lines) if l.startswith('day,'))
        cols = lines[head].split(',')
        rows = np.array([[float(x) if x else np.nan for x in l.split(',')] for l in lines[head + 1:] if l])
        t, y = solve(p)
        assert np.allclose(t, rows[:, 0]), 'time grids differ'
        N = float(p['population'])
        mapping = {'S': 0, 'E': 1, 'I': 2, 'R': 3, 'V': 4, 'cumulative_infections': 5}
        out = []
        for name, j in mapping.items():
            d = np.max(np.abs(rows[:, cols.index(name)] - y[:, j]))
            out.append((name, d))
            worst_overall = max(worst_overall, d / N)
        print(f"{path.split('/')[-1]:34s} model={p['model']:5s} N={N:.0f}  " + '  '.join(f'{n}:{d:.2e}' for n, d in out) + f"   (max/N = {max(d for _, d in out)/N:.2e})")
    print(f'worst max|difference| / N over all files and columns = {worst_overall:.3e}')


if __name__ == '__main__':
    main(sys.argv[1:])
