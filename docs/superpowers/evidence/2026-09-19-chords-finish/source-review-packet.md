# Queen source-review packet — draft PR #103

This packet separates importer/source evidence from the live Chords producer.
It is a bounded human-review request, not a claim that the musical gate has
passed.

## Review inputs

- `source-candidate-comparison.md` — pinned Queen importer lineage and
  current-versus-candidate structural comparison.
- `audio-candidate-2026-09-19/manifest.json` — exact render boundaries,
  hashes, SoundFont, FluidSynth, FFmpeg, and encoding commands.
- `audio-candidate-2026-09-19/original-full.ogg` — original canonical source
  render.
- `audio-candidate-2026-09-19/replay-full.ogg` — current `parseMidi →
  buildVariants` replay.
- `audio-candidate-2026-09-19/candidate-full.ogg` — raw FF01 `-CANTO-`
  importer candidate, before the player selector.
- The matching `*-diagnostic-18-30-beats.ogg` files isolate the first review
  window at 108 BPM.

All six OGG files are importer/replay artifacts. None is a Chords-producer
render. The candidate's source tag is diagnostic evidence only; it is not a
catalog mutation, Player default, or promoted arrangement.

## Exact review question

At Queen's frozen `108 BPM`, does the raw FF01 `-CANTO-` lane in
`candidate-diagnostic-18-30-beats.ogg` read as the intended melody more
reliably than `replay-diagnostic-18-30-beats.ogg`? For the full render, mark
the exact beat ranges containing:

- missing melody or missing rests/hooks;
- extra notes that should not be melody;
- role conflicts where the same material is more plausibly accompaniment;
- register, phrase-boundary, or onset problems that make the mapping unsafe.

Do not infer the answer from note counts, source labels, RMS, or the existence
of a `-CANTO-` tag. The useful result is a source-role and phrase decision
with beat ranges; “unresolved” is a valid outcome.

## Producer boundary

The disposable live bridge is default-only. Its structural comparison is:

| Replay | Output events | Attacks | Fallback beats | Unresolved spans |
|---|---:|---:|---:|---:|
| Current source | 2128 | 968 | 241.250 | 91 |
| Protected importer candidate | 2186 | 1008 | 289.125 | 104 |

These numbers show that the candidate changes the Chords input texture; they
do not show that it improves the arrangement. The historical player-side
identity-selector experiment was removed after it bypassed normal sounding
trim. There is no live `protectedIdentitySources` selector API in the current
Player or player-core path.

## Response format

1. Source mapping: accept, reject, or unresolved.
2. Exact beat ranges and the reason for each decision.
3. Any lost rest, hook, phrase, register, or role evidence.
4. Separate implication for the Chords producer: promote a constrained source
   rule, retain Original on unresolved spans, or make no automatic change.
