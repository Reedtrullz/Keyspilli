import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index];
  if (!flag.startsWith("--") || !process.argv[index + 1] || process.argv[index + 1].startsWith("--"))
    throw new Error(`Expected a value after ${flag}; supported inputs: --source-midi, --speech-1, --speech-2, --output-dir`);
  if (!["--source-midi", "--speech-1", "--speech-2", "--output-dir"].includes(flag)) throw new Error(`Unknown option: ${flag}`);
  if (cli.has(flag)) throw new Error(`Option supplied more than once: ${flag}`);
  cli.set(flag, process.argv[++index]);
}
const inputPath = (flag, env, fallback) => {
  const value = cli.get(flag) ?? process.env[env] ?? fallback;
  return value == null ? null : isAbsolute(value) ? resolve(value) : resolve(root, value);
};
const run = inputPath("--output-dir", "KEYSPILLI_PLAYER_CORPUS_RUN", "output/song-prep/player-qualification-20261003");
const fixturesDir = join(run, "capture-fixtures");
const mediaDir = join(run, "model-facing/media");
const sourcePath = inputPath("--source-midi", "KEYSPILLI_PLAYER_CORPUS_SOURCE_MIDI", "output/song-prep/audio-review-demo-20261003/demo/note-events.json");
const speechSources = [
  inputPath("--speech-1", "KEYSPILLI_PLAYER_CORPUS_SPEECH_1"),
  inputPath("--speech-2", "KEYSPILLI_PLAYER_CORPUS_SPEECH_2"),
];
for (const [label, path] of [["authored note-event fixture", sourcePath], ...speechSources.map((path, index) => [`synthetic speech control ${index + 1}`, path])]) {
  if (!path) throw new Error(`Missing ${label}; pass its CLI option or documented KEYSPILLI_PLAYER_CORPUS_* environment variable.`);
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
}

mkdirSync(fixturesDir, { recursive: true });
mkdirSync(mediaDir, { recursive: true });
mkdirSync(join(run, "evaluator-only"), { recursive: true });
const authored = JSON.parse(readFileSync(sourcePath, "utf8"));
function pcm16MonoWavDuration(path) {
  const bytes = readFileSync(path);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE")
    throw new Error(`Synthetic speech control must be a RIFF/WAVE file: ${path}`);
  let offset = 12;
  let byteRate = 0;
  let dataLength = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > bytes.length) throw new Error(`Truncated WAV chunk in ${path}`);
    if (id === "fmt ") {
      const format = bytes.readUInt16LE(body);
      const channels = bytes.readUInt16LE(body + 2);
      byteRate = bytes.readUInt32LE(body + 8);
      const bitsPerSample = bytes.readUInt16LE(body + 14);
      if (format !== 1 || channels !== 1 || bitsPerSample !== 16)
        throw new Error(`Synthetic speech control must be mono PCM16: ${path}`);
    }
    if (id === "data") dataLength = size;
    offset = body + size + (size % 2);
  }
  if (!byteRate || !dataLength) throw new Error(`Missing PCM16 WAV format or data chunk: ${path}`);
  return Number((dataLength / byteRate).toFixed(7));
}
const playerSourceCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const playerSourceFiles = ["apps/web/src/components/player/Player.tsx", "packages/player-core/src/engine.ts", "packages/player-core/src/sampler-audio.ts"];
const playerSourcePins = Object.fromEntries(playerSourceFiles.map(path => [path,
  execFileSync("git", ["-C", root, "rev-parse", `HEAD:${path}`], { encoding: "utf8" }).trim()]));
const tempoBpm = 120;
const phraseWindows = [0, 8, 16, 24];
const fixtures = [];
const captures = new Map();
const cases = [];
const answerKey = { schemaVersion: 1, kind: "evaluator-only-answer-key", keepOutOfReviewerContext: true, cases: [] };

