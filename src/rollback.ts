import type {
  RealtimeClientId,
  RealtimeTick
} from './types.js';

export type RollbackFrame = RealtimeTick;
export type RollbackInputStatus = 'confirmed' | 'predicted';

export interface RollbackInput<TPayload = unknown> {
  readonly clientId: RealtimeClientId;
  readonly frame: RollbackFrame;
  readonly payload: TPayload;
  readonly seq?: number;
  readonly status?: RollbackInputStatus;
}

export interface RollbackFrameInputs<TPayload = unknown> {
  readonly frame: RollbackFrame;
  readonly inputs: readonly RollbackInput<TPayload>[];
  readonly predicted: boolean;
  readonly missing: readonly RealtimeClientId[];
}

export interface RollbackCheckpoint<TState = unknown> {
  readonly frame: RollbackFrame;
  readonly state: TState;
  readonly checksum?: string | number;
}

export interface RollbackStepContext<TEffect = unknown> {
  readonly frame: RollbackFrame;
  readonly replaying: boolean;
  emit(effect: TEffect): void;
}

export type RollbackInputPredictor<TPayload = unknown> = (
  clientId: RealtimeClientId,
  frame: RollbackFrame,
  previous: RollbackInput<TPayload> | null
) => TPayload;

export type RollbackInputEquals<TPayload = unknown> = (left: TPayload, right: TPayload) => boolean;

export type RollbackFrameStepper<TState, TPayload = unknown, TEffect = unknown> = (
  state: TState,
  frameInputs: RollbackFrameInputs<TPayload>,
  context: RollbackStepContext<TEffect>
) => TState;

export interface RollbackInputSourceOptions {
  readonly clientId: RealtimeClientId;
  readonly inputDelay?: number;
  readonly startSeq?: number;
}

export interface RollbackInputSource<TPayload = unknown> {
  readonly clientId: RealtimeClientId;
  readonly nextSeq: number;
  create(payload: TPayload, currentFrame: RollbackFrame): RollbackInput<TPayload>;
  reset(nextSeq?: number): void;
}

export interface RollbackInputLogOptions<TPayload = unknown> {
  readonly players: readonly RealtimeClientId[];
  readonly predictInput: RollbackInputPredictor<TPayload>;
  readonly inputEquals?: RollbackInputEquals<TPayload>;
  readonly maxPredictionFrames?: number;
}

export interface RollbackInputAddResult<TPayload = unknown> {
  readonly accepted: boolean;
  readonly corrected: boolean;
  readonly input: RollbackInput<TPayload>;
  readonly previous?: RollbackInput<TPayload>;
}

export interface RollbackInputLog<TPayload = unknown> {
  readonly players: readonly RealtimeClientId[];
  add(input: RollbackInput<TPayload>): RollbackInputAddResult<TPayload>;
  read(clientId: RealtimeClientId, frame: RollbackFrame): RollbackInput<TPayload> | null;
  readFrame(frame: RollbackFrame): RollbackFrameInputs<TPayload>;
  confirmedFrame(startFrame?: RollbackFrame, endFrame?: RollbackFrame): RollbackFrame;
  predictedFrames(startFrame?: RollbackFrame, endFrame?: RollbackFrame): RollbackFrame[];
  clearBefore(frame: RollbackFrame): void;
}

export interface RollbackSessionOptions<TState, TPayload = unknown, TEffect = unknown> {
  readonly initialState: TState;
  readonly players: readonly RealtimeClientId[];
  readonly stepFrame: RollbackFrameStepper<TState, TPayload, TEffect>;
  readonly initialFrame?: RollbackFrame;
  readonly inputDelay?: number;
  readonly checkpointInterval?: number;
  readonly maxRollbackFrames?: number;
  readonly maxPredictionFrames?: number;
  readonly cloneState?: (state: TState) => TState;
  readonly checksum?: (state: TState) => string | number;
  readonly predictInput?: RollbackInputPredictor<TPayload>;
  readonly inputEquals?: RollbackInputEquals<TPayload>;
}

export interface RollbackAdvanceResult<TState, TPayload = unknown, TEffect = unknown> {
  readonly frame: RollbackFrame;
  readonly state: TState;
  readonly inputs: RollbackFrameInputs<TPayload>;
  readonly effects: readonly TEffect[];
}

export interface RollbackCorrectionResult<TState, TPayload = unknown> {
  readonly corrected: boolean;
  readonly fromFrame: RollbackFrame;
  readonly toFrame: RollbackFrame;
  readonly replayed: number;
  readonly state: TState;
  readonly input: RollbackInput<TPayload>;
}

