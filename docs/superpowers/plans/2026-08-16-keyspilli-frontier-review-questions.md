# Keyspilli frontier-model review questions before implementation

Status: pre-implementation design review (2026-08-16)

This is a question packet for an advanced architecture/product model. It is
not an implementation specification by itself. The model should distinguish
true blockers from generic enterprise concerns that do not apply to this
single-repository filesystem + SQLite deployment.

## Context to give the reviewer

- Keyspilli stores six difficulty variants under
  data/artifacts/<baseId>/<level>/.
- Runtime loads notes.json; variant.mid and variant.xml are derived artifacts.
  SQLite songs.tempo is a read-model mirror.
- The proposed shared base artifact manifest is
  data/artifacts/<baseId>/manifest.json; it will be written last inside a
  staged base tree, then the whole tree will be atomically renamed.
- Legacy notes.json may have no manifest and no chord sourceKind.
- Chord authority is authored/chart > inferred learner fallback > generated
  MIDI fallback. unknown is reserved for legacy/ambiguous provenance.
- Chord run compaction treats source kind, root, quality, and inversion as
  material; note order and octave doublings are not.
- The player currently loses absolute chord voicing at the
  PlaybackEngine -> AudioEngine pitch-class boundary.
- The current transcription pipeline has scalar BPM, Basic Pitch 0.3.0
  locally, onset/frame thresholds 0.65/0.45, duplicated tempo resolution in
  worker/rebuild paths, and no persisted transcription config block yet.

## Blockers to resolve before writing production code

### 1. Manifest identity and schema

What exactly identifies an arrangement manifest: baseId, source hash,
canonical-note hash, generator/config fingerprint, or a version tuple? Can two
artifacts share a source hash but legitimately differ because of a tempo
override, learner profile, or chord policy? What is the schema version and
compatibility matrix for old/new manifests?

Evidence required: a JSON schema, identity function, required/optional field
table, and examples for legacy, current, and future manifests.

### 2. Scalar tempo versus tempo map

Is this migration explicitly scalar-BPM-only? If so, what happens when MIDI or
MusicXML contains multiple tempo events, rubato, fermatas, or a manual tempo
override? Does a manual override alter only playback, or rescale beat positions
to preserve source wall-clock timing?

Evidence required: one tempo-resolution algorithm, source precedence, explicit
non-goals for tempo maps, and tests for override/detected/MIDI/manifest inputs.

### 3. Publication atomicity boundary

Is the atomic unit the complete base artifact tree plus SQLite rows? What is the
state machine if the process dies during staging, root rename, DB replacement,
or cleanup? Can two rebuilds publish the same baseId concurrently? Are stale
backup/staging directories safe and discoverable?

Evidence required: publish state diagram and failure-injection tests for disk
full, permission failure, process kill, DB failure, and concurrent publish.

### 4. Partial-read and legacy behavior

Does a loader fail open or fail closed for missing manifest, missing level,
malformed manifest, missing tempoBpm, and manifest/notes tempo mismatch? Is
unknown ranked below generated, or does it require a special conflict rule so
legacy curated events are not silently demoted?

Evidence required: a compatibility matrix and a corpus test over all legacy
artifact shapes. The projection must never infer generated from absence.

### 5. Chord provenance semantics

Is sourceKind provenance for the whole event, while inferred describes the
label/voicing decision? Must the invariant be sourceKind = inferred implies
inferred = true? Can an authored event contain an inferred voicing, or must
that become two layered events? What is the provenance chain after a chart
event is filled from generated notes?

Evidence required: a closed taxonomy, invariants, examples of mixed chart /
fallback events, and UI/export semantics for each state.

### 6. Precedence and determinism

Is precedence a total order or a partial order with explicit incomparable
cases? What are the exact same-rank tie-breakers? Does stable input order count
as deterministic when callers provide differently ordered arrays? Is dedupe
idempotent and permutation-stable?

Evidence required: precedence table/lattice, canonical sorting rule, and
property tests for idempotence, determinism, same-onset conflicts, overlapping
chart spans, and repeated normalization.

### 7. Normalized event schema

Does every normalized event have durationBeats, absolute MIDI notes, and a
non-optional sourceKind, while legacy input fields remain optional? What
schema/version is used when chord-timeline.ts:368, catalog-api.ts, and web
normalization reconstruct events?

Evidence required: one shared type or adapter, fixture round-trips, and a grep-
backed list of every reconstruction point.

### 8. Explicit-MIDI audio contract

