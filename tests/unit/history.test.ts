import { describe, expect, it } from 'vitest';
import { History } from '../../src/ui/history';

describe('History', () => {
  it('undoes and redoes in order and clears redo on a new push', () => {
    const h = new History(1);
    h.push(2);
    h.push(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBeUndefined();
    expect(h.redo()).toBe(2);
    h.push(9);
    expect(h.canRedo).toBe(false);
    expect(h.value).toBe(9);
  });
  it('is bounded: oldest states are dropped beyond the limit', () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 10; i++) h.push(i);
    const seen: number[] = [];
    for (let v = h.undo(); v !== undefined; v = h.undo()) seen.push(v);
    expect(seen).toEqual([9, 8, 7]);
  });
});
