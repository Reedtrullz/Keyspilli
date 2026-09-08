/** Private-data development runner; never imports catalog DB or publishes songs. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, rename, statfs } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { parseMidi, writeMidi, buildMetalArrangement, buildVariants } from '@keyspilli/midi';
import { evaluateArrangement } from '../src/arrangement-evaluation.js';
import { metalArrangementTracks } from '../../../services/transcribe/src/metal-midi.js';
import { stemPipelineConfigFromEnv, transcribePitchedStems, type StemMidi, type StemMidiRole } from '../../../services/transcribe/src/stem-pipeline.js';

interface Entry { id: string; split: string; title: string; artist: string }
const hash = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function developmentCacheKey(input: { sourceSha256: string; codeSha256: string; config: unknown }): string {
  return hash(stable(input));
}
export function developmentEntries(manifest: unknown, ids?: string[]): Entry[] {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray((manifest as { entries?: unknown }).entries)) throw new Error('manifest entries required');
  const entries = (manifest as { entries: unknown[] }).entries;
  const seen = new Set<string>();
  for (const raw of entries) {
    const e = raw as Entry;
    if (!e || typeof e.id !== 'string' || !/^[\w-]+$/.test(e.id) || seen.has(e.id)) throw new Error('invalid or duplicate entry id');
    if (typeof e.split !== 'string' || typeof e.title !== 'string' || typeof e.artist !== 'string') throw new Error('invalid entry metadata');
    seen.add(e.id);
  }
  const selected = ids ? ids.map(id => { const e = (entries as Entry[]).find(e => e.id === id); if (!e) throw new Error(`unknown id: ${id}`); return e; }) : (entries as Entry[]).filter(e => e.split.startsWith('development-'));
  if (!selected.length || selected.some(e => !e.split.startsWith('development-'))) throw new Error('only development entries may run');
  return selected;
}
const roles: StemMidiRole[] = ['vocals', 'bass', 'guitar', 'other', 'drums'];
async function cachedStems(root: string): Promise<StemMidi[]> {
  const report = JSON.parse(await readFile(join(root, 'report.json'), 'utf8')) as { stems: { role: StemMidiRole; sourceStem: StemMidiRole; midiFile: string }[] };
  if (!Array.isArray(report.stems) || !report.stems.length) throw new Error('missing stem provenance');
  const seen = new Set<string>();
  return Promise.all(report.stems.map(async s => {
    if (!roles.includes(s.role) || seen.has(s.role) || !(s.role === s.sourceStem || s.role === 'guitar' && s.sourceStem === 'other') || s.midiFile !== `${s.role}.mid`) throw new Error('invalid stem provenance');
    seen.add(s.role);
    return { role: s.role, noteSource: s.sourceStem, midi: new Uint8Array(await readFile(join(root, s.midiFile))) };
  }));
}
async function codeIdentity(repo: string): Promise<string> {
  const paths = ['packages/midi/src', 'packages/catalog/src', 'services/transcribe/src'];
  const files = [fileURLToPath(import.meta.url)];
  for (const dir of paths) for (const name of await readdir(join(repo, dir))) if (/\.(ts|py)$/.test(name)) files.push(join(repo, dir, name));
  return hash((await Promise.all(files.sort().map(async p => `${p.slice(repo.length)}:${hash(await readFile(p))}`))).join('\n'));
}
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args: argv, options: {
    manifest: { type: 'string' }, hashes: { type: 'string' }, recordings: { type: 'string' }, output: { type: 'string' },
    ids: { type: 'string' }, 'cached-stems': { type: 'string' }, python: { type: 'string' }, 'basic-pitch': { type: 'string' }, 'model-manifest': { type: 'string' },
  } });
  for (const key of ['manifest', 'hashes', 'recordings', 'output'] as const) if (!values[key]) throw new Error(`--${key} required`);
  const entries = developmentEntries(JSON.parse(await readFile(resolve(values.manifest!), 'utf8')), values.ids?.split(','));
  const frozen = JSON.parse(await readFile(resolve(values.hashes!), 'utf8')) as { entries: { id: string; sha256: string }[] };
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const codeSha256 = await codeIdentity(repo);
  const config = { ...stemPipelineConfigFromEnv(process.env, { root: repo, python: values.python ?? 'python3', basicPitch: values['basic-pitch'] ?? 'basic-pitch' }), separatorTimeoutMs: process.env.KEYSPILLI_DEMUCS_DEVICE === 'mps' ? 900000 : 1200000, basicPitchTimeoutMs: process.env.KEYSPILLI_DEMUCS_DEVICE === 'mps' ? 300000 : 600000, minFreeBytes: 30 * 1024 ** 3 };
  if (!values['cached-stems'] && !values['model-manifest']) throw new Error('--model-manifest required for fresh inference');
  const modelIdentity = values['model-manifest'] ? JSON.parse(await readFile(resolve(values['model-manifest']), 'utf8')) : { mode: 'cached-stem-replay-no-inference' };
  await mkdir(resolve(values.output!), { recursive: true });
  const exec = promisify(execFile);
  for (const entry of entries) {
    const source = join(resolve(values.recordings!), entry.id, 'audio.mp3');
    const sourceSha256 = hash(await readFile(source));
    if (frozen.entries.filter(e => e.id === entry.id && e.sha256 === sourceSha256).length !== 1) throw new Error(`source hash mismatch: ${entry.id}`);
    const replay = values['cached-stems'] ? await cachedStems(join(resolve(values['cached-stems']), entry.id, 'stem-midi')) : undefined;
    const cacheKey = developmentCacheKey({ sourceSha256, codeSha256, config: { config, modelIdentity, stems: replay?.map(s => ({ role: s.role, source: s.noteSource, hash: hash(s.midi) })) } });
    const job = join(resolve(values.output!), entry.id, cacheKey);
    await mkdir(job, { recursive: true });
    try {
      const prior = JSON.parse(await readFile(join(job, 'complete.json'), 'utf8')) as { cacheKey: string; artifacts: Record<string,string> };
      if (prior.cacheKey === cacheKey && Object.keys(prior.artifacts).length === 14 && (await Promise.all(Object.entries(prior.artifacts).map(async ([name, sha]) => /^[\w-]+\.(mid|json)$/.test(name) && hash(await readFile(join(job, name))) === sha))).every(Boolean)) { console.log(`cached ${entry.id} ${cacheKey}`); continue; }
    } catch { /* Missing/corrupt completion is recomputed, never counted as success. */ }
    const started = Date.now(); const stages: { command: string; seconds: number; status: string }[] = [];
    const run = async (command: string, args: readonly string[], options: { timeoutMs: number }) => {
      const disk = await statfs(job); if (disk.bavail * disk.bsize < config.minFreeBytes) throw new Error('disk below30GiB');
      const start = Date.now();
      try { const r = await exec(command, [...args], { timeout: options.timeoutMs, maxBuffer: 32 * 1024 ** 2 }); stages.push({ command: command.split('/').at(-1)!, seconds: (Date.now() - start) / 1000, status: 'ok' }); return r; }
      catch (e) { stages.push({ command: command.split('/').at(-1)!, seconds: (Date.now() - start) / 1000, status: 'failed' }); throw e; }
    };
    try {
      const tempo = replay ? parseMidi(replay[0]!.midi).tempoBpm : Number((await run(config.python, [join(repo, 'services/transcribe/src/tempo.py'), source], { timeoutMs: 60000 })).stdout.trim());
      const stems = replay ?? (await transcribePitchedStems(source, job, config, { tempo }, { run })).stems;
      const a = buildMetalArrangement({ stems: stems.map(s => ({ role: s.role, sourceStem: s.noteSource, midi: parseMidi(s.midi) })), title: entry.title });
      const bytes = writeMidi(a.parsed.notes, { ...a.parsed, tracks: metalArrangementTracks(a.parsed.notes) });
      const parsed = parseMidi(bytes);
      const variants = buildVariants(parsed, entry, { arrangementProfile: 'metal', audioDerived: true, maxDurBeats: null, chords: a.chords });
      const report = evaluateArrangement({ fixture: { id: entry.id }, candidate: { selector: 'candidate.mid', bytes, parsed }, variants, mode: 'structural' });
      const artifacts: Record<string,string> = {};
      const save = async (name: string, data: Uint8Array | string) => { await writeFile(join(job,name), data); artifacts[name] = hash(data); };
      await save('candidate.mid', bytes);
      await save('report.json', JSON.stringify(report,null,2));
      for (const v of variants) {
        await save(`${v.level}.mid`, writeMidi(v.notes, { tempoBpm: v.tempoBpm, timeSig: v.timeSig, tracks: metalArrangementTracks(v.notes) }));
        await save(`${v.level}.json`, JSON.stringify(v));
      }
      await writeFile(join(job, 'complete.tmp'), JSON.stringify({ cacheKey, sourceSha256, codeSha256, modelIdentity, config, artifacts, stages, seconds: (Date.now()-started)/1000, structural: report.gate, sourceAccuracy: 'not-evaluated', musicalAcceptance: 'not-evaluated' },null,2));
      await rename(join(job,'complete.tmp'),join(job,'complete.json'));
      console.log(`completed ${entry.id} structural=${report.gate.status} ${cacheKey}`);
    } catch (e) { await writeFile(join(job,'failure.json'), JSON.stringify({ cacheKey, stages, error: String(e) },null,2)); throw e; }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(String(error)); process.exitCode = 1; });
