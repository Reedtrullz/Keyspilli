/** Isolated hypothesis: this source's blue lane is LH, green lane RH. Never writes accepted notes. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseMidi, buildVariants, measurePlayability, validateVariants, splitHands } from '../../../packages/midi/src/index.ts';
const root = 'output/tutorial-recovery/link-proof-metallica/DzAGQbvDpns';
const midiBytes = await readFile(`${root}/extracted.mid`);
const jsonBytes = await readFile(`${root}/extracted.json`);
const parsed = parseMidi(midiBytes);
const extracted = JSON.parse(jsonBytes.toString()) as { notes: { midi: number; startSec: number; durationSec: number; color: string }[] };
const explicit = parsed.notes.map(note => {
  const candidates = extracted.notes.filter(raw => raw.midi === note.midi && Math.abs(raw.startSec - note.start * 60 / parsed.tempoBpm) < .002);
  assert.equal(candidates.length, 1, 'Each parsed attack must match one raw color event');
  assert.ok(['blue', 'green'].includes(candidates[0]!.color));
  return { ...note, hand: candidates[0]!.color === 'blue' ? 'L' as const : 'R' as const };
});
assert.deepEqual(explicit.map(({ hand, ...note }) => note), parsed.notes, 'Only hand labels may change at input');
const original = JSON.stringify(parsed);
const options = { arrangementProfile: 'source' as const, maxDurBeats: null };
const baseline = buildVariants(parsed, { title: 'Metallica hand-lane probe' }, options);
const candidate = buildVariants({ ...parsed, notes: explicit }, { title: 'Metallica hand-lane probe' }, options);
assert.equal(JSON.stringify(parsed), original, 'Probe must not mutate parsed input');
assert.deepEqual(validateVariants(baseline, { maxDurBeats: null }), []);
assert.deepEqual(validateVariants(candidate, { maxDurBeats: null }), []);
const split = splitHands(parsed.notes);
const rawPassage = extracted.notes.filter(n => n.startSec >= 229 && n.startSec < 233);
const rows = [];
for (const level of ['beginner', 'easy', 'medium', 'advanced']) {
  const before = baseline.find(v => v.level === level)!;
  const after = candidate.find(v => v.level === level)!;
  const passage = (v: typeof before) => v.notes.filter(n => n.start * 60 / v.tempoBpm >= 229 && n.start * 60 / v.tempoBpm < 233);
  const b = measurePlayability(passage(before), before.tempoBpm);
  const a = measurePlayability(passage(after), after.tempoBpm);
  rows.push({ level, beforeNotes: before.notes.length, afterNotes: after.notes.length,
    before: { notes: passage(before), hands: b.hands }, after: { notes: passage(after), hands: a.hands },
    wholeSongAfter: measurePlayability(after.notes, after.tempoBpm).hands });
}
const easy = rows.find(r => r.level === 'easy')!;
assert.equal(easy.before.hands.R.worstTopVoiceLeap?.semitones, 31);
assert.ok((easy.after.hands.R.worstTopVoiceLeap?.semitones ?? Infinity) < 31);
console.log(JSON.stringify({
  scope: 'Read-only hand-lane hypothesis, not approved note replacement. Color is not globally authoritative hand metadata.',
  inputs: { midiSha256: createHash('sha256').update(midiBytes).digest('hex'), jsonSha256: createHash('sha256').update(jsonBytes).digest('hex') },
  baselineSplit: { lhMaxMidi: Math.max(...split.lh.map(n => n.midi)), rhMinMidi: Math.min(...split.rh.map(n => n.midi)) },
  rawPassage, rows, validation: 'Both complete variant ladders validate; exact raw input notes preserved except proposed explicit hand labels.',
}, null, 2));
