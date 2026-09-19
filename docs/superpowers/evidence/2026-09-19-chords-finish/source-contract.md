# Chord mode source contract — 19 September 2026

## Runtime chain

The source path is:

raw source/artifact → artifact manifest and variant notes.json → catalog API loadSongArtifact → Player source/chord resolution → buildMelodyAccompaniment → ordinary Note stream.

The catalog API constructs sourceFingerprint from the variant identity, manifest sourceArtifactHash, and loaded notes.json hash. This is the correct identity boundary for saved melody choices. A source timing contract must travel through the same boundary and be included in the producer request key.

## Phase and measure rule

Current Variant only carries:

- timeSig: [number, number]
- measures: index/startBeat/endBeat

packages/midi/src/simplify.ts buildMeasures derives measure starts as:

startBeat = index × (timeSig numerator × 4 / denominator)

The five pinned artifacts all begin with MusicXML measure 1, no implicit pickup flag, and an explicit time signature. That is useful descriptive evidence, but it does not prove that beat 0 is an authored downbeat or that a source pickup was absent. The current notes.json measure arrays are arithmetic projections, not independently authored phase records.

Execution fixtures must match the pinned source identity before they are used for current-song acceptance. Compare sourceArtifactHash, note count/end, semantic notes payload, measures, and chord payload separately; do not mix a historical API fixture's enriched metadata or sourceFingerprint with a canonical artifact. A mismatch requires a disposable fixture regenerated from the pinned canonical source or remains an explicit blocker.

Therefore:

- missing phase provenance remains unknown;
- a time-signature tuple alone cannot enable meter-phase sparse support;
- a validated source-measure boundary must be explicit, finite, fingerprinted, and tied to the loaded source artifact;
- invalid signature, nonfinite phase, source mismatch, or unsupported provenance must fail closed to undefined timing;
- unknown sources remain conservative and source-timed.

## Meter-event transport decision

The scalar final `timeSig` field cannot represent Queen's change from 2/4 at beat 0 to 6/8 at beat 12. `MidiTimeSignatureEvent[]` is therefore retained through parser output, variant measure construction, and catalog `notes.json` metadata. The event structure is descriptive transport only: meter declarations do not independently prove pickup or downbeat phase. Only explicit, fingerprinted `sourceTiming` metadata with `source-measure-boundary` provenance may enable sparse backing phase. Queen remains phase-unknown until that evidence exists.

## Target source decisions

### Oops I Did It Again — advanced, 95 BPM

Pinned ID: britney-spears-oops-i-did-it-again-a.

The canonical source is standard MIDI-derived material with source artifact hash 64d18aa4c23f7625a6eb0a7a234843a7a2278003d75cba9ea04efde7d8225ad4. A backup MusicXML exposes staff/voice ownership, but the colors and staff/voice lanes have no semantic melody legend. The frozen runtime payload has no sourceLane or identitySource field. Existing RH candidate notes are hypotheses only. Do not promote right-hand material as automatic melody truth.

Decision: required target; use unknown-phase behavior until a bounded source contract proves phase and melody identity.

### Blackbird — advanced control, 120 BPM

Pinned ID: the-beatles-blackbird-a.

The canonical source is standard MIDI-derived material with source artifact hash 3fc3fd74d567da56dd10ff05689ef2f57641efbbe200532aabc0ea5fbcea1e75. The checked-in complete fixture and the 14–26.5 worksheet provide structural/control evidence. The worksheet intentionally leaves M/B/H/D/R/U labels reviewer-owned and blank; stored L/R is not melody truth.

Decision: required source-timing control; do not infer semantic melody or phase from hand labels or arithmetic measures.

### Somebody To Love — advanced, 108 BPM

Pinned ID: queen-somebody-to-love-a.

The canonical source is standard MIDI-derived material with source artifact hash 4505d3a7cb3c24788e51905eb29a40c501a31f7bd07596d489f63f7430c7a74e. Its declared signature is 6/8 and the arithmetic measure width is 3 quarter-note beats. No checked-in v2 fixture or semantic melody identity contract was found. There is no catalog-authored chord chart.

Decision: required 6/8 target; do not enable 6/8 phase gestures without independently validated source phase.

### Your Song — advanced, 129 BPM, partial chart

Pinned ID: the-theorist-elton-john-your-song-piano-cover-jz6ugvghbt8-a.

The canonical source is YouTube-derived with source artifact hash bcdbb1eef809fbf0bee0824a874e98ad3cea321e44d0d87ed0a9633b72371f0e. The curated UG timeline is sourceId ug-your-song, coverage opening-section, duration 128 beats, and 32 four-beat events. Generated continuation outside authored chart is not equivalent to authored backing or validated harmony.

Decision: partial-coverage target; forbid unsupported synthesized harmony outside the authored chart, but allow evidence-backed source-only reduction where the source path is defensible. Preserve Original only when no safe reduction path is established, and keep authored chart, source-only reduction, generated labels, and notes-derived fallback distinct.

### Hell You Call a Dream — advanced negative control

Pinned ID: aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d-a.

The canonical source is a detected YouTube transcription with source artifact hash 13e9cd2ed273c7bf9f9a8a14a480ae5b8505e52d85eb3cfacdc51d6cb9f3af0a. It has no catalog-authored chord chart and no semantic melody gold. The checked-in fixture is a negative control for unsupported authored chord coverage, not evidence that the song source is absent.

Decision: fallback must stay audible and honest; do not count fallback as successful simplification.

## Melody and harmony constraints

- Source hand, staff, and voice labels are evidence for investigation, not automatic melody truth.
- Generated chord labels from notes.json are not validated harmonic evidence for the selected melody.
- Current policy must keep notes-derived generated harmony label-only unless an event is explicitly authored or an independent chart source is selected.
- Existing protected melody, rest, fallback, and physical-limit logic must remain fail-closed.
- Source repairs, if needed, must preserve the original artifact and be bounded/reviewable; no per-song exception may be added merely to satisfy a test.

## Acceptance boundary

T1 establishes exact IDs, variants, hashes, coverage, and unresolved provenance. It does not establish recognizable melody, useful backing, physical playability, pedal cleanliness, or human listening acceptance. Those require later T3/T7 evidence and separate user review at declared tempos.
