import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { validate, WRITABLE, resolveEsbuild } from '../player-guard-run.mjs';
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
