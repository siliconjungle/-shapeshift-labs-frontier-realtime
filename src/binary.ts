import { validateRealtimeMessageEnvelope } from './messages.js';
import type {
  RealtimeClientMessage,
  RealtimeCommand,
  RealtimeDelta,
  RealtimeServerMessage,
  RealtimeSnapshot
} from './types.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAGIC_0 = 0x46; // F
const MAGIC_1 = 0x52; // R
const MAGIC_2 = 0x54; // T
const MAGIC_3 = 0x31; // 1

const enum Tag {
  Join = 1,
  Command = 2,
  Leave = 3,
  Pong = 4,
  Welcome = 16,
  Snapshot = 17,
  Delta = 18,
  CommandAck = 19,
  CommandReject = 20,
  Ping = 21
}

export function encodeRealtimeBinaryMessage(message: RealtimeClientMessage | RealtimeServerMessage): Uint8Array {
  validateRealtimeMessageEnvelope(message);
  const writer = new BinaryWriter();
  writer.u8(MAGIC_0);
  writer.u8(MAGIC_1);
  writer.u8(MAGIC_2);
  writer.u8(MAGIC_3);

  switch (message.type) {
    case 'join':
      writer.u8(Tag.Join);
      writeString(writer, message.roomId);
      writeString(writer, message.clientId);
      writeOptionalString(writer, message.token);
      writeOptionalString(writer, message.sessionId);
      writeOptionalString(writer, message.resumeToken);
      writeOptionalNumber(writer, message.lastSeenTick);
      break;
    case 'command':
      writer.u8(Tag.Command);
      writeOptionalString(writer, message.roomId);
      writeCommand(writer, message.command);
      break;
    case 'leave':
      writer.u8(Tag.Leave);
      writeOptionalString(writer, message.roomId);
      break;
    case 'pong':
      writer.u8(Tag.Pong);
      writeOptionalString(writer, message.nonce);
      writeOptionalNumber(writer, message.timeMs);
      break;
    case 'welcome':
      writer.u8(Tag.Welcome);
      writeString(writer, message.clientId);
      writeString(writer, message.roomId);
      writeOptionalJson(writer, message.snapshot);
      writeOptionalString(writer, message.sessionId);
      writeOptionalString(writer, message.resumeToken);
      writer.u8(message.resumed === true ? 1 : 0);
      writeOptionalNumber(writer, message.lastSeenTick);
      break;
    case 'snapshot':
      writer.u8(Tag.Snapshot);
      writeOptionalString(writer, message.roomId);
      writeSnapshot(writer, message.snapshot);
      break;
    case 'delta':
      writer.u8(Tag.Delta);
      writeOptionalString(writer, message.roomId);
      writeDelta(writer, message.delta);
      break;
    case 'command-ack':
      writer.u8(Tag.CommandAck);
      writeString(writer, message.ack.clientId);
      writer.varint(message.ack.seq);
      writeOptionalString(writer, message.ack.commandId);
      break;
    case 'command-reject':
      writer.u8(Tag.CommandReject);
      writeString(writer, message.rejection.clientId);
      writer.varint(message.rejection.seq);
      writeString(writer, message.rejection.reason);
      writeOptionalString(writer, message.rejection.commandId);
      break;
    case 'ping':
      writer.u8(Tag.Ping);
      writeOptionalString(writer, message.nonce);
      writeOptionalNumber(writer, message.timeMs);
      break;
  }

  return writer.finish();
}

