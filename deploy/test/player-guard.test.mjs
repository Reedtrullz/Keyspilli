import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { validate, WRITABLE, resolveEsbuild, checkSource, MOUNTS, observeHealth, requestHealth, diagnosticProfile, guardLaunchArgs, guardEnvironment, sidecarLaunchArgs, SIDECAR_PROFILES, NODE_RUNTIME_ENV, NATIVE_COMMAND_TIMEOUT_MS, NATIVE_WHOLE_CASE_TIMEOUT_MS, appendTrace, captureInFlight, probeTcp, parseGuardOutput, requireDiagnosticEvidence, browserProcessEvidence, nativeSmoke, accumulateMountUsage, inspectEvidence, requireInspectEvidence } from '../player-guard-run.mjs';
import { perfViewport } from '../../apps/web/e2e/perf-viewport.ts';
import { summarizeTaskCounts } from '../../apps/web/scripts/native-task-counts.ts';
import { createPhaseTrace } from '../../apps/web/scripts/native-phase-trace.ts';
import { watchPlayerPage } from '../../apps/web/scripts/native-page-watch.ts';
import * as capacity from '../player-guard-run.mjs';
import { pdfRequestAllowed } from '../pdf-render-server.mjs';
const { privatePath, connectionAllowed } = createRequire(import.meta.url)('../player-node-guard.cjs');

const phaseCounts = {
  processes: 2,
  threads: 9,
  vanished: 0,
  roles: {
    guard: { processes: 1, threads: 1 },
    'automation-node': { processes: 1, threads: 8 },
    'app-node': { processes: 0, threads: 0 },
    chromium: { processes: 0, threads: 0 },
    crashpad: { processes: 0, threads: 0 },
    unknown: { processes: 0, threads: 0 },
  },
};

test('native smoke keeps a bounded deadline with enough room for three browser lifetimes', () => {
  assert.equal(NATIVE_COMMAND_TIMEOUT_MS, 180000);
  assert.equal(NATIVE_WHOLE_CASE_TIMEOUT_MS, 240000);
  assert(NATIVE_COMMAND_TIMEOUT_MS < NATIVE_WHOLE_CASE_TIMEOUT_MS);
  assert(NATIVE_WHOLE_CASE_TIMEOUT_MS < 5 * 60 * 1000);
});

test('bounded native phase trace reserves a compact failure without masking the primary error', () => {
  const writes = [];
  const trace = createPhaseTrace(line => writes.push(line), { limitBytes: 512, failureReserveBytes: 128 });
  for (let index = 0; index < 8; index++) trace.emit('filler', 'entry', phaseCounts);
  const primary = new Error('post-Chords sentinel');
  try {
    throw primary;
  } catch (error) {
    trace.emit('chords-capture', 'failure', phaseCounts);
    assert.equal(error, primary);
  }
  assert.ok(Buffer.byteLength(writes.join('')) <= 512);
  assert.equal(trace.truncated, true);
  assert.ok(writes.some(line => JSON.parse(line).state === 'failure'));
  assert.ok(!writes.join('').includes('Native phase trace exceeds8KiB'));
});

test('bounded native phase trace leaves an ordinary trace byte-identical', () => {
  const writes = [];
  const trace = createPhaseTrace(line => writes.push(line));
  trace.emit('startup', 'entry', phaseCounts);
  trace.emit('startup', 'exit', phaseCounts);
  const expected = [
    JSON.stringify({ kind: 'keyspilli-native-phase', phase: 'startup', state: 'entry', ...phaseCounts }) + '\n',
    JSON.stringify({ kind: 'keyspilli-native-phase', phase: 'startup', state: 'exit', ...phaseCounts }) + '\n',
  ];
  assert.deepEqual(writes, expected);
  assert.equal(trace.truncated, false);
  assert.equal(trace.bytes, Buffer.byteLength(expected.join('')));
});

test('bounded native phase trace absorbs a synchronous writer failure', () => {
  const trace = createPhaseTrace(() => { throw new Error('closed stderr'); });
  assert.doesNotThrow(() => trace.emit('startup', 'failure', phaseCounts));
  assert.equal(trace.truncated, true);
  assert.equal(trace.bytes, 0);
});

test('closed player pages release every observer and the page reference', () => {
  const page = new EventEmitter();
  page.off = page.removeListener.bind(page);
  const notes = [];
  let cleaned = 0;
  const stop = watchPlayerPage(page, 'original', (label, kind) => notes.push([label, kind]), () => { cleaned++; });
  for (const event of ['console', 'pageerror', 'requestfailed', 'crash', 'close']) assert.equal(page.listenerCount(event), 1, event);
  page.emit('close');
  for (const event of ['console', 'pageerror', 'requestfailed', 'crash', 'close']) assert.equal(page.listenerCount(event), 0, event);
  assert.deepEqual(notes, [['original', 'close']]);
  assert.equal(cleaned, 1);
  stop();
  assert.equal(cleaned, 1);
});

function capacityFixture() {
  return { repository: 'Reedtrullz/Keyspilli', event: 'workflow_dispatch', ref: 'refs/heads/codex/keyspilli-native-full-20261104', expected: 'b'.repeat(40), dispatchCommit: 'b'.repeat(40), commit: 'b'.repeat(40), clean: true,
    hosted: 'github-hosted', actions: 'true', imageOS: 'ubuntu24', imageVersion: '20261101.1.0', os: '24.04', platform: 'linux', arch: 'x64', runnerOwner: true, runnerUid: 1001, disposable: true,
    target: '/usr/local/lib/android/sdk', canonical: true, owner: 0, ancestorsSafe: true, mountSafe: true, handles: 0, callers: 0,
    allocatedBytes: 20 * 1024 ** 3, freeBytes: 16 * 1024 ** 3, managedBytes: 0, settings: { reserve: 6 * 1024 ** 3, limit: 16 * 1024 ** 3, maxEntries: 100000, peak: 12 * 1024 ** 3 } };
}

test('capacity requirement covers unchanged writer, export, entry metadata and managed bytes', () => {
  assert.equal(capacity.capacityRequirement(capacityFixture()), 33867431936);
  const f = capacityFixture(); f.managedBytes = 1234; assert.equal(capacity.capacityRequirement(f), 33867433170);
  f.settings.maxEntries = 100001; assert.equal(capacity.capacityRequirement(f), 33867449554);
  for (const value of [-1, NaN, Infinity, '6', 1.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => capacity.capacityRequirement({ ...capacityFixture(), managedBytes: value }));
  }
});

test('guarded runtime caps non-browser Node worker pools without changing Chromium or PID guards', () => {
  assert.deepEqual(NODE_RUNTIME_ENV, {
    NODE_OPTIONS: '--v8-pool-size=2 --expose-gc',
    UV_THREADPOOL_SIZE: '2',
  });
  const pairs = guardEnvironment();
  assert(pairs.some(([key, value]) => key === 'NODE_OPTIONS' && value === '--v8-pool-size=2 --expose-gc'));
  assert(pairs.some(([key, value]) => key === 'UV_THREADPOOL_SIZE' && value === '2'));
  assert(pairs.some(([key, value]) => key === 'KEYSPILLI_PDF_RENDERER_URL' && value === 'http://127.0.0.1:3001'));
  assert(!pairs.some(([key]) => key.startsWith('CHROME_') || key === 'DEBUG'));
  const args = guardLaunchArgs('owned', diagnosticProfile('control'));
  assert.equal(args[args.indexOf('--pids-limit') + 1], '128');
  assert.equal(args[args.indexOf('--cpus') + 1], '1.5');
});

test('guarded C helper compiles without shadowing libc functions', () => {
  const source = fs.readFileSync(new URL('../player-guard.c', import.meta.url), 'utf8');
  const helper = source.match(/static void path_allow_if_present\([\s\S]*?\n\}/)?.[0];
  assert(helper, 'missing optional-path helper');
  const fixture = [
    '#include <errno.h>',
    '#include <stdint.h>',
    '#include <unistd.h>',
    'static void die(const char *where) { (void)where; }',
    'static void path_allow(int fd, const char *path, uint64_t access) { (void)fd; (void)path; (void)access; }',
    helper,
    'int main(void) { path_allow_if_present(0, "/tmp", 0); return 0; }',
  ].join('\n');
  assert.doesNotThrow(() => execFileSync('cc', ['-fsyntax-only', '-std=c11', '-Wall', '-Wextra', '-Wshadow', '-Werror', '-x', 'c', '-'], {
    input: fixture, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
  }));
});

test('guarded path policy keeps sentinel files outside writable roots', () => {
  const source = fs.readFileSync(new URL('../player-guard.c', import.meta.url), 'utf8');
  const writes = source.match(/const char \*writes\[\] = \{([^}]*)\};/)?.[1];
  assert(writes, 'missing guarded write roots');
  assert.deepEqual([...writes.matchAll(/"([^"]+)"/g)].map(match => match[1]).sort(),
    ['/browser-results', '/data', '/dev/shm', '/tmp']);
});

