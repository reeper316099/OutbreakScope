// Small bounded undo/redo history over immutable snapshots (also used for back/forward between views).

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private current: T;

  constructor(
    initial: T,
    private readonly limit = 100,
  ) {
    this.current = initial;
  }

  /** The present value. */
  get value(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Makes `next` the present value, remembering the old one (clears redo; drops the oldest beyond the limit). */
  push(next: T): void {
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    this.future = [];
  }

  /** Steps back; returns the new present value, or undefined if there is nothing to undo. */
  undo(): T | undefined {
    const prev = this.past.pop();
    if (prev === undefined) return undefined;
    this.future.push(this.current);
    this.current = prev;
    return prev;
  }

  /** Steps forward again; returns the new present value, or undefined if there is nothing to redo. */
  redo(): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(this.current);
    this.current = next;
    return next;
  }
}
