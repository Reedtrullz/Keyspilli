import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { developmentEntries, developmentCacheKey, codeIdentity } from '../scripts/run-metal-development.js';

describe('development runner boundary', () => {
  const entries = [
    { id: 'dev', split: 'development-riff', title: 'Development', artist: 'Artist' },
    { id: 'sealed', split: 'supported-holdout', title: 'Sealed', artist: 'Artist' },
  ];
  it('never admits requested holdouts, including mixed selections', () => {
    expect(developmentEntries({ entries }).map(e => e.id)).toEqual(['dev']);
    expect(() => developmentEntries({ entries }, ['dev', 'sealed'])).toThrow(/development/);
    expect(() => developmentEntries({ entries }, ['missing'])).toThrow(/unknown/);
    expect(() => developmentEntries({ entries: [{ ...entries[0], id: '../escape' }] })).toThrow(/id/);
  });

  it('CLI rejects a holdout before opening recordings or starting any process', () => {
    const root = mkdtempSync(join(tmpdir(), 'keyspilli-development-'));
    try {
      const manifest = join(root, 'manifest.json');
      writeFileSync(manifest, JSON.stringify({ entries }));
      let stderr = '';
      try {
        execFileSync(process.execPath, ['--import', 'tsx', resolve('scripts/run-metal-development.ts'), '--manifest', manifest, '--hashes', join(root, 'absent.json'), '--recordings', root, '--output', root, '--ids', 'sealed'], { encoding: 'utf8', stdio: 'pipe' });
      } catch (error) { stderr = String((error as { stderr: unknown }).stderr); }
      expect(stderr).toContain('only development entries may run');
      expect(stderr).not.toContain('ENOENT');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('invalidates cached inference for source, code, or configuration changes', () => {
    const input = { sourceSha256: 'a'.repeat(64), codeSha256: 'b'.repeat(64), config: { model: 'six', tempo: 120 } };
    const original = developmentCacheKey(input);
    expect(developmentCacheKey({ ...input, config: { tempo: 120, model: 'six' } })).toBe(original);
    expect(developmentCacheKey({ ...input, sourceSha256: 'c'.repeat(64) })).not.toBe(original);
    expect(developmentCacheKey({ ...input, codeSha256: 'd'.repeat(64) })).not.toBe(original);
    expect(developmentCacheKey({ ...input, config: { model: 'four', tempo: 120 } })).not.toBe(original);
  });

  it('invalidates a development cache when an extracted implementation changes without changing its facade', async () => {
    const root = mkdtempSync(join(tmpdir(), 'keyspilli-development-'));
    try {
      for (const directory of ['packages/midi/src/metal-arrange', 'packages/catalog/src', 'services/transcribe/src']) {
        mkdirSync(join(root, directory), { recursive: true });
      }
      const facade = join(root, 'packages/midi/src/metal-arrange.ts');
      const nested = join(root, 'packages/midi/src/metal-arrange/shared.ts');
      const facadeSource = 'export { select } from "./metal-arrange/shared.js";';
      writeFileSync(facade, facadeSource);
      writeFileSync(nested, 'export const select = (notes: number[]) => notes.slice(0, 1);');
      const before = await codeIdentity(root);
      const input = { sourceSha256: 'a'.repeat(64), config: { mode: 'cached-stem-replay-no-inference' } };
      const priorKey = developmentCacheKey({ ...input, codeSha256: before });
      writeFileSync(nested, 'export const select = (notes: number[]) => notes.slice(0, 2);');
      expect(readFileSync(facade, 'utf8')).toBe(facadeSource);
      const after = await codeIdentity(root);
      expect(after).not.toBe(before);
      expect(developmentCacheKey({ ...input, codeSha256: after })).not.toBe(priorKey);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
