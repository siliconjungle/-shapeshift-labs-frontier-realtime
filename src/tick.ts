import type { RealtimeTick, RealtimeTimestampMs } from './types.js';

export interface RealtimeTickClockOptions {
  tickRate?: number;
  tickMs?: number;
  startTick?: RealtimeTick;
  startTimeMs?: RealtimeTimestampMs;
}

export interface RealtimeTickAdvance {
  readonly tick: RealtimeTick;
  readonly steps: number;
}

export interface RealtimeTickClock {
  readonly tickRate: number;
  readonly tickMs: number;
  readonly tick: RealtimeTick;
  readonly startTimeMs: RealtimeTimestampMs;
  toTick(timeMs: RealtimeTimestampMs): RealtimeTick;
  toTimeMs(tick: RealtimeTick): RealtimeTimestampMs;
  update(nowMs: RealtimeTimestampMs): RealtimeTickAdvance;
  step(count?: number): RealtimeTickAdvance;
  reset(tick?: RealtimeTick, startTimeMs?: RealtimeTimestampMs): void;
}

export function createTickClock(options: RealtimeTickClockOptions = {}): RealtimeTickClock {
  const normalized = normalizeTickClockOptions(options);
  let tick = normalized.startTick;
  let startTimeMs = normalized.startTimeMs;

  return {
    get tickRate() {
      return normalized.tickRate;
    },
    get tickMs() {
      return normalized.tickMs;
    },
    get tick() {
      return tick;
    },
    get startTimeMs() {
      return startTimeMs;
    },
    toTick(timeMs: RealtimeTimestampMs) {
      return timeToTick(timeMs, normalized.tickMs, startTimeMs);
    },
    toTimeMs(nextTick: RealtimeTick) {
      return tickToTimeMs(nextTick, normalized.tickMs, startTimeMs);
    },
    update(nowMs: RealtimeTimestampMs) {
      const nextTick = Math.max(tick, timeToTick(nowMs, normalized.tickMs, startTimeMs));
      const steps = nextTick - tick;
      tick = nextTick;
      return { tick, steps };
    },
    step(count = 1) {
      if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('step count must be a non-negative safe integer');
      tick += count;
      return { tick, steps: count };
    },
    reset(nextTick = normalized.startTick, nextStartTimeMs = normalized.startTimeMs) {
      if (!Number.isSafeInteger(nextTick) || nextTick < 0) throw new TypeError('tick must be a non-negative safe integer');
      if (!Number.isFinite(nextStartTimeMs)) throw new TypeError('startTimeMs must be finite');
      tick = nextTick;
      startTimeMs = nextStartTimeMs;
    }
  };
}

export function timeToTick(timeMs: RealtimeTimestampMs, tickMs: number, startTimeMs = 0): RealtimeTick {
  if (!Number.isFinite(timeMs)) throw new TypeError('timeMs must be finite');
  if (!Number.isFinite(startTimeMs)) throw new TypeError('startTimeMs must be finite');
  const normalizedTickMs = normalizeTickMs(tickMs);
  return Math.max(0, Math.floor((timeMs - startTimeMs) / normalizedTickMs));
}

export function tickToTimeMs(tick: RealtimeTick, tickMs: number, startTimeMs = 0): RealtimeTimestampMs {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new TypeError('tick must be a non-negative safe integer');
  if (!Number.isFinite(startTimeMs)) throw new TypeError('startTimeMs must be finite');
  return startTimeMs + tick * normalizeTickMs(tickMs);
}

export function clampTickDelta(current: RealtimeTick, target: RealtimeTick, maxSteps: number): number {
  if (!Number.isSafeInteger(current) || current < 0) throw new TypeError('current must be a non-negative safe integer');
  if (!Number.isSafeInteger(target) || target < 0) throw new TypeError('target must be a non-negative safe integer');
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 0) throw new TypeError('maxSteps must be a non-negative safe integer');
  return Math.min(Math.max(0, target - current), maxSteps);
}

function normalizeTickClockOptions(options: RealtimeTickClockOptions): Required<RealtimeTickClockOptions> {
  const tickMs = options.tickMs !== undefined
    ? normalizeTickMs(options.tickMs)
    : normalizeTickRate(options.tickRate ?? 20);
  const tickRate = options.tickRate !== undefined ? options.tickRate : 1000 / tickMs;
  if (!Number.isFinite(tickRate) || tickRate <= 0) throw new TypeError('tickRate must be positive and finite');
  const startTick = options.startTick ?? 0;
  if (!Number.isSafeInteger(startTick) || startTick < 0) throw new TypeError('startTick must be a non-negative safe integer');
  const startTimeMs = options.startTimeMs ?? 0;
  if (!Number.isFinite(startTimeMs)) throw new TypeError('startTimeMs must be finite');
  return { tickRate, tickMs, startTick, startTimeMs };
}

function normalizeTickRate(tickRate: number): number {
  if (!Number.isFinite(tickRate) || tickRate <= 0) throw new TypeError('tickRate must be positive and finite');
  return 1000 / tickRate;
}

function normalizeTickMs(tickMs: number): number {
  if (!Number.isFinite(tickMs) || tickMs <= 0) throw new TypeError('tickMs must be positive and finite');
  return tickMs;
}
