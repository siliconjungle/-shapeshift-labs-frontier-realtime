import type {
  RealtimeClientMessage,
  RealtimeServerMessage
} from './types.js';

const CLIENT_TYPES = new Set(['join', 'command', 'leave', 'pong']);
const SERVER_TYPES = new Set(['welcome', 'snapshot', 'delta', 'command-ack', 'command-reject', 'ping']);

export function encodeRealtimeMessage(message: RealtimeClientMessage | RealtimeServerMessage): string {
  validateRealtimeMessageEnvelope(message);
  return JSON.stringify(message);
}

export function decodeRealtimeMessage(value: string): RealtimeClientMessage | RealtimeServerMessage {
  const message = JSON.parse(value) as unknown;
  validateRealtimeMessageEnvelope(message);
  return message as RealtimeClientMessage | RealtimeServerMessage;
}

export function isRealtimeClientMessage(value: unknown): value is RealtimeClientMessage {
  return isVersionedType(value, CLIENT_TYPES);
}

export function isRealtimeServerMessage(value: unknown): value is RealtimeServerMessage {
  return isVersionedType(value, SERVER_TYPES);
}

export function validateRealtimeMessageEnvelope(value: unknown): asserts value is RealtimeClientMessage | RealtimeServerMessage {
  if (!isRealtimeClientMessage(value) && !isRealtimeServerMessage(value)) {
    throw new TypeError('invalid realtime message envelope');
  }
}

function isVersionedType(value: unknown, types: ReadonlySet<string>): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { version?: unknown; type?: unknown };
  return record.version === 1 && typeof record.type === 'string' && types.has(record.type);
}
