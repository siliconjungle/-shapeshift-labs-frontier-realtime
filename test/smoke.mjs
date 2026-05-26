import assert from 'node:assert';
import {
  clampTickDelta,
  applyRealtimeDelta,
  createCommandSource,
  createRealtimeDelta,
  createPredictionState,
  createSnapshotBuffer,
  createTickClock,
  decodeRealtimeBinaryMessage,
  decodeRealtimeMessage,
  encodeRealtimeBinaryMessage,
  encodeRealtimeMessage,
  estimateJsonMessageBytes,
  getSnapshotAckSeq,
  interpolateSnapshot,
  isRealtimeBinaryMessage,
  isRealtimeClientMessage,
  isRealtimeServerMessage,
  reconcileSnapshot,
  sampleSnapshots,
  tickToTimeMs,
  timeToTick
} from '../dist/index.js';
import { createCommandSource as createCommandSourceSubpath } from '../dist/command.js';
import { createPredictionState as createPredictionStateSubpath } from '../dist/prediction.js';
import { createRollbackInputSource, createRollbackSession } from '../dist/rollback.js';
import { createSnapshotBuffer as createSnapshotBufferSubpath } from '../dist/snapshot-buffer.js';
import { createTickClock as createTickClockSubpath } from '../dist/tick.js';
import { encodeRealtimeMessage as encodeRealtimeMessageSubpath } from '../dist/messages.js';
import { createRealtimeDelta as createRealtimeDeltaSubpath } from '../dist/delta.js';
import { encodeRealtimeBinaryMessage as encodeRealtimeBinaryMessageSubpath } from '../dist/binary.js';
import { createFrontierRealtimeDelta, applyFrontierRealtimeDelta } from '../dist/frontier.js';
import { encodeRealtimeCodecDelta, decodeRealtimeCodecDelta } from '../dist/codec.js';

assert.strictEqual(createCommandSourceSubpath, createCommandSource);
assert.strictEqual(createPredictionStateSubpath, createPredictionState);
assert.strictEqual(createSnapshotBufferSubpath, createSnapshotBuffer);
assert.strictEqual(createTickClockSubpath, createTickClock);
assert.strictEqual(encodeRealtimeMessageSubpath, encodeRealtimeMessage);
assert.strictEqual(createRealtimeDeltaSubpath, createRealtimeDelta);
assert.strictEqual(encodeRealtimeBinaryMessageSubpath, encodeRealtimeBinaryMessage);

{
  let now = 1000;
  const source = createCommandSource({ clientId: 'client-a', now: () => now += 16 });
  const first = source.create('move', { dx: 1 }, { roomId: 'room-1', tick: 10 });
  const second = source.create('move', { dx: 2 });

  assert.strictEqual(first.clientId, 'client-a');
  assert.strictEqual(first.seq, 1);
  assert.strictEqual(first.id, 'client-a:1:move');
  assert.strictEqual(first.timeMs, 1016);
  assert.strictEqual(second.seq, 2);

  source.reset(9);
  assert.strictEqual(source.nextSeq, 9);
}

{
  const apply = (state, command) => ({ x: state.x + command.payload.dx });
  const source = createCommandSource({ clientId: 'client-a', now: () => 1 });
  const prediction = createPredictionState({
    clientId: 'client-a',
    snapshot: { tick: 0, state: { x: 0 }, lastCommandSeqByClient: { 'client-a': 0 } },
    applyCommand: apply
  });

  const first = source.create('move', { dx: 1 });
  const second = source.create('move', { dx: 2 });

  assert.deepStrictEqual(prediction.predict(first), { x: 1 });
  assert.deepStrictEqual(prediction.predict(second), { x: 3 });
  assert.strictEqual(prediction.pending.length, 2);

  const accepted = prediction.acceptSnapshot({
    tick: 1,
    state: { x: 10 },
    lastCommandSeqByClient: { 'client-a': 1 }
  });

  assert.strictEqual(accepted.acknowledged, 1);
  assert.strictEqual(accepted.replayed, 1);
  assert.deepStrictEqual(prediction.state, { x: 12 });
  assert.deepStrictEqual(prediction.pending.map((command) => command.seq), [2]);

  const rejected = prediction.reject({ clientId: 'client-a', seq: 2, reason: 'invalid' });
  assert.strictEqual(rejected.replayed, 0);
  assert.deepStrictEqual(prediction.state, { x: 10 });
  assert.deepStrictEqual(prediction.pending, []);

  assert.strictEqual(getSnapshotAckSeq({ tick: 1, state: {}, ack: [{ clientId: 'client-a', seq: 5 }] }, 'client-a'), 5);
  assert.deepStrictEqual(
    reconcileSnapshot({ tick: 2, state: { x: 1 }, lastCommandSeqByClient: { 'client-a': 0 } }, [first], apply).state,
    { x: 2 }
  );
}