function phraseData(startBeat, mutation = null, shape = "full") {
  const endBeat = startBeat + 8;
  const melody = authored.original.melody.filter(n => n.start >= startBeat && n.start < endBeat).map(n => ({ ...n, start: n.start - startBeat, hand: "R" }));
  const backing = authored.original.accompaniment.filter(n => n.start >= startBeat && n.start < endBeat).map(n => ({ ...n, start: n.start - startBeat, hand: "L" }));
  const chordGroups = new Map();
  for (const note of authored.chords.accompaniment.filter(n => n.start >= startBeat && n.start < endBeat)) {
    const beat = note.start - startBeat;
    const group = chordGroups.get(beat) ?? { beat, durationBeats: Math.min(note.dur, endBeat - note.start), name: "C", notes: [], sourceKind: "authored" };
    group.notes.push(note.midi);
    group.durationBeats = Math.max(group.durationBeats, Math.min(note.dur, endBeat - note.start));
    chordGroups.set(beat, group);
  }
  const chords = [...chordGroups.values()].sort((a, b) => a.beat - b.beat);
  let notes = shape === "backing" ? backing : shape === "melody-only" ? melody : [...melody, ...backing];
  if (mutation) {
    if (mutation.type === "wrong-note") notes = notes.map(n => n.start === mutation.beat && n.midi === mutation.pitch ? { ...n, midi: n.midi + mutation.delta } : n);
    if (mutation.type === "rhythm") notes = notes.map(n => n.start === mutation.beat && n.midi === mutation.pitch ? { ...n, start: n.start + mutation.delta } : n);
    if (mutation.type === "missing-melody") notes = notes.filter(n => !(n.hand === "R" && n.start === mutation.beat && n.midi === mutation.pitch));
  }
  // PlaybackEngine.firstNoteAtOrAfter uses binary search, so the combined
  // hand lanes must use the same canonical time/pitch ordering as generated notes.
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const measures = Array.from({ length: 2 }, (_, i) => ({ index: i, startBeat: i * 4, endBeat: (i + 1) * 4 }));
  return { notes, chords, key: "C", tempoBpm, timeSig: [4, 4], measures, sections: [{ id: "phrase", label: "Phrase", startBeat: 0, endBeat: 8 }] };
}

function addFixture(label, data) {
  const id = `fixture-${String(fixtures.length + 1).padStart(2, "0")}`;
  fixtures.push({ id, data, title: "Authored listening fixture" });
  return id;
}
function addCapture(label, mode, data, expectedEvents) {
  const songId = addFixture(label, data);
  const clipId = `clip-${String(captures.size + 1).padStart(2, "0")}`;
  const schedule = mode === "chords" ? data.chords.map(chord => ({ start: chord.beat })) : expectedEvents;
  const seconds = events => events.map(event => Number((event.start * 60 / tempoBpm).toFixed(4)));
  captures.set(label, { clipId, songId: `${songId}-m`, mode, durationMs: 4_700,
    expectedAttackSeconds: schedule.map(n => Number((n.start * 60 / tempoBpm).toFixed(4))),
    expectedAttackSecondsByBus: {
      voice: mode === "original" ? seconds(data.notes.filter(note => note.hand === "R")) : [],
      backing: seconds(data.notes.filter(note => note.hand === "L")).concat(mode === "chords" ? seconds(data.chords.map(chord => ({ start: chord.beat }))) : []),
    } });
  return clipId;
}
function sourceEvents(startBeat, shape = "full") {
  return phraseData(startBeat, null, shape).notes;
}
function capturePair(label, startBeat, mode, refData, candData, defect = null, group = "clean", clipModes = {}) {
  const refEvents = refData.notes;
  const candEvents = candData.notes;
  const reference = addCapture(`${label}-reference`, clipModes.referenceMode ?? mode, refData, refEvents);
  const candidate = addCapture(`${label}-candidate`, clipModes.candidateMode ?? mode, candData, candEvents);
  const id = `q-${String(cases.length + 1).padStart(2, "0")}`;
  cases.push({ id, mode, group: defect ? "known-fault" : group, reference, candidate });
  const targetStart = defect ? Math.max(0, Number((defect.beat * 60 / tempoBpm).toFixed(4))) : null;
  answerKey.cases.push({ id, expected: defect ? { ...defect, onsetWindowSeconds: [targetStart, Number((targetStart + 0.3).toFixed(4))], localizationClaim: "an onset claim may use the target onset window; full affected span is recorded separately" }
    : { seededMutation: null, status: "construction only; no independent musical correctness claim" },
    referenceNotes: refEvents, candidateNotes: candEvents,
    tolerance: { onsetSeconds: 0.12, pitchSemitones: 0, localizationPaddingSeconds: 0.5 } });
  return { reference, candidate, id };
}