test('guarded loopback policy adds only the authenticated PDF renderer port', () => {
  const source = fs.readFileSync(new URL('../player-guard.c', import.meta.url), 'utf8');
  assert.match(source, /struct port_rule ports\[\] = \{\{3, 3000\}, \{3, 3001\}\};/);
  const allowed = req => pdfRequestAllowed(req, 'owned-token');
  assert.equal(allowed({ method: 'GET', url: '/health', headers: {} }), true);
  assert.equal(allowed({ method: 'POST', url: '/render', headers: { authorization: 'Bearer owned-token' } }), true);
  assert.equal(allowed({ method: 'POST', url: '/render', headers: { authorization: 'Bearer wrong' } }), false);
  assert.equal(allowed({ method: 'POST', url: '/other', headers: { authorization: 'Bearer owned-token' } }), false);
});

test('trace records bounded stage boundaries and sanitized in-flight tails', () => {
  const report = { trace: [] };
  appendTrace(report, 'sentinel-write', 'start');
  appendTrace(report, 'sentinel-write', 'end');
  appendTrace(report, 'health', 'start');
  appendTrace(report, 'health', 'end');
  assert.deepEqual(report.trace.map(row => [row.name, row.state]), [
    ['sentinel-write', 'start'], ['sentinel-write', 'end'],
    ['health', 'start'], ['health', 'end'],
  ]);
  assert(report.trace.filter(row => row.state !== 'start').every(row => Number.isSafeInteger(row.elapsedMs) && row.elapsedMs >= 0));
  assert.throws(() => appendTrace(report, 'health', 'unknown'), /trace state/);
  assert.throws(() => appendTrace(report, 'health', 'start', { command: 'private' }), /trace details/);
  assert.throws(() => appendTrace(report, 'health', 'start', { env: {} }), /trace details/);
  const backwards = { trace: [{ name: 'old', state: 'start', atMs: Number.MAX_SAFE_INTEGER }] };
  assert.throws(() => appendTrace(backwards, 'new', 'start'), /backwards/);
  const capped = { trace: [] };
  for (let index = 0; index < 32; index++) appendTrace(capped, 'stage-' + index, 'start');
  assert.throws(() => appendTrace(capped, 'overflow', 'start'), /entry cap/);

  const now = performance.now(), inflight = { trace: [] };
  captureInFlight(inflight, [{ stage: 'native-smoke', startedAt: now - 12, stdout: 'x'.repeat(5000), stderr: 'pw:browser <launching> private command\nkept error' }], now);
  assert.equal(inflight.inFlight.length, 1);
  assert.equal(Buffer.byteLength(inflight.inFlight[0].stdoutTail), 4096);
  assert(!inflight.inFlight[0].stderrTail.includes('<launching>'));
  assert(inflight.inFlight[0].stderrTail.includes('kept error'));
  assert.throws(() => captureInFlight(inflight, Array.from({ length: 9 }, () => ({ stage: 'x', startedAt: now, stdout: '', stderr: '' })), now), /in-flight entry cap/);
});

test('wire probe completes with a graceful FIN and no loopback reset', async () => {
  const sockets = new Set();
  let ended = false, serverError;
  let settle;
  const completed = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const server = net.createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    socket.once('end', () => { ended = true; settle.resolve(); });
    socket.once('error', error => { serverError = error; settle.reject(error); });
    socket.end('owned');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  try {
    await Promise.race([
      probeTcp(port),
      new Promise((_, reject) => setTimeout(() => reject(new Error('wire probe waited for server close')), 500)),
    ]);
    await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error('server did not observe FIN')), 500))]);
    assert.equal(serverError, undefined); assert.equal(ended, true);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
  const closed = net.createServer();
  await new Promise((resolve, reject) => { closed.once('error', reject); closed.listen(0, '127.0.0.1', resolve); });
  const closedPort = closed.address().port;
  await new Promise((resolve, reject) => closed.close(error => error ? reject(error) : resolve()));
  await assert.rejects(probeTcp(closedPort));
});

test('app and browser sidecars preserve aggregate resources and independent task guards', () => {
  const profiles = Object.values(SIDECAR_PROFILES);
  assert.equal(profiles.reduce((sum, profile) => sum + profile.memoryMiB, 0), 1024);
  assert.equal(profiles.reduce((sum, profile) => sum + Number(profile.cpus), 0), 1.5);
  assert.equal(profiles.reduce((sum, profile) => sum + Object.values(profile.writable).reduce((a, b) => a + b, 0), 0), 40);
  for (const role of ['app', 'browser']) {
    const browserNetwork = 'container:' + 'a'.repeat(64);
    const args = sidecarLaunchArgs('owned-' + role, role, role === 'app' ? 'none' : browserNetwork);
    assert.equal(args[args.indexOf('--pids-limit') + 1], '128');
    assert.equal(args[args.indexOf('--cpus') + 1], SIDECAR_PROFILES[role].cpus);
    assert.equal(args[args.indexOf('--memory') + 1], SIDECAR_PROFILES[role].memoryMiB + 'm');
    assert(args.includes('--read-only'));
    assert.equal(args[args.indexOf('--cap-drop') + 1], 'ALL');
    assert.equal(args[args.indexOf('--network') + 1], role === 'app' ? 'none' : browserNetwork);
  }
});

test('phase task roles cover the owned tree and reject ambiguous process ownership', () => {
  const rows = [
    {pid: 10, ppid: 1, name: 'player-guard', threads: 1},
    {pid: 20, ppid: 10, name: 'node', threads: 18},
    {pid: 30, ppid: 10, name: 'node', threads: 20},
    {pid: 40, ppid: 30, name: 'chrome-headless', threads: 31},
    {pid: 41, ppid: 30, name: 'chrome_crashpad', threads: 3},
  ];
  assert.deepEqual(summarizeTaskCounts(rows, 30, 10), {
    processes: 5, threads: 73, vanished: 0,
    roles: {
      guard: {processes: 1, threads: 1},
      'app-node': {processes: 1, threads: 18},
      'automation-node': {processes: 1, threads: 20},
      chromium: {processes: 1, threads: 31},
      crashpad: {processes: 1, threads: 3},
      unknown: {processes: 0, threads: 0},
    },
  });
  assert.equal(summarizeTaskCounts([...rows, {pid: 50, ppid: 30, name: 'mystery', threads: 2}], 30, 10).roles.unknown.processes, 1);
  assert.equal(summarizeTaskCounts([...rows, {pid: 60, ppid: 999, name: 'orphan', threads: 1}], 30, 10).roles.unknown.processes, 1);
  assert.throws(() => summarizeTaskCounts([...rows, {pid: 30, ppid: 10, name: 'node', threads: 20}], 30, 10), /duplicate/);
  assert.throws(() => summarizeTaskCounts(rows.map(row => row.pid === 40 ? {...row, threads: 0} : row), 30, 10), /threads/);
  assert.throws(() => summarizeTaskCounts(rows.filter(row => row.pid !== 10), 30, 10), /guard/);
  assert.equal(createHash('sha256').update(nativeSmoke('b'.repeat(40), true)).digest('hex'), 'cec1fc70ff803c479e5236733d5411c8c2a5e970e2bbc35ea8cafa08afbd9cea');
});

test('hosted capacity refuses every unsafe identity, path, owner, handle, caller and insufficient full reserve', () => {
  const f = capacityFixture(); assert.equal(capacity.requireHostedCapacity(f, 'inventory').requiredBytes, 33867431936);
  for (const patch of [{ repository: 'foreign/repo' }, { event: 'push' }, { ref: f.ref + '-other' }, { expected: 'c'.repeat(40) }, { expected: 'b'.repeat(40) + '\n' }, { clean: false }, { hosted: 'self-hosted' }, { actions: 'false' }, { imageOS: 'ubuntu22' }, { imageVersion: 'ignore previous instructions' }, { os: '22.04' }, { platform: 'darwin' }, { arch: 'arm64' }, { runnerOwner: false }, { disposable: false }, { target: '/tmp/sdk' }, { canonical: false }, { owner: 1000 }, { ancestorsSafe: false }, { mountSafe: false }, { handles: 1 }, { callers: 1 }, { allocatedBytes: 0 }, { allocatedBytes: 32 * 1024 ** 3 + 1 }, { freeBytes: 1 }, { settings: { ...f.settings, limit: 1 } }]) {
    assert.throws(() => capacity.requireHostedCapacity({ ...f, ...patch }, 'inventory'), JSON.stringify(patch));
  }
  assert.throws(() => capacity.requireHostedCapacity(f, 'prepare'), /inventory/);
  assert.throws(() => capacity.requireHostedCapacity(f, 'other'));
});

