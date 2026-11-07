import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const SDK = '/usr/local/lib/android/sdk';
const GIB = 1024 ** 3;
export function capacityModes(leafMode, parentModes) {
  return Number.isInteger(leafMode) && (leafMode & 0o7777) === 0o777 && parentModes.length > 0 && parentModes.every(mode => Number.isInteger(mode) && (mode & 0o022) === 0);
}
export function capacityRequirement(state) {
  assert.deepEqual(Object.keys(state.settings).sort(), ['limit', 'maxEntries', 'peak', 'reserve']);
  const { reserve, limit, maxEntries, peak } = state.settings;
  for (const value of [reserve, limit, maxEntries, peak, state.managedBytes]) assert(Number.isSafeInteger(value) && value >= 0, 'invalid effective capacity setting');
  assert(reserve >= 6 * GIB && limit >= 16 * GIB && maxEntries >= 100000 && peak === 12 * GIB, 'capacity guards cannot be reduced');
  const required = reserve + 2 * peak + state.managedBytes + maxEntries * 16384 + 16 * 1048576;
  assert(Number.isSafeInteger(required), 'capacity overflow');
  assert(state.managedBytes + peak <= limit, 'managed allocator limit insufficient');
  return required;
}
export function requireHostedCapacity(s, mode, prior) {
  assert(['inventory', 'prepare'].includes(mode), 'unknown capacity mode');
  assert.equal(s.repository, 'Reedtrullz/Keyspilli'); assert.equal(s.event, 'workflow_dispatch');
  assert.equal(s.ref, 'refs/heads/codex/keyspilli-native-full-20261104');
  assert(typeof s.expected === 'string' && /^[a-f0-9]{40}$/.test(s.expected) && s.expected.length === 40, 'exact expected commit required');
  assert.equal(s.commit, s.expected, 'stale source commit'); assert.equal(s.dispatchCommit, s.expected, 'stale dispatched commit'); assert.equal(s.clean, true, 'dirty source');
  assert.equal(s.hosted, 'github-hosted'); assert.equal(s.actions, 'true'); assert.equal(s.imageOS, 'ubuntu24');
  assert(typeof s.imageVersion === 'string' && /^\d{8}\.\d+\.\d+$/.test(s.imageVersion), 'invalid hosted image identity');
  assert.equal(s.os, '24.04'); assert.equal(s.platform, 'linux'); assert.equal(s.arch, 'x64');
  assert.equal(s.runnerOwner, true); assert.equal(s.disposable, true);
  assert(Number.isSafeInteger(s.runnerUid) && s.runnerUid > 0, 'trusted hosted runner UID required');
  assert.equal(s.target, SDK, 'unapproved SDK target'); assert.equal(s.canonical, true, 'linked or noncanonical SDK'); assert(s.owner === 0 || s.owner === s.runnerUid, 'foreign SDK owner'); assert.equal(s.ancestorsSafe, true, 'unsafe SDK parent or leaf permissions'); assert.equal(s.mountSafe, true, 'foreign SDK mount');
  assert.equal(s.handles, 0, 'SDK has open handles'); assert.equal(s.callers, 0, 'SDK has build or runtime callers');
  for (const value of [s.allocatedBytes, s.freeBytes]) assert(Number.isSafeInteger(value) && value >= 0, 'invalid observed bytes');
  assert(s.allocatedBytes > 0 && s.allocatedBytes <= 32 * GIB, 'SDK absent or allocated size exceeds 32GiB');
  const requiredBytes = capacityRequirement(s);
  // du is candidate capacity only; retain 1GiB headroom before risking removal.
  assert(s.freeBytes + s.allocatedBytes >= requiredBytes + GIB, 'SDK insufficient for complete allocator and preparation headroom');
  if (mode === 'prepare') {
    assert(prior?.status === 'INVENTORY_ONLY' && prior.deleted === false, 'accepted inventory required');
    assert.equal(prior.kind, 'keyspilli-hosted-capacity'); requireHostedCapacity(prior, 'inventory');
    for (const key of ['repository', 'event', 'ref', 'commit', 'expected', 'imageOS', 'imageVersion', 'target', 'owner', 'sdkMode', 'runnerUid']) assert.equal(prior[key], s[key], 'stale inventory ' + key);
    const permissions = value => value?.map(({ path, uid, gid, mode }) => ({ path, uid, gid, mode }));
    assert.deepEqual(permissions(prior.ancestry), permissions(s.ancestry), 'stale inventory parent permissions');
    assert.deepEqual(prior.settings, s.settings, 'stale effective settings'); assert.equal(prior.requiredBytes, capacityRequirement(prior), 'malformed inventory capacity');
  }
  return { requiredBytes };
}
export async function capacityCommand(command, args, { timeout = 60000, signal, codes = [0], record = () => {} } = {}) {
  assert(Number.isInteger(timeout) && timeout > 0 && timeout <= 60000, 'bounded command deadline required');
  const entry = { id: randomUUID(), executable: command, argumentCount: args.length, status: 'intent', pid: null, startedAt: new Date().toISOString() };
  record({ ...entry });
  if (signal?.aborted) { record({ ...entry, status: 'terminal', reason: 'cancelled-before-spawn', code: null, signal: null }); throw new Error('capacity cancel'); }
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    entry.pid = child.pid ?? null; entry.status = 'running';
    let output = '', bytes = 0, stderrBytes = 0, failure;
    const stop = reason => { failure ??= new Error(reason); try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') failure ??= e; } };
    const cancel = () => stop('capacity cancel');
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => stop('capacity deadline'), timeout);
    child.stdout.on('data', data => { bytes += data.length; if (bytes <= 65536) output += data; else stop('capacity output cap'); });
    child.stderr.on('data', data => { bytes += data.length; stderrBytes += data.length; if (bytes > 65536) stop('capacity output cap'); });
    child.on('error', error => { failure = error; });
    child.on('close', (code, terminalSignal) => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); record({ ...entry, status: 'terminal', code, signal: terminalSignal, bytes, reason: failure?.message ?? (!codes.includes(code) || stderrBytes ? 'command-failed' : 'complete') }); if (failure || !codes.includes(code) || stderrBytes) reject(failure ?? new Error('capacity command failed')); else resolve(output.trim()); });
    try { record({ ...entry }); } catch (error) { assert(error instanceof Error); stop('capacity journal failed'); }
    if (signal?.aborted) cancel();
  });
}
function hostCapacityAdapter(signal, record) {
  const command = (exe, args) => capacityCommand(exe, args, { signal, record });
  const free = async () => {
    const text = await command('/bin/df', ['-B1', '--output=avail', process.env.RUNNER_TEMP]);
    assert(/^Avail\s+\d+$/.test(text), 'malformed numeric df'); return Number(text.split(/\s+/)[1]);
  };
  return { free, remove: async target => { assert.equal(target, SDK); await command('/usr/bin/sudo', ['-n', '/bin/rm', '-rf', '--', SDK]); }, observe: async () => {
    const env = process.env;
    assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
    assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted'); assert.equal(env.GITHUB_ACTIONS, 'true');
    assert.equal(env.GITHUB_REPOSITORY, 'Reedtrullz/Keyspilli'); assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    assert.equal(env.GITHUB_REF, 'refs/heads/codex/keyspilli-native-full-20261104'); assert.equal(env.ImageOS, 'ubuntu24');
    let pid = process.ppid, runnerOwner = false, runnerUid;
    for (let i = 0; i < 20 && pid > 1; i++) {
      if (fs.readFileSync('/proc/' + pid + '/comm', 'utf8').trim() === 'Runner.Worker') { runnerOwner = fs.realpathSync('/proc/' + pid + '/exe').startsWith('/home/runner/'); runnerUid = Number(fs.readFileSync('/proc/' + pid + '/status', 'utf8').match(/^Uid:\s+(\d+)/m)?.[1]); assert.equal(runnerUid, process.getuid(), 'foreign runner process owner'); break; }
      pid = Number(fs.readFileSync('/proc/' + pid + '/status', 'utf8').match(/^PPid:\s+(\d+)$/m)?.[1]);
    }
    const root = fs.realpathSync(env.GITHUB_WORKSPACE), temp = fs.realpathSync(env.RUNNER_TEMP);
    assert(root.startsWith('/home/runner/work/') && temp.startsWith('/home/runner/work/'), 'non-disposable workspace');
    const commit = await command('/usr/bin/git', ['-C', root, 'rev-parse', 'HEAD']);
    const clean = (await command('/usr/bin/git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'])) === '';
    const target = fs.lstatSync(SDK), device = fs.statSync(temp).dev;
    // Pinned runner-images install-android-sdk.sh deliberately chmods the SDK leaf a+rwx.
    // Parents retain strict root ownership/non-writability; leaf ownership is observed, never presumed.
    let ancestorsSafe = target.isDirectory() && !target.isSymbolicLink(); const ancestry = [];
    for (let p = path.dirname(SDK); ; p = path.dirname(p)) { const s = fs.lstatSync(p); ancestry.push({ path: p, uid: s.uid, gid: s.gid, mode: s.mode, device: s.dev }); ancestorsSafe &&= s.isDirectory() && !s.isSymbolicLink() && s.uid === 0 && s.dev === device; if (p === '/') break; }
    ancestorsSafe &&= capacityModes(target.mode, ancestry.map(entry => entry.mode));
    const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8'); assert(Buffer.byteLength(mounts) <= 1048576, 'mount metadata cap');
    const mountSafe = !mounts.split('\n').some(line => { const mount = line.split(' ')[4]; return mount === SDK || mount?.startsWith(SDK + '/'); });
    const allocated = await command('/usr/bin/sudo', ['-n', '/usr/bin/du', '-s', '-B1', '--', SDK]);
    assert(new RegExp('^[0-9]+\\s+' + SDK + '$').test(allocated), 'malformed allocated bytes');
    const handleText = await capacityCommand('/usr/bin/sudo', ['-n', '/usr/bin/lsof', '-t', '+D', SDK], { signal, record, codes: [0, 1] });
    assert(handleText === '' || /^\d+(\n\d+)*$/.test(handleText), 'malformed handle census');
    const handles = handleText === '' ? 0 : new Set(handleText.split('\n')).size;
    // Scan all tracked text inputs, including invoked scripts/lockfiles, except this policy and its direct tests.
    const callerText = await capacityCommand('/usr/bin/git', ['-C', root, 'grep', '-I', '-i', '-l', '-E', 'android[_-]?(home|sdk)|/usr/local/lib/android|sdkmanager|gradlew|gradle', '--', '.', ':(exclude)deploy/player-guard-run.mjs', ':(exclude)deploy/test/player-guard.test.mjs'], { signal, record, codes: [0, 1] });
    const processCallers = await command('/usr/bin/sudo', ['-n', '/usr/bin/python3', '-c', "import os,pathlib; target=b'/usr/local/lib/android/sdk'; count=0\nfor p in pathlib.Path('/proc').iterdir():\n if p.name.isdigit() and int(p.name) not in (os.getpid(),os.getppid()):\n  try: count+=int(target in (p/'cmdline').read_bytes())\n  except (FileNotFoundError,ProcessLookupError): pass\nprint(count)"]);
    assert(/^\d+$/.test(processCallers), 'malformed runtime caller census');
    const callers = (callerText === '' ? 0 : callerText.split('\n').length) + Number(processCallers);
    const number = (key, fallback) => { const text = env[key] ?? String(fallback); assert(/^[0-9]+$/.test(text), 'invalid effective numeric setting'); return Number(text); };
    const managed = path.join(temp, 'keyspilli-evidence'); const managedBytes = 0;
    try { const stat = fs.lstatSync(managed); assert(stat.isDirectory() && !stat.isSymbolicLink(), 'foreign managed root'); assert.equal(fs.realpathSync(managed), managed); assert.equal(fs.readdirSync(managed).length, 0, 'fresh disposable managed root required'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { repository: env.GITHUB_REPOSITORY, event: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, expected: env.EXPECTED_COMMIT, dispatchCommit: env.GITHUB_SHA, commit, clean,
      hosted: env.RUNNER_ENVIRONMENT, actions: env.GITHUB_ACTIONS, imageOS: env.ImageOS, imageVersion: env.ImageVersion,
      os: fs.readFileSync('/etc/os-release', 'utf8').match(/^VERSION_ID="([^"]+)"$/m)?.[1], platform: process.platform, arch: process.arch, runnerOwner, runnerUid, ancestry, disposable: true,
      target: SDK, canonical: fs.realpathSync(SDK) === SDK && target.isDirectory() && !target.isSymbolicLink(), owner: target.uid, sdkMode: target.mode & 0o7777, ancestorsSafe, mountSafe, handles, callers,
      allocatedBytes: Number(allocated.split(/\s+/)[0]), freeBytes: await free(), managedBytes,
      settings: { reserve: number('KEYSPILLI_EVIDENCE_RESERVE_BYTES', 6 * GIB), limit: number('KEYSPILLI_EVIDENCE_LIMIT_BYTES', 16 * GIB), maxEntries: number('KEYSPILLI_EVIDENCE_MAX_ENTRIES', 100000), peak: 12 * GIB } };
  } };
}
export async function hostedCapacity(mode, adapter, prior) {
  assert(['inventory', 'prepare'].includes(mode), 'unknown capacity mode');
  const result = { kind: 'keyspilli-hosted-capacity', status: 'REFUSED', deleted: false, phase: 'observe' };
  try {
    const state = await adapter.observe();
    result.phase = 'validate';
    result.observed = Object.fromEntries(['freeBytes', 'allocatedBytes', 'managedBytes', 'owner', 'runnerUid', 'handles', 'callers'].map(key => [key, Number.isSafeInteger(state[key]) && state[key] >= 0 ? state[key] : 'invalid']));
    result.observed.settings = Object.fromEntries(['reserve', 'limit', 'maxEntries', 'peak'].map(key => [key, Number.isSafeInteger(state.settings?.[key]) && state.settings[key] >= 0 ? state.settings[key] : 'invalid']));
    for (const key of ['canonical', 'ancestorsSafe', 'mountSafe', 'runnerOwner', 'clean']) result.observed[key] = state[key] === true;
    result.observed.requiredBytes = capacityRequirement(state);
    result.observed.candidateBytes = Number.isSafeInteger(state.freeBytes + state.allocatedBytes) ? state.freeBytes + state.allocatedBytes : 'invalid';
    const capacity = requireHostedCapacity(state, mode, prior);
    const allowed = ['repository', 'event', 'ref', 'expected', 'dispatchCommit', 'commit', 'clean', 'hosted', 'actions', 'imageOS', 'imageVersion', 'os', 'platform', 'arch', 'runnerOwner', 'runnerUid', 'ancestry', 'disposable', 'target', 'canonical', 'owner', 'sdkMode', 'ancestorsSafe', 'mountSafe', 'handles', 'callers', 'allocatedBytes', 'freeBytes', 'managedBytes', 'settings'];
    Object.assign(result, Object.fromEntries(allowed.filter(key => state[key] !== undefined).map(key => [key, state[key]])), capacity, { status: 'INVENTORY_ONLY', phase: 'inventory' });
    if (mode === 'prepare') {
      result.phase = 'repeat';
      const repeated = await adapter.observe(); requireHostedCapacity(repeated, mode, prior);
      assert.deepEqual(repeated.settings, state.settings, 'settings changed before removal');
      result.freeBeforeBytes = repeated.freeBytes; result.requiredBytes = capacityRequirement(repeated);
      result.phase = 'remove'; result.deletionAttempted = true; result.deleted = null; await adapter.remove(SDK); result.deleted = true;
      result.phase = 'df-after'; result.freeAfterBytes = await adapter.free();
      assert(Number.isSafeInteger(result.freeAfterBytes) && result.freeAfterBytes >= result.requiredBytes, 'measured df still insufficient after SDK removal');
      result.status = 'PREPARED'; result.phase = 'complete';
    }
    assert(Buffer.byteLength(JSON.stringify(result)) <= 4194304, 'capacity evidence cap');
    return result;
  } catch (error) { assert(error instanceof Error); result.status = 'REFUSED'; result.reason = error.code === 'ERR_ASSERTION' && error.generatedMessage !== true ? error.message.slice(0, 160) : 'host identity or observation refused'; error.capacityEvidence = result; throw error; }
}
async function capacityCLI(mode) {
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
  const timer = setTimeout(cancel, 540000);
  let result, journalFd; const commands = [];
  const record = entry => {
    assert(commands.length < 256, 'capacity command journal cap'); commands.push(entry);
    if (journalFd === undefined) {
      const temp = fs.realpathSync(process.env.RUNNER_TEMP); assert(temp.startsWith('/home/runner/work/'), 'disposable journal path required');
      journalFd = fs.openSync(path.join(temp, 'keyspilli-hosted-capacity-commands.json'), 'wx', 0o600);
    }
    const body = JSON.stringify({ kind: 'keyspilli-capacity-command-journal', commands }); assert(Buffer.byteLength(body) <= 1048576, 'capacity journal byte cap');
    fs.ftruncateSync(journalFd, 0); fs.writeSync(journalFd, body, 0, 'utf8'); fs.fsyncSync(journalFd);
  };
  try {
    const text = process.env.KEYSPILLI_CAPACITY_INVENTORY ?? ''; assert(Buffer.byteLength(text) <= 65536, 'inventory input cap');
    result = await hostedCapacity(mode, hostCapacityAdapter(controller.signal, record), mode === 'prepare' ? JSON.parse(text) : undefined);
  } catch (error) { assert(error instanceof Error); result = { ...error.capacityEvidence, kind: 'keyspilli-hosted-capacity', status: 'REFUSED', error: error.code ?? error.name, nativeQualified: false }; process.exitCode = 1; }
  finally { clearTimeout(timer); process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel); if (journalFd !== undefined) fs.closeSync(journalFd); }
  result.commands = commands;
  console.log(JSON.stringify(result));
}