export interface RollbackSession<TState, TPayload = unknown, TEffect = unknown> {
  readonly frame: RollbackFrame;
  readonly state: TState;
  readonly inputLog: RollbackInputLog<TPayload>;
  readonly checkpoints: readonly RollbackCheckpoint<TState>[];
  readonly confirmedFrame: RollbackFrame;
  readonly predictedFrames: readonly RollbackFrame[];
  addLocalInput(payload: TPayload, currentFrame?: RollbackFrame): RollbackInput<TPayload>;
  addRemoteInput(input: RollbackInput<TPayload>): RollbackCorrectionResult<TState, TPayload>;
  advance(count?: number): RollbackAdvanceResult<TState, TPayload, TEffect>[];
  rollbackTo(frame: RollbackFrame): RollbackCorrectionResult<TState, TPayload>;
  saveCheckpoint(frame?: RollbackFrame): RollbackCheckpoint<TState>;
  checksum(frame?: RollbackFrame): string | number | undefined;
}

export function createRollbackInputSource<TPayload = unknown>(
  options: RollbackInputSourceOptions
): RollbackInputSource<TPayload> {
  if (typeof options.clientId !== 'string' || options.clientId.length === 0) throw new TypeError('clientId must be a non-empty string');
  const inputDelay = readNonNegativeInteger(options.inputDelay ?? 0, 'inputDelay');
  let nextSeq = readNonNegativeInteger(options.startSeq ?? 1, 'startSeq');
  return {
    get clientId() {
      return options.clientId;
    },
    get nextSeq() {
      return nextSeq;
    },
    create(payload, currentFrame) {
      const frame = readNonNegativeInteger(currentFrame, 'currentFrame') + inputDelay;
      return {
        clientId: options.clientId,
        frame,
        payload,
        seq: nextSeq++,
        status: 'confirmed'
      };
    },
    reset(seq = 1) {
      nextSeq = readNonNegativeInteger(seq, 'nextSeq');
    }
  };
}

export function createRollbackInputLog<TPayload = unknown>(
  options: RollbackInputLogOptions<TPayload>
): RollbackInputLog<TPayload> {
  const players = normalizePlayers(options.players);
  const predictInput = options.predictInput;
  const inputEquals = options.inputEquals ?? defaultInputEquals;
  const maxPredictionFrames = options.maxPredictionFrames ?? 8;
  const inputs = new Map<string, RollbackInput<TPayload>>();

  function read(clientId: string, frame: number): RollbackInput<TPayload> | null {
    return inputs.get(inputKey(clientId, frame)) ?? null;
  }

  function add(input: RollbackInput<TPayload>): RollbackInputAddResult<TPayload> {
    const normalized = normalizeInput(input, players);
    const key = inputKey(normalized.clientId, normalized.frame);
    const previous = inputs.get(key);
    const corrected = previous?.status === 'predicted' && !inputEquals(previous.payload, normalized.payload);
    if (previous?.status === 'confirmed' && inputEquals(previous.payload, normalized.payload)) {
      return { accepted: true, corrected: false, input: previous, previous };
    }
    inputs.set(key, { ...normalized, status: 'confirmed' });
    return { accepted: true, corrected, input: normalized, previous };
  }

  function readFrame(frame: number): RollbackFrameInputs<TPayload> {
    const normalizedFrame = readNonNegativeInteger(frame, 'frame');
    const out: RollbackInput<TPayload>[] = [];
    const missing: string[] = [];
    let predicted = false;
    for (const clientId of players) {
      const existing = read(clientId, normalizedFrame);
      if (existing) {
        out.push(existing);
        if (existing.status === 'predicted') predicted = true;
        continue;
      }
      const previous = previousInput(clientId, normalizedFrame);
      if (previous && normalizedFrame - previous.frame > maxPredictionFrames) {
        missing.push(clientId);
        predicted = true;
      }
      const generated: RollbackInput<TPayload> = {
        clientId,
        frame: normalizedFrame,
        payload: predictInput(clientId, normalizedFrame, previous),
        status: 'predicted'
      };
      inputs.set(inputKey(clientId, normalizedFrame), generated);
      out.push(generated);
      predicted = true;
    }
    return { frame: normalizedFrame, inputs: out, predicted, missing };
  }

  function confirmedFrame(startFrame = 0, endFrame = Number.MAX_SAFE_INTEGER): number {
    let frame = readNonNegativeInteger(startFrame, 'startFrame');
    const end = readNonNegativeInteger(endFrame, 'endFrame');
    outer:
    while (frame <= end) {
      for (const player of players) {
        const input = read(player, frame);
        if (!input || input.status !== 'confirmed') break outer;
      }
      frame++;
    }
    return frame - 1;
  }

  function predictedFrames(startFrame = 0, endFrame = Number.MAX_SAFE_INTEGER): number[] {
    const start = readNonNegativeInteger(startFrame, 'startFrame');
    const end = readNonNegativeInteger(endFrame, 'endFrame');
    const out: number[] = [];
    for (let frame = start; frame <= end; frame++) {
      if (players.some((player) => read(player, frame)?.status === 'predicted')) out.push(frame);
    }
    return out;
  }

  function clearBefore(frame: number): void {
    const min = readNonNegativeInteger(frame, 'frame');
    for (const [key, input] of inputs) {
      if (input.frame < min) inputs.delete(key);
    }
  }

  function previousInput(clientId: string, beforeFrame: number): RollbackInput<TPayload> | null {
    for (let frame = beforeFrame - 1; frame >= 0; frame--) {
      const input = read(clientId, frame);
      if (input) return input;
    }
    return null;
  }

  return {
    players,
    add,
    read,
    readFrame,
    confirmedFrame,
    predictedFrames,
    clearBefore
  };
}