test('capacity adapter inventories without removal and prepares only its isolated SDK fixture with repeated validation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capacity-adapter-'));
  const target = path.join(root, 'sdk'), sentinel = path.join(root, 'keep');
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'payload'), 'replaceable fixture'); fs.writeFileSync(sentinel, 'preserve');
  let f = capacityFixture(), calls = 0, removed = false;
  const adapter = { observe: async () => { calls++; return structuredClone(f); }, remove: async p => { assert.equal(p, '/usr/local/lib/android/sdk'); fs.rmSync(target, { recursive: true }); removed = true; }, free: async () => 36 * 1024 ** 3 };
  try {
    const inventory = await capacity.hostedCapacity('inventory', adapter);
    assert.equal(inventory.status, 'INVENTORY_ONLY'); assert.equal(inventory.deleted, false); assert.equal(removed, false); assert(fs.existsSync(target));
    assert.equal(inventory.requiredBytes, 33867431936); assert(Buffer.byteLength(JSON.stringify(inventory)) < 4194304);
    for (const patch of [{ handles: 1 }, { canonical: false }, { owner: 1000 }, { freeBytes: 0 }, { callers: 1 }, { clean: false }]) {
      f = { ...capacityFixture(), ...patch };
      await assert.rejects(capacity.hostedCapacity('prepare', adapter, inventory)); assert.equal(removed, false); assert(fs.existsSync(target));
    }
    f = capacityFixture();
    for (const patch of [{ commit: 'c'.repeat(40) }, { imageVersion: '20261102.1.0' }, { settings: { ...f.settings, maxEntries: 99999 } }, { status: 'PREPARED' }, { deleted: true }]) await assert.rejects(capacity.hostedCapacity('prepare', adapter, { ...inventory, ...patch }));
    const prepared = await capacity.hostedCapacity('prepare', adapter, inventory);
    assert.equal(prepared.status, 'PREPARED'); assert.equal(prepared.deleted, true); assert.equal(prepared.freeAfterBytes, 36 * 1024 ** 3);
    assert.equal(fs.existsSync(target), false); assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve'); assert(calls > 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('capacity subprocess kills hung or cancelled groups and rejects excessive or failed output', async () => {
  await assert.rejects(capacity.capacityCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 100 }), /deadline/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(capacity.capacityCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal }), /cancel/);
  await assert.rejects(capacity.capacityCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(65537))']), /output/);
  await assert.rejects(capacity.capacityCommand(process.execPath, ['-e', 'process.exit(1)']), /command/);
  assert.equal(await capacity.capacityCommand(process.execPath, ['-e', 'process.stdout.write("42")']), '42');
});

test('official SDK leaf mode 777 is accepted while actual writable parent mode is refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-mode-'));
  const leaf = path.join(root, 'sdk'); fs.mkdirSync(leaf); fs.chmodSync(root, 0o755); fs.chmodSync(leaf, 0o777);
  try {
    assert.equal(capacity.capacityModes(fs.statSync(leaf).mode, [fs.statSync(root).mode]), true);
    fs.chmodSync(root, 0o777); assert.equal(capacity.capacityModes(fs.statSync(leaf).mode, [fs.statSync(root).mode]), false);
    fs.chmodSync(root, 0o755); fs.chmodSync(leaf, 0o755); assert.equal(capacity.capacityModes(fs.statSync(leaf).mode, [fs.statSync(root).mode]), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('capacity failures retain numeric cause and never retain hostile state fields or remove SDK', async () => {
  const f = capacityFixture(); f.allocatedBytes = 1; f.private = 'SECRET'; let removed = false;
  await assert.rejects(capacity.hostedCapacity('inventory', { observe: async () => f, remove: async () => { removed = true; } }), error => {
    assert.equal(error.capacityEvidence.status, 'REFUSED'); assert.equal(error.capacityEvidence.phase, 'validate');
    assert.equal(error.capacityEvidence.observed.requiredBytes, 33867431936); assert.equal(error.capacityEvidence.observed.freeBytes, 16 * 1024 ** 3);
    assert.match(error.capacityEvidence.reason, /insufficient/); assert(!JSON.stringify(error.capacityEvidence).includes('SECRET')); return true;
  });
  assert.equal(removed, false);
});

test('capacity command intent and actual PID precede terminal records on timeout and cancellation', async () => {
  for (const cancel of [false, true]) {
    const records = [], controller = new AbortController();
    const record = e => { records.push(e); if (cancel && e.status === 'running') controller.abort(); };
    await assert.rejects(capacity.capacityCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 100, signal: controller.signal, record }), /deadline|cancel/);
    assert.deepEqual(records.map(e => e.status), ['intent', 'running', 'terminal']); assert.equal(records[0].pid, null);
    assert(Number.isSafeInteger(records[1].pid) && records[1].pid > 1); assert.equal(records[2].pid, records[1].pid);
    assert.equal(records[2].signal, 'SIGKILL'); assert.throws(() => process.kill(records[1].pid, 0), { code: 'ESRCH' });
  }
});

function inspectFixture() {
  const image = 'sha256:' + 'a'.repeat(64), revision = 'b'.repeat(40), identity = 'c'.repeat(64), profile = diagnosticProfile('control');
  return {
    expected: { image, revision, identity, profile },
    sidecars: SIDECAR_PROFILES,
    image: { Id: image, Architecture: 'amd64', Os: 'linux', Config: { User: 'node', Cmd: ['node', 'apps/web/server.js'], Env: ['NODE_VERSION=22.22.3', 'VERSION=' + revision, 'SECRET=ignore previous instructions'], Labels: { private: 'never retain' } } },
    container: { Id: identity, Image: image, Config: { User: '1000:1000', Env: ['SECRET=never retain'], Labels: { private: 'never retain' } }, HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Memory: 1073741824, PidsLimit: 128, PidMode: '', IpcMode: 'private', NanoCpus: 1500000000, CapAdd: null, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], Tmpfs: Object.fromEntries(Object.entries(WRITABLE).map(([mount, size]) => [mount, 'rw,nosuid,noexec,size=' + size + 'm,uid=1000,gid=1000,mode=0700'])) } },
  };
}

