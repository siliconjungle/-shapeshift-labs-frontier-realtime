import { compareCommands, normalizeCommand } from './command.js';
import type {
  ApplyRealtimeCommand,
  RealtimeClientId,
  RealtimeCommand,
  RealtimeCommandAck,
  RealtimeCommandRejection,
  RealtimeSnapshot
} from './types.js';

export interface ReconcileSnapshotOptions {
  clientId?: RealtimeClientId;
}

export interface ReconcileSnapshotResult<TState, TCommand extends RealtimeCommand = RealtimeCommand> {
  readonly snapshot: RealtimeSnapshot<TState>;
  readonly state: TState;
  readonly pending: TCommand[];
  readonly acknowledged: number;
  readonly replayed: number;
}

export interface RealtimePredictionStateOptions<TState, TCommand extends RealtimeCommand = RealtimeCommand> {
  clientId: RealtimeClientId;
  snapshot: RealtimeSnapshot<TState>;
  applyCommand: ApplyRealtimeCommand<TState, TCommand>;
  maxPending?: number;
}

export interface RealtimePredictionState<TState, TCommand extends RealtimeCommand = RealtimeCommand> {
  readonly clientId: RealtimeClientId;
  readonly state: TState;
  readonly latestSnapshot: RealtimeSnapshot<TState>;
  readonly pending: readonly TCommand[];
  predict(command: TCommand): TState;
  acceptSnapshot(snapshot: RealtimeSnapshot<TState>): ReconcileSnapshotResult<TState, TCommand>;
  reject(rejection: RealtimeCommandRejection): ReconcileSnapshotResult<TState, TCommand>;
  clear(snapshot?: RealtimeSnapshot<TState>): void;
}

export function reconcileSnapshot<TState, TCommand extends RealtimeCommand = RealtimeCommand>(
  snapshot: RealtimeSnapshot<TState>,
  pending: readonly TCommand[],
  applyCommand: ApplyRealtimeCommand<TState, TCommand>,
  options: ReconcileSnapshotOptions = {}
): ReconcileSnapshotResult<TState, TCommand> {
  const normalizedSnapshot = normalizeSnapshot(snapshot);
  const remaining: TCommand[] = [];
  let acknowledged = 0;

  for (const command of sortedCommands(pending)) {
    const normalized = normalizeCommand(command);
    if (isCommandAcknowledged(normalized, normalizedSnapshot, options.clientId)) {
      acknowledged++;
    } else {
      remaining.push(normalized);
    }
  }

  let state = normalizedSnapshot.state;
  for (let index = 0; index < remaining.length; index++) state = applyCommand(state, remaining[index]);

  return {
    snapshot: normalizedSnapshot,
    state,
    pending: remaining,
    acknowledged,
    replayed: remaining.length
  };
}

export function createPredictionState<TState, TCommand extends RealtimeCommand = RealtimeCommand>(
  options: RealtimePredictionStateOptions<TState, TCommand>
): RealtimePredictionState<TState, TCommand> {
  if (typeof options.clientId !== 'string' || options.clientId.length === 0) {
    throw new TypeError('clientId must be a non-empty string');
  }
  const maxPending = options.maxPending ?? 1024;
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) throw new TypeError('maxPending must be a positive safe integer');

  let latestSnapshot = normalizeSnapshot(options.snapshot);
  let pending: TCommand[] = [];
  let state = latestSnapshot.state;

  function replay(): ReconcileSnapshotResult<TState, TCommand> {
    const result = reconcileSnapshot(latestSnapshot, pending, options.applyCommand, { clientId: options.clientId });
    pending = result.pending;
    state = result.state;
    return result;
  }

  return {
    get clientId() {
      return options.clientId;
    },
    get state() {
      return state;
    },
    get latestSnapshot() {
      return latestSnapshot;
    },
    get pending() {
      return pending;
    },
    predict(command: TCommand): TState {
      const normalized = normalizeCommand(command);
      if (normalized.clientId !== options.clientId) throw new TypeError('predicted command clientId does not match prediction state');
      if (pending.length >= maxPending) throw new RangeError('maxPending exceeded');
      pending = insertCommand(pending, normalized);
      state = options.applyCommand(state, normalized);
      return state;
    },
    acceptSnapshot(snapshot: RealtimeSnapshot<TState>): ReconcileSnapshotResult<TState, TCommand> {
      latestSnapshot = normalizeSnapshot(snapshot);
      return replay();
    },
    reject(rejection: RealtimeCommandRejection): ReconcileSnapshotResult<TState, TCommand> {
      pending = pending.filter((command) => !matchesRejection(command, rejection));
      return replay();
    },
    clear(snapshot?: RealtimeSnapshot<TState>) {
      if (snapshot !== undefined) latestSnapshot = normalizeSnapshot(snapshot);
      pending = [];
      state = latestSnapshot.state;
    }
  };
}

