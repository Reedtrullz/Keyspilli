/** Bounded candidate-only generation. Accepted v10 artifacts are read and hashed, never written. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseMidi, buildVariants, inferSourceHandLanes, measurePlayability, assessPlayability, validateVariants, writeMidi, type Note } from '../../../packages/midi/src/index.ts';
const root = resolve('output/tutorial-recovery');
const out = join(root, 'source-lane-candidates-v1');
const sources = [['queen', 'bohemian-keys.mid'], ['metallica-old', 'nothing-else-matters.mid'], ['in-my-mind', 'in-my-mind.mid']];
for (const name of ['nirvana', 'acdc-fixed', 'metallica']) {
  const receipt = JSON.parse(await readFile(join(root, `link-proof-${name}/receipt.json`), 'utf8'));
  sources.push([name, receipt.midiPath]);
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const events = (notes: Note[]) => notes.map(({ sourceLane, ...note }) => note);
const summarize = (notes: Note[], tempoBpm: number) => {
  const m = measurePlayability(notes, tempoBpm);
  const hand = (h: typeof m.global) => ({ peakAttacksPerSecond: h.maxShortWindowAttacksPerSecond, worstAttackWindow: h.worstAttackWindow,
    maxSimultaneous: h.maxSimultaneous, maxSounding: h.maxSounding, maxChordSpanSemitones: h.maxChordSpanSemitones,
    maxSoundingSpanSemitones: h.maxSoundingSpanSemitones, worstTopVoiceLeap: h.worstTopVoiceLeap });
  return { global: hand(m.global), hands: { R: hand(m.hands.R), L: hand(m.hands.L) } };
};
const rows = [];
for (const [name, file] of sources) {
  const rawPath = resolve(root, file!);
  const raw = await readFile(rawPath);
  const parsed = parseMidi(raw);
  const inference = inferSourceHandLanes(parsed.notes);
  const options = { arrangementProfile: 'source' as const, maxDurBeats: null };
  const baseline = buildVariants(parsed, { title: name!, artist: 'Source lane audit' }, options);
  const candidate = buildVariants(parsed, { title: name!, artist: 'Source lane audit' }, { ...options, inferSourceHands: true });
  assert.deepEqual(validateVariants(baseline, { maxDurBeats: null }), []);
  assert.deepEqual(validateVariants(candidate, { maxDurBeats: null }), []);
  for (const [code, level] of Object.entries({ b: 'beginner', e: 'easy', m: 'medium', a: 'advanced' })) {
    const acceptedPath = join(root, `isolated-ingest-v10-checked/artifacts/proof-${name}/${code}/notes.json`);
    const acceptedBytes = await readFile(acceptedPath);
    const accepted = JSON.parse(acceptedBytes.toString());
    const before = baseline.find(v => v.level === level)!;
    const after = candidate.find(v => v.level === level)!;
    assert.deepEqual(events(before.notes), events(accepted.notes), `${name}/${level}: default events must remain accepted v10 events`);
    const target = name === 'queen' && level === 'beginner' ? 168 : name!.startsWith('metallica') && level === 'easy' ? 60 : null;
    const nearby = (notes: Note[]) => summarize(notes.filter(n => n.start * 60 / after.tempoBpm >= target! - 2 && n.start * 60 / after.tempoBpm < target! + 2), after.tempoBpm);
    const directory = join(out, name!, code);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'notes.json'), JSON.stringify(after));
    const candidateMidi = writeMidi(after.notes, { tempoBpm: after.tempoBpm, tracks: ['R', 'L'].map(hand => ({ name: hand === 'R' ? 'RH' : 'LH', notes: after.notes.filter(note => note.hand === hand) })) });
    const midiEvent = ({ midi, start, dur, vel, hand }: Note) => ({ midi, start, dur, vel, hand });
    assert.deepEqual(parseMidi(candidateMidi).notes.map(midiEvent), after.notes.map(midiEvent), 'Candidate MIDI must retain note events and inferred hands');
    await writeFile(join(directory, 'variant.mid'), candidateMidi);
    assert.equal(hash(await readFile(acceptedPath)), hash(acceptedBytes));
    rows.push({ name, level, inference: { applied: inference.applied, reason: inference.reason }, sourceSha256: hash(raw), acceptedSha256: hash(acceptedBytes),
      acceptedEventsUnchanged: true, candidatePath: directory, beforeCount: before.notes.length, candidateCount: after.notes.length,
      assessment: assessPlayability(measurePlayability(after.notes, after.tempoBpm), after.level),
      before: summarize(before.notes, before.tempoBpm), candidate: summarize(after.notes, after.tempoBpm),
      ...(name === 'metallica' && level === 'easy' ? { latePassage: { startSeconds: 229, endSeconds: 233, before: summarize(before.notes.filter(n => n.start * 60 / before.tempoBpm >= 229 && n.start * 60 / before.tempoBpm < 233), before.tempoBpm), candidate: summarize(after.notes.filter(n => n.start * 60 / after.tempoBpm >= 229 && n.start * 60 / after.tempoBpm < 233), after.tempoBpm) } } : {}),
      ...(target === null ? {} : { flaggedPassage: { startSeconds: target - 2, endSeconds: target + 2, before: nearby(before.notes), candidate: nearby(after.notes) } }),
    });
  }
  assert.equal(hash(await readFile(rawPath)), hash(raw));
}
console.log(JSON.stringify({ scope: 'Opt-in generic tutorial source-lane candidates; accepted raw MIDI and 24 persisted note files unchanged. Structural checks only; hand inference and musical acceptance remain unverified.', rows }, null, 2));