export const WRITABLE = Object.freeze({ '/tmp': 15, '/dev/shm': 4, '/data': 16, '/browser-results': 4, '/sentinels': 1 });
export const NODE_RUNTIME_ENV = Object.freeze({ NODE_OPTIONS: '--v8-pool-size=2', UV_THREADPOOL_SIZE: '2' });
const PROFILES = Object.freeze({
  control: Object.freeze({ memoryMiB: 1024, writable: WRITABLE }),
  writable: Object.freeze({ memoryMiB: 1024, writable: Object.freeze({ '/tmp': 256, '/dev/shm': 128, '/data': 32, '/browser-results': 16, '/sentinels': 1 }) }),
  ram: Object.freeze({ memoryMiB: 4096, writable: WRITABLE }),
});
export function diagnosticProfile(name) {
  assert(typeof name === 'string' && Object.hasOwn(PROFILES, name), 'unknown finite diagnostic profile');
  const profile = PROFILES[name];
  assert(profile.memoryMiB <= 4096 && Object.values(profile.writable).reduce((a, b) => a + b, 16) <= 512, 'owner resource ceiling');
  return profile;
}
export function guardLaunchArgs(name, profile = PROFILES.control) {
  assert(Object.values(PROFILES).includes(profile), 'profile must be a declared immutable profile');
  const args = ['create', '--name', name, '--pull=never', '--network', 'none', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--cpus', '1.5', '--memory', profile.memoryMiB + 'm', '--pids-limit', '128', '--workdir', readRoot, '--entrypoint', '/player-guard'];
  for (const [mount, size] of Object.entries(profile.writable)) args.push('--tmpfs', mount + ':rw,nosuid,noexec,size=' + size + 'm,uid=1000,gid=1000,mode=0700');
  return args;
}
export function guardEnvironment(diagnosticName) {
  const pairs = [
    ['HOME', '/tmp'], ['TMPDIR', '/tmp'], ['PORT', '3000'], ['HOSTNAME', '127.0.0.1'],
    ['PLAYWRIGHT_BROWSERS_PATH', '/ms-playwright'], ['KEYSPILLI_DATA_DIR', '/data'],
    ['KEYSPILLI_ORIGIN', 'http://127.0.0.1:3000'], ['KEYSPILLI_API_TOKEN', 'test-token-for-e2e'],
    ['AUTH_SECRET', 'owned-player-guard-only'], ['KEYSPILLI_TUTORIAL_BETA', '0'],
    ['KEYSPILLI_NATIVE_PROBE_SCOPE', 'owned-restore'],
    ...Object.entries(NODE_RUNTIME_ENV),
  ];
  if (diagnosticName !== undefined) {
    assert(typeof diagnosticName === 'string' && Object.hasOwn(PROFILES, diagnosticName), 'unknown diagnostic profile');
    pairs.push(['KEYSPILLI_GUARD_PROFILE', diagnosticName], ['KEYSPILLI_CRASH_DIAGNOSTIC', 'native-crash-v1'], ['DEBUG', 'pw:browser']);
  }
  return pairs;
}
export function browserProcessEvidence(stderr) {
  assert(Buffer.byteLength(stderr) <= 65536, 'browser stderr observation cap');
  const events = [];
  for (const line of stderr.replace(/\u001b\[[0-9;]*m/g, '').split('\n')) {
    const body = line.match(/^(?:\d{4}-\d\d-\d\dT\S+\s+)?\s*pw:browser\s+(.+)$/)?.[1];
    if (!body) continue;
    const argv = body.match(/^<launching> (.+)$/);
    const launch = body.match(/^<launched> pid=(\d+)$/);
    const exit = body.match(/^\[pid=(\d+)\] <process did exit: exitCode=(null|-?\d+), signal=(null|SIG[A-Z0-9]+)>$/);
    if (argv) { assert(Buffer.byteLength(argv[1]) <= 8192, 'browser command line cap'); events.push({ kind: 'argv', commandLineText: argv[1] }); }
    assert(!/^<launching>|^<launched>|^\[pid=[^\]]*\] <process did exit/.test(body) || argv || launch || exit, 'malformed browser process observation');
    if (launch) { assert(Number.isSafeInteger(Number(launch[1])) && Number(launch[1]) > 1, 'malformed launch PID'); events.push({ kind: 'launch', pid: Number(launch[1]) }); }
    if (exit) { assert(Number.isSafeInteger(Number(exit[1])) && Number(exit[1]) > 1 && (exit[2] === 'null' || Number.isSafeInteger(Number(exit[2]))), 'malformed exit identity'); events.push({ kind: 'exit', pid: Number(exit[1]), code: exit[2] === 'null' ? null : Number(exit[2]), signal: exit[3] === 'null' ? null : exit[3] }); }
    assert(events.length <= 16, 'browser process observation cap');
  }
  return events;
}
export function parseGuardOutput(output, revision) {
  const rows = output.trim().split('\n').map(line => JSON.parse(line));
  const results = rows.filter(r => r.kind === 'keyspilli-guard-admission');
  assert.equal(results.length, 1, 'one complete guard packet required');
  const result = results[0]; assert.equal(result.revision, revision);
  assert(['passed', 'failed'].includes(result.status));
  return { result, reaper: rows.find(r => r.phase === 'reaper') };
}
export function phaseTaskCounts(stderr) {
  return stderr.split('\n').flatMap((line, index) => {
    if (!line.startsWith('{"kind":"keyspilli-native-phase",')) return [];
    const { phase, state, processes, threads, vanished } = JSON.parse(line);
    if (/^import-(playwright|midi|capture|piano)$/.test(phase) && processes === undefined) return [];
    assert(/^[a-z][a-z0-9-]{0,63}$/.test(phase) && ['entry', 'exit', 'failure'].includes(state), 'invalid phase record');
    assert([processes, threads, vanished].every(Number.isSafeInteger) &&
      processes > 0 && threads >= processes && vanished >= 0, 'missing or invalid process/thread counts');
    return [{ phase, state, processes, threads, vanished, index }];
  });
}
export function requireDiagnosticEvidence(packet, expectedBrowsers = 1) {
  assert([1, 2, 3].includes(expectedBrowsers), 'invalid browser observation count');
  const observation = packet.functional?.browserObservation;
  assert(observation?.armed === true && Array.isArray(observation.events), 'missing early browser/launch evidence');
  assert.equal(observation.commandLineSource, 'playwright-launcher-stderr');
  assert.equal(observation.stderrSource, 'guarded-child-stderr');
  assert.equal(observation.events.filter(event => event.kind === 'browser-launched').length, expectedBrowsers, 'wrong browser launch count');
  const processes = packet.browserProcesses;
  const smoke = packet.logs?.find(log => log.args?.at(-1) === nativeSmoke(packet.revision, true));
  const stream = smoke?.stderr;
  assert(typeof stream === 'string' && stream.length > 0, 'missing raw smoke launcher stderr');
  assert.deepEqual(processes, browserProcessEvidence(stream), 'browser process evidence provenance mismatch');
  assert.equal(processes.length, expectedBrowsers * 3, 'exact browser argv, launch and exit required');
  for (let index = 0; index < processes.length; index += 3) {
    const [argv, launch, exit] = processes.slice(index, index + 3);
    assert(argv.kind === 'argv' && argv.commandLineText.length > 0, 'missing actual browser command line');
    assert(launch.kind === 'launch' && Number.isSafeInteger(launch.pid) && launch.pid > 1, 'missing browser process launch');
    assert(exit.kind === 'exit' && exit.pid === launch.pid, 'missing matching browser process exit');
    assert((exit.code === null) !== (exit.signal === null), 'missing unambiguous process exit status');
  }
  if (expectedBrowsers === 3) {
    const phases = phaseTaskCounts(stream), lines = stream.split('\n');
    let previous = -1;
    const boundary = (phase, state) => {
      const matches = phases.filter(row => row.phase === phase && row.state === state);
      assert(matches.length === 1 && matches[0].index > previous, 'missing or invalid phase order: ' + phase + ' ' + state);
      return previous = matches[0].index;
    };
    const modes = ['original', 'chords', 'silence'];
    assert.deepEqual(observation.events.filter(event => event.kind === 'browser-launched').map(event => event.phase),
      modes.map(mode => mode + '-browser-startup'));
    for (const [index, mode] of modes.entries()) {
      const start = boundary(mode + '-browser-startup', 'entry');
      const ready = boundary(mode + '-browser-startup', 'exit');
      boundary(mode === 'silence' ? mode : mode + '-capture', 'entry');
      const teardown = boundary(mode + '-browser-teardown', 'entry');
      const closed = boundary(mode + '-browser-teardown', 'exit');
      assert.deepEqual(browserProcessEvidence(lines.slice(start + 1, ready).join('\n')), processes.slice(3 * index, 3 * index + 2), 'wrong browser startup sequence');
      assert.deepEqual(browserProcessEvidence(lines.slice(teardown + 1, closed).join('\n')), processes.slice(3 * index + 2, 3 * index + 3), 'wrong browser teardown sequence');
    }
  }
  assert(Number.isInteger(packet.logBytes) && packet.logBytes <= 65536 && !smoke.clipped, 'clipped inner launcher stream');
  const r = packet.resources;
  assert(Number.isInteger(r?.pid) && r.pid > 1 && r.cgroup?.startsWith('/'), 'missing owned resource identity');
  assert(r.beforeTeardown && packet.resourceBarrierAcknowledged, 'missing acknowledged pre-teardown resource snapshot');
  for (const key of ['memory.events', 'memory.peak', 'memory.max']) assert(typeof r.memory?.[key] === 'string' && r.memory[key].length > 0, 'missing ' + key);
  for (const key of ['memory.peak', 'memory.max']) assert.match(r.memory[key], /^[0-9]+\n?$/, 'malformed ' + key);
  assert.match(r.memory['memory.events'], /(?:^|\n)oom [0-9]+(?:\n|$)/, 'missing OOM counter');
  assert.deepEqual(Object.keys(r.mounts ?? {}).sort(), Object.keys(WRITABLE).sort(), 'missing owned mounts');
  for (const mount of Object.values(r.mounts)) for (const key of ['blocks', 'free', 'blockSize', 'files', 'freeFiles']) assert(Number.isFinite(mount[key]) && mount[key] >= 0, 'missing mount/inode usage');
  const usage = packet.mountUsage;
  assert(usage?.pid === r.pid && usage.cgroup === r.cgroup && Number.isSafeInteger(usage.sampleCount) && usage.sampleCount > 0, 'missing accumulated owned mount samples');
  assert.equal(usage.provenance, 'owned /proc/PID/root statfs samples; existing 1000ms observer and pre-teardown barrier');
  assert.deepEqual(Object.keys(usage.mounts ?? {}).sort(), Object.keys(WRITABLE).sort());
  for (const [mount, value] of Object.entries(r.mounts)) {
    const aggregate = usage.mounts[mount];
    for (const key of ['minFreeBytes', 'maxUsedBytes', 'minFreeInodes', 'maxUsedInodes']) assert(Number.isSafeInteger(aggregate[key]) && aggregate[key] >= 0, 'invalid sampled mount aggregate');
    assert(aggregate.minFreeBytes <= value.free * value.blockSize && aggregate.maxUsedBytes >= (value.blocks - value.free) * value.blockSize && aggregate.minFreeInodes <= value.freeFiles && aggregate.maxUsedInodes >= value.files - value.freeFiles, 'aggregate lost sampled usage');
  }
  assert(r.limits?.includes('Max processes'), 'missing launch limits');
  assert(packet.containerRemoved && packet.scratchRemoved, 'incomplete cleanup');
  assert(!packet.cancelled && !packet.deadlineExceeded, 'cancelled or expired cell');
  assert(!packet.stdoutClipped && !packet.stderrClipped, 'clipped diagnostic packet');
}
export function nativeSmoke(revision, diagnostic = false) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  // The guard deliberately strips DEBUG; configure the owned Node smoke before Playwright's first load.
  const debug = diagnostic ? "process.env.DEBUG='pw:browser';process.env.DEBUG_COLORS='0';process.env.DEBUG_HIDE_DATE='0';" : '';
  return `import {createRequire} from 'node:module';${debug}const r=createRequire('${readRoot}/apps/web/package.json');const {chromium}=r('@playwright/test');let worker=false;const launch=chromium.launch.bind(chromium);chromium.launch=async(...args)=>{const b=await launch(...args);const nc=b.newContext.bind(b);b.newContext=async(...args)=>{const c=await nc(...args);c.on('page',p=>{void p.waitForFunction(()=>window.__sheetReady===true&&window.__sheetRenderer==='worker'&&window.__sheetRenderedPages>0,{},{timeout:80000}).then(()=>{worker=true}).catch(()=>{});});return c;};return b;};const {verifyNativePlayer}=await import('${readRoot}/apps/web/scripts/verify-native-player.mts');await verifyNativePlayer('${revision}', ${diagnostic});if(process.exitCode||!worker)throw Error('functional worker/WASM proof missing');`;
}
export function accumulateMountUsage(previous, sample) {
  assert(Number.isInteger(sample?.pid) && sample.pid > 1 && sample.cgroup?.startsWith('/'), 'owned sample identity required');
  assert.deepEqual(Object.keys(sample.mounts ?? {}).sort(), Object.keys(WRITABLE).sort(), 'owned sample mounts required');
  if (previous) { assert.equal(previous.pid, sample.pid); assert.equal(previous.cgroup, sample.cgroup); }
  const mounts = Object.fromEntries(Object.entries(sample.mounts).map(([mount, value]) => {
    for (const key of ['blocks', 'free', 'blockSize', 'files', 'freeFiles']) assert(Number.isSafeInteger(value[key]) && value[key] >= 0, 'invalid mount sample');
    assert(value.free <= value.blocks && value.freeFiles <= value.files && value.blockSize > 0, 'invalid mount capacity');
    const old = previous?.mounts[mount];
    return [mount, { minFreeBytes: Math.min(old?.minFreeBytes ?? Infinity, value.free * value.blockSize), maxUsedBytes: Math.max(old?.maxUsedBytes ?? 0, (value.blocks - value.free) * value.blockSize), minFreeInodes: Math.min(old?.minFreeInodes ?? Infinity, value.freeFiles), maxUsedInodes: Math.max(old?.maxUsedInodes ?? 0, value.files - value.freeFiles) }];
  }));
  return { pid: sample.pid, cgroup: sample.cgroup, sampleCount: (previous?.sampleCount ?? 0) + 1, provenance: 'owned /proc/PID/root statfs samples; existing 1000ms observer and pre-teardown barrier', interpretation: 'Sampled usage lower bound, not a true kernel peak; final resources retain the barrier snapshot.', mounts };
}
// Trusted outer observer: only the inspected container's PID/cgroup and fixed owned mount paths.
function ownedResources(pidText, identity, release = false) {
  assert.match(pidText, /^[1-9][0-9]*$/); assert(Number(pidText) > 1); assert.match(identity, /^[a-f0-9]{64}$/);
  const proc = '/proc/' + pidText;
  const cgroup = fs.readFileSync(proc + '/cgroup', 'utf8').trim().split('\n').find(line => line.startsWith('0::'))?.slice(3);
  assert(cgroup?.startsWith('/') && !cgroup.includes('..') && cgroup.includes(identity), 'owned cgroup v2 identity required');
  const root = '/sys/fs/cgroup' + cgroup;
  const memory = Object.fromEntries(['memory.events', 'memory.peak', 'memory.max', 'memory.current', 'pids.events', 'cpu.stat'].map(key => [key, fs.readFileSync(root + '/' + key, 'utf8').slice(0, 2048)]));
  const mounts = Object.fromEntries(Object.keys(WRITABLE).map(mount => { const s = fs.statfsSync(proc + '/root' + mount); return [mount, { blocks: s.blocks, free: s.bfree, blockSize: s.bsize, files: s.files, freeFiles: s.ffree }]; }));
  const result = { pid: Number(pidText), cgroup, memory, mounts, limits: fs.readFileSync(proc + '/limits', 'utf8').slice(0, 8192), beforeTeardown: release };
  if (release) fs.writeFileSync(proc + '/root/tmp/owned-observer-release', 'observed', { flag: 'wx' });
  return result;
}
export function validate(image, revision) {
  assert.match(image, /^sha256:[a-f0-9]{64}$/); assert.match(revision, /^[a-f0-9]{40}$/);
  assert(Object.values(WRITABLE).reduce((a, b) => a + b, 0) + 16 <= 64);
}
export function requireInspectEvidence(inspect, expected) {
  const keys = (value, allowed) => assert.deepEqual(Object.keys(value ?? {}).sort(), allowed.sort(), 'missing or forbidden inspect fields');
  keys(inspect, ['image', 'container']);
  keys(inspect.image, ['Id', 'Architecture', 'Os', 'User', 'NodeVersion', 'Revision', 'Cmd']);
  keys(inspect.container, ['Id', 'Image', 'User', 'HostConfig']);
  const image = inspect.image, container = inspect.container, host = container.HostConfig;
  keys(host, ['NetworkMode', 'ReadonlyRootfs', 'Memory', 'PidsLimit', 'PidMode', 'IpcMode', 'NanoCpus', 'CapAdd', 'CapDrop', 'SecurityOpt', 'Tmpfs']);
  validate(expected.image, expected.revision); assert.match(expected.identity, /^[a-f0-9]{64}$/);
  assert.equal(image.Id, expected.image); assert.equal(image.Architecture, 'amd64'); assert.equal(image.Os, 'linux');
  assert.equal(image.User, 'node'); assert.equal(image.NodeVersion, '22.22.3'); assert.equal(image.Revision, expected.revision);
  assert.deepEqual(image.Cmd, ['node', 'apps/web/server.js']);
  assert.equal(container.Id, expected.identity); assert.equal(container.Image, expected.image); assert.equal(container.User, '1000:1000');
  assert.equal(host.NetworkMode, 'none'); assert.equal(host.ReadonlyRootfs, true); assert.equal(host.PidMode, ''); assert.equal(host.IpcMode, 'private');
  assert.equal(host.Memory, expected.profile.memoryMiB * 1048576); assert.equal(host.PidsLimit, 128); assert.equal(host.NanoCpus, 1500000000);
  assert(host.CapAdd === null || Array.isArray(host.CapAdd) && host.CapAdd.length === 0); assert.deepEqual(host.CapDrop, ['ALL']);
  assert.deepEqual(host.SecurityOpt, ['no-new-privileges']);
  assert.deepEqual(host.Tmpfs, Object.fromEntries(Object.entries(expected.profile.writable).map(([mount, size]) => [mount, 'rw,nosuid,noexec,size=' + size + 'm,uid=1000,gid=1000,mode=0700'])));
}
export function inspectEvidence(image, container, expected) {
  const evidence = {
    image: { Id: image.Id, Architecture: image.Architecture, Os: image.Os, User: image.Config?.User, NodeVersion: image.Config?.Env?.find(value => value.startsWith('NODE_VERSION='))?.slice(13), Revision: image.Config?.Env?.find(value => value.startsWith('VERSION='))?.slice(8), Cmd: image.Config?.Cmd },
    container: { Id: container.Id, Image: container.Image, User: container.Config?.User, HostConfig: Object.fromEntries(['NetworkMode', 'ReadonlyRootfs', 'Memory', 'PidsLimit', 'PidMode', 'IpcMode', 'NanoCpus', 'CapAdd', 'CapDrop', 'SecurityOpt', 'Tmpfs'].map(key => [key, container.HostConfig?.[key]])) },
  };
  requireInspectEvidence(evidence, expected);
  return evidence;
}
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
// Bounded health diagnostic: only clipped scalars, no raw body or message; attempts and last state are the whole footprint.
const clip = v => v === undefined ? v : typeof v === 'string' ? v.slice(0, 64).replace(/[^\w.:-]/g, '?') : typeof v;
export function observeHealth(health, http, body, error) {
  health.attempts = Math.min(health.attempts + 1, 1e6);
  const b = body && typeof body === 'object' ? body : {};
  const last = error ? { http: Number.isInteger(http) ? http : undefined, error: clip(error?.name), code: clip(error?.code) } : { http: Number.isInteger(http) ? http : undefined, status: clip(b.status), version: clip(b.version), catalog: clip(b.readiness?.catalog?.code) };
  health.last = Object.fromEntries(Object.entries(last).filter(([, v]) => v !== undefined));
}
const node = '/usr/local/bin/node';
// Same header the restore verifier uses; the container-owned env token is the only source, no fallback.
export const requestHealth = (request = fetch, token = process.env.KEYSPILLI_API_TOKEN) =>
  request('http://127.0.0.1:3000/api/health', token ? { headers: { 'x-keyspilli-api-token': `Bearer ${token}` } } : undefined);
