# Keyspilli transcription and learning-arrangement roadmap

Status: draft for collaborative review (2026-08-16)

Before implementation, use the companion review packet:
docs/superpowers/plans/2026-08-16-keyspilli-frontier-review-questions.md.

The pasted answer set is reconciled against the repository in:
docs/superpowers/plans/2026-08-16-keyspilli-decision-set-review.md.

This roadmap supersedes the stale checkbox status in
`docs/superpowers/plans/2026-08-13-keyspilli-youtube-midi-quality.md` while
preserving its useful decomposition. It is a planning baseline, not a claim
that the whole catalogue is musically accepted.

## Product north star

Keyspilli should help a person learn a recognizable song on piano. The quality
bar is therefore:

- a clear, continuous melody, primarily in the right hand;
- useful left-hand chords, bass shapes, or practice patterns;
- honest, monotonic difficulty levels that a human can actually play;
- stable rhythm, tempo, and bar alignment for metronome practice; and
- source provenance that lets us diagnose, reproduce, and repair a result.

When literal source fidelity conflicts with learnability, learnability wins.

## Current baseline (freshly checked)

- Repository: `main` at `a597ddd`; source tree was clean after restoring the
  SQLite runtime sidecar touched by the read-only audit. The working tree now
  contains only the planning documents named at the top of this file; no
  source or catalogue artifacts have been changed.
- Catalogue: 426 database bases / 2,556 rows / six artifact levels per base;
  388 standard bases and 38 YouTube bases.
- Manifest: 153 entries, 149 enabled and 4 explicitly disabled.
- Quality report: 308 healthy bases, 2 YouTube bases needing source
  re-import, 2 YouTube bases needing manual musical repair, and 116 standard
  bases needing manual musical review.
- `npm run verify-catalog`: 0 failures, 2 data warnings (both
  advanced/medium note-count equality warnings).
- YouTube audit: median tempo 124 BPM, median advanced note count 1,101,
  maximum duration 1.5 beats, maximum simultaneity 6, and median 1/16-grid
  coverage 49.4%. Only one reference match is currently found by the heuristic
  matcher, so accuracy is not yet a trustworthy catalogue-wide claim.

Historical Dear God work remains an important diagnostic example: a lossy
1,150-note seed could not be repaired by downstream cleanup, while a fuller
audio-aligned source restored omitted attacks. Its numbers are evidence for
source preservation, not universal thresholds for every song.

## What the pasted suggestions mean for this codebase

### Already implemented or substantially present

- Basic Pitch worker, configurable onset/frame thresholds, tempo detection,
  duration guard, audio-onset filtering, and leading-silence trimming.
- Source-aware cleanup, adaptive/tempo-aware sustain limits, quantization,
  piano-range normalization, pad-aware melody selection, and playable density
  caps.
- Six difficulty variants, hand labels/splitting, learner-profile shaping,
  rhythmic medium reduction, chord/bass simplification, provenance in
  `notes.json`, and round-trip/artifact validation.
- Atomic job claiming, retries, orphan requeue, timeout configuration,
  metadata editing, in-place re-transcription, deletion, `.mxl` parsing, and
  job retry/delete UI.
- Falling-view range expansion to avoid silently dropping notes outside a
  narrow measure window.

### Good ideas, but experiments are required first

- Demucs/Spleeter separation, high-pass filtering, and input normalization:
  potentially useful, but they can remove bass or piano harmonics and add
  model/runtime/storage cost. No default change until raw-vs-preprocessed A/B
  evidence exists.
- More Basic Pitch knobs (`minimum_note_length`, frequency bounds, melodia):
  expose them behind configuration after verifying the installed CLI and add
  fixture tests; do not globally disable melodia or change defaults by guess.
- Confidence filtering and velocity remapping: the current MIDI path does not
  retain explicit model confidence, and global dynamic remapping could destroy
  useful expression. Preserve diagnostic metadata first; only promote a gate
  after metric and listening wins.
- Tempo octave correction, tempo maps, repeat compression, and rubato: useful
  later, but the current player and schema are scalar-BPM based. First make
  fixed-tempo detection measurable and safely overridable.
- Automatic fingering and community MusicXML/MuseScore acquisition: optional
  learner features requiring separate provenance/rights and human review.

## New symptom-driven diagnosis

### Current Basic Pitch setup

The worker uses Basic Pitch `0.3.0` with these inference arguments:

| Parameter | Basic Pitch default | Keyspilli current |
|-----------|---------------------|-------------------|
| onset threshold | `0.50` | `0.65` |
| frame threshold | `0.30` | `0.45` |
| minimum note length | `127.7 ms` | unchanged |
| minimum/maximum frequency | unrestricted | unrestricted |
| Melodia trick | enabled | enabled |
| MIDI tempo | `120 BPM` | detected tempo, unless overridden |

The tuned thresholds are configured by `KEYSPILLI_ONSET` and
`KEYSPILLI_FRAME`. Production uses ONNX; local development uses CoreML when
requested. There is currently no Demucs step, high-pass/level normalization,
frequency bound, segment-aware parameter switching, or confidence gate.

The later cleanup is separate from Basic Pitch inference: audio-onset matching
within `0.15s`, minimum velocity `30`, minimum duration `0.14` beats, attack
polyphony cap `6`, sounding-note cap `8`, and a tempo-aware sustain ceiling.
Because the onset filter only checks whether an attack exists in the mix, a
percussion transient can still survive if it aligns with a detected onset.

### What the reported sounds imply

- “Bob bob” in the left hand is consistent with low-frequency bass/kick
  harmonics surviving the unrestricted input and then being assigned by the
  learner hand split. This is a source-conditioning/voice-assignment problem,
  not something a duration cap can reliably repair.
- Fast “bip bop” notes are consistent with percussion/broadband transients.
  A minimum-note-length or confidence experiment may help, but a global filter
  can also delete real grace notes and short melody attacks.
- A clean intro followed by a messy full-band section is a strong signal for a
  raw-vs-separated and segment-density experiment. It does not yet prove that
  Demucs will improve every song.

### Chord-mode boundary

There is no runtime Ultimate Guitar scraper in the current implementation.
The repository has one manually curated UG timeline (`Your Song`) and a
MIDI-derived fallback for the rest of the catalogue. The verifier currently
resolves 426/426 bases: one chart, 425 generated fallbacks, and two empty
timelines.

The known failure is therefore downstream of scraping: the curated chart is
only an opening-section artifact, the player fills the remainder with
generated events, and fallback events/voicings have had timing and synthesis
problems (missing durations, default spans, collapsed inversions/registers,
and low-register chord synthesis). The next chord-mode lane should first
separate chart coverage from fallback coverage, preserve authored voicings,
derive honest durations, and test smooth voice leading. A scraper or mobile
UG API should be a separate acquisition project, not assumed to be the current
failure.

More specifically, chord mode is metadata plus Web Audio synthesis, not a
separate chord-MIDI generation job. `chordsAt()` intentionally drops short
notes, dyads it cannot label, unsupported symbols, and runs shorter than one
beat. The selected song level is currently used for generated fallback, so
beginner/very-beginner variants often have empty generated chord arrays even
when advanced has usable material. Generated events without explicit durations
fall back to a 1.2-second audio span, which creates gaps when chord changes are
farther apart. These are the first concrete defects to measure and fix.

### Review of the pasted refactoring proposal

The proposed `extractChords -> simplifyChord -> voiceChord` split is the right
architecture, with two safeguards:

- Extraction should use the fullest canonical/advanced transcription and keep
  ambiguity/confidence metadata. It should not rewrite raw notes or invent a
  confident chord merely because a dyad is incomplete.
- “Carry the previous root,” dyad completion, nearest-symbol mapping, and
  sub-beat extension should be learner-timeline fallbacks, visibly marked as
  inferred. They must not be treated as source truth or used to overwrite
  provenance.

The first safe chord slice is therefore:

1. Extract harmonic candidates once from the fullest canonical source,
   independent of the selected difficulty level. The canonical candidate keeps
   root, quality, bass/inversion, duration, ambiguity, and provenance—not a
   final playable note array.
2. Project/simplify that candidate separately for each level (root/root+fifth,
   triad, or full voicing), so a beginner chord never inherits an advanced
   variant's dense or out-of-range notes. Preserve a source/inferred label on
   the projection.
3. Fill partial-chart fallback durations from the next event or song end,
   rather than the fixed 1.2-second default.
4. Pass explicit MIDI note arrays through the player when present; use symbol
   reconstruction only as a last resort.
5. Add tests for lower-level fallback, partial chart coverage, duration gaps,
   inversions, and empty-timeline diagnostics.