// Four clean Original pairs and four lead-removed Chords pairs, all sourced from the existing authored MIDI study fixture.
for (let i = 0; i < 4; i++) {
  const phrase = phraseWindows[i];
  const full = phraseData(phrase);
  capturePair(`clean-original-${i + 1}`, phrase, "original", full, structuredClone(full), null);
}
for (let i = 0; i < 4; i++) {
  const phrase = phraseWindows[i];
  capturePair(`clean-chords-${i + 1}`, phrase, "chords", phraseData(phrase), phraseData(phrase), null, "clean",
    { referenceMode: "original", candidateMode: "chords" });
}

// Eight single-mutation cases: two each of pitch, timing, removed melody, and extra accompaniment.
const faultPlan = [
  ["Original", 0, "wrong-note"], ["Original", 8, "rhythm"],
  ["Original", 16, "missing-melody"], ["Original", 24, "missing-melody"],
  ["Chords", 0, "wrong-note"], ["Chords", 8, "rhythm"],
  ["Chords", 16, "backing-intrusion"], ["Chords", 24, "backing-intrusion"],
];
for (const [modeName, phrase, fault] of faultPlan) {
  const mode = modeName === "Chords" ? "chords" : "original";
  const base = phraseData(phrase);
  let mutation;
  let candidate;
  if (fault === "wrong-note") {
    const n = base.notes.find(n => n.hand === (mode === "chords" ? "L" : "R"));
    mutation = { type: "wrong-note", beat: n.start, pitch: n.midi, delta: -1 };
    candidate = phraseData(phrase, mutation, mode === "chords" ? "backing" : "full");
  } else if (fault === "rhythm") {
    const n = base.notes.find(n => n.hand === (mode === "chords" ? "L" : "R"));
    mutation = { type: "rhythm", beat: n.start, pitch: n.midi, delta: 0.5 };
    candidate = phraseData(phrase, mutation, mode === "chords" ? "backing" : "full");
  } else if (fault === "missing-melody") {
    const n = base.notes.find(n => n.hand === "R");
    mutation = { type: "missing-melody", beat: n.start, pitch: n.midi };
    candidate = phraseData(phrase, mutation, "full");
  } else {
    const backing = phraseData(phrase, null, "backing");
    const beat = 1.5;
    backing.chords.push({ beat, durationBeats: 0.5, name: "F#7", notes: [54, 58, 61, 65], sourceKind: "authored" });
    mutation = { type: "backing-intrusion", beat, pitch: 84 };
    candidate = backing;
  }
  if (mode === "chords" && fault === "wrong-note") {
    candidate.chords = candidate.chords.map(chord => chord.beat === mutation.beat
      ? { ...chord, name: mutation.delta === -1 ? "B" : "C#",
        notes: chord.notes.map(midi => midi === mutation.pitch ? midi + mutation.delta : midi) }
      : chord);
  }
  if (mode === "chords" && fault === "rhythm") {
    candidate.chords = candidate.chords.map(chord => chord.beat === mutation.beat
      ? { ...chord, beat: chord.beat + mutation.delta }
      : chord);
  }
  capturePair(`fault-${fault}-${modeName}-${phrase}`, phrase, mode, base, candidate,
    { defect: true, type: fault, attachment: "candidate", beat: mutation.beat, pitch: mutation.pitch, delta: mutation.delta ?? null });
}

