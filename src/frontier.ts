import {
  applyPatchImmutable,
  diff,
  type JsonValue,
  type Patch
} from '@shapeshift-labs/frontier';
import {
  applyRealtimeDelta,
  createRealtimeDelta
} from './delta.js';
import type {
  RealtimeDelta,
  RealtimeSnapshot
} from './types.js';

export function createFrontierRealtimeDelta<TState extends JsonValue>(
  previous: RealtimeSnapshot<TState>,
  next: RealtimeSnapshot<TState>
): RealtimeDelta<Patch> {
  return createRealtimeDelta(previous, next, { createPatch: diff });
}

export function applyFrontierRealtimeDelta<TState extends JsonValue>(
  base: RealtimeSnapshot<TState>,
  delta: RealtimeDelta<Patch>
): RealtimeSnapshot<TState> {
  return applyRealtimeDelta(base, delta, {
    applyPatch: (state, patch) => applyPatchImmutable(state, patch) as TState
  });
}

export function estimateFrontierPatchBytes(patch: Patch): number {
  return new TextEncoder().encode(JSON.stringify(patch)).byteLength;
}

export type {
  Patch
};