Before changing the event shape, perform a compatibility audit. `chordsAt()`
itself currently has one direct call site (inside `buildVariants()`), but its
`ChordLabel[]` output is serialized into variants and consumed by catalog API
normalization, `dedupeChords()`, the player engine, ChordStrip, Beginner View,
Lead Sheet View, and their tests. Preserve optional fields during dedupe and
normalization, and add a migration test for old `notes.json` without the new
metadata.

The audio handoff must be changed as one contract, not one file at a time. The
current `AudioLike.playChord()` accepts pitch classes plus a bass MIDI note;
`PlaybackEngine` reduces absolute chord notes to that shape, and
`AudioEngine` reconstructs a compact register. To preserve inversions, use an
explicit-MIDI-note method and update the engine, audio implementation, test
double, and regression tests together. The first slice must define sorting,
exact duplicate handling, transpose location, duration, seek/start behavior,
and global stop semantics. Do not promise same-slot/per-voice cancellation
until the contract has a voice or scheduling identity; keep the legacy
pitch-class adapter explicit and temporary while old artifacts remain readable.

The repository evidence is stronger than a type-name guess: `ChordLabel.notes`
is absolute MIDI everywhere it is produced (including slash-bass and octave
voicings). The lossy boundary is specifically `engine.ts` → `audio.ts`, and
the production handoff has only those two implementations plus the engine test
double. A likely clean contract is `playChord(midiNotes, when, durationSec)`;
test transpose, ordering, inversions, octave doublings, seek/start scheduling,
and duration behavior before changing any persisted artifact.

Event-level inference should be explicit and user-visible. Add optional
`inferred` plus an `inferenceType` enum (for example `dyad-completion`,
`carry-forward-root`, `nearest-symbol`, `subbeat-extension`) to the learner
chord event, while leaving source-chart provenance separate. The player can
render inferred symbols with a dotted treatment, alternate color, and an
accessible label such as “inferred chord.”

Keep the required legacy shape `{ beat, name, notes }` so old `notes.json`
continues to load. Preserve the optional fields explicitly in catalog fallback
normalization, web timeline normalization, chart/generated merging, and any
metadata-remapping helper; those functions currently rebuild event objects and
can silently discard new fields.

### Chord event precedence

The current `dedupeChords()` re-labels every event from its notes, drops
unlabelable events, collapses consecutive same-name runs, and keeps the first
event in each run. It has no explicit precedence for same-onset conflicts.
`normalizeChordTimeline()` has a different same-beat rule (the last event wins),
so ordering can currently decide whether authored or fallback data survives.

Introduce an explicit authority rank for event-level merges:

1. authored/chart;
2. inferred learner fallback;
3. generated MIDI-derived fallback.

When events overlap or share an onset, resolve authority before voicing
richness: an authored symbol with no playable notes still suppresses a
generated fallback over its duration. Within the selected rank, prefer an
explicit non-empty voicing, then apply a source-aware richness rule (fewer
notes for generated learner safety; more notes for authored/inferred fidelity),
then longer duration, and finally a canonical event fingerprint. Never use
array arrival order as the final tie-breaker. Preserve the selected event's
`name`, `notes`, `inferred`, `inferenceType`, duration, and source metadata.
Add regression cases for authored-vs-inferred, inferred-vs-generated,
same-onset conflicting inference types, inversion differences, and partial
chart overlap.

Make run compaction concrete rather than comparing only the display name. A
normalized run key should contain `sourceKind`, root pitch class, chord quality,
and inversion/bass pitch class. Source rank, root, quality, and inversion are
material differences and must break a run. Note ordering and octave doublings
are not material; compare a normalized pitch-class view but preserve the
winning event's original absolute `notes` array. This prevents generated
voicing variation from producing chord spam while still exposing a real
harmonic or provenance change.

For same-rank ties, use a permutation-stable `eventFingerprint` built from
canonical beat/duration formatting, source kind, name, and sorted absolute MIDI
notes. The complete order is: authority context; explicit non-empty notes;
fewer notes for generated events or more notes for authored/inferred events;
longer duration; then the fingerprint. Property tests must feed shuffled event
arrays and require identical output. The fingerprint is a tie-breaker, not a
replacement for source authority or the material run key.

Classify missing `sourceKind` at the legacy boundary rather than assigning one
universal rank: a checked-in/curated chart event is `authored`, an old
MIDI-derived `notes.json` event is `generated`, and genuinely ambiguous input
is `unknown`. `unknown` is not an authority rank; it is treated as generated
only when an explicit resolver context requires a deterministic fallback, and
the loader records that ambiguity for investigation. A direct normalizer call
with no context may preserve `unknown` rather than guessing.