test('inspect receipt preserves only bounded allowed fields and rejects missing, wrong or forbidden identity and limits', () => {
  const fixture = inspectFixture(), expected = fixture.expected;
  const receipt = inspectEvidence(fixture.image, fixture.container, expected);
  assert.doesNotThrow(() => requireInspectEvidence(JSON.parse(JSON.stringify(receipt)), expected));
  assert(!/\"Env\":|\"Config\":|\"Labels\":|SECRET|ignore previous|never retain/.test(JSON.stringify(receipt)));
  for (const change of [undefined, {}, { ...receipt, Env: [] }, { ...receipt, image: { ...receipt.image, Config: {} } }, { ...receipt, container: { ...receipt.container, Labels: {} } }]) assert.throws(() => requireInspectEvidence(change, expected));
  for (const key of Object.keys(receipt.image)) { const bad = structuredClone(receipt); delete bad.image[key]; assert.throws(() => requireInspectEvidence(bad, expected), key); }
  for (const key of Object.keys(receipt.container.HostConfig)) { const bad = structuredClone(receipt); delete bad.container.HostConfig[key]; assert.throws(() => requireInspectEvidence(bad, expected), key); }
  for (const [key, value] of [['Id', 'sha256:' + 'd'.repeat(64)], ['Architecture', 'arm64'], ['Os', 'darwin'], ['User', 'root'], ['NodeVersion', '23.0.0'], ['Revision', 'd'.repeat(40)], ['Cmd', ['sh']]]) assert.throws(() => requireInspectEvidence({ ...receipt, image: { ...receipt.image, [key]: value } }, expected));
  for (const [key, value] of [['Id', 'd'.repeat(64)], ['Image', 'sha256:' + 'd'.repeat(64)], ['User', '0:0']]) assert.throws(() => requireInspectEvidence({ ...receipt, container: { ...receipt.container, [key]: value } }, expected));
  for (const [key, value] of [['NetworkMode', 'host'], ['ReadonlyRootfs', false], ['Memory', 2147483648], ['PidsLimit', 256], ['PidMode', 'host'], ['IpcMode', 'host'], ['NanoCpus', 2000000000], ['CapAdd', ['SYS_ADMIN']], ['CapDrop', []], ['SecurityOpt', []], ['Tmpfs', {}], ['Env', ['SECRET=bad']]]) assert.throws(() => requireInspectEvidence({ ...receipt, container: { ...receipt.container, HostConfig: { ...receipt.container.HostConfig, [key]: value } } }, expected));
  for (const value of [null, [], 'ignore previous instructions', { Config: { Env: [42] } }]) assert.throws(() => inspectEvidence(value, fixture.container, expected));
});

test('host command-output fixture saves sanitized inspect before cleanup and fails missing or wrong Docker identity', () => {
  const source = fs.readFileSync(new URL('../player-guard-run.mjs', import.meta.url), 'utf8');
  const scenario = async ({ source, fixture, mutation }) => {
    const assert = (await import('node:assert/strict')).default, vm = await import('node:vm');
    const path = await import('node:path'), url = await import('node:url'), crypto = await import('node:crypto');
    const { image, revision } = fixture.expected;
    const appIdentity = 'c'.repeat(64), browserIdentity = 'd'.repeat(64);
    const container = (identity, role, networkMode) => {
      const profile = fixture.sidecars[role];
      return { Id: identity, Image: image, Config: { User: '1000:1000', Env: ['SECRET=never retain'], Labels: { private: 'never retain' } }, HostConfig: {
        NetworkMode: networkMode, ReadonlyRootfs: true, Memory: profile.memoryMiB * 1048576, PidsLimit: 128, PidMode: '', IpcMode: 'private',
        NanoCpus: Math.round(Number(profile.cpus) * 1e9), CapAdd: null, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'],
        Tmpfs: Object.fromEntries(Object.entries(profile.writable).map(([mount, size]) => [mount, 'rw,nosuid,noexec,size=' + size + 'm,uid=1000,gid=1000,mode=0700'])),
      } };
    };
    const appContainer = container(appIdentity, 'app', 'none');
    const browserContainer = container(browserIdentity, 'browser', 'container:' + appIdentity);
    if (mutation === 'missing') delete appContainer.Id;
    if (mutation === 'wrong') appContainer.Image = 'sha256:' + 'e'.repeat(64);
    const filename = '/source/deploy/player-guard-run.mjs', writes = new Map(), events = [];
    const removed = new Set();
    const processState = { platform: 'linux', arch: 'x64', argv: ['node', filename, '--image', image, '--revision', revision], env: { GITHUB_ACTIONS: 'true', KEYSPILLI_EVIDENCE: '/evidence', KEYSPILLI_SCRATCH: '/scratch', KEYSPILLI_NATIVE_PIANO_DIR: '/piano' } };
    const command = (exe, args) => {
      if (exe === 'git') return args[0] === 'rev-parse' ? revision : '';
      if (exe === 'gcc') return '';
      assert.equal(exe, 'docker'); events.push(args[0]);
      if (args[0] === 'image') return JSON.stringify([fixture.image]);
      if (args[0] === 'create') return args[args.indexOf('--name') + 1].endsWith('-app') ? appIdentity : browserIdentity;
      if (args[0] === 'inspect') return args[1] === '--format' ? JSON.stringify({ Pid: 0, ExitCode: 0, OOMKilled: false }) : JSON.stringify([args[1].endsWith('-app') ? appContainer : browserContainer]);
      if (args[0] === 'start') return args[1] === '-a' ? JSON.stringify({ kind: 'keyspilli-guard-admission', status: 'passed', revision, runtime: { node: 'v22.22.3', platform: 'linux', arch: 'x64', uid: 1000 }, survivorPid: 7 }) + '\n' + JSON.stringify({ phase: 'reaper', remainingChildren: 0, reaped: [{ pid: 7, signal: 9 }] }) : '';
      if (args[0] === 'ps') { const name = args.at(-1).slice(7, -1); return removed.has(name) ? '' : (name.endsWith('-app') ? appIdentity : browserIdentity); }
      if (args[0] === 'rm') { removed.add(args.at(-1)); return ''; }
      if (args[0] === 'stop') return '';
      throw Error('unexpected Docker command');
    };
    const modules = { 'node:fs': { default: { realpathSync: p => p, mkdtempSync: () => '/scratch/owned', readFileSync: () => Buffer.from('owned'), readdirSync: () => ['guard'], statSync: () => ({ size: 5 }), rmSync: () => { assert.equal(removed.size, 2); events.push('scratch-removed'); }, writeFileSync: (p, body) => { if (p.endsWith('-inspect.json')) { assert.equal(removed.size, 0); events.push('inspect-saved'); } writes.set(p, body); } } }, 'node:path': { default: path.default }, 'node:net': { default: {} }, 'node:dgram': { default: {} }, 'node:assert/strict': { default: assert }, 'node:crypto': crypto, 'node:module': { createRequire() {} }, 'node:url': url, 'node:child_process': { execFileSync: command, spawn() { throw Error('diagnostic execution forbidden'); }, spawnSync() { return { stdout: 'owned app log\n', stderr: '' }; } } };
    const context = vm.createContext({ process: processState, Buffer, console, setTimeout, clearTimeout });
    context.process = vm.runInContext('(' + JSON.stringify(processState) + ')', context);
    const module = new vm.SourceTextModule(source, { context, initializeImportMeta: meta => { meta.url = url.pathToFileURL(filename).href; } });
    await module.link(name => { const values = modules[name]; assert(values, name); return new vm.SyntheticModule(Object.keys(values), function() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context }); });
    let rejected = false;
    try { await module.evaluate(); } catch (error) { assert.match(String(error), /Player guard qualification failed/); rejected = true; }
    const receipt = JSON.parse(writes.get('/evidence/player-guard-admission.json'));
    assert.equal(receipt.status, mutation ? 'failed' : 'passed'); assert.equal(rejected, Boolean(mutation));
    assert(receipt.containerRemoved && receipt.scratchRemoved); assert(!/SECRET|Env|Labels|ignore previous|never retain/.test(JSON.stringify(receipt)));
    if (!mutation) { assert.deepEqual(receipt.inspect.image.Id, image); assert.equal(receipt.inspect.container.Id, browserIdentity); assert.equal(receipt.appInspect.container.Id, appIdentity); assert(events.includes('inspect-saved')); assert(events.indexOf('inspect-saved') < events.indexOf('start')); assert.deepEqual(JSON.parse(writes.get('/evidence/player-guard-inspect.json')), receipt.inspect); assert.deepEqual(JSON.parse(writes.get('/evidence/player-guard-app-inspect.json')), receipt.appInspect); }
    else { assert(!events.includes('start')); assert(receipt.inspectError); }
    console.log(JSON.stringify({ kind: 'source-inspect-command-fixture', provenance: 'local VM Docker command-output fixture; no Docker execution', mutation, receipt }));
  };
  for (const mutation of ['', 'missing', 'wrong']) {
    const result = JSON.parse(runModuleScenario(scenario, { source, fixture: inspectFixture(), mutation }));
    assert.equal(result.receipt.status, mutation ? 'failed' : 'passed');
    console.log(JSON.stringify(result));
  }
});

test('diagnostic profiles reject arbitrary settings and preserve control isolation in both contrasts', () => {
  for (const value of ['', '4g', 'control\n', '__proto__', null, { memoryMiB: 8192 }, { writable: { '/tmp': 512 } }]) assert.throws(() => diagnosticProfile(value));
  const control = diagnosticProfile('control'), writable = diagnosticProfile('writable'), ram = diagnosticProfile('ram');
  for (const profile of [{ memoryMiB: 8192, writable: control.writable }, { memoryMiB: 1024, writable: { '/tmp': 512 } }]) assert.throws(() => guardLaunchArgs('owned', profile));
  assert.deepEqual(ram.writable, control.writable); assert.equal(writable.memoryMiB, control.memoryMiB);
  assert.equal(ram.memoryMiB, 4096); assert.equal(control.memoryMiB, 1024);
  for (const p of [control, writable, ram]) {
    assert(Object.values(p.writable).reduce((a, b) => a + b, 16) <= 512);
    const args = guardLaunchArgs('owned', p);
    for (const pair of [['--network', 'none'], ['--user', '1000:1000'], ['--cap-drop', 'ALL'], ['--security-opt', 'no-new-privileges'], ['--cpus', '1.5'], ['--pids-limit', '128']]) assert.equal(args[args.indexOf(pair[0]) + 1], pair[1]);
    assert(args.includes('--read-only')); assert.equal(args[args.indexOf('--memory') + 1], p.memoryMiB + 'm');
  }
});

test('failed cell output retains the failed inner packet and rejects misleading, stale or clipped success', () => {
  const revision = 'b'.repeat(40), result = { kind: 'keyspilli-guard-admission', revision, status: 'failed', functional: { error: 'page crashed', results: [{ kind: 'sampled-playback', mode: 'original' }] } };
  const output = JSON.stringify(result) + '\n' + JSON.stringify({ phase: 'reaper', remainingChildren: 0 });
  assert.deepEqual(parseGuardOutput(output, revision).result, result);
  for (const text of ['passed', '{"status":"passed"}', output.slice(0, -2), output + '\n' + JSON.stringify(result)]) assert.throws(() => parseGuardOutput(text, revision));
  assert.throws(() => parseGuardOutput(output, 'c'.repeat(40)));
});

