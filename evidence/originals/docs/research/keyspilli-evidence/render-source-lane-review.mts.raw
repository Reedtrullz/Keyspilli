/** Four bounded local comparisons. No original note/audio artifact is written. */
import { readFile, writeFile, mkdir, unlink, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { writeMidi, measurePlayability, type Note } from '../../../packages/midi/src/index.ts';
import { renderMidiToWav, slicePcm16WavFile } from '../../../packages/catalog/src/midi-renderer.ts';
const root = resolve('output/tutorial-recovery');
const output = join(root, 'source-lane-listening-v1');
await mkdir(output, { recursive: true });
const specs = [
  { id: 'metallica-new', name: 'New Metallica · Easy', source: 'metallica', level: 'e', start: 229, end: 233, finding: 'Lane separation reduces the RH jump from 31 semitones / 375 ms to 11 / 1.5625 s. Listening acceptance pending.' },
  { id: 'metallica-accepted', name: 'Accepted old Metallica · Easy', source: 'metallica-old', level: 'e', start: 58, end: 62, finding: 'Candidate changes the accepted passage: RH peak rises 2→4 attacks/sec. Keep the accepted version unless reviewed.' },
  { id: 'queen', name: 'Queen · Beginner', source: 'queen', level: 'b', start: 166, end: 170, finding: 'The flagged passage has unchanged structural metrics. No improvement claim.' },
  { id: 'acdc', name: 'AC/DC · Easy', source: 'acdc-fixed', level: 'e', start: 41, end: 45, finding: 'Candidate includes the worsened 26-semitone RH leap at 42.1875 s. Do not activate automatically.' },
];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const rows = [];
for (const spec of specs) {
  const comparisons = [];
  for (const side of ['before', 'candidate']) {
    const path = side === 'before'
      ? join(root, `isolated-ingest-v10-checked/artifacts/proof-${spec.source}/${spec.level}/notes.json`)
      : join(root, `source-lane-candidates-v1/${spec.source}/${spec.level}/notes.json`);
    const bytes = await readFile(path);
    const variant = JSON.parse(bytes.toString()) as { notes: Note[]; tempoBpm: number };
    const scale = 60 / variant.tempoBpm;
    // Include the real starts of notes already held during the two-second lead-in.
    const relevant = variant.notes.filter(n => (n.start + n.dur) * scale > spec.start - 2 && n.start * scale < spec.end);
    const renderStart = Math.min(spec.start - 2, ...relevant.map(n => n.start * scale));
    assert.ok(renderStart >= spec.start - 10, 'Unexpected >10s carry-in; stop instead of approximating held-note attacks');
    const excerpt = relevant.map(n => ({ ...n, start: n.start - renderStart / scale,
      dur: Math.min(n.dur, spec.end / scale - n.start) }));
    const stem = join(output, `${spec.id}-${side}`);
    await writeFile(`${stem}.mid`, writeMidi(excerpt, { tempoBpm: variant.tempoBpm }));
    try {
      const rendered = await renderMidiToWav({ midiPath: `${stem}.mid`, outputPath: `${stem}-render.wav` }, {
        soundfontPath: resolve('output/metal-development/soundfont/timgm6mb-soundfont_1.3/TimGM6mb.sf2'), sampleRate: 22050, targetPeak: .8, timeoutMs: 60000,
      });
      assert.ok(rendered.wav.rms > 0, 'Audio must be non-silent');
      const audio = await slicePcm16WavFile(`${stem}-render.wav`, `${stem}.wav`, spec.start - renderStart, spec.end - renderStart);
      assert.ok(Math.abs(audio.durationSeconds - (spec.end - spec.start)) <= 1 / 22050 + 1e-6);
      const attacks = variant.notes.filter(n => n.start * scale >= spec.start && n.start * scale < spec.end);
      const metrics = measurePlayability(attacks, variant.tempoBpm);
      comparisons.push({ side, input: path, inputSha256: hash(bytes), file: `${spec.id}-${side}.wav`, audio,
        renderer: rendered.renderer, soundfontSha256: rendered.soundfont.sha256, renderStartSeconds: renderStart,
        metrics: { peakAttacksPerSecond: metrics.global.maxShortWindowAttacksPerSecond, R: metrics.hands.R.worstTopVoiceLeap, L: metrics.hands.L.worstTopVoiceLeap } });
      assert.equal(hash(await readFile(path)), hash(bytes));
    } finally {
      await unlink(`${stem}-render.wav`).catch(() => {});
      await unlink(`${stem}.mid`).catch(() => {});
    }
  }
  rows.push({ ...spec, comparisons });
}
const receipt = { scope: 'Local synthesized before/candidate audio. No auto activation. No accepted artifact changed. Same piano SoundFont; per-render peak normalization 0.8, 22050Hz, 4 s PCM slices within one sample. Original carry-in attacks retained; no tempo changes.', rows };
await writeFile(join(output, 'metrics.json'), JSON.stringify(receipt, null, 2));
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const cards = rows.map(row => `<section><h2>${escape(row.name)} <small>${row.start}–${row.end}s</small></h2><p>${escape(row.finding)}</p><div class="pair">${row.comparisons.map(c => `<div><h3>${c.side === 'before' ? 'Before · persisted v10' : 'Candidate · opt-in lanes'}</h3><audio controls preload="metadata" src="${escape(c.file)}"></audio><p><a href="${escape(c.file)}" download>Download 4 s WAV</a></p><p>Peak attacks: ${c.metrics.peakAttacksPerSecond}/sec<br>RH largest movement: ${c.metrics.R ? `${c.metrics.R.semitones} semitones / ${c.metrics.R.gapSeconds}s` : 'none'}</p></div>`).join('')}</div></section>`).join('');
await writeFile(join(output, 'review.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Source lane listening review</title><style>body{max-width:1000px;margin:32px auto;padding:0 20px;background:#101521;color:#edf0f7;font:17px/1.5 system-ui}a{color:#9ec9ff}section{padding:22px 0;border-top:1px solid #45516a}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}audio{width:100%}h2{margin-bottom:8px}small{font-size:16px;color:#abb7ca}.notice{padding:18px;background:#2f2432;border-left:4px solid #e4a173}@media(max-width:650px){.pair{grid-template-columns:1fr}}</style><h1>Source lane listening review</h1><p class="notice"><strong>Review only — automatic activation is off.</strong> Accepted versions remain untouched. These clips compare one proposed hand-assignment policy; easier playability and musical identity still need listening review.</p><p>Each clip covers its specified 4-second passage (within one sample) at the original tempo, using the same local piano SoundFont. Carries from earlier notes retain their original attacks. Each bounded render is peak-normalized to 0.8. <a href="metrics.json">Metrics and SHA256 receipts</a>.</p>${cards}<script>document.addEventListener('play',e=>{if(e.target.tagName==='AUDIO')document.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause()})},true)</script></html>`);
const files = await Promise.all((await readdir(output)).map(name => stat(join(output, name))));
const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
assert.ok(totalBytes < 20 * 1024 * 1024, 'Review output must stay below 20 MiB');
console.log(JSON.stringify({ output, totalBytes, clips: rows.length * 2, receipts: 'metrics.json' }));
