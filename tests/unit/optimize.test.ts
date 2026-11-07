import { describe, expect, it } from 'vitest';
import { multiStart, nelderMead } from '../../src/sim/optimize';

describe('Nelder-Mead', () => {
  it('minimises a quadratic exactly (min at (3, -2), value 5)', () => {
    const f = (x: number[]): number =>
      ((x[0] as number) - 3) ** 2 + 2 * ((x[1] as number) + 2) ** 2 + 5;
    const r = nelderMead(f, [0, 0]);
    expect(r.converged).toBe(true);
    expect(r.x[0]).toBeCloseTo(3, 5);
    expect(r.x[1]).toBeCloseTo(-2, 5);
    expect(r.value).toBeCloseTo(5, 9);
  });
  it('minimises the Rosenbrock function from the classic start (-1.2, 1) to (1, 1)', () => {
    const f = (x: number[]): number =>
      100 * ((x[1] as number) - (x[0] as number) ** 2) ** 2 + (1 - (x[0] as number)) ** 2;
    const r = multiStart(f, [[-1.2, 1]], { maxIterations: 2000 });
    expect(r.best.x[0]).toBeCloseTo(1, 4);
    expect(r.best.x[1]).toBeCloseTo(1, 4);
    expect(r.best.value).toBeLessThan(1e-8);
  });
  it('works in higher dimensions (5-D shifted quadratic)', () => {
    const target = [1, -1, 2, 0.5, -3];
    const f = (x: number[]): number =>
      x.reduce((a, xi, i) => a + (xi - (target[i] as number)) ** 2, 0);
    const r = nelderMead(f, new Array<number>(5).fill(0), { maxIterations: 5000 });
    target.forEach((t, i) => expect(r.x[i]).toBeCloseTo(t, 4));
  });
  it('multi-start finds a global minimum of the 4-minimum Himmelblau function and reports agreement', () => {
    const f = (x: number[]): number =>
      ((x[0] as number) ** 2 + (x[1] as number) - 11) ** 2 +
      ((x[0] as number) + (x[1] as number) ** 2 - 7) ** 2;
    const r = multiStart(
      f,
      [
        [0, 0],
        [-4, 4],
        [-4, -4],
        [4, -4],
        [2, 2],
      ],
      { maxIterations: 1000 },
    );
    expect(r.best.value).toBeLessThan(1e-8);
    expect(r.agreeing).toBe(5); // all minima have value 0, so every start agrees on the optimum value
    expect(r.reliable).toBe(true);
  });
  it('treats NaN and Infinity as bad points and stays finite', () => {
    const f = (x: number[]): number =>
      (x[0] as number) < -5 ? NaN : (x[0] as number) > 5 ? Infinity : ((x[0] as number) - 1) ** 2;
    const r = nelderMead(f, [4]);
    expect(r.x[0]).toBeCloseTo(1, 4);
  });
  it('reports non-convergence when the iteration budget is too small', () => {
    const f = (x: number[]): number =>
      100 * ((x[1] as number) - (x[0] as number) ** 2) ** 2 + (1 - (x[0] as number)) ** 2;
    expect(nelderMead(f, [-1.2, 1], { maxIterations: 10 }).converged).toBe(false);
  });
});
