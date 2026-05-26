import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  createCommandSource,
  createPredictionState,
  createSnapshotBuffer,
  createTickClock,
  reconcileSnapshot
} from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const args = parseArgs(process.argv.slice(2));
const rounds = readPositiveInt(args.rounds, 9);
const outPath = args.out ? path.resolve(rootDir, args.out) : null;
let sink = 0;

const apply = (state, command) => ({ x: state.x + command.payload.dx });
const commands = makeCommands(128);

const rows = [
  runRow('Create 32 client commands', 8000, () => {
    const source = createCommandSource({ clientId: 'bench', now: () => 1 });
    for (let i = 0; i < 32; i++) sink += source.create('move', { dx: i }).seq;
  }),
  runRow('Reconcile 128 pending commands', 6000, () => {
    const result = reconcileSnapshot(
      { tick: 4, state: { x: 100 }, lastCommandSeqByClient: { bench: 64 } },
      commands,
      apply,
      { clientId: 'bench' }
    );
    sink += result.state.x + result.pending.length;
  }),
  runRow('Prediction accept snapshot', 5000, () => {
    const prediction = createPredictionState({
      clientId: 'bench',
      snapshot: { tick: 0, state: { x: 0 }, lastCommandSeqByClient: { bench: 0 } },
      applyCommand: apply,
      maxPending: 256
    });
    for (let i = 0; i < 32; i++) prediction.predict(commands[i]);
    sink += prediction.acceptSnapshot({ tick: 2, state: { x: 40 }, lastCommandSeqByClient: { bench: 16 } }).state.x;
  }),
  runRow('Snapshot buffer push/sample', 8000, () => {
    const buffer = createSnapshotBuffer({ capacity: 16 });
    for (let i = 0; i < 16; i++) buffer.push({ tick: i, timeMs: i * 50, state: { x: i } });
    sink += buffer.sample(375)?.previous.tick ?? 0;
  }),
  runRow('Tick clock update, 128 frames', 10000, () => {
    const clock = createTickClock({ tickRate: 60 });
    for (let i = 0; i < 128; i++) sink += clock.update(i * 16.67).steps;
  })
];

finish('@shapeshift-labs/frontier-realtime', rows);

function makeCommands(count) {
  const source = createCommandSource({ clientId: 'bench', now: () => 1 });
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = source.create('move', { dx: 1 });
  return out;
}

function measure(fn, inner) {
  for (let i = 0; i < inner; i++) fn();
  const samples = new Array(rounds);
  for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
    const start = performance.now();
    for (let i = 0; i < inner; i++) fn();
    samples[roundIndex] = ((performance.now() - start) * 1000) / inner;
  }
  samples.sort((left, right) => left - right);
  return { median: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
}

function runRow(name, inner, fn, extra = {}) {
  const timing = measure(fn, inner);
  return { fixture: name, medianUs: round(timing.median), p95Us: round(timing.p95), ...extra };
}

function finish(packageName, rows) {
  const report = {
    package: packageName,
    version: readPackageVersion(),
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform + ' ' + process.arch,
    rounds,
    rows
  };
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  }
  printReport(report);
  if (sink === 42) console.log('sink=' + sink);
}

function printReport(report) {
  console.log(report.package + ' package benchmark');
  console.log('Node ' + report.node + ' on ' + report.platform + ', rounds=' + rounds);
  console.log('These are Frontier-only package measurements, not competitor comparisons.');
  console.log('');
  console.log(padRight('Fixture', 36) + padLeft('Median', 12) + padLeft('p95', 11));
  for (const row of report.rows) {
    console.log(padRight(row.fixture, 36) + padLeft(formatUs(row.medianUs), 12) + padLeft(formatUs(row.p95Us), 11));
  }
  if (outPath) console.log('\nwrote ' + path.relative(rootDir, outPath));
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function readPackageVersion() {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rounds') out.rounds = argv[++i];
    else if (arg === '--out') out.out = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run bench -- [--rounds 9] [--out benchmarks/results/package-bench.json]');
      process.exit(0);
    } else {
      throw new Error('unknown argument: ' + arg);
    }
  }
  return out;
}

function readPositiveInt(value, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error('expected positive integer, got ' + value);
  return number;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function formatUs(value) {
  return value >= 1000 ? (value / 1000).toFixed(2) + ' ms' : value.toFixed(2) + ' us';
}

function padRight(value, width) {
  return String(value).padEnd(width);
}

function padLeft(value, width) {
  return String(value).padStart(width);
}