test('diagnostic collection fails closed on absent crash, resource, launch or cleanup evidence', () => {
  const mounts = Object.fromEntries(Object.keys(SIDECAR_PROFILES.browser.writable).map(mount => [mount, { blocks: 15, free: 1, blockSize: 4096, files: 4, freeFiles: 1 }]));
  const appMounts = Object.fromEntries(Object.keys(SIDECAR_PROFILES.app.writable).map(mount => [mount, { blocks: 8, free: 2, blockSize: 4096, files: 3, freeFiles: 1 }]));
  const revision = 'b'.repeat(40), stderr = '2026-11-04T00:00:00Z pw:browser <launching> /owned/chromium --headless\n2026-11-04T00:00:00Z pw:browser <launched> pid=44\n2026-11-04T00:00:01Z pw:browser [pid=44] <process did exit: exitCode=1, signal=null>\n';
  const packet = { revision, trace: [{ name: 'sentinel-write', state: 'start', atMs: 1 }, { name: 'sentinel-write', state: 'end', atMs: 2, elapsedMs: 1 }], cleanupTimeouts: [], inspect: { container: { Id: 'd'.repeat(64) } }, appInspect: { container: { Id: 'e'.repeat(64) } }, appState: { OOMKilled: false }, logs: [{ args: ['-e', nativeSmoke(revision, true)], stderr }], functional: { phaseTruncated: false, browserObservation: { armed: true, commandLineSource: 'playwright-launcher-stderr', events: [{ kind: 'browser-launched' }], stderrSource: 'guarded-child-stderr' } }, browserProcesses: browserProcessEvidence(stderr), resourceBarrierAcknowledged: true, resources: { pid: 42, cgroup: '/owned/d' + 'd'.repeat(63), beforeTeardown: true, memory: { 'memory.events': 'oom 0\noom_kill 0\n', 'memory.peak': '12', 'memory.max': '671088640', 'pids.events': 'max 0\n' }, mounts, limits: 'Max processes 128 128 processes' }, appResources: { pid: 43, cgroup: '/owned/e' + 'e'.repeat(63), memory: { 'memory.events': 'oom 0\noom_kill 0\n', 'memory.peak': '11', 'memory.max': '402653184', 'pids.events': 'max 0\n' }, mounts: appMounts, limits: 'Max processes 128 128 processes' }, containerRemoved: true, browserContainerRemoved: true, appContainerRemoved: true, scratchRemoved: true, stdoutClipped: false, stderrClipped: false };
  packet.logBytes = Buffer.byteLength(stderr);
  packet.mountUsage = accumulateMountUsage(undefined, packet.resources);
  packet.appMountUsage = accumulateMountUsage(undefined, packet.appResources, Object.keys(SIDECAR_PROFILES.app.writable));
  assert.doesNotThrow(() => requireDiagnosticEvidence(packet));
  const two = stderr + stderr.replaceAll('pid=44', 'pid=45');
  const twoPacket = { ...packet, logs: [{ args: ['-e', nativeSmoke(revision, true)], stderr: two }],
    logBytes: Buffer.byteLength(two), browserProcesses: browserProcessEvidence(two),
    functional: { phaseTruncated: false, browserObservation: { ...packet.functional.browserObservation,
      events: [{ kind: 'browser-launched' }, { kind: 'browser-disconnected' }, { kind: 'browser-launched' }] } } };
  assert.doesNotThrow(() => requireDiagnosticEvidence(twoPacket, 2));
  assert.throws(() => requireDiagnosticEvidence(packet, 2), /launch count/);
  assert.throws(() => requireDiagnosticEvidence(twoPacket), /launch count/);
  const counts = (phase, state) => JSON.stringify({
    kind: 'keyspilli-native-phase', phase, state, processes: 7, threads: 41, vanished: 0,
    roles: {
      guard: {processes: 1, threads: 1},
      'app-node': {processes: 1, threads: 10},
      'automation-node': {processes: 1, threads: 10},
      chromium: {processes: 3, threads: 15},
      crashpad: {processes: 1, threads: 5},
      unknown: {processes: 0, threads: 0},
    },
  }) + '\n';
  const three = ['original', 'chords', 'silence'].map((mode, index) => {
    const [argv, launch, exit] = stderr.replaceAll('pid=44', 'pid=' + (44 + index)).trimEnd().split('\n');
    return counts(mode + '-browser-startup', 'entry') + argv + '\n' + launch + '\n'
      + counts(mode + '-browser-startup', 'exit') + counts(mode === 'silence' ? mode : mode + '-capture', 'entry')
      + counts(mode + '-browser-teardown', 'entry') + exit + '\n' + counts(mode + '-browser-teardown', 'exit');
  }).join('');
  const comparison = stream => ({
    ...packet, logs: [{ args: ['-e', nativeSmoke(revision, true)], stderr: stream }],
    logBytes: Buffer.byteLength(stream), browserProcesses: browserProcessEvidence(stream),
    functional: { phaseTruncated: false, browserObservation: { ...packet.functional.browserObservation,
      events: ['original', 'chords', 'silence'].map(mode => ({kind: 'browser-launched', phase: mode + '-browser-startup'})) } },
  });
  assert.doesNotThrow(() => requireDiagnosticEvidence(comparison(three), 3));
  assert.throws(() => requireDiagnosticEvidence(comparison(three.replace('"threads":41', '"threads":2')), 3), /counts/);
  const unknownRole = three.replace('"chromium":{"processes":3,"threads":15}', '"chromium":{"processes":2,"threads":14}')
    .replace('"unknown":{"processes":0,"threads":0}', '"unknown":{"processes":1,"threads":1}');
  assert.throws(() => requireDiagnosticEvidence(comparison(unknownRole), 3), /unknown/);
  assert.throws(() => requireDiagnosticEvidence(comparison(three.replace('"threads":5', '"threads":4')), 3), /role thread totals/);
  const withoutRoles = three.split('\n').map(line => {
    if (!line.startsWith('{"kind":"keyspilli-native-phase",')) return line;
    const {roles: _roles, ...row} = JSON.parse(line); return JSON.stringify(row);
  }).join('\n');
  assert.throws(() => requireDiagnosticEvidence(comparison(withoutRoles), 3), /role task evidence/);
  assert.throws(() => requireDiagnosticEvidence(comparison(three.replace(counts('original-browser-teardown', 'exit'), '')), 3), /phase order/);
  const exit = three.split('\n').find(line => line.includes('[pid=44] <process did exit')) + '\n';
  const lateExit = three.replace(exit, '').replace(counts('chords-browser-startup', 'entry'), counts('chords-browser-startup', 'entry') + exit);
  assert.throws(() => requireDiagnosticEvidence(comparison(lateExit), 3), /teardown/);
  const guardNegative = { command: '/player-guard', args: ['/usr/local/bin/node','-e','process.stdout.write("x".repeat(4096));setInterval(()=>{},1000)'], code: null, signal: 'SIGKILL', stdout: 'x'.repeat(1024), stderr: '', clipped: true };
  const withExpectedNegative = {...packet,logBytes:4096+packet.logBytes,logs:[guardNegative,packet.logs[0]]};
  assert.doesNotThrow(() => requireDiagnosticEvidence(withExpectedNegative), 'intentional output-limit guard negative is retained separately from valid smoke');
  assert.throws(() => requireDiagnosticEvidence({...withExpectedNegative,logs:[guardNegative,{...packet.logs[0],clipped:true}]}), /clipped inner launcher stream/);
  assert.throws(() => requireDiagnosticEvidence({...packet,mountUsage:undefined}));
  assert.throws(() => requireDiagnosticEvidence({...packet,mountUsage:{...packet.mountUsage,sampleCount:0}}));
  assert.throws(() => requireDiagnosticEvidence({...packet,appMountUsage:undefined}));
  assert.throws(() => requireDiagnosticEvidence({...packet,resources:{...packet.resources,memory:{...packet.resources.memory,'pids.events':'max 1\n'}}}), /PID limit/);
  assert.throws(() => requireDiagnosticEvidence({...packet,appResources:{...packet.appResources,memory:{...packet.appResources.memory,'pids.events':'max 1\n'}}}), /PID limit/);
  assert.throws(() => requireDiagnosticEvidence({...packet,resources:{...packet.resources,memory:{...packet.resources.memory,'memory.events':'oom 0\noom_kill 1\n'}}}), /OOM event/);
  for (const key of ['memory.peak', 'memory.max', 'memory.events']) assert.throws(() => requireDiagnosticEvidence({ ...packet, resources: { ...packet.resources, memory: { ...packet.resources.memory, [key]: 'passed' } } }));
  for (const change of [{ functional: undefined }, { resources: undefined }, { appResources: undefined }, { appState: { OOMKilled: true } }, { resourceBarrierAcknowledged: false }, { cancelled: true }, { deadlineExceeded: true }, { trace: undefined }, { trace: [] }, { trace: [{ name: 'stage', state: 'start', atMs: 1 }, { name: 'stage', state: 'start', atMs: 2 }] }, { trace: [{ name: 'stage', state: 'end', atMs: 1, elapsedMs: 1 }] }, { inFlight: Array.from({ length: 9 }, () => ({ stage: 'stage', elapsedMs: 1, stdoutTail: '', stderrTail: '' })) }, { cleanupTimeouts: [{ stage: 'stage', elapsedMs: 1 }] }, { resources: { ...packet.resources, memory: {} } }, { resources: { ...packet.resources, mounts: { '/tmp': mounts['/tmp'] } } }, { browserProcesses: [{ kind: 'launch', pid: 44 }, { kind: 'exit', pid: 45 }] }, { functional: { browserObservation: { armed: true, commandLine: [], events: [] } } }, { containerRemoved: false }, { browserContainerRemoved: false }, { appContainerRemoved: false }, { stdoutClipped: true }, { stderrClipped: true }]) assert.throws(() => requireDiagnosticEvidence({ ...packet, ...change }));
  assert.throws(() => requireDiagnosticEvidence({ ...packet, trace: [{ name: 'stage', state: 'start', atMs: 1, command: 'private' }, { name: 'stage', state: 'end', atMs: 2, elapsedMs: 1 }] }), /trace start fields/);
  assert.throws(() => requireDiagnosticEvidence({ ...packet, oversized: 'x'.repeat(1048576) }), /receipt exceeds cap/);
  for (const text of ['', stderr.replace(/^.*<launching>.*\n/m, ''), stderr.replace(/^.*<launched>.*\n/m, ''), stderr.replace(/^.*<process did exit:.*\n/m, ''), stderr.replace('[pid=44]', '[pid=45]'), stderr.replace('pid=44', 'pid=0')]) {
    assert.throws(() => requireDiagnosticEvidence({ ...packet, logs: [{ args: ['-e', nativeSmoke(revision, true)], stderr: text }], browserProcesses: browserProcessEvidence(text) }));
  }
  assert.throws(() => requireDiagnosticEvidence({ ...packet, logs: [] }));
  assert.throws(() => requireDiagnosticEvidence({ ...packet, revision: 'c'.repeat(40) }));
  assert.throws(() => requireDiagnosticEvidence({ ...packet, logBytes: 65537 }));
  assert.throws(() => requireDiagnosticEvidence({ ...packet, logs: [{ ...packet.logs[0], clipped: true }] }));
  const unknownExit = stderr.replace('exitCode=1', 'exitCode=null');
  assert.throws(() => requireDiagnosticEvidence({ ...packet, logs: [{ ...packet.logs[0], stderr: unknownExit }], browserProcesses: browserProcessEvidence(unknownExit) }));
});

