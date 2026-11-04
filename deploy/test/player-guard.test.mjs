import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { validate, WRITABLE, resolveEsbuild, checkSource, MOUNTS, observeHealth, requestHealth, diagnosticProfile, guardLaunchArgs, parseGuardOutput, requireDiagnosticEvidence, browserProcessEvidence, nativeSmoke, accumulateMountUsage } from '../player-guard-run.mjs';
import { perfViewport } from '../../apps/web/e2e/perf-viewport.ts';
const { privatePath, connectionAllowed } = createRequire(import.meta.url)('../player-node-guard.cjs');

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
  const mounts = Object.fromEntries(Object.keys(WRITABLE).map(mount => [mount, { blocks: 15, free: 1, blockSize: 4096, files: 4, freeFiles: 1 }]));
  const revision = 'b'.repeat(40), stderr = '2026-11-04T00:00:00Z pw:browser <launching> /owned/chromium --headless\n2026-11-04T00:00:00Z pw:browser <launched> pid=44\n2026-11-04T00:00:01Z pw:browser [pid=44] <process did exit: exitCode=1, signal=null>\n';
  const packet = { revision, logs: [{ args: ['-e', nativeSmoke(revision, true)], stderr }], functional: { browserObservation: { armed: true, commandLineSource: 'playwright-launcher-stderr', events: [{ kind: 'browser-launched' }], stderrSource: 'guarded-child-stderr' } }, browserProcesses: browserProcessEvidence(stderr), resourceBarrierAcknowledged: true, resources: { pid: 42, cgroup: '/owned', beforeTeardown: true, memory: { 'memory.events': 'oom 0', 'memory.peak': '12', 'memory.max': '1073741824' }, mounts, limits: 'Max processes 128 128 processes' }, containerRemoved: true, scratchRemoved: true, stdoutClipped: false, stderrClipped: false };
  packet.logBytes = Buffer.byteLength(stderr);
  packet.mountUsage = accumulateMountUsage(undefined, packet.resources);
  assert.doesNotThrow(() => requireDiagnosticEvidence(packet));
  const guardNegative = { command: '/player-guard', args: ['/usr/local/bin/node','-e','process.stdout.write("x".repeat(4096));setInterval(()=>{},1000)'], code: null, signal: 'SIGKILL', stdout: 'x'.repeat(1024), stderr: '', clipped: true };
  const withExpectedNegative = {...packet,logBytes:4096+packet.logBytes,logs:[guardNegative,packet.logs[0]]};
  assert.doesNotThrow(() => requireDiagnosticEvidence(withExpectedNegative), 'intentional output-limit guard negative is retained separately from valid smoke');
  assert.throws(() => requireDiagnosticEvidence({...withExpectedNegative,logs:[guardNegative,{...packet.logs[0],clipped:true}]}), /clipped inner launcher stream/);
  assert.throws(() => requireDiagnosticEvidence({...packet,mountUsage:undefined}));
  assert.throws(() => requireDiagnosticEvidence({...packet,mountUsage:{...packet.mountUsage,sampleCount:0}}));
  for (const key of ['memory.peak', 'memory.max', 'memory.events']) assert.throws(() => requireDiagnosticEvidence({ ...packet, resources: { ...packet.resources, memory: { ...packet.resources.memory, [key]: 'passed' } } }));
  for (const change of [{ functional: undefined }, { resources: undefined }, { resourceBarrierAcknowledged: false }, { cancelled: true }, { deadlineExceeded: true }, { resources: { ...packet.resources, memory: {} } }, { resources: { ...packet.resources, mounts: { '/tmp': mounts['/tmp'] } } }, { browserProcesses: [{ kind: 'launch', pid: 44 }, { kind: 'exit', pid: 45 }] }, { functional: { browserObservation: { armed: true, commandLine: [], events: [] } } }, { containerRemoved: false }, { stdoutClipped: true }, { stderrClipped: true }]) assert.throws(() => requireDiagnosticEvidence({ ...packet, ...change }));
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
    const files = new Map(), revision = 'b'.repeat(40), processState = { platform: 'linux', arch: 'x64', env: { KEYSPILLI_NATIVE_PROBE_SCOPE: 'owned-restore', KEYSPILLI_DATA_DIR: '/data' }, argv: [] };
    const context = vm.createContext({ process: processState, Buffer, URL, console: {log(){} } });
    let captured = false, cdpCalls = 0, missingSamples = false;
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
      'node:fs': {readFileSync(){},statSync(){},writeFileSync:(p,b)=>files.set(p,b),writeSync(){}},
      'node:path': await import('node:path'), 'node:url': await import('node:url'),
      '@playwright/test': {chromium:{launch:async()=>browser},expect:value=>({toBe:expected=>assert.equal(value,expected),toEqual:expected=>assert.deepEqual(value,expected)}),request:{newContext:async()=>api}},
      '@keyspilli/midi': {parseMidi(){},parseMusicXmlNotes(){}},
      '../e2e/player-audio-capture': {capturePlayerClip:async()=>{captured=true;assert(browser.listenerCount('disconnected')>0);assert(page.listenerCount('crash')>0);assert(page.listenerCount('close')>0);if(missingSamples)return {sampleAssets:[]};page.emit('crash');throw Error('capture-boundary-sentinel');},savePlayerCapture(){}},
      '../src/lib/native-player-assets': {readNativePianoBank:()=>({assets:new Map(),sampleAssetPins:[{url:'https://pinned.invalid/piano.ogg',sha256:'a'.repeat(64)}]})},
    };
    const load = async name => {const values=modules[name];assert(values, name);const m=new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value] of Object.entries(values))this.setExport(key,value);},{context});await m.link(()=>{});await m.evaluate();return m;};
    const module = new vm.SourceTextModule(stripTypeScriptTypes(source), { context, importModuleDynamically: load });
    await module.link(load); await module.evaluate(); await module.namespace.verifyNativePlayer(revision);
    assert.equal(cdpCalls,0,'optional CDP must not become a startup precondition');
    assert.equal(captured,true,'capture boundary reached');
    const packet=JSON.parse(files.get('/browser-results/result.json'));
    assert.match(packet.error,/Native browser terminal event: page-crash at original-capture/);assert.equal(packet.browserObservation.armed,true);
    assert(packet.browserObservation.events.some(e=>e.kind==='page-crash'&&e.phase==='original-capture'));
    const xml=files.get('/browser-results/control.musicxml');missingSamples=true;await module.namespace.verifyNativePlayer(revision);assert.equal(files.get('/browser-results/control.musicxml'),xml);
    const missing=JSON.parse(files.get('/browser-results/result.json'));assert.equal(missing.status,'failed');assert.match(missing.error,/piano\.ogg/);
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
test('socket calls permit only the app loopback port or an owned Unix socket', () => {
  for (const args of [[3000, '127.0.0.1'], [{ port: 3000, host: '::1' }], [{ path: '/tmp/socket' }], [[{ port: 3000, host: 'localhost' }]]]) assert.equal(connectionAllowed(args), true);
  for (const args of [[443, 'api.example.invalid'], [3000, '203.0.113.1'], [{ port: 3001, host: '127.0.0.1' }], [{ path: '/tmp/../sentinels/socket' }], [{ host: '127.0.0.1' }]]) assert.equal(connectionAllowed(args), false);
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