export function decodeRealtimeBinaryMessage(data: ArrayBuffer | ArrayBufferView): RealtimeClientMessage | RealtimeServerMessage {
  const reader = new BinaryReader(data);
  if (reader.u8() !== MAGIC_0 || reader.u8() !== MAGIC_1 || reader.u8() !== MAGIC_2 || reader.u8() !== MAGIC_3) {
    throw new TypeError('invalid Frontier realtime binary frame');
  }

  let message: RealtimeClientMessage | RealtimeServerMessage;
  switch (reader.u8()) {
    case Tag.Join:
      message = {
        version: 1,
        type: 'join',
        roomId: readString(reader),
        clientId: readString(reader),
        token: readOptionalString(reader),
        sessionId: readOptionalString(reader),
        resumeToken: readOptionalString(reader),
        lastSeenTick: readOptionalNumber(reader)
      };
      break;
    case Tag.Command:
      message = { version: 1, type: 'command', roomId: readOptionalString(reader), command: readCommand(reader) };
      break;
    case Tag.Leave:
      message = { version: 1, type: 'leave', roomId: readOptionalString(reader) };
      break;
    case Tag.Pong:
      message = { version: 1, type: 'pong', nonce: readOptionalString(reader), timeMs: readOptionalNumber(reader) };
      break;
    case Tag.Welcome:
      message = {
        version: 1,
        type: 'welcome',
        clientId: readString(reader),
        roomId: readString(reader),
        snapshot: readOptionalJson(reader) as RealtimeSnapshot | undefined,
        sessionId: readOptionalString(reader),
        resumeToken: readOptionalString(reader),
        resumed: reader.u8() === 1,
        lastSeenTick: readOptionalNumber(reader)
      };
      break;
    case Tag.Snapshot:
      message = { version: 1, type: 'snapshot', roomId: readOptionalString(reader), snapshot: readSnapshot(reader) };
      break;
    case Tag.Delta:
      message = { version: 1, type: 'delta', roomId: readOptionalString(reader), delta: readDelta(reader) };
      break;
    case Tag.CommandAck:
      message = {
        version: 1,
        type: 'command-ack',
        ack: { clientId: readString(reader), seq: reader.varint(), commandId: readOptionalString(reader) }
      };
      break;
    case Tag.CommandReject:
      message = {
        version: 1,
        type: 'command-reject',
        rejection: {
          clientId: readString(reader),
          seq: reader.varint(),
          reason: readString(reader),
          commandId: readOptionalString(reader)
        }
      };
      break;
    case Tag.Ping:
      message = { version: 1, type: 'ping', nonce: readOptionalString(reader), timeMs: readOptionalNumber(reader) };
      break;
    default:
      throw new TypeError('unknown Frontier realtime binary message tag');
  }

  reader.done();
  validateRealtimeMessageEnvelope(message);
  return message;
}

export function isRealtimeBinaryMessage(data: unknown): boolean {
  if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return false;
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return bytes.length >= 4 &&
    bytes[0] === MAGIC_0 &&
    bytes[1] === MAGIC_1 &&
    bytes[2] === MAGIC_2 &&
    bytes[3] === MAGIC_3;
}

function writeCommand(writer: BinaryWriter, command: RealtimeCommand): void {
  writeString(writer, command.clientId);
  writer.varint(command.seq);
  writeString(writer, command.type);
  writeJson(writer, command.payload);
  writeOptionalString(writer, command.id);
  writeOptionalString(writer, command.actorId);
  writeOptionalString(writer, command.roomId);
  writeOptionalNumber(writer, command.tick);
  writeOptionalNumber(writer, command.timeMs);
}

function readCommand(reader: BinaryReader): RealtimeCommand {
  return {
    clientId: readString(reader),
    seq: reader.varint(),
    type: readString(reader),
    payload: readJson(reader),
    id: readOptionalString(reader),
    actorId: readOptionalString(reader),
    roomId: readOptionalString(reader),
    tick: readOptionalNumber(reader),
    timeMs: readOptionalNumber(reader)
  };
}

function writeSnapshot(writer: BinaryWriter, snapshot: RealtimeSnapshot): void {
  writer.varint(snapshot.tick);
  writeOptionalNumber(writer, snapshot.timeMs);
  writeJson(writer, snapshot.state);
  writeOptionalJson(writer, snapshot.lastCommandSeqByClient);
  writeOptionalJson(writer, snapshot.ack);
}

function readSnapshot(reader: BinaryReader): RealtimeSnapshot {
  return {
    tick: reader.varint(),
    timeMs: readOptionalNumber(reader),
    state: readJson(reader),
    lastCommandSeqByClient: readOptionalJson(reader) as RealtimeSnapshot['lastCommandSeqByClient'],
    ack: readOptionalJson(reader) as RealtimeSnapshot['ack']
  };
}

