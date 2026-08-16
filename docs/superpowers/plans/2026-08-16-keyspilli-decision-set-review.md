# Keyspilli decision-set review

Status: debate required before implementation (2026-08-16)

The pasted decision set answers the 20 frontier-review questions. Most
decisions are directionally correct, but the following points conflict with
current repository behavior or need a sharper contract.

## Adopt with no substantive objection

- Scalar BPM is an explicit scope boundary; tempo maps and rubato preservation
  remain later work.
- A shared base artifact manifest is the runtime authority.
- The complete base artifact tree is the publication unit.
- Missing levels are unavailable rather than borrowing another level.
- sourceKind describes the event; inferred describes a label/voicing decision.
- Canonical chord extraction comes from the fullest source and simplifies per
  learner level.
- Existing Note.hand plus undefined-as-unassigned remains sufficient for this
  slice.
- A 10-song transcription fixture set and separate human musical gate are
  appropriate.

## Decisions requiring revision or debate

### A. Manifest identity is incomplete

baseId + configFingerprint does not identify the input arrangement if the
source audio/MIDI changes while the slug and processing config remain the same.
Add sourceArtifactHash (and arrangement-profile/grid/limit inputs) to the
manifest identity. Keep configFingerprint as the processing identity, not the
whole artifact identity.

### B. Tempo override has two different meanings

The pasted answer says overrides preserve beat coordinates, but current
transcription/reingest paths rescale Basic Pitch beats to preserve audio wall
clock, while apps/web/src/lib/song-update.ts rescales stored note and chord
beats on manual tempo edits.

Separate:

1. source calibration tempo, used before onset filtering and ingestion; and
2. learner playback tempo, which should normally change seconds-per-beat without
   rewriting canonical beat coordinates.

Do not implement one global override rule until this distinction is explicit.

### C. Atomicity must include every writer

ingestSource already stages the base root, but song-update.ts writes each level
directly and repair-artifacts.ts swaps files individually. The manifest commit
marker is insufficient unless those writers use the same lock/staging/recovery
protocol.

Required decisions: lock ownership, stale-lock recovery, crash states, DB-stale
behavior, and whether runtime reads tolerate a new tree with old SQLite rows.

### D. unknown cannot safely be one universal precedence rank

authored > inferred > unknown > generated protects legacy curated data, but it
also promotes legacy generated events when provenance is absent. Prefer
source-aware legacy classification:

- old checked-in chart timeline -> authored;
- old generated notes.json chords -> generated;
- genuinely ambiguous external input -> unknown.

If that context is unavailable, unknown should not silently outrank generated;
the resolver should require an explicit authority context or preserve the
existing event without merging.

### E. Determinism conflicts with stable input order

Sorting by beat/rank/note-count/duration and then using stable input order does
not guarantee permutation stability when all preceding keys tie. Use a
canonical event fingerprint/serialized tie-breaker, or preserve an explicit
source ordinal that is itself stable. Add property tests over shuffled inputs.

Also validate whether richer voicing should prefer more notes: it may select a
melody doubling or muddy generated cluster over a cleaner learner voicing.

### F. The audio cancellation rule is underspecified

“A new playChord at the same time cancels pending notes for that voice” has no
voice identity in the current AudioLike contract and could cancel legitimate
overlapping chart/fallback events. Define whether cancellation is global,
per-scheduled-event, or only performed by stop/seek. Preserve duplicate MIDI
notes only when they represent distinct octaves; collapse exact duplicate
MIDI numbers.

### G. Cache exclusion of tempo needs the calibration split

Resolved playback tempo can stay outside the transcription fingerprint only if
it never changes beat coordinates. Source calibration tempo must be included
directly or via a calibration hash whenever it changes the audio-aligned beat
timeline.

Add source hash, arrangement profile, grid, duration limits, model
serialization/weights identity, and variant-policy version to the fingerprint.

### H. Unknown UI should not look fully authored

Gray/no-alarm treatment for unknown provenance may imply authority to a learner.
At minimum expose “provenance unknown” in accessible text and exports; decide
whether the visual treatment is a subtle question mark/dotted style or a quiet
gray warning.

### I. Promotion thresholds need rater and regression rules

The 10-song rubric is a good start, but an average score plus “no fixture drops
more than one point” is not enough. Require at least two listeners or repeated
ratings, prohibit regressions in melody recognizability and wrong-note severity,
and report uncertainty rather than treating a small fixture mean as proof.

## Local evidence that must be reconciled

- Tempo rewrite behavior: apps/web/src/lib/song-update.ts:65-128.
- Worker/reingest tempo calibration: services/transcribe/src/worker.ts and
  packages/catalog/scripts/reingest-all-youtube.ts.
- Staged ingest publication: packages/catalog/src/ingest.ts:285-360.
- Direct per-level writes: apps/web/src/lib/song-update.ts and
  packages/catalog/scripts/repair-artifacts.ts.
- Current lossy audio boundary: packages/player-core/src/engine.ts:294-307
  and packages/player-core/src/audio.ts:179-205.
- Current first-in-run dedupe: packages/player-core/src/timeline.ts:58-79.

## Proposed debate order

1. Source-calibration tempo versus learner playback tempo.
2. Legacy unknown classification and precedence.
3. One publication/lock protocol for ingest, metadata edits, and repairs.
4. Canonical deterministic tie-breaker for chord conflicts.
5. Audio event cancellation and generated voiced-chord payload.

## Reconciliation of the second decision set

The second pasted answer set resolves the five debates in the right direction,
with the following implementation contract now fixed.