export function createRollbackSession<TState, TPayload = unknown, TEffect = unknown>(
  options: RollbackSessionOptions<TState, TPayload, TEffect>
): RollbackSession<TState, TPayload, TEffect> {
  const players = normalizePlayers(options.players);
  const initialFrame = readNonNegativeInteger(options.initialFrame ?? 0, 'initialFrame');
  const inputDelay = readNonNegativeInteger(options.inputDelay ?? 0, 'inputDelay');
  const checkpointInterval = Math.max(1, readNonNegativeInteger(options.checkpointInterval ?? 1, 'checkpointInterval'));
  const maxRollbackFrames = Math.max(1, readNonNegativeInteger(options.maxRollbackFrames ?? 120, 'maxRollbackFrames'));
  const cloneState = options.cloneState ?? ((state: TState) => state);
  const predictInput = options.predictInput ?? defaultPredictInput<TPayload>;
  const inputLog = createRollbackInputLog<TPayload>({
    players,
    predictInput,
    inputEquals: options.inputEquals,
    maxPredictionFrames: options.maxPredictionFrames
  });
  const localSource = createRollbackInputSource<TPayload>({
    clientId: players[0],
    inputDelay
  });
  let frame = initialFrame;
  let state = cloneState(options.initialState);
  let checkpoints: RollbackCheckpoint<TState>[] = [makeCheckpoint(frame, state)];

  function makeCheckpoint(checkpointFrame: number, checkpointState: TState): RollbackCheckpoint<TState> {
    const copy = cloneState(checkpointState);
    return {
      frame: checkpointFrame,
      state: copy,
      checksum: options.checksum?.(copy)
    };
  }

  function saveCheckpoint(checkpointFrame = frame): RollbackCheckpoint<TState> {
    const checkpoint = makeCheckpoint(readNonNegativeInteger(checkpointFrame, 'frame'), state);
    checkpoints = insertCheckpoint(checkpoints, checkpoint, maxRollbackFrames);
    return checkpoint;
  }

  function simulate(targetFrame: number, replaying: boolean): RollbackAdvanceResult<TState, TPayload, TEffect> {
    const inputs = inputLog.readFrame(targetFrame);
    const effects: TEffect[] = [];
    const context: RollbackStepContext<TEffect> = {
      frame: targetFrame,
      replaying,
      emit(effect) {
        if (!replaying) effects.push(effect);
      }
    };
    state = options.stepFrame(state, inputs, context);
    frame = targetFrame;
    if (frame % checkpointInterval === 0 || frame === initialFrame) saveCheckpoint(frame);
    trimRollbackHistory();
    return { frame, state, inputs, effects };
  }

  function replayFrom(fromFrame: number, toFrame: number): number {
    const checkpoint = checkpointAtOrBefore(checkpoints, fromFrame - 1) ?? checkpoints[0];
    state = cloneState(checkpoint.state);
    frame = checkpoint.frame;
    let replayed = 0;
    for (let nextFrame = checkpoint.frame + 1; nextFrame <= toFrame; nextFrame++) {
      simulate(nextFrame, true);
      replayed++;
    }
    return replayed;
  }

  function trimRollbackHistory(): void {
    const minFrame = Math.max(0, frame - maxRollbackFrames);
    checkpoints = checkpoints.filter((checkpoint, index) => checkpoint.frame >= minFrame || index === 0);
    inputLog.clearBefore(minFrame);
  }

  const session: RollbackSession<TState, TPayload, TEffect> = {
    get frame() {
      return frame;
    },
    get state() {
      return state;
    },
    inputLog,
    get checkpoints() {
      return checkpoints;
    },
    get confirmedFrame() {
      return inputLog.confirmedFrame(initialFrame + 1, frame);
    },
    get predictedFrames() {
      return inputLog.predictedFrames(initialFrame + 1, frame);
    },
    addLocalInput(payload, currentFrame = frame) {
      const input = localSource.create(payload, currentFrame);
      inputLog.add(input);
      return input;
    },
    addRemoteInput(input) {
      const added = inputLog.add(input);
      if (!added.corrected || added.input.frame > frame) {
        return {
          corrected: added.corrected,
          fromFrame: added.input.frame,
          toFrame: frame,
          replayed: 0,
          state,
          input: added.input
        };
      }
      const toFrame = frame;
      const replayed = replayFrom(added.input.frame, toFrame);
      return {
        corrected: true,
        fromFrame: added.input.frame,
        toFrame,
        replayed,
        state,
        input: added.input
      };
    },
    advance(count = 1) {
      const steps = readNonNegativeInteger(count, 'count');
      const results: RollbackAdvanceResult<TState, TPayload, TEffect>[] = [];
      for (let index = 0; index < steps; index++) results.push(simulate(frame + 1, false));
      return results;
    },
    rollbackTo(targetFrame) {
      const normalized = readNonNegativeInteger(targetFrame, 'frame');
      const toFrame = frame;
      if (normalized > toFrame) throw new RangeError('rollback frame must be <= current frame');
      const replayed = replayFrom(normalized, toFrame);
      return {
        corrected: true,
        fromFrame: normalized,
        toFrame,
        replayed,
        state,
        input: inputLog.read(players[0], normalized) ?? {
          clientId: players[0],
          frame: normalized,
          payload: undefined as TPayload,
          status: 'predicted'
        }
      };
    },
    saveCheckpoint,
    checksum(targetFrame = frame) {
      const checkpoint = checkpoints.find((entry) => entry.frame === targetFrame);
      if (checkpoint) return checkpoint.checksum;
      return targetFrame === frame ? options.checksum?.(state) : undefined;
    }
  };

  return session;
}

