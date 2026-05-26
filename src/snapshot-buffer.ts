import { normalizeSnapshot } from './prediction.js';
import type { RealtimeSnapshot, RealtimeTimestampMs } from './types.js';

export interface SnapshotSample<TState = unknown> {
  readonly previous: RealtimeSnapshot<TState>;
  readonly next: RealtimeSnapshot<TState>;
  readonly alpha: number;
  readonly renderTimeMs: RealtimeTimestampMs;
  readonly exact: boolean;
}

export interface SnapshotBufferOptions {
  capacity?: number;
}

export interface SnapshotBuffer<TState = unknown> {
  readonly capacity: number;
  readonly size: number;
  readonly snapshots: readonly RealtimeSnapshot<TState>[];
  push(snapshot: RealtimeSnapshot<TState>): void;
  sample(renderTimeMs: RealtimeTimestampMs): SnapshotSample<TState> | null;
  latest(): RealtimeSnapshot<TState> | null;
  clear(): void;
}

export function createSnapshotBuffer<TState = unknown>(options: SnapshotBufferOptions = {}): SnapshotBuffer<TState> {
  const capacity = options.capacity ?? 64;
  if (!Number.isSafeInteger(capacity) || capacity < 2) throw new TypeError('capacity must be a safe integer >= 2');
  let snapshots: RealtimeSnapshot<TState>[] = [];

  return {
    get capacity() {
      return capacity;
    },
    get size() {
      return snapshots.length;
    },
    get snapshots() {
      return snapshots;
    },
    push(snapshot: RealtimeSnapshot<TState>) {
      snapshots = insertSnapshot(snapshots, normalizeSnapshot(snapshot), capacity);
    },
    sample(renderTimeMs: RealtimeTimestampMs) {
      return sampleSnapshots(snapshots, renderTimeMs);
    },
    latest() {
      return snapshots.length === 0 ? null : snapshots[snapshots.length - 1];
    },
    clear() {
      snapshots = [];
    }
  };
}

export function sampleSnapshots<TState>(
  snapshots: readonly RealtimeSnapshot<TState>[],
  renderTimeMs: RealtimeTimestampMs
): SnapshotSample<TState> | null {
  if (!Number.isFinite(renderTimeMs)) throw new TypeError('renderTimeMs must be finite');
  if (snapshots.length === 0) return null;
  if (snapshots.length === 1) {
    const only = snapshots[0];
    return { previous: only, next: only, alpha: 0, renderTimeMs, exact: true };
  }

  const first = snapshots[0];
  if (renderTimeMs <= snapshotTime(first)) return { previous: first, next: first, alpha: 0, renderTimeMs, exact: true };

  for (let index = 1; index < snapshots.length; index++) {
    const next = snapshots[index];
    const nextTime = snapshotTime(next);
    if (renderTimeMs <= nextTime) {
      const previous = snapshots[index - 1];
      const previousTime = snapshotTime(previous);
      const span = nextTime - previousTime;
      const alpha = span <= 0 ? 1 : clamp01((renderTimeMs - previousTime) / span);
      return {
        previous,
        next,
        alpha,
        renderTimeMs,
        exact: alpha === 0 || alpha === 1 || previous === next
      };
    }
  }

  const latest = snapshots[snapshots.length - 1];
  return { previous: latest, next: latest, alpha: 0, renderTimeMs, exact: true };
}

export function interpolateSnapshot<TState>(
  sample: SnapshotSample<TState>,
  interpolate: (previous: TState, next: TState, alpha: number) => TState
): TState {
  return sample.previous === sample.next
    ? sample.previous.state
    : interpolate(sample.previous.state, sample.next.state, sample.alpha);
}

export function snapshotTime(snapshot: Pick<RealtimeSnapshot, 'tick' | 'timeMs'>): RealtimeTimestampMs {
  return snapshot.timeMs ?? snapshot.tick;
}

function insertSnapshot<TState>(
  snapshots: readonly RealtimeSnapshot<TState>[],
  snapshot: RealtimeSnapshot<TState>,
  capacity: number
): RealtimeSnapshot<TState>[] {
  const next = snapshots.slice();
  const time = snapshotTime(snapshot);
  let inserted = false;
  for (let index = 0; index < next.length; index++) {
    const existingTime = snapshotTime(next[index]);
    if (existingTime === time || next[index].tick === snapshot.tick) {
      next[index] = snapshot;
      inserted = true;
      break;
    }
    if (existingTime > time) {
      next.splice(index, 0, snapshot);
      inserted = true;
      break;
    }
  }
  if (!inserted) next.push(snapshot);
  if (next.length > capacity) next.splice(0, next.length - capacity);
  return next;
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}
