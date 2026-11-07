// Holds the current scenario with live previews (while dragging) and committed undo/redo history.
import type { Scenario } from '../shared/types';
import { History } from './history';

export type ChangeKind = 'preview' | 'commit' | 'undo' | 'redo';
type Listener = (scenario: Scenario, kind: ChangeKind) => void;

/** The default starting scenario: a plain SEIR outbreak. */
export function defaultScenario(): Scenario {
  return {
    params: {
      model: 'SEIR',
      r0: 2.5,
      incubationDays: 5,
      infectiousDays: 7,
      population: 1_000_000,
      initialInfected: 10,
      vaccineEfficacy: 0.8,
      horizonDays: 365,
    },
    interventions: [],
    seed: 12345,
    ensembleSize: 100,
  };
}

export class ScenarioStore {
  private readonly history: History<Scenario>;
  private live: Scenario;
  private readonly listeners = new Set<Listener>();

  constructor(initial: Scenario = defaultScenario()) {
    this.history = new History(initial, 100);
    this.live = initial;
  }

  /** The scenario currently shown (including uncommitted slider previews). */
  get scenario(): Scenario {
    return this.live;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** Registers a listener; returns a function that removes it. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Shows a change immediately without adding an undo step (used while a slider is being dragged). */
  preview(next: Scenario): void {
    this.live = next;
    this.emit('preview');
  }

  /** Makes a change official: adds one undo step if it differs from the last committed scenario. */
  commit(next: Scenario): void {
    if (JSON.stringify(next) !== JSON.stringify(this.history.value)) this.history.push(next);
    this.live = next;
    this.emit('commit');
  }

  /** Steps back one committed change. */
  undo(): void {
    const prev = this.history.undo();
    if (prev === undefined) return;
    this.live = prev;
    this.emit('undo');
  }

  /** Re-applies an undone change. */
  redo(): void {
    const next = this.history.redo();
    if (next === undefined) return;
    this.live = next;
    this.emit('redo');
  }

  private emit(kind: ChangeKind): void {
    for (const l of this.listeners) l(this.live, kind);
  }
}
