import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

export const WRITABLE = Object.freeze({ '/tmp': 15, '/dev/shm': 4, '/data': 16, '/browser-results': 4, '/sentinels': 1 });
export function validate(image, revision) {
  assert.match(image, /^sha256:[a-f0-9]{64}$/); assert.match(revision, /^[a-f0-9]{40}$/);
  assert(Object.values(WRITABLE).reduce((a, b) => a + b, 0) + 16 <= 64);
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
  assert.match(revision, /^[a-f0-9]{40}$/); assert.equal(process.getuid(), 1000);
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64'); assert.equal(process.version, 'v22.22.3');
  const capacities = Object.fromEntries(Object.entries(WRITABLE).map(([p, mib]) => {
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
        if (bytes > limit || logBytes > 65536) { failure = Object.assign(new Error('output limit'), { code: 'PLAYER_OUTPUT_LIMIT' }); kill(child); return; }
        if (name === 'stdout') stdout += data; else stderr += data;
      };
      child.stdout.on('data', capture('stdout')); child.stderr.on('data', capture('stderr'));
      child.on('error', error => { failure = error; });
      child.on('close', (code, signal) => { clearTimeout(timer); live.delete(child); logs.push({ command, args, code, signal, stdout, stderr });
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
  const report = { kind: 'keyspilli-guard-admission', revision, status: 'failed', capacities, wasmMemory: 'unknown', performanceObservations: 0 };
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
      const kernel = (await guard(['--probe'])).trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(kernel.map(p => p.phase), ['kernel-main', 'kernel-child']);
      const checks = `const a=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');for(const p of ['catalog','media','home','credential'])a.throws(()=>fs.readFileSync('/sentinels/'+p),{code:'EPERM'});a.throws(()=>fs.writeFileSync('/sentinels/protected','changed'),{code:'EPERM'});a.throws(()=>cp.spawnSync('/usr/bin/id'),{code:'EPERM'});a.throws(()=>require('node:net').connect({host:'127.0.0.1',port:${port}}),{code:'EPERM'});a.throws(()=>require('node:dgram').createSocket('udp4'),{code:'EPERM'});a.throws(()=>require('node:dns').resolve4('fixture.invalid'),{code:'EPERM'});`;
      const childProgram = checks + `console.log(JSON.stringify({phase:'node-child',denied:true}));`;
      const program = checks + `const c=cp.spawnSync(process.execPath,['-e',${JSON.stringify(childProgram)}]);a.equal(c.status,0);process.stdout.write(c.stdout);console.log(JSON.stringify({phase:'node-main',denied:true}));`;
      const nodeProof = (await guard([node, '-e', program])).trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(nodeProof.map(p => p.phase).sort(), ['node-child', 'node-main']);
      assert.deepEqual({ forbidden: counts.forbidden, udp: counts.udp, dns: counts.dns }, { forbidden: pre.forbidden, udp: pre.udp, dns: pre.dns });
      await positive(); assert.equal(counts.forbidden, pre.forbidden + 1); assert.equal(counts.udp, pre.udp + 1); assert.equal(counts.dns, pre.dns + 1);
      report.wireLiveness = { pre, post: { ...counts } }; // real UDP/DNS wire positives, separate from the guard's socket denials
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
      const smoke = `import {createRequire} from 'node:module';const r=createRequire('${readRoot}/apps/web/package.json');const {chromium}=r('@playwright/test');let worker=false;const launch=chromium.launch.bind(chromium);chromium.launch=async(...args)=>{const b=await launch(...args);const nc=b.newContext.bind(b);b.newContext=async(...args)=>{const c=await nc(...args);c.on('page',p=>{void p.waitForFunction(()=>window.__sheetReady===true&&window.__sheetRenderer==='worker'&&window.__sheetRenderedPages>0,{},{timeout:80000}).then(()=>{worker=true}).catch(()=>{});});return c;};return b;};const {verifyNativePlayer}=await import('${readRoot}/apps/web/scripts/verify-native-player.mts');await verifyNativePlayer('${revision}');if(process.exitCode||!worker)throw Error('functional worker/WASM proof missing');`;
      await guard([node, '--import', loader, '--input-type=module', '-e', smoke]);
      report.functional = JSON.parse(fs.readFileSync('/browser-results/result.json', 'utf8')); assert.equal(report.functional.status, 'passed');
      report.kernel = kernel; report.node = nodeProof; report.counters = counts; report.workerWasm = 'worker produced ready SVG'; report.addon = 'guarded SELECT1'; report.status = 'passed';
    };
    await Promise.race([work(), deadline]);
  } catch (error) { report.error = String(error); }
  finally {
    clearTimeout(report.timer); delete report.timer;
    for (const child of live) { try { kill(child); } catch (e) { cleanupErrors.push(String(e)); } }
    await Promise.all([...live].map(child => new Promise(resolve => child.once('close', resolve))));
    for (const socket of sockets) socket.destroy();
    for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve));
    if (udp.address) { try { await new Promise(resolve => udp.close(resolve)); } catch (e) { if (e.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') cleanupErrors.push(String(e)); } }
    report.cleanupErrors = cleanupErrors; report.logs = logs; report.logBytes = logBytes;
    if (cleanupErrors.length) report.status = 'failed'; console.log(JSON.stringify(report)); if (report.status !== 'passed') process.exitCode = 1;
  }
}

async function host(image, revision) {
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
  let receipt = { kind: 'keyspilli-guard-admission', status: 'failed', image, revision }, failure;
  const piano = process.env.KEYSPILLI_NATIVE_PIANO_DIR; assert(piano && path.isAbsolute(piano) && fs.realpathSync(piano) === piano);
  try {
    command('gcc', ['-static', '-O2', '-std=c11', '-Wall', '-Wextra', '-Werror', path.join(root, 'deploy/player-guard.c'), '-o', binary], { env: { ...process.env, TMPDIR: scratch } });
    const args = ['create', '--name', name, '--pull=never', '--network', 'none', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--cpus', '1.5', '--memory', '1g', '--pids-limit', '128', '--workdir', readRoot, '--entrypoint', '/player-guard'];
    for (const [mount, size] of Object.entries(WRITABLE)) args.push('--tmpfs', mount + ':rw,nosuid,noexec,size=' + size + 'm,uid=1000,gid=1000,mode=0700');
    for (const relative of MOUNTS) {
      const p = path.join(root, relative); assert(fs.realpathSync(p) === p && !p.includes(':')); args.push('-v', p + ':' + readRoot + '/' + relative + ':ro');
    }
    args.push('-v', binary + ':/player-guard:ro', '-v', piano + ':/piano-input:ro');
    for (const pair of ['HOME=/tmp', 'TMPDIR=/tmp', 'PORT=3000', 'HOSTNAME=127.0.0.1', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright', 'KEYSPILLI_DATA_DIR=/data', 'KEYSPILLI_ORIGIN=http://127.0.0.1:3000', 'KEYSPILLI_API_TOKEN=test-token-for-e2e', 'AUTH_SECRET=owned-player-guard-only', 'KEYSPILLI_TUTORIAL_BETA=0', 'KEYSPILLI_NATIVE_PROBE_SCOPE=owned-restore']) args.push('-e', pair);
    args.push(image, '--init', node, readRoot + '/deploy/player-guard-run.mjs', '--inside', revision);
    assert.match(command('docker', args).trim(), /^[a-f0-9]{64}$/);
    const inspected = JSON.parse(command('docker', ['inspect', name]))[0]; assert.equal(inspected.HostConfig.NetworkMode, 'none'); assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
    assert.equal(inspected.HostConfig.Memory, 1073741824); assert.equal(inspected.HostConfig.PidsLimit, 128); assert.equal(inspected.HostConfig.PidMode, ''); assert.equal(inspected.Config.User, '1000:1000');
    assert.deepEqual(Object.keys(inspected.HostConfig.Tmpfs).sort(), Object.keys(WRITABLE).sort());
    const output = command('docker', ['start', '-a', name], { timeout: 120000 });
    const rows = output.trim().split('\n').map(line => JSON.parse(line)); const result = rows.find(r => r.kind === 'keyspilli-guard-admission'), reaper = rows.find(r => r.phase === 'reaper');
    assert.equal(result?.status, 'passed'); assert.equal(reaper?.remainingChildren, 0); assert(reaper.reaped.some(p => p.pid === result.survivorPid && p.signal === 9));
    const state = JSON.parse(command('docker', ['inspect', '--format', '{{json .State}}', name])); assert.equal(state.Pid, 0); assert.equal(state.ExitCode, 0); assert.equal(state.OOMKilled, false);
    receipt = { ...result, reaper, state, image, writableMiB: Object.values(WRITABLE).reduce((a, b) => a + b, 0), helperSha256: hash(binary), sourceSha256: hash(path.join(root, 'deploy/player-guard.c')) };
  } catch (error) {
    failure = error; receipt.error = String(error.message).slice(0, 4096); receipt.stdout = String(error.stdout ?? '').slice(0, 524288); receipt.stderr = String(error.stderr ?? '').slice(0, 65536);
  } finally {
    try {
      if (command('docker', ['ps', '-aq', '--filter', 'name=^/' + name + '$']).trim()) command('docker', ['rm', '-f', name]);
      assert.equal(command('docker', ['ps', '-aq', '--filter', 'name=^/' + name + '$']).trim(), ''); receipt.containerRemoved = true;
      fs.rmSync(scratch, { recursive: true }); receipt.scratchRemoved = true;
    } catch (error) { receipt.status = 'failed'; receipt.cleanupError = String(error); failure ??= error; }
    const body = JSON.stringify(receipt, null, 2) + '\n'; assert(Buffer.byteLength(body) <= 1048576, 'receipt output cap');
    fs.writeFileSync(path.join(process.env.KEYSPILLI_EVIDENCE, 'player-guard-admission.json'), body, { flag: 'wx' });
  }
  if (failure) throw new Error('Player guard qualification failed; see player-guard-admission.json');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--inside') await inside(process.argv[3]);
  else { assert.deepEqual(process.argv.slice(2).filter((_, i) => i % 2 === 0), ['--image', '--revision']); assert.equal(process.argv.length, 6); await host(process.argv[3], process.argv[5]); }
}
