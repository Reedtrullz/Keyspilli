import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve('output/music-review/score-review-completion-20261008-native-01');
mkdirSync(root, { recursive: false, mode: 0o700 });
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const anti = '/Users/reidar/Projectos/.worktrees/anti-music-review-afk';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const oldRoot = resolve('output/music-review/r2-next-20261007');
const old = JSON.parse(readFileSync(join(oldRoot, 'TASK5_LIVE_SMOKE.json'), 'utf8'));
for (const name of ['report', 'state', 'response', 'prompt']) {
  if (hash(join(oldRoot, old.evidence[name])) !== old.evidence[`${name}Sha256`]) throw new Error(`Frozen ${name} changed`);
}
const dirty = git(process.cwd(), 'diff', '--name-only').split('\n').filter(Boolean).map(path => ({ path, sha256: hash(path) }));
const baseline = {
  schemaVersion: 1, kind: 'keyspilli-score-review-baseline', createdAt: new Date().toISOString(),
  heads: { keyspilli: git(process.cwd(), 'rev-parse', 'HEAD'), anti: git(anti, 'rev-parse', 'HEAD') },
  dirty, node: { executable: process.execPath, version: process.version },
  anti: { python: `${anti}/.venv/bin/python`, importRoot: `${anti}/codex_antigravity_auth`, helperSha256: hash(`${anti}/codex_antigravity_auth/skills/anti/scripts/anti.py`) },
  frozenEvidence: { path: oldRoot, status: old.status, historicalProviderAttempts: old.attempt.providerAttempts, hashesVerified: true },
  budget: { newLiveJobs: 1, backendAttempts: 1, retries: 0, fallback: false, seconds: 90 },
  productionAdmission: false, installedAdoption: false,
};
writeFileSync(join(root, 'BASELINE.json'), JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ evidenceRoot: root, hashesVerified: true, dirtyFiles: dirty.length }));
