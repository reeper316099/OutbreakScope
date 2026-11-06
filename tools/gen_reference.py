"""Generate SciPy reference trajectories for OutbreakScope's solver tests.

Equations (see MODEL.md section 2):
  c(t)  = contact multiplier (piecewise constant), nu(t) = vaccination rate (piecewise constant)
  lam   = c(t) * beta * I / N                       force of infection
  dS/dt = -lam*S - nu*S
  dV/dt =  nu*S - (1-eff)*lam*V                     (leaky vaccine, no waning)
  dE/dt =  lam*(S + (1-eff)*V) - sigma*E            (SIR: E is absent, infection goes straight to I)
  dI/dt =  sigma*E - gamma*I                        (SIR: dI/dt = lam*(S+(1-eff)V) - gamma*I)
  dR/dt =  gamma*I
Because the parameters are piecewise constant, we integrate each constant segment
separately with solve_ivp (DOP853, tight tolerances) so no step ever straddles a boundary.
State order in output: S, E, I, R, V (E is all zeros for SIR; V all zeros without vaccination).
"""
import json, sys
from pathlib import Path
import numpy as np
import scipy
from scipy.integrate import solve_ivp

RTOL, ATOL, METHOD = 1e-10, 1e-12, "DOP853"
OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "reference"


def rhs_factory(model, beta, sigma, gamma, N, c, nu, eff):
    def rhs(_t, y):
        S, E, I, R, V = y
        lam = c * beta * I / N
        new_inf_S = lam * S
        new_inf_V = (1.0 - eff) * lam * V
        inf = new_inf_S + new_inf_V
        if model == "SIR":
            return [-new_inf_S - nu * S, 0.0, inf - gamma * I, gamma * I, nu * S - new_inf_V]
        return [-new_inf_S - nu * S, inf - sigma * E, sigma * E - gamma * I, gamma * I, nu * S - new_inf_V]
    return rhs


def run_case(case):
    m, N, T = case["model"], case["N"], case["days"]
    R0, gamma = case["R0"], 1.0 / case["infectious_days"]
    sigma = 1.0 / case["incubation_days"] if m != "SIR" else None
    beta = R0 * gamma
    eff = case.get("vaccine_efficacy", 0.0)
    # Boundaries: every start/end day of every intervention, plus 0 and T.
    bounds = sorted({0, T, *[b for iv in case["interventions"] for b in (iv["start"], iv["end"]) if 0 < b < T]})
    I0 = case["I0"]
    y = [N - I0, 0.0, I0, 0.0, 0.0]
    if m != "SIR" and case.get("start_exposed"):
        y = [N - I0, I0, 0.0, 0.0, 0.0]
    ts, ys = [0.0], [list(y)]
    for a, b in zip(bounds[:-1], bounds[1:]):
        c, nu = 1.0, 0.0
        for iv in case["interventions"]:
            if iv["start"] <= a < iv["end"]:
                if iv["type"] == "contact_reduction":
                    c *= 1.0 - iv["strength"]
                elif iv["type"] == "vaccination":
                    nu += iv["strength"]
        t_eval = np.arange(a + 1, b + 1, 1.0)
        sol = solve_ivp(rhs_factory(m, beta, sigma, gamma, N, c, nu, eff), (a, b), y,
                        method=METHOD, rtol=RTOL, atol=ATOL, t_eval=t_eval)
        assert sol.success, sol.message
        for k in range(sol.y.shape[1]):
            ts.append(float(sol.t[k])); ys.append(sol.y[:, k].tolist())
        y = sol.y[:, -1].tolist()
    return {"case": case, "internal": {"beta_per_day": beta, "sigma_per_day": sigma, "gamma_per_day": gamma},
            "meta": {"scipy": scipy.__version__, "numpy": np.__version__, "method": METHOD, "rtol": RTOL, "atol": ATOL,
                     "state_order": ["S", "E", "I", "R", "V"], "grid": "daily, t=0..days"},
            "t": ts, "y": ys}


CASES = [
    dict(id="sir_slow_R1p5", model="SIR", R0=1.5, infectious_days=10, N=1e6, I0=10, days=365, interventions=[]),
    dict(id="sir_fast_R6", model="SIR", R0=6.0, infectious_days=3, N=1e6, I0=1, days=120, interventions=[]),
    dict(id="seir_near_critical_R1p05", model="SEIR", R0=1.05, incubation_days=4, infectious_days=6, N=1e6, I0=100, days=730, interventions=[]),
    dict(id="seir_exactly_R1", model="SEIR", R0=1.0, incubation_days=4, infectious_days=6, N=1e6, I0=100, days=365, interventions=[]),
    dict(id="seir_subcritical_R0p8", model="SEIR", R0=0.8, incubation_days=4, infectious_days=6, N=1e6, I0=100, days=200, interventions=[]),
    dict(id="seir_measles_like_R15", model="SEIR", R0=15.0, incubation_days=8, infectious_days=8, N=1e6, I0=5, days=250, interventions=[]),
    dict(id="seir_contact_reduction_day30", model="SEIR", R0=2.5, incubation_days=5, infectious_days=7, N=1e6, I0=20, days=300,
         interventions=[dict(type="contact_reduction", start=30, end=300, strength=0.4)]),
    dict(id="seirv_vaccination_window_45_90", model="SEIR", R0=2.5, incubation_days=5, infectious_days=7, N=1e6, I0=20, days=300,
         vaccine_efficacy=0.9, interventions=[dict(type="vaccination", start=45, end=90, strength=0.01)]),
    dict(id="seirv_combined", model="SEIR", R0=3.0, incubation_days=4, infectious_days=5, N=1e6, I0=50, days=300,
         vaccine_efficacy=0.7, interventions=[dict(type="contact_reduction", start=20, end=80, strength=0.3),
                                              dict(type="vaccination", start=40, end=120, strength=0.005)]),
]

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for case in CASES:
        res = run_case(case)
        (OUT / f"{case['id']}.json").write_text(json.dumps(res))
        tot = np.array(res["y"]).sum(axis=1)
        print(f"{case['id']:36s} conservation max|sum-N| = {np.max(np.abs(tot - case['N'])):.3e}  final R/N = {res['y'][-1][3]/case['N']:.5f}")
    print("scipy", scipy.__version__, "numpy", np.__version__, file=sys.stderr)