test('sampled mount usage retains the accumulated high usage when final resources are released', () => {
  const sample = (free, freeFiles) => ({pid:42,cgroup:'/owned',mounts:Object.fromEntries(Object.keys(WRITABLE).map(mount=>[mount,{blocks:100,free,blockSize:4096,files:1000,freeFiles}]))});
  let usage;
  for(const observation of [sample(80,950),sample(20,700),sample(95,980)])usage=accumulateMountUsage(usage,observation);
  assert.equal(usage.sampleCount,3);assert.equal(usage.pid,42);assert.equal(usage.cgroup,'/owned');
  assert.match(usage.interpretation,/lower bound.*not a true kernel peak/);
  for(const mount of Object.keys(WRITABLE))assert.deepEqual(usage.mounts[mount],{minFreeBytes:20*4096,maxUsedBytes:80*4096,minFreeInodes:700,maxUsedInodes:300});
  assert.throws(()=>accumulateMountUsage(usage,{...sample(95,980),pid:43}));
  assert.throws(()=>accumulateMountUsage(usage,{...sample(95,980),mounts:{}}));
  assert.throws(()=>accumulateMountUsage(usage,sample(101,980)));
});

test('browser process observations preserve exit signals without treating application text as process proof', () => {
  const stderr = '2026-11-04T00:00:00Z pw:browser <launched> pid=44\n2026-11-04T00:00:01Z pw:browser [pid=44] <process did exit: exitCode=null, signal=SIGBUS>\napp says pw:browser <launched> pid=99\n';
  assert.deepEqual(browserProcessEvidence(stderr), [{ kind: 'launch', pid: 44 }, { kind: 'exit', pid: 44, code: null, signal: 'SIGBUS' }]);
  assert.deepEqual(browserProcessEvidence('passed\n{"pw:browser":"<launched> pid=99"}'), []);
  assert.throws(() => browserProcessEvidence('pw:browser <launched> pid=44\n'.repeat(17)));
  const commandLineText = '/owned/path with spaces/chromium --flag=value with spaces';
  assert.deepEqual(browserProcessEvidence('pw:browser <launching> ' + commandLineText), [{ kind: 'argv', commandLineText }]);
  for (const line of ['<launching>', '<launched> pid=no', '<launched> pid=0', '<launched> pid=9999999999999999999999', '[pid=44] <process did exit: exitCode=wat, signal=null>', '[pid=0] <process did exit: exitCode=0, signal=null>']) assert.throws(() => browserProcessEvidence('pw:browser ' + line));
  assert.throws(() => browserProcessEvidence('pw:browser <launching> ' + 'x'.repeat(8193)));
  assert.throws(() => browserProcessEvidence('x'.repeat(65537)));
});

function runModuleScenario(scenario, source) {
  return execFileSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', `(${scenario.toString()})(${JSON.stringify(source)}).catch(error=>{console.error(error);process.exitCode=1;});`], { encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
}

test('generated diagnostic smoke restores launcher logging after sanitization before first Playwright import', () => {
  const scenario = async ({source, diagnostic}) => {
    const assert = (await import('node:assert/strict')).default, vm = await import('node:vm');
    const environment = {}, context = vm.createContext({ process: { env: environment } });
    let firstLoad = false;
    const chromium = { async launch() { return { async newContext() { return { on(name, callback) { callback({ waitForFunction: async () => {} }); } }; } }; } };
    const module = new vm.SourceTextModule(source, { context, importModuleDynamically: async () => {
      const verifier = new vm.SyntheticModule(['verifyNativePlayer'], function() { this.setExport('verifyNativePlayer', async () => { await (await chromium.launch()).newContext(); await Promise.resolve(); }); }, { context });
      await verifier.link(() => {}); await verifier.evaluate(); return verifier;
    } });
    await module.link(() => new vm.SyntheticModule(['createRequire'], function() { this.setExport('createRequire', () => () => { firstLoad = true; assert.equal(environment.DEBUG, diagnostic ? 'pw:browser' : undefined); return { chromium }; }); }, { context }));
    await module.evaluate(); assert.equal(firstLoad, true);
    console.log(JSON.stringify({ firstLoad, debug: environment.DEBUG ?? null }));
  };
  assert.equal(JSON.parse(runModuleScenario(scenario, {source:nativeSmoke('b'.repeat(40), true),diagnostic:true})).debug, 'pw:browser');
  assert.equal(JSON.parse(runModuleScenario(scenario, {source:nativeSmoke('b'.repeat(40)),diagnostic:false})).debug, null);
});

