export type RealtimeClientId = string;
export type RealtimeActorId = string;
export type RealtimeRoomId = string;
export type RealtimeCommandId = string;
export type RealtimeCommandSeq = number;
export type RealtimeTick = number;
export type RealtimeTimestampMs = number;

export interface RealtimeCommand<TPayload = unknown> {
  readonly clientId: RealtimeClientId;
  readonly seq: RealtimeCommandSeq;
  readonly type: string;
  readonly payload: TPayload;
  readonly id?: RealtimeCommandId;
  readonly actorId?: RealtimeActorId;
  readonly roomId?: RealtimeRoomId;
  readonly tick?: RealtimeTick;
  readonly timeMs?: RealtimeTimestampMs;
}

export interface RealtimeCommandAck {
  readonly clientId: RealtimeClientId;
  readonly seq: RealtimeCommandSeq;
  readonly commandId?: RealtimeCommandId;
}

export interface RealtimeCommandRejection {
  readonly clientId: RealtimeClientId;
  readonly seq: RealtimeCommandSeq;
  readonly reason: string;
  readonly commandId?: RealtimeCommandId;
}

export interface RealtimeSnapshot<TState = unknown> {
  readonly tick: RealtimeTick;
  readonly state: TState;
  readonly timeMs?: RealtimeTimestampMs;
  readonly lastCommandSeqByClient?: Readonly<Record<RealtimeClientId, RealtimeCommandSeq>>;
  readonly ack?: readonly RealtimeCommandAck[];
}

export interface RealtimeDelta<TPatch = unknown> {
  readonly tick: RealtimeTick;
  readonly patch: TPatch;
  readonly baseTick?: RealtimeTick;
  readonly timeMs?: RealtimeTimestampMs;
}

export type ApplyRealtimeCommand<
  TState,
  TCommand extends RealtimeCommand = RealtimeCommand
> = (state: TState, command: TCommand) => TState;

export interface RealtimeClientJoinMessage {
  readonly version: 1;
  readonly type: 'join';
  readonly roomId: RealtimeRoomId;
  readonly clientId: RealtimeClientId;
  readonly token?: string;
  readonly sessionId?: string;
  readonly resumeToken?: string;
  readonly lastSeenTick?: RealtimeTick;
}

export interface RealtimeClientCommandMessage<TCommand extends RealtimeCommand = RealtimeCommand> {
  readonly version: 1;
  readonly type: 'command';
  readonly command: TCommand;
  readonly roomId?: RealtimeRoomId;
}

export interface RealtimeClientLeaveMessage {
  readonly version: 1;
  readonly type: 'leave';
  readonly roomId?: RealtimeRoomId;
}

export interface RealtimeClientPongMessage {
  readonly version: 1;
  readonly type: 'pong';
  readonly nonce?: string;
  readonly timeMs?: RealtimeTimestampMs;
}

export type RealtimeClientMessage<TCommand extends RealtimeCommand = RealtimeCommand> =
  | RealtimeClientJoinMessage
  | RealtimeClientCommandMessage<TCommand>
  | RealtimeClientLeaveMessage
  | RealtimeClientPongMessage;

export interface RealtimeServerWelcomeMessage<TState = unknown> {
  readonly version: 1;
  readonly type: 'welcome';
  readonly clientId: RealtimeClientId;
  readonly roomId: RealtimeRoomId;
  readonly snapshot?: RealtimeSnapshot<TState>;
  readonly sessionId?: string;
  readonly resumeToken?: string;
  readonly resumed?: boolean;
  readonly lastSeenTick?: RealtimeTick;
}

export interface RealtimeServerSnapshotMessage<TState = unknown> {
  readonly version: 1;
  readonly type: 'snapshot';
  readonly snapshot: RealtimeSnapshot<TState>;
  readonly roomId?: RealtimeRoomId;
}

export interface RealtimeServerDeltaMessage<TPatch = unknown> {
  readonly version: 1;
  readonly type: 'delta';
  readonly delta: RealtimeDelta<TPatch>;
  readonly roomId?: RealtimeRoomId;
}

export interface RealtimeServerCommandAckMessage {
  readonly version: 1;
  readonly type: 'command-ack';
  readonly ack: RealtimeCommandAck;
}

export interface RealtimeServerCommandRejectMessage {
  readonly version: 1;
  readonly type: 'command-reject';
  readonly rejection: RealtimeCommandRejection;
}

export interface RealtimeServerPingMessage {
  readonly version: 1;
  readonly type: 'ping';
  readonly nonce?: string;
  readonly timeMs?: RealtimeTimestampMs;
}

export type RealtimeServerMessage<TState = unknown, TPatch = unknown> =
  | RealtimeServerWelcomeMessage<TState>
  | RealtimeServerSnapshotMessage<TState>
  | RealtimeServerDeltaMessage<TPatch>
  | RealtimeServerCommandAckMessage
  | RealtimeServerCommandRejectMessage
  | RealtimeServerPingMessage;
