#!/usr/bin/env node
/** Build an offline, rights-cleared demo and blind control pack for music-listening review. */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { writeMidi, type Note } from "@keyspilli/midi";
import { inspectPcm16Wav, stableJson, validateReviewManifest, type ReviewManifest } from "../src/lib/audio-review.js";

const execFile = promisify(execFileCallback);
const ROOT = resolve(import.meta.dirname, "../../..");
const DEFAULT_OUTPUT = join(ROOT, "output/song-prep/audio-review-demo-20261003");
const DEFAULT_SOUNDFONT = "/Users/reidar/.local/share/keyspilli/soundfonts/SalamanderGrandPiano-SF2-V3+20200602/SalamanderGrandPiano-V3+20200602.sf2";
const FLUIDSYNTH = "/opt/homebrew/bin/fluidsynth";
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const TEMPO = 120;
const RATE = 44_100;
const DEMO_SECONDS = 21;
const CONTROL_SECONDS = 6;

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const digest = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const hashFile = async (path: string) => digest(await readFile(path));

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, json(value), { mode: 0o600 });
}

async function saveMidi(path: string, tracks: { name: string; notes: Note[]; channel: number; program: number }[], title: string) {
  const bytes = writeMidi(tracks.flatMap(track => track.notes), {
    tempoBpm: TEMPO,
    timeSig: [4, 4],
    title,
    tracks,
  });
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { mode: 0o600 });
  return bytes;
}

async function renderMidi(midiPath: string, outPath: string, seconds: number, soundfont: string) {
  const rawPath = `${outPath}.render.wav`;
  await mkdir(dirname(outPath), { recursive: true, mode: 0o700 });
  await execFile(FLUIDSYNTH, [
    "-ni", "-q", "-r", String(RATE), "-L", "1", "-g", "0.7", "-R", "0", "-C", "0",
    "-T", "wav", "-O", "s16", "-F", rawPath, soundfont, midiPath,
  ], { timeout: 60_000, maxBuffer: 256_000 });
  await execFile(FFMPEG, ["-v", "error", "-y", "-i", rawPath, "-af", `apad=pad_dur=${seconds}`, "-t", String(seconds), "-ac", "1", "-ar", String(RATE), "-sample_fmt", "s16", "-c:a", "pcm_s16le", outPath], { timeout: 30_000, maxBuffer: 128_000 });
  await rm(rawPath, { force: true });
  const wav = await readFile(outPath);
  const inspected = inspectPcm16Wav(wav);
  if (inspected.durationSeconds < seconds - 0.01 || inspected.durationSeconds > seconds + 0.01) throw new Error(`Unexpected rendered duration ${inspected.durationSeconds}s for ${outPath}`);
  if (inspected.bytes > 2 * 1024 * 1024) throw new Error(`Rendered clip exceeds 2 MiB: ${outPath}`);
  return { ...inspected, sha256: digest(wav) };
}