function normalizeInput<TPayload>(
  input: RollbackInput<TPayload>,
  players: readonly string[]
): RollbackInput<TPayload> {
  if (!players.includes(input.clientId)) throw new RangeError('rollback input clientId is not in the session player list');
  return {
    clientId: input.clientId,
    frame: readNonNegativeInteger(input.frame, 'input.frame'),
    payload: input.payload,
    seq: input.seq === undefined ? undefined : readNonNegativeInteger(input.seq, 'input.seq'),
    status: input.status === 'predicted' ? 'predicted' : 'confirmed'
  };
}

function insertCheckpoint<TState>(
  checkpoints: readonly RollbackCheckpoint<TState>[],
  checkpoint: RollbackCheckpoint<TState>,
  maxRollbackFrames: number
): RollbackCheckpoint<TState>[] {
  const next = checkpoints.filter((entry) => entry.frame !== checkpoint.frame);
  const index = next.findIndex((entry) => entry.frame > checkpoint.frame);
  if (index < 0) next.push(checkpoint);
  else next.splice(index, 0, checkpoint);
  const minFrame = Math.max(0, checkpoint.frame - maxRollbackFrames);
  return next.filter((entry, entryIndex) => entry.frame >= minFrame || entryIndex === 0);
}

function checkpointAtOrBefore<TState>(
  checkpoints: readonly RollbackCheckpoint<TState>[],
  frame: number
): RollbackCheckpoint<TState> | null {
  let found: RollbackCheckpoint<TState> | null = null;
  for (const checkpoint of checkpoints) {
    if (checkpoint.frame <= frame) found = checkpoint;
    else break;
  }
  return found;
}

function normalizePlayers(players: readonly string[]): readonly string[] {
  if (!Array.isArray(players) || players.length === 0) throw new TypeError('players must be a non-empty array');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const player of players) {
    if (typeof player !== 'string' || player.length === 0) throw new TypeError('player ids must be non-empty strings');
    if (seen.has(player)) throw new TypeError('player ids must be unique');
    seen.add(player);
    out.push(player);
  }
  return Object.freeze(out);
}

function readNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(name + ' must be a non-negative safe integer');
  return value;
}

function inputKey(clientId: string, frame: number): string {
  return clientId + ':' + frame;
}

function defaultPredictInput<TPayload>(_clientId: string, _frame: number, previous: RollbackInput<TPayload> | null): TPayload {
  if (!previous) throw new RangeError('missing rollback input and no previous input is available for prediction');
  return previous.payload;
}

function defaultInputEquals<TPayload>(left: TPayload, right: TPayload): boolean {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}