function writeDelta(writer: BinaryWriter, delta: RealtimeDelta): void {
  writer.varint(delta.tick);
  writeOptionalNumber(writer, delta.baseTick);
  writeOptionalNumber(writer, delta.timeMs);
  writeJson(writer, delta.patch);
}

function readDelta(reader: BinaryReader): RealtimeDelta {
  return {
    tick: reader.varint(),
    baseTick: readOptionalNumber(reader),
    timeMs: readOptionalNumber(reader),
    patch: readJson(reader)
  };
}

function writeOptionalString(writer: BinaryWriter, value: string | undefined): void {
  writer.u8(value === undefined ? 0 : 1);
  if (value !== undefined) writeString(writer, value);
}

function readOptionalString(reader: BinaryReader): string | undefined {
  return reader.u8() === 0 ? undefined : readString(reader);
}

function writeOptionalNumber(writer: BinaryWriter, value: number | undefined): void {
  writer.u8(value === undefined ? 0 : 1);
  if (value !== undefined) writer.float64(value);
}

function readOptionalNumber(reader: BinaryReader): number | undefined {
  return reader.u8() === 0 ? undefined : reader.float64();
}

function writeOptionalJson(writer: BinaryWriter, value: unknown): void {
  writer.u8(value === undefined ? 0 : 1);
  if (value !== undefined) writeJson(writer, value);
}

function readOptionalJson(reader: BinaryReader): unknown {
  return reader.u8() === 0 ? undefined : readJson(reader);
}

function writeJson(writer: BinaryWriter, value: unknown): void {
  writeString(writer, JSON.stringify(value));
}

function readJson(reader: BinaryReader): unknown {
  return JSON.parse(readString(reader));
}

function writeString(writer: BinaryWriter, value: string): void {
  const bytes = encoder.encode(value);
  writer.varint(bytes.length);
  writer.bytes(bytes);
}

function readString(reader: BinaryReader): string {
  return decoder.decode(reader.bytes(reader.varint()));
}

class BinaryWriter {
  private buffer = new Uint8Array(256);
  private offset = 0;

  finish(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }

  u8(value: number): void {
    this.ensure(1);
    this.buffer[this.offset++] = value & 0xff;
  }

  float64(value: number): void {
    this.ensure(8);
    new DataView(this.buffer.buffer).setFloat64(this.offset, value, true);
    this.offset += 8;
  }

  varint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('varint value must be a non-negative safe integer');
    let current = value;
    while (current >= 0x80) {
      this.u8((current & 0x7f) | 0x80);
      current = Math.floor(current / 128);
    }
    this.u8(current);
  }

  bytes(value: Uint8Array): void {
    this.ensure(value.length);
    this.buffer.set(value, this.offset);
    this.offset += value.length;
  }

  private ensure(size: number): void {
    const required = this.offset + size;
    if (required <= this.buffer.length) return;
    let capacity = this.buffer.length * 2;
    while (capacity < required) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buffer);
    this.buffer = next;
  }
}

class BinaryReader {
  private readonly bytesView: Uint8Array;
  private offset = 0;

  constructor(data: ArrayBuffer | ArrayBufferView) {
    this.bytesView = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  done(): void {
    if (this.offset !== this.bytesView.length) throw new TypeError('trailing bytes in Frontier realtime binary frame');
  }

  u8(): number {
    this.require(1);
    return this.bytesView[this.offset++];
  }

  float64(): number {
    this.require(8);
    const value = new DataView(this.bytesView.buffer, this.bytesView.byteOffset, this.bytesView.byteLength).getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  varint(): number {
    let multiplier = 1;
    let value = 0;
    for (let index = 0; index < 8; index++) {
      const byte = this.u8();
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) return value;
      multiplier *= 128;
    }
    throw new TypeError('invalid Frontier realtime varint');
  }

  bytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) throw new TypeError('byte length must be a non-negative safe integer');
    this.require(length);
    const out = this.bytesView.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  private require(size: number): void {
    if (this.offset + size > this.bytesView.length) throw new TypeError('truncated Frontier realtime binary frame');
  }
}
