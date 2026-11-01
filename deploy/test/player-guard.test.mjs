import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { validate, WRITABLE, resolveEsbuild, checkSource, MOUNTS, observeHealth, requestHealth } from '../player-guard-run.mjs';
import { perfViewport } from '../../apps/web/e2e/perf-viewport.ts';
const { privatePath, connectionAllowed } = createRequire(import.meta.url)('../player-node-guard.cjs');

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
