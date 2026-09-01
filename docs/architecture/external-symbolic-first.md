# External symbolic-first evidence architecture

Keyspilli's product target is a recognizable, playable piano arrangement from
an audio submission. Dense-metal audio transcription is useful fallback
evidence, but it is not the default musical authority when a validated
symbolic or piano-derived source is available.

## Evidence classes

Evidence is classified before selection. The classes have an ordered prior,
but validation, identity, role, and alignment confidence can still reject a
higher-prior source:

1. `VERIFIED_NATIVE_SYMBOLIC`
2. `VERIFIED_STRUCTURED_BAND_SYMBOLIC`
3. `PIANO_COVER_SYMBOLIC`
4. `PIANO_COVER_AUDIO`
5. `TAB_OR_CHORD_EVIDENCE`
6. `AUDIO_AMT_FALLBACK`

`BENCHMARK_REFERENCE` is evaluation-only. It can score a frozen generated
result, but it must never enter candidate discovery, ranking, alignment,
fusion, decoding, or arrangement generation.

## Generation boundary

The generation pipeline consumes only candidate records whose provenance
purpose is not `BENCHMARK_REFERENCE`, whose acquisition policy permits local
analysis, and whose source bytes pass strict parsing and identity checks.
Candidate selection is frozen before any benchmark reference is opened. A
candidate-set digest, source hashes, alignment configuration, and arranger
configuration make that boundary reproducible.

Benchmark/reference material may be aligned only after the generated candidate
is frozen, for evaluation diagnostics; it is never part of generation-side
alignment, fusion, decoding, or arrangement construction.

The target recording remains the timing authority. External symbolic sources
are aligned to it per role and section; their tempo maps are not silently
substituted for the recording timeline. Unaligned or ambiguous regions remain
conservative or fall back to `AUDIO_AMT_FALLBACK`.

## Local evaluation commands

The evidence and benchmark modules are intentionally direct local imports, not
production catalog-barrel exports. Run them only with an explicit local
manifest or stage set:

```text
npm run evaluate:external-symbolic -w @keyspilli/catalog -- \
  --manifest /absolute/local/manifest.json \
  --out /absolute/local/report.json

npm run evaluate-red-baron-survival -w @keyspilli/catalog -- \
  --stage raw=/absolute/local/raw.mid \
  --stage decoder=/absolute/local/decoder.mid \
  --stage semantic=/absolute/local/semantic.mid \
  --stage canonical=/absolute/local/canonical.mid \
  --stage easy=/absolute/local/easy.mid \
  --reference /absolute/local/reference.mid \
  --window solo:0:32:0:32
```

Inputs are read in place; commands do not download, upload, copy, or publish
reference material. Reports redact physical paths and omit raw notes/bytes.
Benchmark/reference records are evaluation-only, and automated metrics do not
establish recognizability or human acceptance.

## Role and realization boundary

Full-band symbolic sources are decomposed into semantic melody/lead,
harmony, bass-root, rhythm, and timing-only drum evidence before piano
realization. Direct piano sources use a preservation-oriented path that keeps
their recognizable melody and reduces accompaniment only when necessary for
playability. Easy, Medium, and Advanced are derived after the semantic source
decision and preserve the selected melody/harmony identity.

## Claims boundary

Automated structural, alignment, pitch, onset, harmony, and playability
metrics are diagnostics. Human recognizability and musical usefulness remain a
separate gate requiring at least two raters. A passing parser, alignment, or
CI run is not a claim that an arrangement sounds good.
