import { normalizeSnapshot } from './prediction.js';
import type {
  RealtimeDelta,
  RealtimeSnapshot
} from './types.js';

export type RealtimePatchCreator<TState, TPatch> = (previous: TState, next: TState) => TPatch;
export type RealtimePatchApplier<TState, TPatch> = (state: TState, patch: TPatch) => TState;

export interface CreateRealtimeDeltaOptions<TState, TPatch> {
  readonly createPatch: RealtimePatchCreator<TState, TPatch>;
  readonly baseTick?: number;
  readonly timeMs?: number;
}

export interface ApplyRealtimeDeltaOptions<TState, TPatch> {
  readonly applyPatch: RealtimePatchApplier<TState, TPatch>;
  readonly requireBaseTick?: boolean;
}

export function createRealtimeDelta<TState, TPatch>(
  previous: RealtimeSnapshot<TState>,
  next: RealtimeSnapshot<TState>,
  options: CreateRealtimeDeltaOptions<TState, TPatch>
): RealtimeDelta<TPatch> {
  const base = normalizeSnapshot(previous);
  const target = normalizeSnapshot(next);
  if (target.tick < base.tick) throw new RangeError('delta target tick must be >= base tick');
  return {
    tick: target.tick,
    baseTick: options.baseTick ?? base.tick,
    timeMs: options.timeMs ?? target.timeMs,
    patch: options.createPatch(base.state, target.state)
  };
}

export function applyRealtimeDelta<TState, TPatch>(
  base: RealtimeSnapshot<TState>,
  delta: RealtimeDelta<TPatch>,
  options: ApplyRealtimeDeltaOptions<TState, TPatch>
): RealtimeSnapshot<TState> {
  const snapshot = normalizeSnapshot(base);
  if (options.requireBaseTick !== false && delta.baseTick !== undefined && delta.baseTick !== snapshot.tick) {
    throw new RangeError('delta baseTick does not match snapshot tick');
  }
  return {
    tick: delta.tick,
    timeMs: delta.timeMs,
    state: options.applyPatch(snapshot.state, delta.patch),
    lastCommandSeqByClient: snapshot.lastCommandSeqByClient,
    ack: snapshot.ack
  };
}

export function estimateJsonMessageBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function shouldSendRealtimeDelta<TPatch>(
  delta: RealtimeDelta<TPatch>,
  estimatePatchBytes: (patch: TPatch) => number,
  snapshotBytes: number,
  minSavingsRatio = 0.1
): boolean {
  if (!Number.isFinite(snapshotBytes) || snapshotBytes <= 0) return false;
  const patchBytes = estimatePatchBytes(delta.patch);
  if (!Number.isFinite(patchBytes) || patchBytes <= 0) return false;
  return patchBytes <= snapshotBytes * (1 - minSavingsRatio);
}