// Four mandatory gates plus four additional controls. Musical controls are rendered through Player below.
const pianoControl = addCapture("control-piano", "original", phraseData(0), sourceEvents(0));
const identicalRef = addCapture("control-identical", "original", phraseData(8), sourceEvents(8));
const identicalCandidate = identicalRef;
const ascending = phraseData(0, null, "melody-only");
ascending.notes = [60, 62, 64, 65, 67, 69, 71, 72].map((midi, index) => ({ midi, start: index, dur: 0.45, vel: 78, hand: "R" }));
const descending = phraseData(0, null, "melody-only");
descending.notes = [72, 71, 69, 67, 65, 64, 62, 60].map((midi, index) => ({ midi, start: index, dur: 0.45, vel: 78, hand: "R" }));
const contourA = addCapture("control-contour-a", "original", ascending, ascending.notes);
const contourB = addCapture("control-contour-b", "original", descending, descending.notes);
const repeated = phraseData(0, null, "melody-only");
repeated.notes = [{ midi: 64, start: 0, dur: 0.45, vel: 78, hand: "R" }, { midi: 64, start: 1, dur: 0.45, vel: 78, hand: "R" }];
const held = phraseData(0, null, "melody-only");
held.notes = [{ midi: 64, start: 0, dur: 1.45, vel: 78, hand: "R" }];
const repeatedId = addCapture("control-repeated", "original", repeated, repeated.notes);
const heldId = addCapture("control-held", "original", held, held.notes);
const major = phraseData(0, null, "backing"); major.notes = []; major.chords = [{ beat: 0, durationBeats: 2, name: "C", notes: [60, 64, 67], sourceKind: "authored" }];
const minor = structuredClone(major); minor.chords[0].notes = [60, 63, 67]; minor.chords[0].name = "Cm";
const majorId = addCapture("control-major", "chords", major, [{ start: 0 }, { start: 0 }, { start: 0 }]);
const minorId = addCapture("control-minor", "chords", minor, [{ start: 0 }, { start: 0 }, { start: 0 }]);

function control(id, mode, reference, candidate, gate = null, noAudio = false) {
  cases.push({ id, mode, group: "control", ...(gate ? { mandatoryGate: gate } : {}),
    ...(noAudio ? { audioPaths: [] } : { reference, candidate }) });
  answerKey.cases.push({ id, expected: { control: gate ?? id }, tolerance: { onsetSeconds: 0.12, pitchSemitones: 0 } });
}
const silenceSamples = 16000;
const silence = Buffer.alloc(44 + silenceSamples * 2);
silence.write("RIFF", 0); silence.writeUInt32LE(36 + silenceSamples * 2, 4); silence.write("WAVEfmt ", 8);
silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
silence.writeUInt32LE(16000, 24); silence.writeUInt32LE(32000, 28); silence.writeUInt16LE(2, 32);
silence.writeUInt16LE(16, 34); silence.write("data", 36); silence.writeUInt32LE(silenceSamples * 2, 40);
const silenceHash = createHash("sha256").update(silence).digest("hex");
const silencePath = join(mediaDir, `${silenceHash}.wav`);
writeFileSync(silencePath, silence);
const silencePin = { path: silencePath, sha256: silenceHash, bytes: silence.length, durationSeconds: 1,
  provenance: "locally generated zero-valued mono PCM16 control; not a Player capture" };
control("g-missing-audio", "original", null, null, "MISSING AUDIO", true);
control("g-piano-silence", "original", pianoControl, silencePin, "PIANO versus SILENCE");
const speechPins = speechSources.map(source => {
  const bytes = readFileSync(source);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const durationSeconds = pcm16MonoWavDuration(source);
  const path = join(mediaDir, `${sha256}.wav`);
  copyFileSync(source, path);
  return { path, sha256, bytes: bytes.length, durationSeconds,
    provenance: "synthetic speech control supplied by the study owner; retain its generator provenance; not a human voice or Player capture",
    sourceName: basename(source) };
});
control("g-unrelated-speech", "original", speechPins[0], speechPins[1], "UNRELATED SPEECH");
control("g-swapped-order", "original", descendingId(), contourA, "SWAPPED ORDER");
control("g-identical", "original", identicalRef, identicalCandidate);
control("g-contour", "original", contourA, contourB);
control("g-repeated-held", "original", repeatedId, heldId);
control("g-major-minor", "chords", majorId, minorId);

function descendingId() { return contourB; }

