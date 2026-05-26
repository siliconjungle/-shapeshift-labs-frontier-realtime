import {
  createCommandSource,
  createPredictionState,
  createRealtimeDelta,
  createSnapshotBuffer,
  createTickClock,
  encodeRealtimeBinaryMessage,
  type RealtimeCommand,
  type RealtimeDelta,
  type RealtimeSnapshot
} from '../dist/index.js';
import { encodeRealtimeBinaryMessage as encodeRealtimeBinaryMessageSubpath } from '../dist/binary.js';
import { createCommandSource as createCommandSourceSubpath } from '../dist/command.js';
import { createRealtimeDelta as createRealtimeDeltaSubpath } from '../dist/delta.js';
import { createPredictionState as createPredictionStateSubpath } from '../dist/prediction.js';
import {
  createRollbackInputSource,
  createRollbackSession,
  type RollbackInput
} from '../dist/rollback.js';
import { createSnapshotBuffer as createSnapshotBufferSubpath } from '../dist/snapshot-buffer.js';
import { createTickClock as createTickClockSubpath } from '../dist/tick.js';

interface State {
  x: number;
}

interface MovePayload {
  dx: number;
}

type MoveCommand = RealtimeCommand<MovePayload>;

const source = createCommandSource({ clientId: 'client-a' });
const source2 = createCommandSourceSubpath({ clientId: 'client-b' });
const command: MoveCommand = source.create('move', { dx: 1 });
source2.create('move', { dx: 2 });

const snapshot: RealtimeSnapshot<State> = { tick: 0, state: { x: 0 } };
const prediction = createPredictionState<State, MoveCommand>({
  clientId: 'client-a',
  snapshot,
  applyCommand: (state, entry) => ({ x: state.x + entry.payload.dx })
});

createPredictionStateSubpath<State, MoveCommand>({
  clientId: 'client-a',
  snapshot,
  applyCommand: (state, entry) => ({ x: state.x + entry.payload.dx })
});

prediction.predict(command);

const buffer = createSnapshotBuffer<State>();
const buffer2 = createSnapshotBufferSubpath<State>();
buffer.push(snapshot);
buffer2.push(snapshot);

const clock = createTickClock({ tickRate: 20 });
const clock2 = createTickClockSubpath({ tickMs: 50 });
clock.step();
clock2.step();

const delta: RealtimeDelta<{ dx: number }> = createRealtimeDelta(snapshot, { tick: 1, state: { x: 1 } }, {
  createPatch: (left, right) => ({ dx: right.x - left.x })
});
createRealtimeDeltaSubpath(snapshot, { tick: 2, state: { x: 2 } }, {
  createPatch: (left, right) => ({ dx: right.x - left.x })
});
encodeRealtimeBinaryMessage({ version: 1, type: 'delta', delta });
encodeRealtimeBinaryMessageSubpath({ version: 1, type: 'snapshot', snapshot });

const rollbackInput: RollbackInput<MovePayload> = createRollbackInputSource<MovePayload>({
  clientId: 'client-a',
  inputDelay: 1
}).create({ dx: 1 }, 0);
const rollback = createRollbackSession<State, MovePayload>({
  initialState: { x: 0 },
  players: ['client-a'],
  predictInput: () => ({ dx: 0 }),
  stepFrame: (state, inputs) => ({ x: state.x + inputs.inputs[0].payload.dx })
});
rollback.addRemoteInput(rollbackInput);
rollback.advance();