The primary accessible UI surface should be ChordStrip: amber/dotted inferred
symbols, `data-inferred`, and an aria label naming the inference type. Beginner
View, Lead Sheet View, FallingCanvas, and exported simplified scores should
carry a lighter visual marker; Settings should explain the legend. Add tests
for metadata round-tripping, legacy events without metadata, chart events that
remain authoritative, and dedupe retaining the selected event's metadata.

Demucs remains the likely high-value experiment for full-mix failures, but it
should follow the failure-localization baseline. Verify the selected model's
actual stem names, CPU/storage cost, and piano/bass retention before adding it
to Docker or making it the default. A spectral-centroid filter and harmonic
suppression rule should remain diagnostic experiments; bright piano and real
bass/chord tones can trigger both heuristics.

### Scope guard for `buildVariants()`

`buildVariants()` currently owns source sanitization, hand splitting, six-level
reduction, ladder enforcement, scores, chord extraction, and measure metadata.
For this pass, extract the chord-candidate generation and per-level chord
simplification seam without rewriting the entire arrangement builder. First
prove the level-independent source and precedence rules through `buildVariants()`
regression tests; split broader arrangement stages only if the seam remains
unreadable after the chord change.

### Adjacent checks worth doing in the same pass

- **Synthesis:** note playback already uses an exponential velocity curve and
  sustain-pedal tail. Chord playback currently uses fixed per-note gain and
  compact-register reconstruction, so explicit-MIDI handoff should be fixed
  first; chord-specific doubled-note attenuation/panning is a separate audio
  acceptance experiment.
- **Exports:** MIDI/XML export returns the stored arrangement artifacts built
  from `Variant.notes`; it does not export the synthetic chord-mode background.
  Verify explicit arrangement voicings survive round-trip, and treat chord-mode
  export as a separate feature. The learner score renders `data.chords` and
  should receive the same inferred marker/legend as the player.
- **Tempo/provenance storage:** use resolve-once/store-once semantics at the
  artifact boundary. The canonical runtime value should live in one shared
  base-level artifact manifest at `data/artifacts/<baseId>/manifest.json`, not
  in the repository's top-level `catalog/manifest.json`: that file is a
  source/acquisition manifest and is not loaded by the player API. A single
  base-level manifest prevents six difficulty variants from acquiring six
  nominally different tempo resolutions. Keep `notes.json.tempoBpm` and the DB
  `tempo` column as denormalized playback/index mirrors, and verify they equal
  the manifest's playback BPM. Calibration BPM is provenance for the beat-space
  conversion, not a second runtime mirror. The existing per-variant
  `provenance` block should carry both role-tagged values plus the versioned
  transcription configuration (Basic Pitch version, thresholds, audio
  conditioning, and post-processing values), but it is diagnostic metadata,
  not a second authority.

  ```ts
  type TempoRole = "source-calibration" | "playback";

  interface ResolvedTempo {
    bpm: number;
    source: TempoSource | "legacy" | "manual";
    resolvedAt: string;        // role determination/change time
    role: TempoRole;
  }

  interface ArrangementManifest {
    schemaVersion: 1;
    baseId: string;
    identityStatus: "legacy-bootstrap" | "current" | "migrated";
    // legacy-bootstrap = first manifest from existing artifacts;
    // current = new transcription/reingest with full provenance;
    // migrated = legacy material explicitly re-transcribed or migrated.
    // source/config identity is required for current/migrated artifacts.
    sourceArtifactHash?: string;
    configFingerprint?: string;
    arrangementProfile?: string;
    tempo: {
      calibration: ResolvedTempo; // immutable; defines beat coordinates
      playback: ResolvedTempo;    // learner-adjustable; defines scheduling
    };
    artifactWrittenAt: string;     // when the artifact set was published
  }
  ```