const readRoot = '/qualification-source';

// Resolve through the package that declares esbuild, then from the real esbuild dir to its platform binary (pnpm symlinks).
export function resolveEsbuild(root) {
  const require = createRequire(root + '/apps/web/package.json');
  const esbuildRequire = createRequire(fs.realpathSync(require.resolve('esbuild/package.json')));
  return fs.realpathSync(esbuildRequire.resolve('@esbuild/linux-x64/bin/esbuild'));
}
export const MOUNTS = ['node_modules', 'apps/web/node_modules', 'packages', 'package.json', 'pnpm-lock.yaml', 'tsconfig.base.json', 'apps/web/package.json', 'apps/web/e2e', 'apps/web/scripts/verify-native-player.mts', 'apps/web/src/lib/native-player-assets.ts', 'apps/web/src/lib/player-reference-bank.ts', 'apps/web/scripts/fixtures/native-piano-assets.json', 'deploy/player-guard-run.mjs', 'deploy/player-node-guard.cjs', 'deploy/player-guard.c'];

// Installed dependencies are the only exempt ignored files; excluding them in Git keeps their names out of the 1MiB buffer.
const INSTALLED = [':(exclude)node_modules', ':(exclude)apps/web/node_modules', ':(exclude,glob)**/node_modules/**'];
export function checkSource(root) {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1048576, cwd: root }).trim();
  assert.equal(git('diff', '--name-only', 'HEAD', '--', 'apps/web/src', '.github/workflows/runtime-rehearsal.yml', ...MOUNTS), '');
  // untracked and non-installed ignored files would be mounted unreviewed
  assert.equal(git('ls-files', '--others', '--exclude-standard', '--', ...MOUNTS), '');
  assert.equal(git('ls-files', '--others', '--ignored', '--exclude-standard', '--', ...MOUNTS, ...INSTALLED), '');
}

