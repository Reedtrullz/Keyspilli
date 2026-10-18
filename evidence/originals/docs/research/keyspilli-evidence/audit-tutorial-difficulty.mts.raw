/** Read-only: Node 22 + node node_modules/tsx/dist/cli.mjs, from repo root. No media processing. */
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { measurePlayability, assessPlayability, type DifficultyLevel, type Note } from '../../../packages/midi/src/index.ts';
const root = resolve(process.argv[2] ?? 'output/tutorial-recovery/isolated-ingest-v10-checked/artifacts');
const rows = [];
function summarize(notes: Note[], tempo: number, durationBeats?: number) {
  const metrics = measurePlayability(notes, tempo, durationBeats);
  const hand = (m: typeof metrics.global) => ({
    attacksPerSecond: m.attacksPerSecond, medianIoiSeconds: m.medianIoiSeconds,
    maxShortWindowAttacksPerSecond: m.maxShortWindowAttacksPerSecond, worstAttackWindow: m.worstAttackWindow,
    maxSimultaneous: m.maxSimultaneous, maxSounding: m.maxSounding,
    maxChordSpanSemitones: m.maxChordSpanSemitones, maxSoundingSpanSemitones: m.maxSoundingSpanSemitones,
    worstTopVoiceLeap: m.worstTopVoiceLeap,
  });
  return { noteCount: metrics.noteCount, durationSeconds: metrics.durationSeconds,
    global: hand(metrics.global), hands: { R: hand(metrics.hands.R), L: hand(metrics.hands.L) } };
}
for (const name of ['queen', 'metallica-old', 'in-my-mind', 'nirvana', 'acdc-fixed', 'metallica']) {
  for (const [code, level] of Object.entries({ b: 'beginner', e: 'easy', m: 'medium', a: 'advanced' })) {
    const path = resolve(root, `proof-${name}/${code}/notes.json`);
    const bytes = await readFile(path);
    const variant = JSON.parse(bytes.toString()) as { notes: Note[]; tempoBpm: number };
    const metrics = measurePlayability(variant.notes, variant.tempoBpm);
    const assessment = assessPlayability(metrics, level as DifficultyLevel);
    const target = name === 'queen' && code === 'b' ? 168 : name.startsWith('metallica') && code === 'e' ? 60 : null;
    const nearby = target === null ? null : {
      startSeconds: target - 2, endSeconds: target + 2,
      metrics: summarize(variant.notes.filter(n => n.start * 60 / variant.tempoBpm >= target - 2 && n.start * 60 / variant.tempoBpm < target + 2)
        .map(n => ({ ...n, start: n.start - (target - 2) * variant.tempoBpm / 60 })), variant.tempoBpm, 4 * variant.tempoBpm / 60),
    };
    rows.push({ source: relative(process.cwd(), path), sha256: createHash('sha256').update(bytes).digest('hex'), name, level, assessment, metrics: summarize(variant.notes, variant.tempoBpm), nearby });
  }
}
console.log(JSON.stringify({
  scope: 'Read-only persisted source-profile audit. Existing global limits are catalog-calibrated structural gates, not a learner difficulty certificate. Window, per-hand spans and leaps are report-only; no thresholds or notes changed.',
  window: 'Half-open 0.5 seconds; earliest maximum. Highest-voice leap is adjacent attack-top movement, not fingering. Nearby passage timestamps are relative to its stated start and exclude prior held notes.',
  rows,
}, null, 2));