test('unsupported optional browser CDP does not block capture and early terminal observers are armed', () => {
  const source = fs.readFileSync(new URL('../../apps/web/scripts/verify-native-player.mts', import.meta.url), 'utf8');
  const scenario = async source => {
    const assert = (await import('node:assert/strict')).default, vm = await import('node:vm'), crypto = await import('node:crypto');
    const {stripTypeScriptTypes} = await import('node:module'), {EventEmitter} = await import('node:events');
    const files = new Map(), phases = [], memorySamples = [], revision = 'b'.repeat(40), processState = { pid: 2, ppid: 1, platform: 'linux', arch: 'x64', env: { KEYSPILLI_NATIVE_PROBE_SCOPE: 'owned-restore', KEYSPILLI_DATA_DIR: '/data' }, argv: [], memoryUsage: () => ({ rss: 64 * 1024 ** 2, heapTotal: 32 * 1024 ** 2, heapUsed: 16 * 1024 ** 2, external: 4 * 1024 ** 2, arrayBuffers: 3 * 1024 ** 2 }) };
    let gcCalls = 0;
    const context = vm.createContext({ process: processState, Buffer, URL, console: {log(){} }, setImmediate: (fn) => { fn(); return 0; }, gc: () => { gcCalls++; } });
    let captured = false, cdpCalls = 0, missingSamples = false, saturate = false, phaseBytes = 0;
    const page = new EventEmitter(), browser = new EventEmitter(), browserContext = new EventEmitter();
    browser.newBrowserCDPSession = async () => { cdpCalls++; throw Error('Browser.getBrowserCommandLine unsupported without --enable-automation'); };
    browser.close = async () => browser.emit('disconnected');
    browser.newContext = async () => browserContext;
    browserContext.route = async () => {};
    browserContext.newPage = async () => { browserContext.emit('page', page); return page; };
    browserContext.close = async () => {};
    const api = { get: async () => ({json:async()=>({version:revision,status:'healthy'})}), post: async (_url, options) => ({ok:()=>true,json:async()=>{const baseId='upload-'+crypto.createHash('sha256').update(options.data).digest('hex');return {baseId,songIds:[baseId+'-a']};}}), delete:async()=>({ok:()=>true}),dispose:async()=>{} };
    const modules = {
      'node:crypto': crypto,
      'node:fs': {readFileSync(p) {
        if (p === '/proc/1/status') return 'Name:\tplayer-guard\nPPid:\t0\nThreads:\t1\n';
        if (p === '/proc/2/status') return 'Name:\tnode\nPPid:\t1\nThreads:\t8\n';
        if (p === '/proc/3/status') throw Object.assign(Error('exited during sample'), {code:'ENOENT'});
        throw Error('unexpected read: ' + p);
      },readdirSync(p) {assert.equal(p, '/proc');return ['1','2','3','self','thread-self'];},
      statSync(){},writeFileSync:(p,b)=>files.set(p,b),writeSync(_fd, line){const row=JSON.parse(line);if(row.kind==='keyspilli-native-memory')memorySamples.push(row);else{phaseBytes += Buffer.byteLength(line); phases.push(row);}}},
      'node:path': await import('node:path'), 'node:url': await import('node:url'),
      'node:v8': await import('node:v8'),
      './native-phase-trace.ts': await import(new URL('./apps/web/scripts/native-phase-trace.ts', import.meta.url).href),
      './native-page-watch.ts': await import(new URL('./apps/web/scripts/native-page-watch.ts', import.meta.url).href),
      './native-task-counts.ts': {collectTaskCounts: () => ({processes: 2, threads: 9, vanished: 1, ...(saturate ? { note: 'x'.repeat(9000) } : {}), roles: {
        guard: {processes: 1, threads: 1}, 'app-node': {processes: 0, threads: 0}, 'automation-node': {processes: 1, threads: 8},
        chromium: {processes: 0, threads: 0}, crashpad: {processes: 0, threads: 0}, unknown: {processes: 0, threads: 0},
      }})},
      '@playwright/test': {chromium:{launch:async()=>browser},expect:value=>({toBe:expected=>assert.equal(value,expected),toEqual:expected=>assert.deepEqual(value,expected)}),request:{newContext:async()=>api}},
      '@keyspilli/midi': {parseMidi(){},parseMusicXmlNotes(){}},
      '../e2e/player-audio-capture': {capturePlayerClip:async()=>{captured=true;assert(browser.listenerCount('disconnected')>0);assert(page.listenerCount('crash')>0);assert(page.listenerCount('close')>0);if(missingSamples)return {sampleAssets:[]};page.emit('crash');throw Error('capture-boundary-sentinel');},savePlayerCapture(){}},
      '../src/lib/native-player-assets': {readNativePianoBank:()=>({assets:new Map(),sampleAssetPins:[{url:'https://pinned.invalid/piano.ogg',sha256:'a'.repeat(64)}]})},
    };
    const load = async name => {const values=modules[name];assert(values, name);const m=new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value] of Object.entries(values))this.setExport(key,value);},{context});await m.link(()=>{});await m.evaluate();return m;};
    const module = new vm.SourceTextModule(stripTypeScriptTypes(source), { context, importModuleDynamically: load });
    await module.link(load); await module.evaluate(); await module.namespace.verifyNativePlayer(revision, true);
    assert.equal(cdpCalls,0,'optional CDP must not become a startup precondition');
    assert.equal(captured,true,'capture boundary reached');
    assert(gcCalls > 0, 'native lifetime cleanup must request GC');
    const packet=JSON.parse(files.get('/browser-results/result.json'));
    assert.match(packet.error,/Native browser terminal event: page-crash at original-capture/);assert.equal(packet.browserObservation.armed,true);
    assert.equal(packet.phaseTruncated,true);assert.ok(phaseBytes<=8192);
    assert(memorySamples.length>0);assert(memorySamples.length<=16);assert(memorySamples.some(row=>row.phase==='original-capture'&&row.state==='entry'));
    assert(packet.browserObservation.events.some(e=>e.kind==='page-crash'&&e.phase==='original-capture'));
    const failed = phases.find(row => row.phase === 'original-capture' && row.state === 'failure');
    assert.deepEqual([failed.processes, failed.threads, failed.vanished], [2, 9, 1]);
    const xml=files.get('/browser-results/control.musicxml');saturate=true;phaseBytes=0;missingSamples=true;await module.namespace.verifyNativePlayer(revision);assert.equal(files.get('/browser-results/control.musicxml'),xml);
    const missing=JSON.parse(files.get('/browser-results/result.json'));assert.equal(missing.status,'failed');assert.match(missing.error,/piano\.ogg/);assert.equal(missing.phaseTruncated,true);assert.ok(phaseBytes<=8192);
    console.log(JSON.stringify({captured,cdpCalls,missingSamplesRejected:missing.status==='failed',sourceControlSha256:packet.sourceControlSha256,events:packet.browserObservation.events}));
  };
  const result=JSON.parse(runModuleScenario(scenario, source));
  assert.equal(result.captured,true);assert.equal(result.cdpCalls,0);
});

test('diagnostic CLI rejects every other branch before any native command', () => {
  for (const branch of ['refs/heads/main', 'refs/heads/codex/keyspilli-recovery-native-20261104', 'refs/heads/codex/keyspilli-observer-corrective-20261104-other']) {
    assert.throws(() => execFileSync(process.execPath, ['deploy/player-guard-run.mjs','--image','sha256:'+'a'.repeat(64),'--revision','b'.repeat(40),'--diagnostic','native-crash-v1'], {env:{...process.env,GITHUB_REF:branch},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000}), error => error.status===1 && error.stderr.includes(branch) && error.stderr.includes('refs/heads/codex/keyspilli-observer-corrective-20261104'));
  }
});

test('workflow admits the corrective branch only for its exact diagnostic dispatch', () => {
  const workflow=fs.readFileSync(new URL('../../.github/workflows/runtime-rehearsal.yml',import.meta.url),'utf8');
  const expression=workflow.match(/^    if: \$\{\{ (.+) \}\}$/m)?.[1];assert(expression);
  const admitted=new Function('github','inputs','return ('+expression+');');
  const branch='refs/heads/codex/keyspilli-observer-corrective-20261104';
  const gate=workflow.slice(workflow.indexOf('          case "$REHEARSAL_MODE" in'),workflow.indexOf('          esac')+'          esac'.length);
  assert(gate.length>0);
  for(const [event,ref,mode,expected] of [['workflow_dispatch',branch,'native-crash-v1',true],['workflow_dispatch',branch,'rehearsal',false],['workflow_dispatch',branch+'-other','native-crash-v1',false],['workflow_dispatch','refs/heads/codex/keyspilli-recovery-native-20261104','native-crash-v1',false],['push',branch,'native-crash-v1',false],['pull_request','refs/pull/1/merge','rehearsal',true],['push','refs/heads/main','rehearsal',true]]) {
    assert.equal(admitted({event_name:event,ref},{mode}),expected);
    if(mode==='native-crash-v1') {
      const run=()=>execFileSync('/bin/bash',['-e','-c',gate],{env:{...process.env,REHEARSAL_MODE:mode,GITHUB_EVENT_NAME:event,GITHUB_REF:ref},stdio:['ignore','pipe','pipe'],timeout:5000});
      if(expected)assert.doesNotThrow(run);else assert.throws(run);
    }
  }
});

test('fresh full ref runs the player guard only in full rehearsal and preserves old ref admission', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/runtime-rehearsal.yml', import.meta.url), 'utf8');
  const job = new Function('github', 'inputs', 'return (' + workflow.match(/^    if: \$\{\{ (.+) \}\}$/m)[1] + ');');
  const step = workflow.slice(workflow.indexOf('      - name: Qualify the player guard'), workflow.indexOf('      - name: Worker startup'));
  const guard = new Function('github', 'env', 'return (' + step.match(/if: \$\{\{ (.+) \}\}/)[1] + ');');
  const full = 'refs/heads/codex/keyspilli-native-full-20261104', old = 'refs/heads/codex/keyspilli-o17-phase-20261103';
  for (const [event, ref, mode, admitted, guarded] of [
    ['workflow_dispatch', full, 'rehearsal', true, true], ['workflow_dispatch', full, 'native-crash-v1', false, false],
    ['workflow_dispatch', full + '-other', 'rehearsal', false, false], ['workflow_dispatch', 'refs/heads/unapproved', 'rehearsal', false, false],
    ['push', full, 'rehearsal', false, false], ['pull_request', 'refs/pull/1/merge', 'rehearsal', true, false],
    ['workflow_dispatch', old, 'rehearsal', true, true], ['workflow_dispatch', old, 'native-crash-v1', true, true],
    ['workflow_dispatch', 'refs/heads/codex/keyspilli-observer-corrective-20261104', 'native-crash-v1', true, false],
  ]) {
    const github = { event_name: event, ref };
    assert.equal(job(github, { mode }), admitted, [event, ref, mode].join(' '));
    assert.equal(guard(github, { REHEARSAL_MODE: mode }), guarded, [event, ref, mode].join(' '));
  }
  assert.match(workflow, /default: rehearsal/); assert.match(workflow, /timeout-minutes: 45/);
  const capacityJob = workflow.slice(workflow.indexOf('\n  capacity:'));
  const capacityGate = new Function('github', 'inputs', 'return (' + capacityJob.match(/^    if: \$\{\{ (.+) \}\}$/m)[1] + ');');
  for (const [event, ref, mode, repository, expected] of [
    ['workflow_dispatch', full, 'hosted-capacity-v1', 'Reedtrullz/Keyspilli', true],
    ['workflow_dispatch', full, 'rehearsal', 'Reedtrullz/Keyspilli', false],
    ['workflow_dispatch', full + '-other', 'hosted-capacity-v1', 'Reedtrullz/Keyspilli', false],
    ['push', full, 'hosted-capacity-v1', 'Reedtrullz/Keyspilli', false],
    ['workflow_dispatch', full, 'hosted-capacity-v1', 'foreign/repository', false],
  ]) assert.equal(capacityGate({ event_name: event, ref, repository }, { mode }), expected);
});