const fixtureBundle = { schemaVersion: 1, provenance: {
  playerSourceCommit,
  mainSampleFixCommit: "46e7b666799de4f7b18ba714ea12d44549b7ad29",
  playerSourceFiles: playerSourcePins,
  type: "self-authored synthetic Player pilot",
  source: "Authored note-event fixture supplied by the study owner; derived examples are synthetic controls with no external recording.",
  limitations: "Single authored phrase family with excerpted and deliberately mutated examples; no real-song, aesthetic, keyboard-playability, or broad acceptance claim.",
  sourceMidi: {
    path: sourcePath.startsWith(`${root}${sep}`) ? relative(root, sourcePath) : basename(sourcePath),
    pathScope: sourcePath.startsWith(`${root}${sep}`) ? "repository-relative" : "basename-only; supplied externally",
    sha256: createHash("sha256").update(readFileSync(sourcePath)).digest("hex") },
  sampleInstrument: "Keyspilli Player SamplerAudioEngine using smplr SplendidGrandPiano; sample assets must be response-hash pinned during capture.",
  fixtureNoteOrder: "Each Player fixture is sorted by start beat then MIDI pitch before handoff; PlaybackEngine binary search requires this canonical order.",
}, fixtures, captures: Object.fromEntries(captures) };
const bundlePath = join(fixturesDir, "bundle.json");
writeFileSync(bundlePath, JSON.stringify(fixtureBundle, null, 2) + "\n", { flag: "w" });
const timelineAudit = JSON.parse(execFileSync(process.execPath, ["--import", "tsx",
  join(root, "apps/web/scripts/audit-player-qualification-fixtures.ts"), bundlePath], { encoding: "utf8" }));