async function renderSilence(outPath: string, seconds: number) {
  await mkdir(dirname(outPath), { recursive: true, mode: 0o700 });
  await execFile(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", `anullsrc=r=${RATE}:cl=mono`, "-t", String(seconds), "-c:a", "pcm_s16le", outPath], { timeout: 30_000, maxBuffer: 128_000 });
  const wav = await readFile(outPath);
  return { ...inspectPcm16Wav(wav), sha256: digest(wav) };
}

function sequence(pitches: number[], spacing = 0.75, duration = 0.58): Note[] {
  return pitches.map((midi, index) => ({ midi, start: index * spacing, dur: duration, vel: 84 }));
}

function chord(pitches: number[], start = 0, duration = 1.7, velocity = 70): Note[] {
  return pitches.map(midi => ({ midi, start, dur: duration, vel: velocity }));
}

async function buildDemo(output: string, soundfont: string) {
  const dir = join(output, "demo");
  const sourceMidi = join(dir, "source.mid");
  const originalMidi = join(dir, "resolved-original.mid");
  const chordsMidi = join(dir, "resolved-chords.mid");
  const accompaniment: Note[] = [];
  const melody: Note[] = [];
  const chordPitches = [48, 52, 55];
  for (let bar = 0; bar < 10; bar++) {
    const beat = bar * 4;
    const notes = bar === 8 || bar === 9 ? [48, 52, 55] : chordPitches;
    accompaniment.push(...chord(notes, beat, bar === 9 ? 3.2 : 2.8, 64));
    if (bar % 2 === 0) accompaniment.push(...chord([notes[0]! - 12], beat, 0.8, 58));
    const contour = [60, 64, 67, 69, 67, 64, 62, 60];
    melody.push(...sequence(contour.slice(bar % 4, bar % 4 + 4), 0.75, 0.55).map((note, index) => ({ ...note, start: beat + index * 0.75, vel: 78 })));
  }
  // Let the final authored cadence sound before the fixed 21-second excerpt ends.
  melody.push({ midi: 60, start: 39, dur: 2, vel: 84 });
  accompaniment.push(...chord([48, 52, 55, 60], 38, 3, 72));
  const sourceBytes = await saveMidi(sourceMidi, [
    { name: "upper line", notes: melody, channel: 0, program: 0 },
    { name: "piano accompaniment", notes: accompaniment, channel: 1, program: 0 },
  ], "Authored listening workflow demonstration");
  const originalBytes = await saveMidi(originalMidi, [
    { name: "upper line", notes: melody, channel: 0, program: 0 },
    { name: "piano accompaniment", notes: accompaniment, channel: 1, program: 0 },
  ], "Resolved Original demonstration");
  const chordsBytes = await saveMidi(chordsMidi, [
    { name: "piano accompaniment", notes: accompaniment, channel: 0, program: 0 },
  ], "Resolved Chords demonstration");

  const [referenceAudio, originalAudio, chordsAudio] = await Promise.all([
    renderMidi(sourceMidi, join(dir, "reference.wav"), DEMO_SECONDS, soundfont),
    renderMidi(originalMidi, join(dir, "original.wav"), DEMO_SECONDS, soundfont),
    renderMidi(chordsMidi, join(dir, "chords.wav"), DEMO_SECONDS, soundfont),
  ]);
  const bankSha256 = await hashFile(soundfont);
  const versionResult = await execFile(FLUIDSYNTH, ["--version"], { timeout: 5_000, maxBuffer: 32_000 });
  const versionOutput = `${versionResult.stdout}${versionResult.stderr}`;
  const settings = {
    backend: "FluidSynth",
    version: versionOutput.split("\n").find(line => line.includes("FluidSynth runtime version"))?.trim() || versionOutput.split("\n").find(line => line.trim())?.trim() || "version unavailable",
    sampleRate: RATE,
    channels: 1,
    gain: 0.7,
    chorus: false,
    reverb: false,
    format: "mono PCM16 WAV",
    soundfont: { name: "Salamander Grand Piano", path: soundfont, sha256: bankSha256, license: "CC BY 3.0; Alexander Holm" },
    note: "Synthetic-control renderer; does not represent a capture of the Keyspilli Player sampler.",
  };
  const settingsPath = join(dir, "render-settings.json");
  await writeJson(settingsPath, settings);
  const provenancePath = join(dir, "provenance.json");
  await writeJson(provenancePath, {
    schemaVersion: 1,
    work: "Original short musical phrase authored for an offline workflow fixture.",
    source: "Created in this generator; no commercial composition, recording, or external source used.",
    audio: "Rendered locally from this fixture's MIDI using Salamander Grand Piano under CC BY 3.0.",
    qualification: "synthetic control only; no source correspondence or musical acceptance claim",
  });
  const exactPath = join(dir, "symbolic-exactness.json");
  await writeJson(exactPath, {
    schemaVersion: 1,
    method: "Generator output byte pins and note-event source records; no independent auditor.",
    sourceMidiSha256: digest(sourceBytes),
    originalMidiSha256: digest(originalBytes),
    chordsMidiSha256: digest(chordsBytes),
    status: "generator-self-check-only",
    note: "Not an independent exact-note audit and not a musical acceptance receipt.",
  });
  const noteEventsPath = join(dir, "note-events.json");
  await writeJson(noteEventsPath, {
    schemaVersion: 1,
    tempoBpm: TEMPO,
    timeSignature: [4, 4],
    sourceBeatLength: 42,
    original: { melody, accompaniment },
    chords: { accompaniment },
  });
  const tempoPath = join(dir, "tempo-map.json");
  const sustainPath = join(dir, "sustain.json");
  await writeJson(tempoPath, [{ beat: 0, bpm: TEMPO }]);
  await writeJson(sustainPath, { events: [], source: "No sustain pedal in fixture" });
  const snapshotPaths = {
    original: join(dir, "replay-original.json"),
    chords: join(dir, "replay-chords.json"),
  };
  const modes = [
    { mode: "original" as const, midiPath: originalMidi, audioPath: join(dir, "original.wav"), midiSha: digest(originalBytes), audio: originalAudio, snapshot: snapshotPaths.original, id: "fixture-original-120", notes: melody.length + accompaniment.length },
    { mode: "chords" as const, midiPath: chordsMidi, audioPath: join(dir, "chords.wav"), midiSha: digest(chordsBytes), audio: chordsAudio, snapshot: snapshotPaths.chords, id: "fixture-chords-120", notes: accompaniment.length },
  ];
  for (const mode of modes) await writeJson(mode.snapshot, {
    schemaVersion: 1,
    mode: mode.mode,
    difficulty: "beginner",
    resolvedVariantId: mode.id,
    midiSha256: mode.midiSha,
    noteEventCount: mode.notes,
    tempoMapSha256: digest(await readFile(tempoPath)),
    sustainSha256: digest(await readFile(sustainPath)),
    renderSettingsSha256: digest(await readFile(settingsPath)),
    fixtureOnly: true,
  });

  const filePin = async (path: string) => ({ path, sha256: await hashFile(path) });
  const source = await filePin(sourceMidi);
  const referenceAsset = { path: join(dir, "reference.wav"), sha256: referenceAudio.sha256, durationSeconds: referenceAudio.durationSeconds };
  const replay = async (mode: typeof modes[number]) => ({
    difficulty: "beginner",
    resolvedVariantId: mode.id,
    asset: { path: mode.audioPath, sha256: mode.audio.sha256, durationSeconds: mode.audio.durationSeconds },
    replaySnapshot: await filePin(mode.snapshot),
    noteEvents: await filePin(noteEventsPath),
    tempoMapSha256: digest(await readFile(tempoPath)),
    sustainSha256: digest(await readFile(sustainPath)),
    playbackSettingsSha256: digest(await readFile(settingsPath)),
    renderer: {
      backend: "FluidSynth",
      version: settings.version,
      sampleRate: RATE,
      channels: 1 as const,
      gain: 0.7,
      settingsSha256: digest(await readFile(settingsPath)),
      instrument: { name: "Salamander Grand Piano", bankPath: soundfont, bankSha256, evidence: "sampled-piano fixture" },
      evidenceClass: "synthetic-control" as const,
    },
    symbolicChecks: {
      exactNotes: { status: "not-run" as const, reason: "Generator pins are not an independent symbolic audit." },
      playability: { status: "not-run" as const, reason: "No physical-keyboard or learner trial." },
    },
  });
  const anchorReceiptPath = join(dir, "alignment-fixture.json");
  await writeJson(anchorReceiptPath, {
    schemaVersion: 1,
    method: "fixture",
    status: "unverified",
    note: "Both clocks come from the generator's fixed 120 BPM timeline; this is not independently checked source alignment.",
    anchors: [{ assetSeconds: 0, sourceBeat: 0 }, { assetSeconds: DEMO_SECONDS, sourceBeat: DEMO_SECONDS * TEMPO / 60 }],
  });
  const anchorPin = await filePin(anchorReceiptPath);
  const anchors = [{ assetSeconds: 0, sourceBeat: 0 }, { assetSeconds: DEMO_SECONDS, sourceBeat: DEMO_SECONDS * TEMPO / 60 }];
  const manifest: ReviewManifest = {
    schemaVersion: 2,
    kind: "keyspilli-audio-review-manifest",
    source: { ...source, format: "midi" },
    reference: {
      asset: referenceAsset,
      identity: { title: "Offline piano listening workflow fixture", evidence: provenancePath },
    },
    phraseInventory: [{ id: "phrase-01", kind: "opening", startBeat: 0, endBeat: 40 }],
    replays: { original: await replay(modes[0]!), chords: await replay(modes[1]!) },
    jobs: modes.map(mode => ({
      id: `demo-${mode.mode}`,
      mode: mode.mode,
      phraseId: "phrase-01",
      referenceClip: { path: referenceAsset.path, sha256: referenceAsset.sha256, bytes: referenceAudio.bytes, sampleRate: RATE, channels: 1 as const, bitsPerSample: 16 as const, durationSeconds: referenceAudio.durationSeconds, assetStartSeconds: 0 },
      candidateClip: { path: mode.audioPath, sha256: mode.audio.sha256, bytes: mode.audio.bytes, sampleRate: RATE, channels: 1 as const, bitsPerSample: 16 as const, durationSeconds: mode.audio.durationSeconds, assetStartSeconds: 0 },
      alignment: { status: "unverified" as const, method: "fixture" as const, evidence: anchorPin, referenceAnchors: anchors, candidateAnchors: anchors },
    })),
  };
  validateReviewManifest(manifest);
  await writeJson(join(dir, "manifest.json"), manifest);
  await writeJson(join(dir, "demo-inventory.json"), {
    status: "offline-demo-ready",
    providerCalls: 0,
    note: "Dry-run only. This synthetic fixture is not a Keyspilli Player capture and does not prove listening or musical quality.",
    files: [sourceMidi, originalMidi, chordsMidi, referenceAsset.path, ...modes.map(mode => mode.audioPath), settingsPath, provenancePath, exactPath, noteEventsPath, tempoPath, sustainPath, anchorReceiptPath],
  });
}

async function buildControls(output: string, soundfont: string) {
  const dir = join(output, "controls");
  const modelDir = join(dir, "model-facing");
  const keyDir = join(dir, "evaluator-only");
  await mkdir(modelDir, { recursive: true, mode: 0o700 });
  await mkdir(keyDir, { recursive: true, mode: 0o700 });
  const cases: Array<{ id: string; prompt: string; ref: Note[]; candidate: Note[]; expected: string; label: string; silenceCandidate?: boolean }> = [
    { id: "c01", label: "same descending phrase", prompt: "Compare the two piano clips. Report whether the melodic contour and attack pattern match, with concise time-localized evidence.", ref: sequence([72, 69, 67, 64, 62]), candidate: sequence([72, 69, 67, 64, 62]), expected: "matched contour and repeated timing" },
    { id: "c02", label: "ascending versus descending", prompt: "Compare the two piano clips. Describe the melodic direction in each and identify any clear difference, with concise time-localized evidence.", ref: sequence([60, 62, 64, 65, 67]), candidate: sequence([67, 65, 64, 62, 60]), expected: "reference ascends; candidate descends" },
    { id: "c03", label: "repeated attack versus held note", prompt: "Compare the piano attacks in the two clips. Does either clip repeat a pitch where the other sustains it? Give a short timing estimate.", ref: [{ midi: 64, start: 0, dur: 0.35, vel: 84 }, { midi: 64, start: 0.5, dur: 0.35, vel: 84 }, { midi: 67, start: 1.5, dur: 0.5, vel: 84 }], candidate: [{ midi: 64, start: 0, dur: 0.85, vel: 84 }, { midi: 67, start: 1.5, dur: 0.5, vel: 84 }], expected: "reference has two E attacks; candidate sustains E" },
    { id: "c04", label: "major versus minor triad", prompt: "Compare the chord quality in these piano clips. If clearly audible, identify the difference and its approximate time.", ref: chord([60, 64, 67], 0, 2), candidate: chord([60, 63, 67], 0, 2), expected: "reference C major; candidate C minor" },
    { id: "c05", label: "non-silent versus silence", prompt: "Compare whether both clips contain audible piano. Identify any clearly silent clip and when the difference occurs.", ref: sequence([60, 64, 67, 72]), candidate: [], expected: "reference has piano notes; candidate is silent", silenceCandidate: true },
    { id: "c06", label: "same changed pair with presentation order reversed", prompt: "Compare the two piano clips. Describe each clip's melodic direction and whether they match.", ref: sequence([67, 65, 64, 62, 60]), candidate: sequence([60, 62, 64, 65, 67]), expected: "same musical contrast as c02 with audio order reversed" },
  ];
  const rows: Array<Record<string, unknown>> = [];
  const answerRows: Array<Record<string, unknown>> = [];
  for (const item of cases) {
    const renderClip = async (side: "a" | "b", notes: Note[], silence = false) => {
      const midiPath = join(dir, `.private-${item.id}-${side}.mid`);
      const temporaryWav = join(dir, `.private-${item.id}-${side}.wav`);
      const tmp = join(dir, `${item.id}-${side}.tmp.wav`);
      if (silence) {
        const audio = await renderSilence(tmp, CONTROL_SECONDS);
        const opaque = join(modelDir, `${audio.sha256}.wav`);
        const temporary = `${opaque}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporary, await readFile(tmp), { mode: 0o600 });
        await rename(temporary, opaque);
        await rm(tmp, { force: true });
        return { path: opaque, sha256: audio.sha256, bytes: audio.bytes, sampleRate: RATE, channels: 1, bitsPerSample: 16, durationSeconds: audio.durationSeconds };
      }
      const midi = await saveMidi(midiPath, [{ name: "piano", notes, channel: 0, program: 0 }], `Control ${item.id}`);
      const rendered = await renderMidi(midiPath, temporaryWav, CONTROL_SECONDS, soundfont);
      const opaque = join(modelDir, `${rendered.sha256}.wav`);
      const temporary = `${opaque}.${process.pid}.${Date.now()}.${side}.tmp`;
      await writeFile(temporary, await readFile(temporaryWav), { mode: 0o600 });
      await rename(temporary, opaque);
      await rm(midiPath, { force: true });
      await rm(temporaryWav, { force: true });
      return { path: opaque, sha256: rendered.sha256, bytes: rendered.bytes, sampleRate: RATE, channels: 1, bitsPerSample: 16, durationSeconds: rendered.durationSeconds, midiSha256: digest(midi) };
    };
    const [reference, candidate] = await Promise.all([
      renderClip("a", item.ref), renderClip("b", item.candidate, item.silenceCandidate),
    ]);
    rows.push({ id: item.id, reference, candidate, prompt: item.prompt, attachments: ["reference", "candidate"] });
    answerRows.push({ id: item.id, privateLabel: item.label, expected: item.expected, referenceMidiSha256: reference.midiSha256 ?? null, candidateMidiSha256: candidate.midiSha256 ?? null, referenceAudioSha256: reference.sha256, candidateAudioSha256: candidate.sha256 });
  }
  const pack = {
    schemaVersion: 1,
    kind: "blind-audio-control-pack",
    qualification: "synthetic controls only; no real-song reviewer calibration credit",
    renderer: { name: "FluidSynth", soundfont: "Salamander Grand Piano", soundfontSha256: await hashFile(soundfont), sampleRate: RATE, channels: 1, bitsPerSample: 16, fixedControlDurationSeconds: CONTROL_SECONDS },
    controls: rows,
    note: "This pack is for a parent-owned controlled experiment. It contains no live submission receipt.",
  };
  await writeJson(join(modelDir, "cases.json"), pack);
  await writeJson(join(keyDir, "answer-key.json"), {
    schemaVersion: 1,
    kind: "evaluator-only-answer-key",
    keepOutOfReviewerContext: true,
    controls: answerRows,
  });
  await writeFile(join(dir, "README.md"), [
    "# Blind audio controls",
    "",
    "Status: prepared locally; no provider request was sent.",
    "",
    "- Reviewer inputs: `model-facing/cases.json` and its hash-named WAVs.",
    "- Evaluator-only labels: `evaluator-only/answer-key.json`. Keep this outside reviewer context.",
    "- All examples are synthetic piano controls. They do not count as real-song calibration or acceptance evidence.",
    "- `c06` presents the same ascending/descending contrast as `c02` with audio order reversed.",
    "",
  ].join("\n"), { mode: 0o600 });
}

async function main() {
  const output = resolve(process.argv[2] ?? DEFAULT_OUTPUT);
  const soundfont = resolve(process.argv[3] ?? DEFAULT_SOUNDFONT);
  await readFile(soundfont);
  await execFile(FLUIDSYNTH, ["--version"], { timeout: 5_000, maxBuffer: 32_000 });
  await execFile(FFMPEG, ["-version"], { timeout: 5_000, maxBuffer: 32_000 });
  await buildDemo(output, soundfont);
  await buildControls(output, soundfont);
  process.stdout.write(`${stableJson({ status: "prepared-only", output, manifest: join(output, "demo/manifest.json"), controls: join(output, "controls/model-facing/cases.json"), answerKey: join(output, "controls/evaluator-only/answer-key.json"), providerCalls: 0, providerListening: "unverified", musicalAcceptance: "not established" })}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