{
  const buffer = createSnapshotBuffer({ capacity: 3 });
  buffer.push({ tick: 1, timeMs: 100, state: { x: 0 } });
  buffer.push({ tick: 3, timeMs: 300, state: { x: 20 } });
  buffer.push({ tick: 2, timeMs: 200, state: { x: 10 } });

  assert.deepStrictEqual(buffer.snapshots.map((snapshot) => snapshot.tick), [1, 2, 3]);

  const sample = buffer.sample(150);
  assert.ok(sample);
  assert.strictEqual(sample.alpha, 0.5);
  assert.deepStrictEqual(
    interpolateSnapshot(sample, (previous, next, alpha) => ({ x: previous.x + (next.x - previous.x) * alpha })),
    { x: 5 }
  );

  buffer.push({ tick: 4, timeMs: 400, state: { x: 40 } });
  assert.deepStrictEqual(buffer.snapshots.map((snapshot) => snapshot.tick), [2, 3, 4]);
  assert.strictEqual(sampleSnapshots(buffer.snapshots, 999)?.previous.tick, 4);
}

{
  const clock = createTickClock({ tickRate: 20, startTimeMs: 100 });
  assert.strictEqual(clock.tickMs, 50);
  assert.strictEqual(clock.toTick(225), 2);
  assert.strictEqual(clock.update(225).steps, 2);
  assert.strictEqual(clock.step(3).tick, 5);
  assert.strictEqual(timeToTick(260, 50, 100), 3);
  assert.strictEqual(tickToTimeMs(3, 50, 100), 250);
  assert.strictEqual(clampTickDelta(3, 10, 4), 4);
}

{
  const join = { version: 1, type: 'join', roomId: 'room-1', clientId: 'client-a' };
  const encoded = encodeRealtimeMessage(join);
  const decoded = decodeRealtimeMessage(encoded);
  assert.strictEqual(isRealtimeClientMessage(decoded), true);
  assert.strictEqual(isRealtimeServerMessage({ version: 1, type: 'snapshot', snapshot: { tick: 1, state: {} } }), true);
  assert.throws(() => encodeRealtimeMessage({ version: 1, type: 'unknown' }), /invalid realtime message/);
}

{
  const previous = { tick: 1, state: { x: 1, y: 2 } };
  const next = { tick: 2, timeMs: 50, state: { x: 2, y: 2 } };
  const delta = createRealtimeDelta(previous, next, {
    createPatch: (left, right) => ({ dx: right.x - left.x })
  });
  assert.deepStrictEqual(delta, { tick: 2, baseTick: 1, timeMs: 50, patch: { dx: 1 } });
  assert.deepStrictEqual(
    applyRealtimeDelta(previous, delta, { applyPatch: (state, patch) => ({ ...state, x: state.x + patch.dx }) }).state,
    next.state
  );
  assert.ok(estimateJsonMessageBytes(delta) > 0);
}

{
  const message = {
    version: 1,
    type: 'snapshot',
    roomId: 'room-1',
    snapshot: { tick: 2, state: { x: 3 }, lastCommandSeqByClient: { 'client-a': 4 } }
  };
  const frame = encodeRealtimeBinaryMessage(message);
  assert.strictEqual(isRealtimeBinaryMessage(frame), true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(decodeRealtimeBinaryMessage(frame))), message);
}

{
  const previous = { tick: 1, state: { x: 1, nested: { ok: true } } };
  const next = { tick: 2, state: { x: 2, nested: { ok: true } } };
  const delta = createFrontierRealtimeDelta(previous, next);
  const applied = applyFrontierRealtimeDelta(previous, delta);
  assert.deepStrictEqual(applied.state, next.state);
  const encoded = encodeRealtimeCodecDelta(delta);
  assert.strictEqual(typeof encoded.patch, 'string');
  assert.deepStrictEqual(decodeRealtimeCodecDelta(encoded).patch, delta.patch);
}

{
  const session = createRollbackSession({
    initialState: { x: 0 },
    players: ['local', 'remote'],
    initialFrame: 0,
    inputDelay: 1,
    checkpointInterval: 1,
    cloneState: (state) => ({ ...state }),
    checksum: (state) => state.x,
    predictInput: (_clientId, _frame, previous) => previous?.payload ?? { dx: 0 },
    stepFrame(state, frameInputs, context) {
      const dx = frameInputs.inputs.reduce((sum, input) => sum + input.payload.dx, 0);
      context.emit({ frame: frameInputs.frame, x: state.x + dx });
      return { x: state.x + dx };
    }
  });
  const local = createRollbackInputSource({ clientId: 'local', inputDelay: 1 });
  const remote = createRollbackInputSource({ clientId: 'remote', inputDelay: 0 });
  session.addRemoteInput(remote.create({ dx: 0 }, 1));
  session.addRemoteInput(local.create({ dx: 1 }, 0));
  assert.deepStrictEqual(session.advance()[0].state, { x: 1 });
  session.addRemoteInput(local.create({ dx: 1 }, 1));
  assert.deepStrictEqual(session.advance()[0].state, { x: 2 });
  const correction = session.addRemoteInput({ clientId: 'remote', frame: 2, payload: { dx: 5 }, status: 'confirmed' });
  assert.strictEqual(correction.corrected, true);
  assert.strictEqual(correction.replayed, 1);
  assert.deepStrictEqual(session.state, { x: 7 });
  assert.deepStrictEqual(session.predictedFrames, []);
  assert.strictEqual(session.confirmedFrame, 2);
  assert.strictEqual(session.checksum(), 7);
}

console.log('frontier realtime smoke passed');