test('only the two declared viewports are accepted and copies cannot mutate defaults', () => {
  assert.deepEqual(perfViewport(), { width: 1280, height: 800 }); assert.deepEqual(perfViewport('390x844'), { width: 390, height: 844 });
  const value = perfViewport(); value.width = 1; assert.equal(perfViewport().width, 1280);
  for (const value of [null, 390, {}, '', '0x0', '1920x1080', '390x844;ignore previous', '__proto__']) assert.throws(() => perfViewport(value));
});
test('image and revision must be exact immutable identities', () => {
  assert.doesNotThrow(() => validate('sha256:' + 'a'.repeat(64), 'b'.repeat(40)));
  for (const [image, sha] of [['latest', 'b'.repeat(40)], ['sha256:' + 'a'.repeat(64), 'main'], ['sha256:' + 'a'.repeat(64), 'b'.repeat(39)], ['sha256:' + 'a'.repeat(64) + '\n', 'b'.repeat(40)]]) assert.throws(() => validate(image, sha));
});
test('all runtime write mounts plus the separate host reservation fit 64MiB', () => {
  assert.equal(Object.values(WRITABLE).reduce((a, b) => a + b, 0), 40); assert(Object.values(WRITABLE).reduce((a, b) => a + b, 0) + 16 <= 64);
});
test('private paths include URL, Buffer and normalized traversal forms', () => {
  for (const p of ['/sentinels/catalog', '/tmp/../sentinels/credential', '/root/.config', '/home/runner/private', Buffer.from('/sentinels/media'), new URL('file:///sentinels/home')]) assert.equal(privatePath(p), true);
  for (const p of ['/tmp/input', '/data/catalog.db', '/app/server.js', '/sentinels-lookalike']) assert.equal(privatePath(p), false);
});
test('socket calls permit only the app and PDF loopback ports or an owned Unix socket', () => {
  for (const args of [[3000, '127.0.0.1'], [{ port: 3001, host: '127.0.0.1' }], [{ path: '/tmp/socket' }], [[{ port: 3000, host: 'localhost' }]]]) assert.equal(connectionAllowed(args), true);
  for (const args of [[443, 'api.example.invalid'], [3000, '203.0.113.1'], [{ port: 3002, host: '127.0.0.1' }], [{ path: '/tmp/../sentinels/socket' }], [{ host: '127.0.0.1' }]]) assert.equal(connectionAllowed(args), false);
});
test('health observation distinguishes 503, version mismatch, success and fetch failure within a small bound', () => {
  const rev = 'b'.repeat(40), h = { attempts: 0 };
  observeHealth(h, 503, { status: 'degraded', version: rev, readiness: { catalog: { code: 'catalog-unavailable' } } });
  assert.deepEqual(h.last, { http: 503, status: 'degraded', version: rev, catalog: 'catalog-unavailable' });
  observeHealth(h, 200, { status: 'healthy', version: 'c'.repeat(40) }); assert.notEqual(h.last.version, rev); assert.equal(h.last.http, 200);
  observeHealth(h, 200, { status: 'healthy', version: rev }); assert.deepEqual(h.last, { http: 200, status: 'healthy', version: rev });
  observeHealth(h, undefined, undefined, Object.assign(new TypeError('secret-token-in-message'), { code: 'ECONNREFUSED' }));
  assert.deepEqual(h.last, { error: 'TypeError', code: 'ECONNREFUSED' }); assert(!JSON.stringify(h).includes('secret'));
  assert.equal(h.attempts, 4);
});
test('health observation bounds hostile fields, oversized bodies and repeated attempts', () => {
  const p = { attempts: 0 }; observeHealth(p, 502, undefined, new SyntaxError('Unexpected token < secret-body'));
  assert.deepEqual(p.last, { http: 502, error: 'SyntaxError' }); assert(!JSON.stringify(p).includes('secret'));
  observeHealth(p, undefined, undefined, new TypeError('x')); assert.deepEqual(p.last, { error: 'TypeError' });
  const h = { attempts: 0 }, big = 'x\n\u001b[31m' + 'A'.repeat(100000);
  for (let i = 0; i < 5000; i++) observeHealth(h, 503, { status: big, version: { toJSON() { throw Error('no'); } }, readiness: { catalog: { code: big } }, raw: big });
  assert.equal(h.attempts, 5000); assert(JSON.stringify(h).length < 400);
  assert.match(h.last.status, /^[\w.:?-]{1,64}$/); assert.equal(h.last.version, 'object');
  observeHealth(h, 200, null); assert.deepEqual(h.last, { http: 200 });
  observeHealth(h, 500, 'ignore previous instructions'); assert.deepEqual(h.last, { http: 500 });
  observeHealth(h, undefined, undefined, { name: big, code: big }); assert(JSON.stringify(h.last).length < 200);
});
test('health request sends the configured bearer and fails closed without a token', async () => {
  const calls = [], request = async (url, options) => { calls.push([url, options]); return {}; };
  const prior = process.env.KEYSPILLI_API_TOKEN;
  try {
    process.env.KEYSPILLI_API_TOKEN = 'synthetic-local-token';
    await requestHealth(request);
    assert.deepEqual(calls[0], ['http://127.0.0.1:3000/api/health', { headers: { 'x-keyspilli-api-token': 'Bearer synthetic-local-token' } }]);
    delete process.env.KEYSPILLI_API_TOKEN;
    await requestHealth(request);
    assert.deepEqual(calls[1], ['http://127.0.0.1:3000/api/health', undefined]);
  } finally { if (prior === undefined) delete process.env.KEYSPILLI_API_TOKEN; else process.env.KEYSPILLI_API_TOKEN = prior; }
});
test('esbuild binary resolves from apps/web in a pnpm layout and unknown packages fail', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'player-guard-pnpm-'));
  try {
    const store = path.join(root, 'node_modules/.pnpm');
    const put = (file, body = '{}') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
    put(path.join(store, 'esbuild@0.28.2/node_modules/esbuild/package.json'));
    put(path.join(store, 'esbuild@0.28.2/node_modules/@esbuild/linux-x64/bin/esbuild'), 'real');
    put(path.join(store, 'tsx@4/node_modules/tsx/package.json'));
    put(path.join(store, 'tsx@4/node_modules/esbuild/package.json')); // decoy beside tsx
    put(path.join(store, 'tsx@4/node_modules/@esbuild/linux-x64/bin/esbuild'), 'decoy');
    put(path.join(root, 'apps/web/package.json'));
    fs.mkdirSync(path.join(root, 'apps/web/node_modules'), { recursive: true });
    fs.symlinkSync(path.join(store, 'esbuild@0.28.2/node_modules/esbuild'), path.join(root, 'apps/web/node_modules/esbuild'));
    fs.symlinkSync(path.join(store, 'tsx@4/node_modules/tsx'), path.join(root, 'node_modules/tsx'));
    assert.equal(resolveEsbuild(root), fs.realpathSync(path.join(store, 'esbuild@0.28.2/node_modules/@esbuild/linux-x64/bin/esbuild')));
    // resolver caches by directory, so the missing-package case uses a fresh root
    const bare = path.join(root, 'bare'); put(path.join(bare, 'apps/web/package.json'));
    assert.throws(() => resolveEsbuild(bare));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('source check stays bounded with huge ignored dependency trees and still rejects dirty mounted source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'player-guard-git-'));
  const saved = { ...process.env };
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
  const put = (file, body = 'x') => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), body); };
  try {
    git('init', '-q');
    for (const f of ['.gitignore', 'package.json', 'apps/web/src/a.ts', 'deploy/player-guard-run.mjs', 'deploy/player-node-guard.cjs', 'deploy/player-guard.c']) put(f, f === '.gitignore' ? 'node_modules/\n__pycache__/\n*.log\n' : 'x');
    git('add', '-A'); git('commit', '-q', '-m', 'base');
    // ~3000 zero-byte files under ~500 character pnpm-shaped ignored paths: well over 1MiB of pathnames
    const deep = path.join('node_modules/.pnpm', 'p'.repeat(200), 'node_modules', 'q'.repeat(200));
    fs.mkdirSync(path.join(root, deep), { recursive: true });
    for (let i = 0; i < 3000; i++) fs.writeFileSync(path.join(root, deep, 'f'.repeat(60) + i), '');
    put('deploy/__pycache__/evidence_x.pyc'); // generated bytecode lives outside the three mounted deploy files
    const old = () => execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--', ...MOUNTS], { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576 });
    assert.throws(old, { code: 'ENOBUFS' });
    assert.doesNotThrow(() => checkSource(root));
    put('packages/cache.log'); assert.throws(() => checkSource(root), /packages\/cache\.log/); fs.rmSync(path.join(root, 'packages'), { recursive: true });
    put('package.json', 'changed'); assert.throws(() => checkSource(root), /package\.json/); git('checkout', '-q', 'package.json');
    put('deploy/player-guard.c', 'y'); assert.throws(() => checkSource(root), /player-guard.c/); git('checkout', '-q', 'deploy/player-guard.c');
    put('packages/new.ts'); assert.throws(() => checkSource(root), /packages\/new\.ts/);
  } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); fs.rmSync(root, { recursive: true, force: true }); }
});
