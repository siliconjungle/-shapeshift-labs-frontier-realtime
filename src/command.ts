import type {
  RealtimeActorId,
  RealtimeClientId,
  RealtimeCommand,
  RealtimeCommandId,
  RealtimeCommandSeq,
  RealtimeRoomId,
  RealtimeTick,
  RealtimeTimestampMs
} from './types.js';

export interface RealtimeCommandSourceOptions {
  clientId: RealtimeClientId;
  startSeq?: RealtimeCommandSeq;
  now?: () => RealtimeTimestampMs;
  makeId?: (clientId: RealtimeClientId, seq: RealtimeCommandSeq, type: string) => RealtimeCommandId;
}

export interface RealtimeCommandCreateOptions {
  actorId?: RealtimeActorId;
  roomId?: RealtimeRoomId;
  tick?: RealtimeTick;
  timeMs?: RealtimeTimestampMs;
  id?: RealtimeCommandId;
}

export interface RealtimeCommandSource {
  readonly clientId: RealtimeClientId;
  readonly nextSeq: RealtimeCommandSeq;
  create<TPayload>(
    type: string,
    payload: TPayload,
    options?: RealtimeCommandCreateOptions
  ): RealtimeCommand<TPayload>;
  reset(nextSeq?: RealtimeCommandSeq): void;
}

export function createCommandSource(options: RealtimeCommandSourceOptions): RealtimeCommandSource {
  if (!isNonEmptyString(options.clientId)) throw new TypeError('clientId must be a non-empty string');
  const now = options.now ?? Date.now;
  const makeId = options.makeId ?? defaultCommandId;
  let nextSeq = normalizeSeq(options.startSeq ?? 1, 'startSeq');

  return {
    get clientId() {
      return options.clientId;
    },
    get nextSeq() {
      return nextSeq;
    },
    create<TPayload>(
      type: string,
      payload: TPayload,
      createOptions: RealtimeCommandCreateOptions = {}
    ): RealtimeCommand<TPayload> {
      if (!isNonEmptyString(type)) throw new TypeError('command type must be a non-empty string');
      const seq = nextSeq++;
      return normalizeCommand({
        clientId: options.clientId,
        seq,
        type,
        payload,
        id: createOptions.id ?? makeId(options.clientId, seq, type),
        actorId: createOptions.actorId,
        roomId: createOptions.roomId,
        tick: createOptions.tick,
        timeMs: createOptions.timeMs ?? now()
      });
    },
    reset(seq = 1) {
      nextSeq = normalizeSeq(seq, 'nextSeq');
    }
  };
}

export function normalizeCommand<TCommand extends RealtimeCommand>(command: TCommand): TCommand {
  if (!isRecord(command)) throw new TypeError('command must be an object');
  if (!isNonEmptyString(command.clientId)) throw new TypeError('command.clientId must be a non-empty string');
  normalizeSeq(command.seq, 'command.seq');
  if (!isNonEmptyString(command.type)) throw new TypeError('command.type must be a non-empty string');
  if (command.id !== undefined && !isNonEmptyString(command.id)) throw new TypeError('command.id must be a non-empty string');
  if (command.actorId !== undefined && !isNonEmptyString(command.actorId)) throw new TypeError('command.actorId must be a non-empty string');
  if (command.roomId !== undefined && !isNonEmptyString(command.roomId)) throw new TypeError('command.roomId must be a non-empty string');
  if (command.tick !== undefined) normalizeNonNegativeInteger(command.tick, 'command.tick');
  if (command.timeMs !== undefined) normalizeFiniteNumber(command.timeMs, 'command.timeMs');
  return { ...command };
}

export function compareCommands(left: RealtimeCommand, right: RealtimeCommand): number {
  if (left.seq !== right.seq) return left.seq - right.seq;
  if (left.clientId < right.clientId) return -1;
  if (left.clientId > right.clientId) return 1;
  if (left.type < right.type) return -1;
  if (left.type > right.type) return 1;
  return 0;
}

export function commandKey(command: Pick<RealtimeCommand, 'clientId' | 'seq'>): string {
  return command.clientId + ':' + command.seq;
}

export function normalizeSeq(value: number, name = 'seq'): number {
  return normalizeNonNegativeInteger(value, name);
}

function defaultCommandId(clientId: string, seq: number, type: string): string {
  return clientId + ':' + seq + ':' + type;
}

function normalizeNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(name + ' must be a non-negative safe integer');
  return value;
}

function normalizeFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new TypeError(name + ' must be finite');
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