Object.assign(fixtureBundle.captures, timelineAudit.captures);
const capturesByClip = new Map(Object.entries(fixtureBundle.captures).map(([label, capture]) => [capture.clipId, { label, capture }]));
const casePlansById = new Map(cases.map(item => [item.id, item]));
for (const answer of answerKey.cases) {
  const planned = casePlansById.get(answer.id);
  const reference = capturesByClip.get(planned?.reference);
  const candidate = capturesByClip.get(planned?.candidate);
  if (reference && candidate) {
    answer.renderedEventAudit = {
      reference: { label: reference.label, ...reference.capture.renderedEventAudit },
      candidate: { label: candidate.label, ...candidate.capture.renderedEventAudit },
    };
    if (answer.expected?.defect) {
      const expected = answer.expected;
      if (JSON.stringify(reference.capture.renderedEventAudit) === JSON.stringify(candidate.capture.renderedEventAudit))
        throw new Error(`Seeded fault ${answer.id} has no audible event difference in the production Player resolver`);
      const sourceMutation = { type: expected.type, beat: expected.beat, pitch: expected.pitch,
        delta: expected.delta, attachment: expected.attachment };
      const targetStart = expected.onsetWindowSeconds[0];
      const refAudit = reference.capture.renderedEventAudit;
      const candAudit = candidate.capture.renderedEventAudit;
      const at = (audit, seconds) => audit.chordEvents.find(event => Math.abs(event.startSeconds - seconds) < 0.001);
      if (expected.type === "wrong-note" && answer.id === "q-13") {
        expected.effectiveMutation = { type: "wrong-note", targetStartSeconds: targetStart,
          renderedChordPitchSet: { reference: at(refAudit, targetStart)?.midiNotes,
            candidate: at(candAudit, targetStart)?.midiNotes },
          note: "Player Chords resolver changes the full voicing for the one semitone root-label mutation." };
        expected.affectedSpanSeconds = [targetStart, 1.4];
      } else if (expected.type === "rhythm" && answer.id === "q-14") {
        expected.effectiveMutation = { type: "rhythm", referenceStartsSeconds: refAudit.chordEvents.map(event => event.startSeconds),
          candidateStartsSeconds: candAudit.chordEvents.map(event => event.startSeconds),
          targetStartSeconds: targetStart };
        expected.affectedSpanSeconds = [0, 1.525];
      } else if (expected.type === "backing-intrusion") {
        const refStarts = new Set(refAudit.chordEvents.map(event => event.startSeconds));
        const candidateFixture = fixtureBundle.fixtures.find(fixture => fixture.id === candidate.capture.songId.replace(/-[ma]$/, ""));
        const sourceChord = candidateFixture?.data.chords.find(chord => Math.abs(chord.beat - expected.beat) < 1e-6);
        sourceMutation.sourceChord = sourceChord ? { beat: sourceChord.beat, name: sourceChord.name,
          notes: sourceChord.notes, durationBeats: sourceChord.durationBeats } : null;
        expected.effectiveMutation = { type: "backing-intrusion", targetStartSeconds: targetStart,
          insertedResolvedChordEvents: candAudit.chordEvents.filter(event => !refStarts.has(event.startSeconds)),
          referenceChordDurations: refAudit.chordEvents.map(event => ({ startSeconds: event.startSeconds, durationBeats: event.durationBeats })),
          candidateChordDurations: candAudit.chordEvents.map(event => ({ startSeconds: event.startSeconds, durationBeats: event.durationBeats })),
          sourceChord: sourceChord ? { beat: sourceChord.beat, name: sourceChord.name, notes: sourceChord.notes, durationBeats: sourceChord.durationBeats } : null,
          note: "The added F#7 label resolves to a five-note voicing and shortens the preceding chord span." };
        expected.affectedSpanSeconds = [0.75, 1.4];
      } else {
        expected.effectiveMutation = { type: expected.type, targetStartSeconds: targetStart,
          referenceEvents: refAudit.notes, candidateEvents: candAudit.notes };
        if (expected.type === "rhythm") expected.affectedSpanSeconds = [targetStart, 0.525];
        else expected.affectedSpanSeconds = [targetStart, Number((targetStart + 0.275).toFixed(4))];
      }
      if (expected.type === "backing-intrusion") {
        delete sourceMutation.pitch;
        delete sourceMutation.delta;
      }
      expected.sourceMutation = sourceMutation;
      const unaffectedReference = refAudit.chordEvents.filter(event => event.startSeconds >= expected.affectedSpanSeconds[1]);
      const unaffectedCandidate = candAudit.chordEvents.filter(event => event.startSeconds >= expected.affectedSpanSeconds[1]);
      expected.unaffectedEventsAfterAffectedSpanEqual = JSON.stringify(unaffectedReference) === JSON.stringify(unaffectedCandidate);
      expected.unaffectedReferenceChordEvents = unaffectedReference;
      expected.unaffectedCandidateChordEvents = unaffectedCandidate;
      if (!expected.unaffectedEventsAfterAffectedSpanEqual)
        throw new Error(`Seeded fault ${answer.id} unexpectedly changes events outside its pinned affected span`);
      delete expected.beat;
      delete expected.pitch;
      delete expected.delta;
    }
  }
}
const inventory = Object.fromEntries(["clean", "known-fault", "control"].map(group => [group, cases.filter(item => item.group === group).length]));
if (cases.length !== 24 || inventory.clean !== 8 || inventory["known-fault"] !== 8 || inventory.control !== 8)
  throw new Error(`Player corpus inventory mismatch: ${JSON.stringify({ total: cases.length, ...inventory })}`);
if (answerKey.cases.length !== 24 || answerKey.cases.some((item, index) => item.id !== cases[index]?.id))
  throw new Error("Player corpus answer-key inventory does not exactly match the 24 model-facing cases");
writeFileSync(bundlePath, JSON.stringify(fixtureBundle, null, 2) + "\n", { flag: "w" });
writeFileSync(join(run, "evaluator-only/answer-key.json"), JSON.stringify(answerKey, null, 2) + "\n");
writeFileSync(join(run, "model-facing/cases.plan.json"), JSON.stringify({ schemaVersion: 1, cases, captures: fixtureBundle.captures, speechPins }, null, 2) + "\n");
console.log(JSON.stringify({ output: run, cases: cases.length, playerCaptures: captures.size,
  mandatoryGates: cases.filter(c => c.mandatoryGate).map(c => c.mandatoryGate) }, null, 2));
