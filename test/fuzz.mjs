import assert from 'node:assert';
import {
  createCommandSource,
  createPredictionState,
  createSnapshotBuffer,
  createTickClock,
  interpolateSnapshot
} from '../dist/index.js';

const args = parseArgs(process.argv.slice(2));
const cases = readPositiveInt(args.cases, 500);
const steps = readPositiveInt(args.steps, 48);
const seed = readPositiveInt(args.seed, 0x51f7);
const rng = mulberry32(seed);

for (let caseId = 0; caseId < cases; caseId++) {
  runCase(caseId, mulberry32((rng() * 0xffffffff) >>> 0));
}

console.log('frontier realtime fuzz passed cases=' + cases + ' steps=' + steps + ' seed=' + seed);

function runCase(caseId, rng) {
  const clientId = 'client-' + caseId;
  const source = createCommandSource({ clientId, now: () => 1000 + source.nextSeq });
  const commands = [];
  let ackSeq = 0;
  let authoritativeTotal = 0;

  const apply = (state, command) => ({ total: state.total + command.payload.delta });
  const prediction = createPredictionState({
    clientId,
    snapshot: snapshot(clientId, 0, authoritativeTotal, ackSeq),
    applyCommand: apply,
    maxPending: steps + 4
  });

  const buffer = createSnapshotBuffer({ capacity: 8 });
  const clock = createTickClock({ tickRate: 30, startTimeMs: 1000 });

  for (let step = 0; step < steps; step++) {
    const command = source.create('add', { delta: 1 + randomInt(rng, 5) }, { tick: clock.step().tick });
    commands.push(command);
    prediction.predict(command);

    if (randomInt(rng, 3) === 0 || step === steps - 1) {
      ackSeq = ackSeq + randomInt(rng, source.nextSeq - ackSeq);
      authoritativeTotal = commands
        .filter((entry) => entry.seq <= ackSeq)
        .reduce((sum, entry) => sum + entry.payload.delta, 0);
      const accepted = prediction.acceptSnapshot(snapshot(clientId, step + 1, authoritativeTotal, ackSeq));
      assert.strictEqual(accepted.pending.every((entry) => entry.seq > ackSeq), true);
    }

    if (prediction.pending.length > 0 && randomInt(rng, 11) === 0) {
      const rejected = prediction.pending[randomInt(rng, prediction.pending.length)];
      commands.splice(commands.findIndex((entry) => entry.seq === rejected.seq), 1);
      prediction.reject({ clientId, seq: rejected.seq, commandId: rejected.id, reason: 'fuzz rejection' });
    }

    authoritativeTotal = commands
      .filter((entry) => entry.seq <= ackSeq)
      .reduce((sum, entry) => sum + entry.payload.delta, 0);
    const expectedTotal = commands
      .filter((entry) => entry.seq > ackSeq)
      .reduce((sum, entry) => sum + entry.payload.delta, authoritativeTotal);

    assert.deepStrictEqual(prediction.state, { total: expectedTotal });

    const sampleTick = step + 1;
    buffer.push({ tick: sampleTick, timeMs: sampleTick * 50, state: { total: expectedTotal } });
    const sample = buffer.sample(sampleTick * 50 - 25);
    if (sample) {
      const interpolated = interpolateSnapshot(sample, (previous, next, alpha) => ({
        total: previous.total + (next.total - previous.total) * alpha
      }));
      assert.strictEqual(Number.isFinite(interpolated.total), true);
    }
  }
}

function snapshot(clientId, tick, total, ackSeq) {
  return {
    tick,
    timeMs: tick * 50,
    state: { total },
    lastCommandSeqByClient: {
      [clientId]: ackSeq
    },
    ack: [
      { clientId, seq: ackSeq }
    ]
  };
}

function randomInt(rng, max) {
  return Math.floor(rng() * max);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cases') out.cases = argv[++i];
    else if (arg === '--steps') out.steps = argv[++i];
    else if (arg === '--seed') out.seed = argv[++i];
    else throw new Error('unknown argument: ' + arg);
  }
  return out;
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function next() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