- **Manifest commit contract:** all artifact writers must call one shared
  `publishBaseArtifact(baseId, writer)` protocol. It acquires a per-base lock,
  stages all six variant directories and the base manifest under a temporary
  root, writes every `notes.json`, MIDI, and XML file first, writes
  `manifest.json` last as the staged-set commit marker, then atomically swaps
  the complete staged root into `data/artifacts/<baseId>/`. The protocol keeps
  `.new`/`.old` recovery states explicit, detects stale locks, and leaves the
  previous complete tree readable until the new tree is committed.
  `ingestSource`, `song-update.ts`, and `repair-artifacts.ts` must all use it; a
  manifest commit marker is not sufficient if a writer bypasses the protocol.
  DB replacement happens after the filesystem swap, and `verify-catalog
  --repair` is the explicit DB-reconciliation path.

- **Partial-set read rules:**
  - manifest missing, selected `notes.json` present: permit an explicit legacy
    migration/read mode from that level's `notes.json.tempoBpm`, never consult
    another level's tempo, and do not silently claim reproducibility;
  - manifest present, selected level missing: the selected level is unavailable
    and must not borrow another level's notes or tempo;
  - manifest and notes both present but `tempoBpm` differs from playback BPM:
    mark the artifact set invalid/unavailable at runtime rather than serving a
    silently divergent arrangement; `verify-catalog` fails until every level,
    DB row, MIDI tempo, and MusicXML metronome tempo is repaired. A diagnostic
    reader may show the manifest value, but normal playback must fail closed;
  - manifest present but malformed or missing tempo: treat the artifact set as
    incomplete rather than silently falling back.
  - a present manifest with `identityStatus: "current"` or `"migrated"` must
    contain the source/config identity fields; only an explicitly marked
    `"legacy-bootstrap"` manifest may omit them. Missing or unsupported status
    is malformed and fails closed. Verification should report counts by status
    so bootstrap provenance cannot disappear silently.

- **Legacy manifest bootstrap:** before writing a first manifest, verify all six
  `notes.json.tempoBpm` values, the DB rows, and the embedded MIDI/XML tempo
  metadata agree. If they do, preserve every existing beat, duration, and
  measure coordinate and initialize both `tempo.calibration` and
  `tempo.playback` from that validated current tempo. Mark calibration as
  `source: "legacy"` (the original detection timestamp is unknowable) and
  record the migration/publish time separately as `artifactWrittenAt`; never
  pretend that the migration timestamp is when the source tempo was detected.
  If levels disagree, fail the migration and route the base to repair instead
  of choosing the advanced level. New source-calibration work may rescale raw
  Basic Pitch coordinates before publication, but that is a rebuild operation,
  not a first-manifest migration.
- **Full-pipeline fixture:** add one synthetic fixture that runs generated
  candidates through simplification, precedence/normalization, engine handoff,
  and a fake audio surface, asserting the final absolute MIDI notes. This
  complements unit tests at each layer and catches contract drift.

- **Tempo authority:** resolve once at the ingestion/rebuild boundary, but keep
  two explicit roles. `calibration` is the source/audio tempo used for
  Basic Pitch MIDI rewriting, `filterTranscription()`, cleanup, beat-relative
  duration/merge windows, `buildVariants()`, and chord duration filling. It is
  immutable after publish because changing it can change beat coordinates.
  `playback` is the learner-adjustable tempo used only for seconds-per-beat,
  scheduling, metronome, seek, and practice speed; changing it must not rewrite
  canonical beat coordinates. New artifacts default playback to calibration.
  A source-calibration correction may rescale/rebuild raw audio-aligned beats,
  while a learner playback edit changes only the manifest playback value and
  playback mirrors. Existing artifacts are not re-timed during manifest
  bootstrap (see below). Pass the same role-tagged values through the pipeline
  and write them into the shared manifest; runtime consumers do not resolve
  tempo again. `resolvedAt` means role determination/change time, while
  `artifactWrittenAt` changes on every atomic publish. Add separate tests for
  calibration rescaling (notes, chord beats/durations, measures) and playback
  edits (no beat-space changes). The runtime mirror invariant is:
  `manifest.tempo.playback.bpm = notes.json.tempoBpm = DB tempo = MIDI/XML
  tempo = SongData.tempoBpm`.