async function inside(revision) {
  const started = Date.now();
  const profile = diagnosticProfile(process.env.KEYSPILLI_GUARD_PROFILE ?? 'control');
  assert.match(revision, /^[a-f0-9]{40}$/); assert.equal(process.getuid(), 1000);
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64'); assert.equal(process.version, 'v22.22.3');
  const capacities = Object.fromEntries(Object.entries(profile.writable).map(([p, mib]) => {
    const stat = fs.statfsSync(p, { bigint: true }), bytes = stat.blocks * stat.bsize;
    assert(bytes > 0n && bytes <= BigInt(mib) * 1048576n, 'actual tmpfs capacity exceeds declaration'); return [p, Number(bytes)];
  }));
  const live = new Set(), servers = [], sockets = new Set(), counts = { allowed: 0, forbidden: 0, udp: 0, dns: 0 };
  const logs = []; let logBytes = 0; const cleanupErrors = [];
  function kill(child) { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
  async function run(command, args, { timeout = 90000, limit = 65536 } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true }); live.add(child);
      let stdout = '', stderr = '', bytes = 0, failure;
      const timer = setTimeout(() => { failure = Object.assign(new Error('command deadline'), { code: 'PLAYER_TIMEOUT' }); kill(child); }, timeout);
      const capture = name => data => {
        bytes += data.length; logBytes += data.length;
        const remaining = Math.max(0, Math.min(limit - (bytes - data.length), 65536 - (logBytes - data.length)));
        if (name === 'stdout') stdout += data.subarray(0, remaining); else stderr += data.subarray(0, remaining);
        if (bytes > limit || logBytes > 65536) { failure = Object.assign(new Error('output limit'), { code: 'PLAYER_OUTPUT_LIMIT' }); kill(child); }
      };
      child.stdout.on('data', capture('stdout')); child.stderr.on('data', capture('stderr'));
      child.on('error', error => { failure = error; });
      child.on('close', (code, signal) => { clearTimeout(timer); live.delete(child); logs.push({ command, args, code, signal, stdout, stderr, clipped: bytes > limit || logBytes > 65536 });
        if (failure || code !== 0) reject(failure ?? new Error(`child failed code=${code} signal=${signal}: ${stderr}`)); else resolve(stdout);
      });
    });
  }
  async function tcp(port, key) {
    const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); counts[key]++; socket.end('owned'); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); servers.push(server); return server;
  }
  const udp = dgram.createSocket('udp4');
  udp.on('message', (body, remote) => { const dns = body.length >= 12 && body.readUInt16BE(0) === 0x1234; counts[dns ? 'dns' : 'udp']++;
    const reply = Buffer.from(body); if (dns) reply.writeUInt16BE(0x8180, 2); udp.send(reply, remote.port, remote.address);
  });
  const report = { kind: 'keyspilli-guard-admission', revision, status: 'failed', runtime: { node: process.version, platform: process.platform, arch: process.arch, uid: process.getuid() }, capacities, wasmMemory: 'unknown', performanceObservations: 0 };
  const deadline = new Promise((_, reject) => { const t = setTimeout(() => { for (const child of live) kill(child); reject(new Error('whole-case 105s deadline')); }, 105000); report.timer = t; });
  let allowed;
  try {
    const work = async () => {
      for (const name of ['catalog', 'media', 'home', 'credential', 'protected']) fs.writeFileSync('/sentinels/' + name, 'owned-canary\n', { flag: 'wx' });
      const before = Object.fromEntries(fs.readdirSync('/sentinels').map(name => [name, hash('/sentinels/' + name)]));
      allowed = await tcp(3000, 'allowed'); const forbidden = await tcp(0, 'forbidden');
      await new Promise(resolve => udp.bind(0, '127.0.0.1', resolve));
      const port = forbidden.address().port;
      async function positive() {
        for (const p of [3000, port]) await new Promise((resolve, reject) => { const s = net.connect({ host: '127.0.0.1', port: p }); s.on('data', () => {}); s.on('error', reject); s.on('close', resolve); });
        for (const body of [Buffer.from('owned-udp'), Buffer.from('123401000001000000000000076669787475726507696e76616c69640000010001', 'hex')]) {
          await new Promise((resolve, reject) => { const s = dgram.createSocket('udp4'); const timer = setTimeout(() => { s.close(); reject(new Error('wire positive timeout')); }, 1000);
            s.once('message', reply => { clearTimeout(timer); s.close(); if (body.length >= 12) { assert.equal(reply.readUInt16BE(0), 0x1234); assert.equal(reply.readUInt16BE(2), 0x8180); } else assert.deepEqual(reply, body); resolve(); }); s.send(body, udp.address().port, '127.0.0.1');
          });
        }
      }
      await positive(); const pre = { ...counts };
      const executables = [node];
      function walk(dir, depth) { if (depth < 0) return; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name); if (entry.isDirectory()) walk(p, depth - 1);
        else if (['chrome', 'headless_shell', 'chrome-headless-shell', 'chrome_crashpad_handler'].includes(entry.name)) executables.push(fs.realpathSync(p));
      } }
      walk('/ms-playwright', 3); assert(executables.length > 1 && executables.length < 12);
      executables.push(resolveEsbuild(readRoot));
      const guard = (args, options) => run('/player-guard', [String(port), ...new Set(executables), '--', ...args], options);
      const kernel = report.kernel = (await guard(['--probe'])).trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(kernel.map(p => p.phase), ['kernel-main', 'kernel-child']);
      const checks = `const a=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');for(const p of ['catalog','media','home','credential'])a.throws(()=>fs.readFileSync('/sentinels/'+p),{code:'EPERM'});a.throws(()=>fs.writeFileSync('/sentinels/protected','changed'),{code:'EPERM'});a.throws(()=>cp.spawnSync('/usr/bin/id'),{code:'EPERM'});a.throws(()=>require('node:net').connect({host:'127.0.0.1',port:${port}}),{code:'EPERM'});a.throws(()=>require('node:dgram').createSocket('udp4'),{code:'EPERM'});a.throws(()=>require('node:dns').resolve4('fixture.invalid'),{code:'EPERM'});`;
      const childProgram = checks + `console.log(JSON.stringify({phase:'node-child',denied:true}));`;
      const program = checks + `const c=cp.spawnSync(process.execPath,['-e',${JSON.stringify(childProgram)}]);a.equal(c.status,0);process.stdout.write(c.stdout);console.log(JSON.stringify({phase:'node-main',denied:true}));`;
      const nodeProof = report.node = (await guard([node, '-e', program])).trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(nodeProof.map(p => p.phase).sort(), ['node-child', 'node-main']);
      assert.deepEqual({ forbidden: counts.forbidden, udp: counts.udp, dns: counts.dns }, { forbidden: pre.forbidden, udp: pre.udp, dns: pre.dns });
      await positive(); assert.equal(counts.forbidden, pre.forbidden + 1); assert.equal(counts.udp, pre.udp + 1); assert.equal(counts.dns, pre.dns + 1);
      report.wireLiveness = { pre, post: { ...counts } }; // real UDP/DNS wire positives, separate from the guard's socket denials
      report.counters = counts;
      assert.deepEqual(Object.fromEntries(fs.readdirSync('/sentinels').map(name => [name, hash('/sentinels/' + name)])), before);
      for (const [code, args, options] of [
        ['PLAYER_TIMEOUT', [node, '-e', 'setInterval(()=>{},1000)'], { timeout: 750 }],
        ['PLAYER_OUTPUT_LIMIT', [node, '-e', 'process.stdout.write("x".repeat(4096));setInterval(()=>{},1000)'], { limit: 1024 }],
      ]) { await assert.rejects(guard(args, options), e => e.code === code); }
      const orphan = JSON.parse(await guard([node, '-e', 'const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"});c.unref();console.log(JSON.stringify({pid:c.pid}));']));
      process.kill(orphan.pid, 0); report.survivorPid = orphan.pid;
      await new Promise(resolve => allowed.close(resolve));
      const loader = readRoot + '/node_modules/tsx/dist/loader.mjs';
      await guard([node, '--import', loader, '--input-type=module', '-e', `import {getDb} from '${readRoot}/packages/catalog/src/db.ts';const db=getDb();if(db.prepare('SELECT 1 AS n').get().n!==1)throw Error('addon');db.close();`]);
      const server = spawn('/player-guard', [String(port), ...new Set(executables), '--', node, '/app/apps/web/server.js'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); live.add(server);
      for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { logBytes += data.length; if (logBytes > 65536) kill(server); else logs.push({ app: data.toString() }); });
      server.on('close', () => live.delete(server));
      const readyUntil = Date.now() + 20000; let ready = false; const health = report.health = { attempts: 0 };
      while (Date.now() < readyUntil && server.exitCode === null) {
        let h;
        try { h = await requestHealth(); const body = await h.json(); observeHealth(health, h.status, body); if (h.ok && body.version === revision && body.status === 'healthy') { ready = true; break; } } catch (e) { observeHealth(health, h?.status, undefined, e); }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(ready, 'guarded app did not become healthy');
      const smoke = nativeSmoke(revision, process.env.KEYSPILLI_CRASH_DIAGNOSTIC === 'native-crash-v1');
      try { await guard([node, '--import', loader, '--input-type=module', '-e', smoke]); }
      finally { report.browserProcesses = browserProcessEvidence(logs.find(log => log.args?.at(-1) === smoke)?.stderr ?? ''); }
      report.functional = JSON.parse(fs.readFileSync('/browser-results/result.json', 'utf8')); assert.equal(report.functional.status, 'passed');
      report.kernel = kernel; report.node = nodeProof; report.counters = counts; report.workerWasm = 'worker produced ready SVG'; report.addon = 'guarded SELECT1'; report.status = 'passed';
    };
    await Promise.race([work(), deadline]);
  } catch (error) { report.error = String(error); }
  finally {
    clearTimeout(report.timer); delete report.timer;
    if (process.env.KEYSPILLI_CRASH_DIAGNOSTIC === 'native-crash-v1') {
      console.log(JSON.stringify({ kind: 'keyspilli-resource-barrier', revision }));
      const until = Math.min(started + 105000, Date.now() + 1500);
      while (!fs.existsSync('/tmp/owned-observer-release') && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
      report.resourceBarrierAcknowledged = fs.existsSync('/tmp/owned-observer-release');
    }
    if (!report.functional && fs.existsSync('/browser-results/result.json')) {
      try { report.functional = JSON.parse(fs.readFileSync('/browser-results/result.json', 'utf8')); }
      catch (error) { report.functionalReadError = String(error); }
    }
    for (const child of live) { try { kill(child); } catch (e) { cleanupErrors.push(String(e)); } }
    await Promise.all([...live].map(child => new Promise(resolve => child.once('close', resolve))));
    for (const socket of sockets) socket.destroy();
    for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve));
    if (udp.address) { try { await new Promise(resolve => udp.close(resolve)); } catch (e) { if (e.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') cleanupErrors.push(String(e)); } }
    report.cleanupErrors = cleanupErrors; report.logs = logs; report.logBytes = logBytes;
    if (cleanupErrors.length) report.status = 'failed'; console.log(JSON.stringify(report)); if (report.status !== 'passed') process.exitCode = 1;
  }
}

async function host(image, revision, profileName, expectedBrowsers = 1) {
  const diagnostic = profileName !== undefined, profile = diagnosticProfile(profileName ?? 'control');
  validate(image, revision); assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert(process.env.KEYSPILLI_EVIDENCE && process.env.KEYSPILLI_SCRATCH);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const command = (exe, args, options = {}) => execFileSync(exe, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1048576, ...options });
  assert.equal(command('git', ['rev-parse', 'HEAD']).trim(), revision);
  checkSource(root);
  const metadata = JSON.parse(command('docker', ['image', 'inspect', image]))[0];
  assert.equal(metadata.Id, image); assert.equal(metadata.Architecture, 'amd64'); assert.equal(metadata.Os, 'linux');
  assert(metadata.Config.Env.includes('VERSION=' + revision)); assert.deepEqual(metadata.Config.Cmd, ['node', 'apps/web/server.js']);
  const scratch = fs.mkdtempSync(path.join(process.env.KEYSPILLI_SCRATCH, 'player-guard-'));
  const binary = path.join(scratch, 'guard'); const name = 'keyspilli-player-guard-' + randomUUID().slice(0, 12);
  let receipt = { kind: 'keyspilli-guard-admission', status: 'failed', image, revision }, failure, expectedInspect;
  const piano = process.env.KEYSPILLI_NATIVE_PIANO_DIR; assert(piano && path.isAbsolute(piano) && fs.realpathSync(piano) === piano);
  try {
    command('gcc', ['-static', '-O2', '-std=c11', '-Wall', '-Wextra', '-Werror', path.join(root, 'deploy/player-guard.c'), '-o', binary], { env: { ...process.env, TMPDIR: scratch } });
    const args = guardLaunchArgs(name, profile);
    for (const relative of MOUNTS) {
      const p = path.join(root, relative); assert(fs.realpathSync(p) === p && !p.includes(':')); args.push('-v', p + ':' + readRoot + '/' + relative + ':ro');
    }
    args.push('-v', binary + ':/player-guard:ro', '-v', piano + ':/piano-input:ro');
    for (const [key, value] of guardEnvironment(diagnostic ? profileName : undefined)) args.push('-e', key + '=' + value);
    args.push(image, '--init', node, readRoot + '/deploy/player-guard-run.mjs', '--inside', revision);
    const identity = command('docker', args).trim(); assert.match(identity, /^[a-f0-9]{64}$/);
    const inspected = JSON.parse(command('docker', ['inspect', name]))[0]; assert.equal(inspected.HostConfig.NetworkMode, 'none'); assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
    expectedInspect = { image, revision, identity, profile };
    receipt.inspect = inspectEvidence(metadata, inspected, expectedInspect);
    const inspectBody = JSON.stringify(receipt.inspect, null, 2) + '\n'; assert(Buffer.byteLength(inspectBody) <= 1048576, 'inspect output cap');
    receipt.inspectArtifact = diagnostic ? 'player-guard-' + profileName + '-inspect.json' : 'player-guard-inspect.json';
    receipt.inspectSha256 = createHash('sha256').update(inspectBody).digest('hex');
    fs.writeFileSync(path.join(process.env.KEYSPILLI_EVIDENCE, receipt.inspectArtifact), inspectBody, { flag: 'wx' });
    assert.equal(inspected.HostConfig.Memory, profile.memoryMiB * 1048576); assert.equal(inspected.HostConfig.PidsLimit, 128); assert.equal(inspected.HostConfig.PidMode, ''); assert.equal(inspected.Config.User, '1000:1000');
    assert.equal(inspected.HostConfig.NanoCpus, 1500000000); assert.deepEqual(inspected.HostConfig.CapDrop, ['ALL']); assert(inspected.HostConfig.SecurityOpt.includes('no-new-privileges'));
    assert.deepEqual(Object.keys(inspected.HostConfig.Tmpfs).sort(), Object.keys(WRITABLE).sort());
    let output;
    if (diagnostic) {
      const terminal = await new Promise(resolve => {
        const child = spawn('docker', ['start', '-a', name], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = ''; const resourceErrors = [];
        const observe = (release = false) => { try {
          const state = JSON.parse(command('docker', ['inspect', '--format', '{{json .State}}', name], { timeout: 2000 }));
          if (state.Running && state.Pid > 1 && !receipt.resources?.beforeTeardown) {
            receipt.resources = JSON.parse(command('sudo', ['-n', process.execPath, fileURLToPath(import.meta.url), '--observe-owned', String(state.Pid), identity, ...(release ? ['--release'] : [])], { timeout: 2000 }));
            receipt.mountUsage = accumulateMountUsage(receipt.mountUsage, receipt.resources);
          }
        } catch (error) { if (resourceErrors.length < 4) resourceErrors.push(String(error.message).slice(0, 512)); } };
        const timer = setInterval(observe, 1000);
        const stop = () => { try { command('docker', ['stop', '--time', '0', name], { timeout: 2000 }); } catch (error) { receipt.killError = String(error.message).slice(0, 512); } finally { child.kill('SIGKILL'); } };
        const cancel = () => { receipt.cancelled = true; observe(); stop(); };
        process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
        const deadline = setTimeout(() => { observe(); receipt.deadlineExceeded = true; stop(); }, 120000);
        for (const [key, stream, cap] of [['stdout', child.stdout, 1048576], ['stderr', child.stderr, 65536]]) stream.on('data', data => {
          const previous = key === 'stdout' ? stdout : stderr;
          const remaining = Math.max(0, cap - Buffer.byteLength(previous)); const next = previous + data.subarray(0, remaining).toString();
          if (key === 'stdout') stdout = next; else stderr = next;
          if (key === 'stdout' && stdout.includes(JSON.stringify({ kind: 'keyspilli-resource-barrier', revision }) + '\n')) observe(true);
          if (data.length > remaining) receipt[key + 'Clipped'] = true;
        });
        child.on('error', error => { receipt.launchError = String(error); });
        child.on('close', (code, signal) => { clearInterval(timer); clearTimeout(deadline); process.off('SIGINT', cancel); process.off('SIGTERM', cancel); resolve({ stdout, stderr, code, signal, resourceErrors }); });
      });
      const { stdout, stderr, ...state } = terminal;
      Object.assign(receipt, state); output = stdout;
      for (const [stream, body] of Object.entries({ stdout, stderr })) {
        const filename = 'player-guard-' + profileName + '.' + stream;
        fs.writeFileSync(path.join(process.env.KEYSPILLI_EVIDENCE, filename), body, { flag: 'wx' });
        receipt[stream + 'Artifact'] = filename; receipt[stream + 'Sha256'] = createHash('sha256').update(body).digest('hex');
      }
    } else output = command('docker', ['start', '-a', name], { timeout: 120000 });
    const state = JSON.parse(command('docker', ['inspect', '--format', '{{json .State}}', name])); receipt.state = state;
    const { result, reaper } = parseGuardOutput(output, revision);
    delete receipt.stdout; receipt.stdoutSha256 = createHash('sha256').update(output).digest('hex');
    Object.assign(receipt, result, { reaper });
    assert.deepEqual(result.runtime, { node: 'v22.22.3', platform: 'linux', arch: 'x64', uid: 1000 });
    assert.equal(result?.status, 'passed'); assert.equal(reaper?.remainingChildren, 0); assert(reaper.reaped.some(p => p.pid === result.survivorPid && p.signal === 9));
    assert.equal(state.Pid, 0); assert.equal(state.ExitCode, 0); assert.equal(state.OOMKilled, false);
    Object.assign(receipt, { state, image, writableMiB: Object.values(profile.writable).reduce((a, b) => a + b, 0), helperSha256: hash(binary), sourceSha256: hash(path.join(root, 'deploy/player-guard.c')) });
  } catch (error) {
    failure = error; receipt.status = 'failed'; receipt.hostError = String(error.message).slice(0, 4096); receipt.error ??= receipt.hostError;
    if (!diagnostic) { receipt.stdout ??= String(error.stdout ?? '').slice(0, 524288); receipt.stderr ??= String(error.stderr ?? '').slice(0, 65536); }
  } finally {
    try { requireInspectEvidence(receipt.inspect, expectedInspect); } catch (error) { receipt.status = 'failed'; receipt.inspectError = String(error.message).slice(0, 512); failure ??= error; }
    if (diagnostic) { receipt.scope = 'diagnostic-only'; receipt.profile = profileName; receipt.profileLimits = profile; }
    try {
      if (command('docker', ['ps', '-aq', '--filter', 'name=^/' + name + '$']).trim()) command('docker', ['rm', '-f', name]);
      assert.equal(command('docker', ['ps', '-aq', '--filter', 'name=^/' + name + '$']).trim(), ''); receipt.containerRemoved = true;
      receipt.parentBytes = fs.readdirSync(scratch).reduce((sum, entry) => sum + fs.statSync(path.join(scratch, entry)).size, 0);
      assert(receipt.parentBytes <= 16 * 1048576, 'parent16MiB reservation exceeded');
      fs.rmSync(scratch, { recursive: true }); receipt.scratchRemoved = true;
    } catch (error) { receipt.status = 'failed'; receipt.cleanupError = String(error); failure ??= error; }
    if (diagnostic) { try { requireDiagnosticEvidence(receipt, expectedBrowsers); receipt.evidenceComplete = true; } catch (error) { receipt.evidenceComplete = false; receipt.evidenceError = String(error); receipt.status = 'failed'; failure ??= error; } }
    const body = JSON.stringify(receipt, null, 2) + '\n'; assert(Buffer.byteLength(body) <= 1048576, 'receipt output cap');
    fs.writeFileSync(path.join(process.env.KEYSPILLI_EVIDENCE, diagnostic ? 'player-guard-' + profileName + '.json' : 'player-guard-admission.json'), body, { flag: 'wx' });
  }
  if (failure && !diagnostic) throw new Error('Player guard qualification failed; see player-guard-admission.json');
  return receipt;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--hosted-capacity') { assert.equal(process.argv.length, 4); await capacityCLI(process.argv[3]); }
  else
  if (process.argv[2] === '--observe-owned') { assert([5, 6].includes(process.argv.length)); if (process.argv.length === 6) assert.equal(process.argv[5], '--release'); console.log(JSON.stringify(ownedResources(process.argv[3], process.argv[4], process.argv.length === 6))); }
  else if (process.argv[2] === '--inside') await inside(process.argv[3]);
  else if (process.argv[6] === '--observe-control') {
    assert.equal(process.argv.length, 7);
    assert.deepEqual([process.argv[2], process.argv[4]], ['--image', '--revision']);
    assert.equal(process.env.GITHUB_REPOSITORY, 'Reedtrullz/Keyspilli');
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/keyspilli-native-full-20261104');
    assert.equal(process.env.GITHUB_SHA, process.argv[5]);
    assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
    assert.equal(process.env.ImageOS, 'ubuntu26');
    const cell = await host(process.argv[3], process.argv[5], 'control', 3);
    if (!cell.evidenceComplete || cell.status !== 'passed') process.exitCode = 1;
  }
  else if (process.argv[6] === '--diagnostic') {
    assert.equal(process.argv.length, 8); assert.equal(process.argv[7], 'native-crash-v1');
    assert.deepEqual([process.argv[2], process.argv[4]], ['--image', '--revision']);
    assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/keyspilli-observer-corrective-20261104');
    const cells = [];
    for (const profile of ['control', 'writable', 'ram']) { const cell = await host(process.argv[3], process.argv[5], profile); cells.push(cell); if (cell.cancelled || !cell.containerRemoved || !cell.scratchRemoved) break; }
    const result = { kind: 'keyspilli-native-crash-diagnostic', scope: 'diagnostic-only', image: process.argv[3], revision: process.argv[5], status: cells.length === 3 && cells.every(cell => cell.evidenceComplete && cell.status === 'passed') ? 'passed' : 'failed', cells };
    fs.writeFileSync(path.join(process.env.KEYSPILLI_EVIDENCE, 'native-crash-diagnostic.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    if (result.status !== 'passed') process.exitCode = 1;
  }
  else { assert.deepEqual(process.argv.slice(2).filter((_, i) => i % 2 === 0), ['--image', '--revision']); assert.equal(process.argv.length, 6); await host(process.argv[3], process.argv[5]); }
}
