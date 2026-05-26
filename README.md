# Frontier Realtime

Realtime multiplayer command, tick, snapshot, prediction, and reconciliation primitives for Frontier.

This package is the dependency-free shared realtime layer. It defines the small contracts that client, authoritative server, and transport packages can agree on without pulling a server runtime, WebSocket adapter, CRDT sync, rendering engine, or physics engine into the root import.

- npm: [`@shapeshift-labs/frontier-realtime`](https://www.npmjs.com/package/@shapeshift-labs/frontier-realtime)
- source: [`siliconjungle/-shapeshift-labs-frontier-realtime`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime)
- license: MIT

## Related Packages

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier): core JSON diff/apply primitives for state snapshots and patches.
- [`@shapeshift-labs/frontier-query`](https://www.npmjs.com/package/@shapeshift-labs/frontier-query): shared selector and entity identity vocabulary that can feed interest management.
- [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec): patch serialization and byte helpers for higher realtime transports.
- [`@shapeshift-labs/frontier-state`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state): patch-routed client/server state projections.
- [`@shapeshift-labs/frontier-event-log`](https://www.npmjs.com/package/@shapeshift-labs/frontier-event-log): bounded command, snapshot, and replay windows.
- [`@shapeshift-labs/frontier-schema`](https://www.npmjs.com/package/@shapeshift-labs/frontier-schema): validation for command and state contracts.
- [`@shapeshift-labs/frontier-logging`](https://www.npmjs.com/package/@shapeshift-labs/frontier-logging): tick, latency, and reconciliation diagnostics.

Companion repositories:

- [`@shapeshift-labs/frontier-realtime-server`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime-server): authoritative server runtime for rooms, ticks, validation, session resume, snapshot history, and replication policy.
- [`@shapeshift-labs/frontier-realtime-websocket`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime-websocket): WebSocket transport for realtime commands, snapshots, deltas, and resume joins.
- [`@shapeshift-labs/frontier-game`](https://github.com/siliconjungle/-shapeshift-labs-frontier-game): game-facing entity, component, player, room, ownership, spatial interest, and replication vocabulary above realtime.

## Install

```sh
npm install @shapeshift-labs/frontier-realtime
```

## Usage

```ts
import {
  createCommandSource,
  createPredictionState,
  createSnapshotBuffer,
  createTickClock,
  interpolateSnapshot
} from '@shapeshift-labs/frontier-realtime';

const commands = createCommandSource({ clientId: 'player-a' });
const clock = createTickClock({ tickRate: 20 });

const client = createPredictionState({
  clientId: 'player-a',
  snapshot: {
    tick: 0,
    state: { x: 0 },
    lastCommandSeqByClient: { 'player-a': 0 }
  },
  applyCommand(state, command) {
    return { x: state.x + command.payload.dx };
  }
});

client.predict(commands.create('move', { dx: 1 }, { tick: clock.step().tick }));
client.acceptSnapshot({
  tick: 1,
  state: { x: 10 },
  lastCommandSeqByClient: { 'player-a': 1 }
});

const snapshots = createSnapshotBuffer<{ x: number }>({ capacity: 32 });
snapshots.push({ tick: 1, timeMs: 100, state: { x: 10 } });
snapshots.push({ tick: 2, timeMs: 150, state: { x: 20 } });

const sample = snapshots.sample(125);
const rendered = sample
  ? interpolateSnapshot(sample, (previous, next, alpha) => ({
      x: previous.x + (next.x - previous.x) * alpha
    }))
  : null;
```

## API

```ts
import {
  createCommandSource,
  createPredictionState,
  createSnapshotBuffer,
  createTickClock,
  createRealtimeDelta,
  createRollbackSession,
  encodeRealtimeBinaryMessage,
  decodeRealtimeMessage,
  encodeRealtimeMessage,
  reconcileSnapshot,
  type RealtimeCommand,
  type RealtimeSnapshot
} from '@shapeshift-labs/frontier-realtime';
```

### Commands

`createCommandSource(options)` creates monotonic client command envelopes with `clientId`, `seq`, `type`, `payload`, optional room/actor/tick metadata, and a stable default command id.

```ts
const source = createCommandSource({ clientId: 'client-a' });
const command = source.create('move', { dx: 1, dy: 0 }, { roomId: 'room-1' });
```

### Prediction and Reconciliation

`createPredictionState(options)` keeps a predicted client state by applying local commands immediately, accepting authoritative snapshots, dropping acknowledged commands, and replaying remaining pending commands over the latest server state.

```ts
const prediction = createPredictionState({
  clientId: 'client-a',
  snapshot: { tick: 0, state: { score: 0 } },
  applyCommand: (state, command) => ({
    score: state.score + command.payload.points
  })
});

prediction.predict(source.create('score', { points: 5 }));
prediction.acceptSnapshot({
  tick: 2,
  state: { score: 10 },
  lastCommandSeqByClient: { 'client-a': 1 }
});
```

`reconcileSnapshot(snapshot, pending, applyCommand, options)` exposes the same operation as a pure helper for custom client stores.

### Snapshot Buffers

`createSnapshotBuffer(options)` stores ordered authoritative snapshots and samples a render time between them. The package returns interpolation metadata but does not assume a physics or rendering model.

```ts
const sample = buffer.sample(renderTimeMs);
const state = sample && interpolateSnapshot(sample, lerpState);
```

### Tick Clocks

`createTickClock(options)` maps wall-clock time to fixed simulation ticks and tracks how many ticks should be advanced.

```ts
const clock = createTickClock({ tickRate: 60 });
const { steps } = clock.update(performance.now());
```

### Messages

The message helpers encode and guard small JSON envelopes shared by future transports:

- client: `join`, `command`, `leave`, `pong`
- server: `welcome`, `snapshot`, `delta`, `command-ack`, `command-reject`, `ping`

Transport-specific framing, reconnect behavior, and server room loops belong in higher packages.

### Binary and Delta Frames

`encodeRealtimeBinaryMessage()` and `decodeRealtimeBinaryMessage()` provide a compact binary envelope for hot realtime loops. The frame keeps command, snapshot, delta, ack, reject, ping, pong, and resume join metadata in the shared protocol package so transports do not need to invent their own wire shape.

`createRealtimeDelta()` and `applyRealtimeDelta()` are generic snapshot-delta helpers. They do not require Frontier core, but `@shapeshift-labs/frontier-realtime/frontier` adds optional `diff()`/`applyPatchImmutable()` adapters and `@shapeshift-labs/frontier-realtime/codec` adds optional `frontier-codec` patch-frame helpers.

### Rollback Netcode

`@shapeshift-labs/frontier-realtime/rollback` provides deterministic fixed-frame input logs, input delay, remote input prediction, checkpoints, rollback/replay, predicted/confirmed frame tracking, and replay-safe side-effect emission. The app still owns deterministic simulation and rendering.

```ts
import { createRollbackSession } from '@shapeshift-labs/frontier-realtime/rollback';

const rollback = createRollbackSession({
  initialState: { x: 0 },
  players: ['local', 'remote'],
  predictInput: (_clientId, _frame, previous) => previous?.payload ?? { dx: 0 },
  stepFrame(state, frameInputs) {
    return {
      x: state.x + frameInputs.inputs.reduce((sum, input) => sum + input.payload.dx, 0)
    };
  }
});
```

## Subpath Imports

```ts
import { createCommandSource } from '@shapeshift-labs/frontier-realtime/command';
import { createPredictionState } from '@shapeshift-labs/frontier-realtime/prediction';
import { createSnapshotBuffer } from '@shapeshift-labs/frontier-realtime/snapshot-buffer';
import { createTickClock } from '@shapeshift-labs/frontier-realtime/tick';
import { encodeRealtimeMessage } from '@shapeshift-labs/frontier-realtime/messages';
import { encodeRealtimeBinaryMessage } from '@shapeshift-labs/frontier-realtime/binary';
import { createRealtimeDelta } from '@shapeshift-labs/frontier-realtime/delta';
import { createFrontierRealtimeDelta } from '@shapeshift-labs/frontier-realtime/frontier';
import { encodeRealtimeCodecDelta } from '@shapeshift-labs/frontier-realtime/codec';
import { createRollbackSession } from '@shapeshift-labs/frontier-realtime/rollback';
```

## Package Scope

This package intentionally owns only shared realtime primitives:

- Command envelopes and monotonic client command ids.
- Fixed tick math.
- Authoritative snapshot acknowledgement and pending-command replay.
- Client-side prediction state.
- Snapshot buffers for interpolation.
- Small JSON message envelope guards.
- Compact binary protocol frames.
- Generic snapshot deltas, with optional Frontier patch and codec adapters behind subpaths.
- Optional rollback input/checkpoint/replay session primitives behind `./rollback`.

It does not own authoritative server loops, sockets, persistence, CRDT sync, physics, renderer bindings, anti-cheat policy, entity/component gameplay APIs, or durable world editing. Those belong in higher packages or application code.

## TypeScript

The package ships ESM JavaScript plus `.d.ts` declarations for the root export and public subpaths. It has no runtime dependencies.

## Validation

```sh
npm test
npm run fuzz
npm run bench
npm run pack:dry
```

The package test suite covers root and subpath imports, command creation, prediction and reconciliation, rejected commands, snapshot interpolation, tick math, message envelopes, TypeScript declarations, randomized pending-command replay, and package export boundaries.

## Benchmarks

Run the package-local benchmark:

```sh
npm run bench
```

Latest local package benchmark on Node v26.1.0, darwin arm64, 9 rounds:

| Fixture | Median | p95 |
| --- | ---: | ---: |
| Create 32 client commands | 2.08 us | 2.23 us |
| Reconcile 128 pending commands | 4.74 us | 4.97 us |
| Prediction accept snapshot | 19.51 us | 19.80 us |
| Snapshot buffer push/sample | 2.01 us | 2.44 us |
| Tick clock update, 128 frames | 1.58 us | 1.89 us |

These are Frontier-only package measurements, not competitor comparisons.

## License

MIT. See [LICENSE](./LICENSE).