- **Tempo-edit rollout:** choose a one-time learner-facing notice, not a silent
  behavior change and not a long-lived compatibility flag. The notice should
  say that tempo edits now change playback speed while preserving the
  arrangement's beat coordinates; the source-calibration/rebuild action is a
  separate maintainer operation. Keep the existing `tempo` API field as a
  backward-compatible alias for playback tempo during the migration, but make
  the new internal/API contract explicit with `playbackTempo` and
  `calibrationTempo` names where the caller needs to choose a role. Return the
  effective role in the update response so older clients cannot mistake a
  playback edit for source recalibration. The existing `/youtube` maintainer
  editor must likewise expose an explicit calibration/rebuild action rather
  than silently treating an operator's source correction as learner playback.
  Persist the notice acknowledgement in UI state keyed by the
  tempo-semantics version, not in the artifact manifest.
  Add an API/UI regression test proving that a legacy-bootstrap arrangement
  retains note/chord/measure beats after a playback edit and that a deliberate
  calibration rebuild is the only path allowed to rescale them.

- **Hand separation scope:** hand labeling is not missing from the model.
  `Note.hand` and the existing split/rebalance path already represent `R`/`L`,
  with `undefined` meaning unassigned. Do not add a second hand contract to
  the chord migration. Evaluate melody continuity, crossings, LH usefulness,
  and balance in Phase 3, and add an explicit `unassigned` representation only
  if the learner UI needs to distinguish it from legacy missing labels.

- **Transcription cache/version gate:** keep cache invalidation out of the
  first chord slice, but add it to the reproducibility phase. The effective
  fingerprint must include the canonical source-audio/content hash, Basic Pitch
  version plus model serialization/weights/backend, every effective inference
  parameter (including onset/frame and onset-match windows), cleanup and
  duration limits, preprocessing/Demucs policy, chord grid/extraction policy,
  normalizer/dedupe version, arrangement profile/range normalization, and
  variant-policy version. Include calibration tempo whenever it can alter beat
  coordinates or cleanup. Exclude playback tempo because it is scheduling-only.
  A separate arrangement/edit revision or patch layer is required for manual
  chord edits; a transcription fingerprint alone must not permit re-ingest to
  overwrite learner edits. On artifact load, compare stored metadata with the
  current pipeline and flag stale artifacts for targeted re-transcription
  rather than rebuilding during an ordinary API read. Preserve the raw source
  and prior artifact while the replacement is staged.

## Phased work plan

### Phase 0 — Freeze the baseline and define acceptance

Deliverables:

1. Replace heuristic-only reference matching with an explicit fixture manifest
   for at least five representative songs (solo piano, dense chords, melodic,
   slow/pedal-heavy, and one known failure).
2. Extend `audit-transcriptions.ts` to emit a reproducible JSON report with
   source/provenance, tempo, note-duration quantiles, onset alignment, density,
   pitch range, velocity variance, hand balance, variant consistency, and
   reference comparison where available.
3. Add a failure-localization fixture that preserves and compares each stage:
   `audio -> raw Basic Pitch MIDI -> audio-onset filter -> cleanTranscription
   -> buildVariants`. Report low-register density, short-note density, onset
   timing, and melody continuity per section so we can identify whether a
   symptom is introduced by inference or retained by cleanup.
4. Record baseline output and update ADR 0002 with the explicit non-claims:
   structural checks are not listening acceptance; current reference coverage
   is incomplete; tempo flags are diagnostic only.
5. Add a short human-review rubric: melody recognizability, LH usefulness,
   hand balance, rhythm/bar alignment, wrong-note severity, and playability at
   normal and 70% practice speed. Fix score anchors with example recordings,
   collect at least two independent listeners (or documented consensus), and
   record disagreement/uncertainty rather than relying on an average alone.

Exit gate: the same command produces the same baseline metrics, and every
future pipeline experiment can be compared against it.

### Phase 1 — Make source handling reproducible and provenance-complete

Deliverables:

1. Define persisted stages for raw audio, raw Basic Pitch MIDI, optional
   preprocessed audio, onset-filtered MIDI, cleaned canonical notes, and six
   generated variants. Preserve checksums and non-secret configuration in
   provenance metadata.
2. Pin and record the exact Basic Pitch version and effective CLI parameters;
   the current Docker install is not version-pinned even though the local
   environment is `0.3.0`.
3. Unify worker, restore, re-transcribe, and re-ingest scripts behind one
   source-aware pipeline so they cannot drift in filtering, tempo scaling, or
   cleanup order.
4. Implement and test the shared `publishBaseArtifact()` lock/staging/swap
   protocol for ingestion, metadata edits, and repair scripts. Exercise crash
   recovery for `.new`, `.old`, missing canonical roots, stale locks, and a
   filesystem-success/DB-stale state; do not auto-repair on ordinary reads.
5. Add regression tests for idempotence, stable base IDs, curated-source
   protection, and “raw source is never overwritten by a derived variant.”
