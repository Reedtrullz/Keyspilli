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
export function requireDiagnosticEvidence(packet) {
  const observation = packet.functional?.browserObservation;
  assert(observation?.armed === true && Array.isArray(observation.events), 'missing early browser/launch evidence');
  assert.equal(observation.commandLineSource, 'playwright-launcher-stderr');
  assert.equal(observation.stderrSource, 'guarded-child-stderr');
  assert(observation.events.some(event => event.kind === 'browser-launched'), 'missing actual launch observation');
  const processes = packet.browserProcesses;
  const smoke = packet.logs?.find(log => log.args?.at(-1) === nativeSmoke(packet.revision, true));
  const stream = smoke?.stderr;
  assert(typeof stream === 'string' && stream.length > 0, 'missing raw smoke launcher stderr');
  assert.deepEqual(processes, browserProcessEvidence(stream), 'browser process evidence provenance mismatch');
  assert.equal(processes.length, 3, 'one actual browser argv, launch and exit required');
  const [argv, launch, exit] = processes;
  assert(argv.kind === 'argv' && argv.commandLineText.length > 0, 'missing actual browser command line');
  assert(launch.kind === 'launch' && Number.isSafeInteger(launch.pid) && launch.pid > 1, 'missing browser process launch');
  assert(exit.kind === 'exit' && exit.pid === launch.pid, 'missing matching browser process exit');
  assert((exit.code === null) !== (exit.signal === null), 'missing unambiguous process exit status');
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
  return `import {createRequire} from 'node:module';${debug}const r=createRequire('${readRoot}/apps/web/package.json');const {chromium}=r('@playwright/test');let worker=false;const launch=chromium.launch.bind(chromium);chromium.launch=async(...args)=>{const b=await launch(...args);const nc=b.newContext.bind(b);b.newContext=async(...args)=>{const c=await nc(...args);c.on('page',p=>{void p.waitForFunction(()=>window.__sheetReady===true&&window.__sheetRenderer==='worker'&&window.__sheetRenderedPages>0,{},{timeout:80000}).then(()=>{worker=true}).catch(()=>{});});return c;};return b;};const {verifyNativePlayer}=await import('${readRoot}/apps/web/scripts/verify-native-player.mts');await verifyNativePlayer('${revision}');if(process.exitCode||!worker)throw Error('functional worker/WASM proof missing');`;
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
// Linux directory descriptors pin proc identities across PID reuse; fixtures use checked directories on macOS.
export function collectOwnedPidSnapshot({ pid, identity, procRoot = '/proc', cgroupRoot = '/sys/fs/cgroup', deadlineMs = Infinity }) {
  const snapshot = { atMs: Date.now(), complete: false, tasks: [], gaps: [] }, handles = [];
  const id = value => { assert.match(String(value), /^[1-9][0-9]{0,9}$/); const n = Number(value); assert(Number.isSafeInteger(n) && n <= 2147483647 && String(n) === String(value)); return n; };
  const directory = file => {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW); handles.push(fd);
    return process.platform === 'linux' ? '/proc/self/fd/' + fd : file;
  };
  const read = file => {
    assert(Date.now() < deadlineMs, 'cell deadline');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try { assert(fs.fstatSync(fd).isFile(), 'kernel file type'); const bytes = Buffer.alloc(8193), size = fs.readSync(fd, bytes, 0, bytes.length, 0); assert(size <= 8192, 'kernel file cap'); return bytes.subarray(0, size).toString('utf8'); }
    finally { fs.closeSync(fd); }
  };
  const ids = text => { assert.match(text, /^(?:[1-9][0-9]*\n?)+$/); const result = text.trim().split('\n').map(id); assert.equal(new Set(result).size, result.length); assert(result.length <= 128, 'task cap'); return result; };
  const group = dir => { const value = read(dir + '/cgroup'); assert.match(value, /^0::\/[a-zA-Z0-9_./-]+\n?$/); const result = value.trim().slice(3); assert(!result.includes('//') && result.split('/').slice(1).every(p => p && p !== '.' && p !== '..'), 'cgroup path'); return result; };
  const stamp = (dir, expected) => { const text = read(dir + '/stat'), match = text.match(/^([1-9][0-9]*) \([\s\S]*\) [A-Za-z] (.*)\n?$/); assert(match && id(match[1]) === expected, 'stat identity'); const start = match[2].trim().split(/\s+/)[18]; assert.match(start ?? '', /^[0-9]+$/); return start; };
  try {
    id(pid); assert(pid > 1); assert.match(identity, /^[a-f0-9]{64}$/); assert.equal(identity.length, 64);
    for (const root of [procRoot, cgroupRoot]) assert.equal(fs.realpathSync(root), root, 'root symlink');
    const proc = directory(procRoot), owner = directory(proc + '/' + pid), cgroup = group(owner);
    assert(['/docker/' + identity, '/system.slice/docker-' + identity + '.scope'].includes(cgroup), 'exact container cgroup');
    snapshot.containerId = identity; snapshot.pid = pid; snapshot.cgroup = cgroup; snapshot.ownerStart = stamp(owner, pid);
    let cg = directory(cgroupRoot); for (const segment of cgroup.slice(1).split('/')) cg = directory(cg + '/' + segment);
    const membersText = read(cg + '/cgroup.procs'), tidsText = read(cg + '/cgroup.threads');
    const members = ids(membersText), tids = ids(tidsText); assert(members.includes(pid), 'owner membership');
    snapshot.members = members; snapshot.threadIds = [...tids];
    for (const member of members) {
      try {
        const p = directory(proc + '/' + member); assert.equal(group(p), cgroup, 'foreign member'); const processStart = stamp(p, member);
        const namespacePidText = read(p + '/status').match(/^NSpid:\s*([^\n]+)$/m)?.[1]; assert(namespacePidText, 'missing process namespace');
        const namespacePids = namespacePidText.trim().split(/\s+/).map(id); assert.equal(namespacePids[0], member); assert(namespacePids.length <= 32);
        const processComm = read(p + '/comm'); assert(Buffer.byteLength(processComm) <= 17, 'comm cap');
        const taskDir = directory(p + '/task'), taskIds = fs.readdirSync(taskDir).map(id); assert(taskIds.length > 0 && taskIds.length <= 128, 'task cap');
        for (const tid of taskIds) {
          try {
            assert(tids.includes(tid), 'thread membership'); assert(snapshot.tasks.length < 128, 'task cap');
            const t = directory(taskDir + '/' + tid); assert.equal(group(t), cgroup, 'foreign thread'); const start = stamp(t, tid);
            const status = read(t + '/status'), comm = read(t + '/comm'); assert(Buffer.byteLength(comm) <= 17, 'comm cap');
            const field = name => { const matches = [...status.matchAll(new RegExp('^' + name + ':\\s*([^\\n]+)$', 'gm'))]; assert.equal(matches.length, 1, 'missing status field'); return matches[0][1].trim(); };
            assert.equal(id(field('Tgid')), member); assert.equal(id(field('Pid')), tid);
            const namespaceIds = field('NSpid').split(/\s+/).map(id); assert.equal(namespaceIds[0], tid); assert(namespaceIds.length <= 32);
            const parentText = field('PPid'); assert.match(parentText, /^(0|[1-9][0-9]{0,9})$/); const parentPid = Number(parentText); assert(Number.isSafeInteger(parentPid) && parentPid <= 2147483647);
            const threads = id(field('Threads')); assert.equal(threads, taskIds.length, 'thread count changed');
            assert.equal(group(t), cgroup); assert.equal(stamp(t, tid), start, 'PID reuse'); assert.equal(group(p), cgroup); assert.equal(stamp(p, member), processStart, 'process reuse');
            snapshot.tasks.push({ hostPid: member, hostTid: tid, namespacePids, namespaceIds, parentPid, processComm: processComm.replace(/\n$/, ''), comm: comm.replace(/\n$/, ''), threads, start });
          } catch (error) { snapshot.gaps.push({ kind: 'task-raced-or-invalid', pid: member, tid, code: error instanceof Error && typeof error.code === 'string' ? error.code : 'INVALID' }); }
        }
      } catch (error) { snapshot.gaps.push({ kind: 'process-raced-or-invalid', pid: member, code: error instanceof Error && typeof error.code === 'string' ? error.code : 'INVALID' }); }
    }
    assert.equal(read(cg + '/cgroup.procs'), membersText, 'membership changed'); assert.equal(read(cg + '/cgroup.threads'), tidsText, 'thread membership changed');
    assert.equal(group(owner), cgroup); assert.equal(stamp(owner, pid), snapshot.ownerStart, 'owner reuse');
    assert.deepEqual(snapshot.tasks.map(t => t.hostTid).sort((a,b)=>a-b), tids.sort((a,b)=>a-b), 'incomplete task coverage');
    snapshot.complete = snapshot.gaps.length === 0;
  } catch (error) { snapshot.tasks = []; snapshot.gaps.push({kind:'ownership-or-membership-unavailable',code:error instanceof Error && typeof error.code === 'string' ? error.code : 'INVALID'}); }
  finally { for (const fd of handles.reverse()) fs.closeSync(fd); }
  return snapshot;
}
export function createPidCensus(owned, startedMs) {
  const report = { version: 'native-pid-census-v1', containerId: owned.identity, pid: owned.pid, startedMs, stopped: false, snapshots: [], gaps: [] };
  let last, binding;
  return { report, sample(now = Date.now()) {
    if (report.stopped) return;
    if (!Number.isFinite(now) || !Number.isFinite(startedMs) || now < startedMs || (last !== undefined && now < last)) { report.gaps.push('invalid-clock'); return; }
    if (now >= startedMs + 120000) { report.gaps.push('cell-deadline'); report.stopped = true; return; }
    if (last !== undefined && now - last < 1000) return;
    if (report.snapshots.length >= 120) { report.gaps.push('snapshot-cap'); report.stopped = true; return; }
    const snapshot = collectOwnedPidSnapshot({...owned,deadlineMs:Date.now() + startedMs + 120000 - now}); snapshot.atMs = now; snapshot.intervalMs = last === undefined ? null : now - last;
    if (snapshot.intervalMs > 1500) report.gaps.push('sampling-gap');
    last = now;
    const current = JSON.stringify([snapshot.containerId, snapshot.pid, snapshot.cgroup, snapshot.ownerStart]);
    binding ??= current;
    if (current !== binding) { snapshot.tasks = []; snapshot.complete = false; snapshot.gaps.push({kind:'stale-owner'}); }
    if (Buffer.byteLength(JSON.stringify({...report,snapshots:[...report.snapshots,snapshot]})) > 1048576) { report.gaps.push('byte-cap'); report.stopped = true; return; }
    report.snapshots.push(snapshot);
  }, stop(reason) {
    report.stopped = true; report.stopReason = reason;
    if (reason !== 'terminal') report.gaps.push(reason);
    while (Buffer.byteLength(JSON.stringify(report)) > 1048576 && report.snapshots.length) { report.snapshots.pop(); if (!report.gaps.includes('byte-cap')) report.gaps.push('byte-cap'); }
  } };
}
export function pidCensusVerdicts(packet) {
  const r = packet.pidCensus;
  let complete = false;
  try {
    const numeric = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
    assert.equal(r.version, 'native-pid-census-v1'); assert.match(r.containerId,/^[a-f0-9]{64}$/); assert.equal(r.containerId.length,64);
    assert(numeric(r.pid) && r.pid>1 && Number.isFinite(r.startedMs)); assert.equal(r.stopped,true); assert.equal(r.stopReason,'terminal'); assert.deepEqual(r.gaps,[]);
    assert(Array.isArray(r.snapshots) && r.snapshots.length>0 && r.snapshots.length<=120 && Buffer.byteLength(JSON.stringify(r))<=1048576);
    for(const [i,s] of r.snapshots.entries()) {
      assert.equal(s.complete,true); assert.deepEqual(s.gaps,[]); assert.equal(s.containerId,r.containerId); assert.equal(s.pid,r.pid);
      assert(['/docker/'+r.containerId,'/system.slice/docker-'+r.containerId+'.scope'].includes(s.cgroup));
      assert.equal(s.cgroup,r.snapshots[0].cgroup); assert.match(s.ownerStart,/^[0-9]+$/); assert.equal(s.ownerStart,r.snapshots[0].ownerStart);
      assert(Number.isFinite(s.atMs) && s.atMs>=r.startedMs && s.atMs<r.startedMs+120000);
      if(i===0) assert.equal(s.intervalMs,null); else assert(s.intervalMs===s.atMs-r.snapshots[i-1].atMs && s.intervalMs>=1000 && s.intervalMs<=1500);
      assert(s.members.length>0 && s.members.length<=128 && s.members.every(numeric) && s.members.includes(r.pid) && new Set(s.members).size===s.members.length);
      assert(s.threadIds.length>0 && s.threadIds.length<=128 && s.threadIds.every(numeric) && new Set(s.threadIds).size===s.threadIds.length);
      assert(s.tasks.length>0 && s.tasks.length<=128);
      assert.deepEqual(s.tasks.map(t=>t.hostTid).sort((a,b)=>a-b),[...s.threadIds].sort((a,b)=>a-b));
      for(const t of s.tasks) {
        assert(numeric(t.hostPid) && numeric(t.hostTid) && s.members.includes(t.hostPid));
        for(const [values,host] of [[t.namespacePids,t.hostPid],[t.namespaceIds,t.hostTid]]) assert(values.length>0 && values.length<=32 && values.every(numeric) && values[0]===host);
        assert(Number.isSafeInteger(t.parentPid) && t.parentPid>=0 && t.parentPid<=2147483647); assert.match(t.start,/^[0-9]+$/);
        assert.equal(t.threads,s.tasks.filter(other=>other.hostPid===t.hostPid).length);
        for(const name of [t.processComm,t.comm]) assert(typeof name==='string' && Buffer.byteLength(name)<=16);
      }
    }
    complete = packet.containerRemoved===true && packet.scratchRemoved===true && !packet.cancelled && !packet.deadlineExceeded;
  } catch (error) { if (!(error instanceof Error)) throw error; }
  return { collection: complete ? 'COMPLETE' : 'INCOMPLETE', functional: (packet.functionalStatus ?? packet.status) === 'passed' && packet.code === 0 ? 'passed' : 'failed', attribution: 'UNRESOLVED' };
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

async function host(image, revision, profileName, censusMode = false) {
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
  let receipt = { kind: 'keyspilli-guard-admission', status: 'failed', image, revision }, failure;
  if (censusMode) receipt.functionalStatus = 'failed';
  const piano = process.env.KEYSPILLI_NATIVE_PIANO_DIR; assert(piano && path.isAbsolute(piano) && fs.realpathSync(piano) === piano);
  try {
    command('gcc', ['-static', '-O2', '-std=c11', '-Wall', '-Wextra', '-Werror', path.join(root, 'deploy/player-guard.c'), '-o', binary], { env: { ...process.env, TMPDIR: scratch } });
    const args = guardLaunchArgs(name, profile);
    for (const relative of MOUNTS) {
      const p = path.join(root, relative); assert(fs.realpathSync(p) === p && !p.includes(':')); args.push('-v', p + ':' + readRoot + '/' + relative + ':ro');
    }
    args.push('-v', binary + ':/player-guard:ro', '-v', piano + ':/piano-input:ro');
    for (const pair of ['HOME=/tmp', 'TMPDIR=/tmp', 'PORT=3000', 'HOSTNAME=127.0.0.1', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright', 'KEYSPILLI_DATA_DIR=/data', 'KEYSPILLI_ORIGIN=http://127.0.0.1:3000', 'KEYSPILLI_API_TOKEN=test-token-for-e2e', 'AUTH_SECRET=owned-player-guard-only', 'KEYSPILLI_TUTORIAL_BETA=0', 'KEYSPILLI_NATIVE_PROBE_SCOPE=owned-restore']) args.push('-e', pair);
    if (diagnostic) args.push('-e', 'KEYSPILLI_GUARD_PROFILE=' + profileName, '-e', 'KEYSPILLI_CRASH_DIAGNOSTIC=native-crash-v1', '-e', 'DEBUG=pw:browser');
    args.push(image, '--init', node, readRoot + '/deploy/player-guard-run.mjs', '--inside', revision);
    const identity = command('docker', args).trim(); assert.match(identity, /^[a-f0-9]{64}$/);
    const inspected = JSON.parse(command('docker', ['inspect', name]))[0]; assert.equal(inspected.HostConfig.NetworkMode, 'none'); assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
    assert.equal(inspected.HostConfig.Memory, profile.memoryMiB * 1048576); assert.equal(inspected.HostConfig.PidsLimit, 128); assert.equal(inspected.HostConfig.PidMode, ''); assert.equal(inspected.Config.User, '1000:1000');
    assert.equal(inspected.HostConfig.NanoCpus, 1500000000); assert.deepEqual(inspected.HostConfig.CapDrop, ['ALL']); assert(inspected.HostConfig.SecurityOpt.includes('no-new-privileges'));
    assert.deepEqual(Object.keys(inspected.HostConfig.Tmpfs).sort(), Object.keys(WRITABLE).sort());
    let output;
    if (diagnostic) {
      const cellStarted = Date.now(); let census;
      const terminal = await new Promise(resolve => {
        const child = spawn('docker', ['start', '-a', name], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = ''; const resourceErrors = [];
        const observe = (release = false) => { try {
          const state = JSON.parse(command('docker', ['inspect', '--format', '{{json .State}}', name], { timeout: 2000 }));
          if (state.Running && state.Pid > 1 && !receipt.resources?.beforeTeardown) {
            if (censusMode) {
              census ??= createPidCensus({pid:state.Pid,identity}, cellStarted); receipt.pidCensus = census.report;
              if (state.Pid !== census.report.pid) census.report.gaps.push('inspected-owner-changed');
              else census.sample();
            }
            receipt.resources = JSON.parse(command('sudo', ['-n', process.execPath, fileURLToPath(import.meta.url), '--observe-owned', String(state.Pid), identity, ...(release ? ['--release'] : [])], { timeout: 2000 }));
            receipt.mountUsage = accumulateMountUsage(receipt.mountUsage, receipt.resources);
          }
        } catch (error) { if (resourceErrors.length < 4) resourceErrors.push(String(error.message).slice(0, 512)); } };
        const timer = setInterval(observe, 1000);
        const stop = () => { try { command('docker', ['stop', '--time', '0', name], { timeout: 2000 }); } catch (error) { receipt.killError = String(error.message).slice(0, 512); } finally { child.kill('SIGKILL'); } };
        const cancel = () => { receipt.cancelled = true; observe(); if (censusMode) census?.stop('cancelled'); stop(); };
        process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
        const deadline = setTimeout(() => { observe(); receipt.deadlineExceeded = true; if (censusMode) census?.stop('deadline'); stop(); }, 120000);
        for (const [key, stream, cap] of [['stdout', child.stdout, 1048576], ['stderr', child.stderr, 65536]]) stream.on('data', data => {
          const previous = key === 'stdout' ? stdout : stderr;
          const remaining = Math.max(0, cap - Buffer.byteLength(previous)); const next = previous + data.subarray(0, remaining).toString();
          if (key === 'stdout') stdout = next; else stderr = next;
          if (key === 'stdout' && stdout.includes(JSON.stringify({ kind: 'keyspilli-resource-barrier', revision }) + '\n')) observe(true);
          if (data.length > remaining) receipt[key + 'Clipped'] = true;
        });
        child.on('error', error => { receipt.launchError = String(error); });
        child.on('close', (code, signal) => { clearInterval(timer); clearTimeout(deadline); process.off('SIGINT', cancel); process.off('SIGTERM', cancel); if (censusMode) census?.stop('terminal'); resolve({ stdout, stderr, code, signal, resourceErrors }); });
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
    assert.equal(result?.status, 'passed'); assert.equal(reaper?.remainingChildren, 0); assert(reaper.reaped.some(p => p.pid === result.survivorPid && p.signal === 9));
    assert.equal(state.Pid, 0); assert.equal(state.ExitCode, 0); assert.equal(state.OOMKilled, false);
    Object.assign(receipt, { state, image, writableMiB: Object.values(profile.writable).reduce((a, b) => a + b, 0), helperSha256: hash(binary), sourceSha256: hash(path.join(root, 'deploy/player-guard.c')) });
    if (censusMode) receipt.functionalStatus = 'passed';
  } catch (error) {
    failure = error; receipt.status = 'failed'; receipt.hostError = String(error.message).slice(0, 4096); receipt.error ??= receipt.hostError;
    if (!diagnostic) { receipt.stdout ??= String(error.stdout ?? '').slice(0, 524288); receipt.stderr ??= String(error.stderr ?? '').slice(0, 65536); }
  } finally {
    if (diagnostic) { receipt.scope = 'diagnostic-only'; receipt.profile = profileName; receipt.profileLimits = profile; }
    try {
      if (command('docker', ['ps', '-aq', '--filter', 'name=^/' + name + '$']).trim()) command('docker', ['rm', '-f', name]);
      assert.equal(command('docker', ['ps', '-aq', '--filter', 'name=^/' + name + '$']).trim(), ''); receipt.containerRemoved = true;
      receipt.parentBytes = fs.readdirSync(scratch).reduce((sum, entry) => sum + fs.statSync(path.join(scratch, entry)).size, 0);
      assert(receipt.parentBytes <= 16 * 1048576, 'parent16MiB reservation exceeded');
      fs.rmSync(scratch, { recursive: true }); receipt.scratchRemoved = true;
    } catch (error) { receipt.status = 'failed'; receipt.cleanupError = String(error); failure ??= error; }
    if (diagnostic) { try { requireDiagnosticEvidence(receipt); receipt.evidenceComplete = true; } catch (error) { receipt.evidenceComplete = false; receipt.evidenceError = String(error); receipt.status = 'failed'; failure ??= error; } }
    if (censusMode) {
      while (Buffer.byteLength(JSON.stringify(receipt, null, 2)) > 1000000 && receipt.pidCensus?.snapshots.length) {
        receipt.pidCensus.snapshots.pop(); if (!receipt.pidCensus.gaps.includes('receipt-cap')) receipt.pidCensus.gaps.push('receipt-cap');
      }
      receipt.censusVerdicts = pidCensusVerdicts(receipt);
    }
    const body = JSON.stringify(receipt, null, 2) + '\n'; assert(Buffer.byteLength(body) <= 1048576, 'receipt output cap');
    fs.writeFileSync(path.join(process.env.KEYSPILLI_EVIDENCE, diagnostic ? 'player-guard-' + profileName + '.json' : 'player-guard-admission.json'), body, { flag: 'wx' });
  }
  if (failure && !diagnostic) throw new Error('Player guard qualification failed; see player-guard-admission.json');
  return receipt;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--observe-owned') { assert([5, 6].includes(process.argv.length)); if (process.argv.length === 6) assert.equal(process.argv[5], '--release'); console.log(JSON.stringify(ownedResources(process.argv[3], process.argv[4], process.argv.length === 6))); }
  else if (process.argv[2] === '--inside') await inside(process.argv[3]);
  else if (process.argv[6] === '--diagnostic' && process.argv[7] === 'native-pid-census-v1') {
    assert.equal(process.argv.length, 8); assert.deepEqual([process.argv[2], process.argv[4]], ['--image', '--revision']);
    assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/keyspilli-pid-census-20261104');
    const cell = await host(process.argv[3], process.argv[5], 'control', true);
    const verdicts = cell.censusVerdicts ?? pidCensusVerdicts(cell);
    const result = {kind:'keyspilli-native-pid-census',scope:'diagnostic-only',image:process.argv[3],revision:process.argv[5],verdicts,cells:[{artifact:'player-guard-control.json',sha256:hash(path.join(process.env.KEYSPILLI_EVIDENCE,'player-guard-control.json'))}],status:verdicts.collection === 'COMPLETE' && verdicts.functional === 'passed' && cell.evidenceComplete ? 'passed' : 'failed'};
    fs.writeFileSync(path.join(process.env.KEYSPILLI_EVIDENCE, 'native-pid-census.json'), JSON.stringify(result, null, 2)+'\n', {flag:'wx'});
    if (result.status !== 'passed') process.exitCode = 1;
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
