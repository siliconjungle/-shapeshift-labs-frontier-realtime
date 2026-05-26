import {
  decodePatchFrame,
  encodePatchFrame,
  type Patch
} from '@shapeshift-labs/frontier-codec';
import type { RealtimeDelta } from './types.js';

export function encodeRealtimeCodecDelta(delta: RealtimeDelta<Patch>): RealtimeDelta<string> {
  return {
    ...delta,
    patch: base64urlEncode(encodePatchFrame(delta.patch))
  };
}

export function decodeRealtimeCodecDelta(delta: RealtimeDelta<string>): RealtimeDelta<Patch> {
  return {
    ...delta,
    patch: decodePatchFrame(base64urlDecode(delta.patch))
  };
}

export function estimateRealtimeCodecDeltaBytes(delta: RealtimeDelta<Patch>): number {
  return encodePatchFrame(delta.patch).byteLength;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '==='.slice((base64.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type {
  Patch
};