6. Add a dry-run plan that shows which bases would be replaced and why before
   any catalogue rebuild.

Exit gate: two consecutive dry runs agree, a real re-ingest is repeatable, and
curated YouTube material cannot be overwritten by a later generic pass.

### Phase 2 — Controlled transcription experiments

Run experiments on the Phase 0 fixtures, keeping the current pipeline as the
control:

1. Basic Pitch parameter sweep: onset/frame, minimum note length, piano-range
   frequency bounds, and melodia mode where supported. Test low-cost parameter
   changes before adding a separation model; Basic Pitch's minimum-note-length
   unit is milliseconds (`120`, not `0.12`, for a 120ms experiment).
2. Audio conditioning A/B: raw, level-normalized, high-pass only, and Demucs
   separated. Measure wall time, storage, pitch/onset coverage, false-note
   rate, note-density shape, bass retention, and human listening score.
3. Confidence path design: determine whether Basic Pitch probabilities can be
   retained as a sidecar/NPZ or whether a different inference API is needed.
   Do not add a `confidence > threshold` production rule until the inference
   path actually emits confidence values and the fixture contract defines what
   they mean.
4. Tempo robustness: compare multiple hop lengths/onset hypotheses and flag
   likely 2x/0.5x errors, retaining `KEYSPILLI_TEMPO_OVERRIDE` as an explicit
   escape hatch.

5. Add a symptom fixture set containing a sparse intro, a full-band entry, a
   bass-heavy section, and a percussion-heavy section. Compare raw audio,
   level-normalized/high-pass variants, and Demucs-separated variants before
   choosing defaults.

6. Keep segment-aware transcription after the raw/threshold/conditioning
   experiments. If it wins, design overlap, attack deduplication, and boundary
   continuity explicitly before enabling it.

7. Treat harmonic “drop the lower note” rules as a diagnostic experiment only;
   they can remove legitimate bass or chord tones. The immediate gap is
   confidence/provenance diagnostics, not another unconditional hard filter.

Promotion rule: a change becomes the default only when it improves both the
structural metrics and the human-review rubric without regressing source
coverage, runtime, or provenance. Require no critical-canary regression in
melody recognizability or wrong-note severity; a positive fixture mean cannot
hide a failure in a mandatory canary.

### Phase 3 — Learning arrangement quality

1. Evaluate hand splitting with melody continuity, RH/LH balance, crossing
   count, LH usefulness, and playable sounding-note density—not pitch split
   alone.
2. Strengthen the six-level ladder so note subsets, density, rhythmic
   simplification, and difficulty scores remain monotonic without flattening
   legitimate dynamics.
3. Validate chord labels and simplified bass patterns against representative
   learner arrangements; keep chart provenance separate from generated MIDI
   fallback provenance.
4. Add a catalogue-wide report of “recognizable melody,” “useful LH,” and
   “unplayable texture” candidates for human triage.

5. Run the chord-mode repair lane independently: chart/fallback coverage
   labels, authored voicing preservation, beat-derived durations, smooth
   voice-leading, and learner-safe generated fallback. Do not conflate this
   with UG scraping success.

6. Add a chord diagnostic before changing behavior: source map/artifact parse,
   timeline event count and coverage, chord-symbol parseability, generated MIDI
   validity/beat alignment, and player scheduling input. The two currently
   empty generated timelines are `zelda-ocarina-of-time-temple-of-time` and
   `o-comeau-ellen-s-song`; investigate their short-note/dyad filtering before
   adding any scraper.

7. Grep and test every `ChordLabel` consumer before publishing the new event
   shape. The UI must expose inferred status rather than silently presenting a
   guess as authoritative.

Exit gate: no variant passes structural publication while violating hard
playability limits, and a sampled set passes the listening rubric at all user-
facing levels.

### Phase 4 — Practice structure

1. Establish reliable bar/downbeat alignment before adding automatic sections.
2. Add `sections`/loop metadata first for curated or manually reviewed songs;
   then evaluate rest/harmony-based phrase detection.
3. Add optional practice annotations (repeat targets, chord labels, tempo
   targets) as sidecars so core MIDI remains lossless.
4. Defer automatic fingering, tempo maps, and repeat compression until the
   timing model and human review process can validate them.

### Phase 5 — Rebuild, release, and operate

1. Dry-run the full catalogue; re-ingest the two currently flagged YouTube
   bases first, then review the two warning cases before broad replacement.
