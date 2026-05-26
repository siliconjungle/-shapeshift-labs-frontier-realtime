import {
  createCommandSource,
  createPredictionState,
  createSnapshotBuffer,
  createTickClock,
  type RealtimeCommand,
  type RealtimeSnapshot
} from '../dist/index.js';
import { createCommandSource as createCommandSourceSubpath } from '../dist/command.js';
import { createPredictionState as createPredictionStateSubpath } from '../dist/prediction.js';
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