What precisely does playChord(midiNotes, when, durationSec) guarantee about
ordering, duplicates, transpose, cancellation, seek/start, looping, and
duration? Is the timing requirement Web Audio scheduling accuracy, or is
sample-accurate device synchronization genuinely required? What is the legacy
compact-pitch-class compatibility rule?

Evidence required: a sequence diagram and fake-audio tests for inversions,
octave doublings, transpose, seek, loop, cancellation, and duration. Do not
adopt unrealistic sample-level SLOs without a product need.

## High-priority questions to answer during the implementation slice

### 9. Generated chord payload

Can generated ChordLabel.notes include melody doublings or non-chord tones?
Should the engine pass all notes, or should chord extraction emit a separate
canonical voiced-chord payload with caps/attenuation? How are chart voicings
protected from generated simplification?

### 10. Duration and tempo remapping

When song-update.ts changes tempo, are note beats, chord beats, and
durationBeats all transformed consistently? Are chord durations source spans
or playback seconds? What invariant prevents a 1.2-second fallback from
returning?

### 11. Chart/fallback merge semantics

Does a chart event win at the same beat, anywhere inside its duration, or only
when it has explicit notes? What happens when a chart has a symbol but no
voicing, overlaps two generated events, or covers only the opening section?

### 12. Canonical extraction source

Does buildVariants() extract chord candidates once from the fullest canonical
source and simplify per level, or are level-specific candidates still needed
for learner safety? What happens to the two currently empty generated
timelines after this change?

### 13. Cache identity and stale artifacts

What exact fingerprint invalidates a transcription or normalized chord result?
At minimum, should it include source-audio hash, Basic Pitch version, effective
inference parameters, preprocessing, cleanup version, precedence version,
tempo resolution, and manifest schema? How are targeted rebuilds throttled?

### 14. Provenance versus editable state

Which fields are immutable derivation history and which are current editable
arrangement state? Does a manual tempo/chord edit create a new derivation
identity, or only update the working artifact? What provenance must appear in
PDF, MusicXML, MIDI, and API responses?

### 15. UI meaning of inferred chords

Is amber/dotted treatment sufficient for learners? What does unknown look
like? How are inferred labels represented in canvas, accessibility text,
grayscale exports, and screen-reader output? What is the user action when an
inferred chord is wrong?

### 16. Hand separation boundary

Is the current Note.hand?: L | R plus undefined-as-unassigned contract
adequate for this slice? If hand provenance is later needed, should it be a
separate handSource field rather than an unassigned enum expansion?

### 17. Basic Pitch/Demucs evidence gate

What fixture set and metrics decide whether threshold changes, frequency bounds,
Melodia changes, high-pass filtering, or Demucs improve learner outcomes?
Which failures are inference errors versus cleanup/arrangement errors? What
listening rubric and sample size are sufficient to promote a default?

## Release and migration questions

### 18. Legacy corpus and rollback

Can every current artifact load without rewriting? Can a failed migration be
rolled back by restoring the previous base root and DB rows? Are generated
manifests additive, and can old code ignore them safely?

### 19. Verification and observability

Which checks fail the build versus emit warnings? How are tempo mismatches,
legacy loads, inferred-chord counts, stale transcription fingerprints,
publication retries, and orphaned staging directories reported?

### 20. Human musical acceptance

What are the release thresholds for melody recognizability, useful LH content,
wrong-note severity, rhythm/bar alignment, chord confidence, and playability at
normal and 70% speed? Which songs are mandatory canaries before a catalogue
rebuild?

## Questions that should not become accidental blockers

- A distributed transaction coordinator is unnecessary unless the deployment
  grows beyond the current staged filesystem + SQLite boundary.
- Sample-accurate hardware latency budgets are unnecessary for the current Web
  Audio abstraction unless product requirements change.
- Tempo maps, automatic fingering, full provenance event sourcing, and runtime
  Demucs should remain explicit later phases.

## Required frontier-model response format

Ask the model to return:

1. assumptions it is making about the current repository;
2. blockers, high-priority decisions, and deferrable ideas;
3. a proposed manifest/schema and compatibility matrix;
4. a publication state machine with crash recovery;
5. a precedence table and determinism properties;
6. an engine/audio timing contract;
7. a test/failure-injection matrix;
8. musical acceptance criteria and non-claims;
9. disagreements with the current roadmap;
10. the smallest safe implementation slice.

The model must cite repository paths for code-specific claims and label generic
industry advice as such.