2. Run structural artifact checks, DB/catalog checks, API checks, player checks,
   and explicit listening checks as separate release gates.
3. Deploy only after immutable-image/version, disk-headroom, rebuild sentinel,
   and rollback checks pass.
4. Publish a report with before/after metrics, reviewed songs, unresolved
   blockers, and explicit non-claims.

## First implementation slice

Phase 0 remains the first operational gate: freeze the fixture baseline and
human-review rubric before changing transcription defaults or rebuilding the
catalogue. The first code slice after that baseline is the **chord event
contract and normalization migration**, not an isolated engine/audio rewrite:

1. Add the optional chord metadata (`durationBeats`, `inferred`,
   `inferenceType`) and an internal/serialized `sourceKind` that can express
   `authored`, `inferred`, `generated`, and `unknown`.
2. Add a shared artifact compatibility loader with source context. A missing
   event field in a curated/chart artifact is stamped `"authored"`; a missing
   field in an old MIDI-derived generated artifact is stamped `"generated"`;
   genuinely ambiguous external/test input is stamped `"unknown"` and logged.
   The projection and serialization code must never use
   `sourceKind ?? "generated"`; genuinely generated events must be marked at
   their creation boundary. A direct normalizer call without origin context
   may preserve `unknown` rather than inventing authority.
3. Define the normalized chord projection explicitly. The generated fallback
   and every catalog/API/web normalizer must emit this shape:

   ```ts
   interface NormalizedChordEvent {
     beat: number;
     durationBeats: number;
     name: string;
     // `[]` is valid for a display-only/unvoiced authored symbol. The player
     // skips audio for an empty array; voicing inference may attach notes later.
     notes: number[];
     sourceKind: "authored" | "inferred" | "generated" | "unknown";
     inferred?: boolean;
     inferenceType?: ChordInferenceType;
   }
   ```

   Legacy input may omit the optional fields, but the loader assigns the
   source-aware `sourceKind` described above and preserves the original event
   otherwise. An authored symbol with empty notes remains visible and
   suppresses generated fallback within its duration; if a voicing can be
   inferred, attach it as `inferred: true`/`inferenceType: "voicing"` without
   changing the authored label authority.
4. Add one precedence-preserving resolver for same-onset/overlapping events,
   then update catalog timeline parsing, the `chord-timeline.ts:368` generated
   projection, `apps/web/src/lib/catalog-api.ts`, and web timeline
   normalization to preserve events wholesale. `catalog-api.ts` is a required
   migration boundary, not a follow-up.
5. Refactor `dedupeChords()` to use the explicit authority rank and the
   material-difference run key. Add characterization tests before changing
   behavior, including authored/inferred/generated conflicts, inversions,
   octave doublings, reordered notes, and legacy artifacts.
6. In the same migration, add the two-role tempo-authority tests and split
   `song-update.ts`: source-calibration changes may rescale beat-space notes,
   chord starts/durations, and measures before a rebuild; playback edits must
   leave all beat-space coordinates unchanged. Preserve `tempo` as a
   backward-compatible playback alias while introducing explicit role-aware
   inputs and the one-time UI notice; no consumer should independently select
   detected, manifest, or MIDI tempo after this point.
7. Narrow the first audio contract to the behavior we can implement and test:
   `playChord(midiNotes: number[], when: number, durationSec: number)`, with
   explicit sorting, exact-duplicate policy, transpose location, stop/seek
   behavior, and no unimplemented per-voice cancellation promise. A legacy
   pitch-class adapter may remain explicit and temporary. Only after metadata
   and tempo paths are green, update `PlaybackEngine`, `AudioEngine`, the fake
   audio adapter, and tests together.

This order prevents the API from stripping inference metadata, prevents a
tempo mismatch from masquerading as a chord-timing bug, and ensures the audio
handoff receives the same authoritative event that the UI and catalog chose.

## Release gates (must remain separate)

1. **Source gate:** source is present, checksummed, and provenance is intact.
2. **Structural gate:** MIDI/XML round-trip, valid notes, ladder, and
   playability checks pass.
3. **Musical gate:** human playback/listening confirms melody, LH usefulness,
   rhythm, balance, and playability.
4. **Runtime gate:** rebuild is idempotent, DB/API/player behavior is correct,
   and deployment/rollback evidence exists.

Passing one gate must never be reported as passing the others.