export function getSnapshotAckSeq(snapshot: RealtimeSnapshot, clientId: RealtimeClientId): number | null {
  const mapSeq = snapshot.lastCommandSeqByClient?.[clientId];
  let maxSeq = typeof mapSeq === 'number' && Number.isSafeInteger(mapSeq) ? mapSeq : null;
  const acknowledgements = snapshot.ack;
  if (acknowledgements) {
    for (let index = 0; index < acknowledgements.length; index++) {
      const ack = acknowledgements[index];
      if (ack.clientId === clientId && Number.isSafeInteger(ack.seq)) {
        maxSeq = maxSeq === null ? ack.seq : Math.max(maxSeq, ack.seq);
      }
    }
  }
  return maxSeq;
}

export function normalizeSnapshot<TState>(snapshot: RealtimeSnapshot<TState>): RealtimeSnapshot<TState> {
  if (typeof snapshot !== 'object' || snapshot === null) throw new TypeError('snapshot must be an object');
  if (!Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0) throw new TypeError('snapshot.tick must be a non-negative safe integer');
  if (snapshot.timeMs !== undefined && !Number.isFinite(snapshot.timeMs)) throw new TypeError('snapshot.timeMs must be finite');
  const lastCommandSeqByClient = snapshot.lastCommandSeqByClient
    ? normalizeAckMap(snapshot.lastCommandSeqByClient)
    : undefined;
  const ack = snapshot.ack ? normalizeAckList(snapshot.ack) : undefined;
  return {
    tick: snapshot.tick,
    timeMs: snapshot.timeMs,
    state: snapshot.state,
    lastCommandSeqByClient,
    ack
  };
}

function isCommandAcknowledged(command: RealtimeCommand, snapshot: RealtimeSnapshot, localClientId?: string): boolean {
  if (localClientId !== undefined && command.clientId !== localClientId) return false;
  const ackSeq = getSnapshotAckSeq(snapshot, command.clientId);
  return ackSeq !== null && command.seq <= ackSeq;
}

function insertCommand<TCommand extends RealtimeCommand>(pending: readonly TCommand[], command: TCommand): TCommand[] {
  const next = pending.slice();
  const key = command.clientId + ':' + command.seq;
  for (let index = 0; index < next.length; index++) {
    if (next[index].clientId + ':' + next[index].seq === key) {
      next[index] = command;
      next.sort(compareCommands);
      return next;
    }
  }
  next.push(command);
  next.sort(compareCommands);
  return next;
}

function sortedCommands<TCommand extends RealtimeCommand>(commands: readonly TCommand[]): TCommand[] {
  const sorted = commands.slice();
  sorted.sort(compareCommands);
  return sorted;
}

function matchesRejection(command: RealtimeCommand, rejection: RealtimeCommandRejection): boolean {
  if (command.clientId !== rejection.clientId || command.seq !== rejection.seq) return false;
  return rejection.commandId === undefined || command.id === rejection.commandId;
}

function normalizeAckMap(map: Readonly<Record<string, number>>): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const key of Object.keys(map)) {
    const seq = map[key];
    if (!Number.isSafeInteger(seq) || seq < 0) throw new TypeError('lastCommandSeqByClient values must be non-negative safe integers');
    normalized[key] = seq;
  }
  return normalized;
}

function normalizeAckList(acknowledgements: readonly RealtimeCommandAck[]): RealtimeCommandAck[] {
  const normalized = new Array<RealtimeCommandAck>(acknowledgements.length);
  for (let index = 0; index < acknowledgements.length; index++) {
    const ack = acknowledgements[index];
    if (typeof ack !== 'object' || ack === null) throw new TypeError('ack entries must be objects');
    if (typeof ack.clientId !== 'string' || ack.clientId.length === 0) throw new TypeError('ack.clientId must be a non-empty string');
    if (!Number.isSafeInteger(ack.seq) || ack.seq < 0) throw new TypeError('ack.seq must be a non-negative safe integer');
    normalized[index] = ack.commandId === undefined
      ? { clientId: ack.clientId, seq: ack.seq }
      : { clientId: ack.clientId, seq: ack.seq, commandId: ack.commandId };
  }
  return normalized;
}