### Tempo: migrate metadata, not beat coordinates

Use two role-tagged values in the artifact-local base manifest:

```ts
type TempoRole = "source-calibration" | "playback";

interface ResolvedTempo {
  bpm: number;
  source: TempoSource | "legacy" | "manual";
  resolvedAt: string;
  role: TempoRole;
}

interface ArrangementManifest {
  schemaVersion: 1;
  baseId: string;
  identityStatus: "legacy-bootstrap" | "current" | "migrated";
  sourceArtifactHash?: string;
  configFingerprint?: string;
  tempo: {
    calibration: ResolvedTempo;
    playback: ResolvedTempo;
  };
  artifactWrittenAt: string;
}
```

Existing artifacts keep their current beats, durations, and measures. Before a
first manifest write, verify all six `notes.json.tempoBpm` values, DB rows, and
MIDI/XML tempo metadata agree. Initialize both calibration and playback from
that validated current value; mark calibration `legacy` because the original
detection timestamp is not knowable. Do not rescale existing coordinates or
pretend the migration timestamp is the original detection time. If levels
disagree, fail closed and repair rather than selecting an arbitrary level.
The manifest must explicitly mark this exception as `identityStatus:
"legacy-bootstrap"`. New transcriptions/reingests use `"current"`; a legacy
artifact that is explicitly re-transcribed or migrated uses `"migrated"`.
`current` and `migrated` require source/config identity fields, while an
unmarked omission is malformed. Verification should report counts by status.

For new transcription/reingest, calibration may rescale raw audio-aligned
coordinates before artifact publication. A later learner playback edit changes
seconds-per-beat and scheduling only; it does not rewrite canonical beat-space
notes, chord starts/durations, or measures. This requires splitting the current
`song-update.ts` tempo behavior into source-calibration rebuild versus playback
override. The runtime mirror invariant is explicitly:

```text
manifest.tempo.playback.bpm
  = notes.json.tempoBpm
  = DB tempo
  = MIDI/XML tempo
  = SongData.tempoBpm
```

Calibration BPM is provenance and beat-space authority, not a second playback
mirror. Runtime consumers read the manifest and never independently re-resolve
detected, MIDI, or database tempo. The cache includes calibration when it can
change beat coordinates; playback tempo is excluded from the transcription
fingerprint and tracked as an arrangement/artifact revision.

### Tempo-edit rollout choice

Choose the one-time UI notice. Shipping silently would make a material change
to the meaning of an existing tempo edit, while retaining a compatibility flag
would create two tempo semantics and weaken the single-authority contract. The
notice explains that learner tempo edits now change playback speed only and
preserve beat coordinates; source-calibration changes are a separate maintainer
rebuild action. Keep the existing `tempo` request field as a temporary
backward-compatible alias for playback tempo, introduce explicit
`playbackTempo`/`calibrationTempo` names where role selection matters, and
return the effective role in the update response. Key the acknowledgement to a
versioned UI notice, not the artifact manifest. The existing `/youtube`
maintainer editor must expose an explicit calibration/rebuild action rather
than silently treating an operator's source correction as learner playback.
Add a regression test covering legacy-bootstrap load, playback edit with
unchanged beats, and explicit calibration rebuild with rescaled beats.

### Legacy provenance and normalized events

The universal `unknown > generated` ordering is rejected. At the loader
boundary, classify missing event provenance from artifact origin: curated/chart
events become `authored`, old MIDI-derived generated events become `generated`,
and ambiguous imports become `unknown`. `unknown` is not a rank; a deterministic
resolver may treat it as generated only with explicit context and must log the
loss of certainty.

An authored symbol with no playable voicing remains a displayable event with
`notes: []`; it suppresses generated fallback during its span. If parsing can
provide a playable voicing, attach it as inferred (`inferred: true`,
`inferenceType: "voicing"`) without changing the authored label authority.
Every catalog/API/web projection must preserve duration and provenance fields.

### Publication, determinism, and audio scope

`publishBaseArtifact(baseId, writer)` is the only writer path for ingestion,
metadata edits, and repairs. It owns the lock, staging root, `.new`/`.old`
recovery states, manifest-last commit marker, atomic swap, post-swap DB update,
and cleanup. Present-but-malformed manifests and tempo-mismatched sets fail
closed; `verify-catalog --repair` is the explicit DB repair path.

Conflict resolution first chooses source authority, then voicing richness, then
longer duration, then a canonical permutation-stable event fingerprint. For
generated same-rank events prefer fewer notes; for authored/inferred events
preserve richer voicing. Note order and octave doublings do not change the
compaction run key, while source kind, root, quality, and inversion do.

The first audio slice narrows the contract to explicit absolute MIDI notes,
transpose, duration, sorting, exact-duplicate policy, seek/start behavior, and
global stop behavior. It does not promise same-slot/per-voice cancellation
without a voice/scheduling identity. Voicing caps and octave attenuation remain
experiments behind a policy fingerprint.

### Remaining implementation gates

- `tempo.py` currently emits BPM without confidence; do not implement a
  confidence threshold until confidence is persisted and semantically defined.
- New manifests need source-artifact/config fingerprints, model/backend identity,
  all effective inference and cleanup parameters, preprocessing, chord grid,
  normalizer/version, arrangement profile, and variant policy. Manual chord
  edits need a separate arrangement revision or patch layer.
- Human promotion requires fixed score anchors, at least two listeners (or
  documented consensus), uncertainty/disagreement recording, and no critical
  canary regression. Structural checks and listening acceptance remain separate.
