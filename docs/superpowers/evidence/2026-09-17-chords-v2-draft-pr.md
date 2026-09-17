# Draft PR — complete Chords v2 melody, accompaniment, worker, UX, and evaluation gates

Draft only. Do not merge or deploy from this branch. The capture candidate remains frozen at `ea68729045e82ef9ced14e0e0916c86991eeba4a`; follow-up heads `4a71c6910b97dd38e9fc5f3a78104db5a4ef22f6` and `fce18bcbc358a06281813192de95eb56f9f0e878` contain evidence hardening plus the runtime-only generated-harmony source policy. No reserved-output tuning was performed.

## Scope: T2–T8

- **T2 — output accounting and interval semantics:** one derived note stream, explicit fallback/change accounting, deterministic `[midi,start,dur,vel]` event multisets, and no duplicate scheduling.
- **T3 — melody rests and local correction:** explicit rest-aware selection, path continuity across rests, fingerprinted phrase overrides, automatic and right-hand choices, plus local seek/loop/correction/reset behavior.
- **T4 — harmonic/source boundaries:** source provenance and generated/fallback paths are traced, with uncertainty interval splits. The actual seed/YouTube notes-derived path is tested with mixed and selected-LH fixtures; unverified generated harmony is now label-only for Melody + accompaniment, Auto gates support to authored chart events, and explicit UG chart events may retain support. The missing selected-melody identity/source lane remains an explicit source/data-contract limitation; no general exclusion claim is made.
- **T5 — accompaniment and sounding rhythm:** source reduction, sparse harmonic candidates, meter/off-grid/pickup fixtures, source lineage, and coherent-phrase no-resumption policy are covered structurally. Where validated source-measure phase is absent, timing safely falls back to boundary/source timing.
- **T6 — sounding, voicing, velocity, and pedal:** sounding limits, source-linked support trims, bounded voicing candidates, sampler CC64 handling, and velocity policy are implemented and tested as engineering behavior. Musical balance and playability remain human-review questions.
- **T7 — worker, single stream, and persistence:** Original/source view, cancellable worker requests, exact source/chord/options keys, stale-result/error guards, constructor/`postMessage` retry, one derived stream for audio/guidance/grading, and reset handling are covered.
- **T8 — status, audition, and accessibility UX:** concise truthful status, changed versus unchanged/reason-classified already-simple phrase counts, partial/unavailable/missing-chart source states, Full/Melody/Accompaniment audition, same-position A/B, phrase seek/loop, 390px controls, keyboard focus, reset/cross-variant invalidation, unsupported-input Original preservation, and the 200% zoom overflow regression are covered.

## Frozen evidence and verification

All commands used Node 22.22.3 from the isolated worktree:

```text
npm test -w @keyspilli/player-core -- --run  15 files, 231 passed
npm test -w @keyspilli/web -- --run           36 files, 207 passed
npm test -w @keyspilli/midi -- --run          17 files, 397 passed
npm test -w @keyspilli/player-core -- --run test/melody-accompaniment.test.ts
                                                58 passed
npm test -w @keyspilli/web -- --run src/components/player/chord-sources.test.ts
                                                15 passed
npm run typecheck -w @keyspilli/web             passed
npm run build -w @keyspilli/web                passed
npm run e2e:melody-scratch -w @keyspilli/web -- --grep "real artifact produces, previews, plays, corrects, and reloads melody support"
                                                1 passed
npx --no-install playwright test --config=playwright.melody.scratch.config.ts
                                                12 passed, 1 intentional skip, ~6.0 min
e2e/player-ui.spec.ts --grep "practice remains keyboard accessible" \
  --project chromium --repeat-each=8             8/8 repeated locally
```

The existing accessibility assertion was preserved; the 200% failure was fixed at the flex/min-content boundary with `min-width: 0` on the player workspace/chord-details path. Packet integrity also passed from the packet directory with `(cd docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet && shasum -c SHA256SUMS.txt)`. Earlier exact-head CI checks passed with deploy/publish/catalogue jobs skipped as expected for a draft PR; the final exact-head CI run for this follow-up is recorded separately after the current test/docs commit is pushed.

## New runtime-only T4 candidate

The source path is explicit: `buildVariants`/`chordsAt` writes notes-derived harmony to `notes.json.chords`; `chord-timeline.ts` and `catalog-api.ts` expose it as the generated source; `resolveChordSources` normalizes generated events as `sourceKind: "generated"`, explicit UG events as `authored`, and Auto as a mixed event-level timeline. `melodyHarmonicSupportPolicy` maps generated to `none`, Auto to `authored-only`, and explicit UG to `all`. The policy is passed through Player sync and worker requests only for Melody + accompaniment; Bass + chords still uses `resolveAccompaniment` unchanged.

The focused selected-R development fixture demonstrates the audible boundary: the old all-support path generated lower support `[36,40,43]` beside melody MIDI 60, with no exact MIDI collision and no sounding-limit rejection. The new generated/label-only candidate keeps the `C` display label, retains the selected source note, emits `0` generated support notes, and reports `unverified chord source`. A mixed Auto fixture still generates authored chart support while leaving generated continuation label-only. This is a new development candidate prompted by contract review; it does not retune or replace the frozen capture packet. Existing selected-index source reduction remains available where source support exists, with Original/local fallback otherwise.

## Reserved browser evidence

The packet contains one source-selected window per song, each with complete Original, Automatic melody, and User-confirmed right-hand captures. The frozen primary windows remain the only captured/human-review candidates. A second non-overlapping window is now prepared for deterministic retrospective producer comparison only; it was selected after the primary freeze and is explicitly **not** an untouched holdout. Player arrangement durations used by the deterministic producer were 96, 40, 84, and 504 beats respectively. Primary producer counts are Original / Automatic / Manual:

| Phrase | Source-only window | Producer `[midi,start,dur,vel]` events | Multiset outcome |
| --- | ---: | ---: | ---: |
| Near the Cross | 24–48 beats, 4×6/4 | 50 / 46 / 47 | automatic changed / manual changed |
| Prélude | 16–32 beats, 4×4/4 | 115 / 86 / 105 | automatic changed / manual changed |
| Pay Me My Money Down | 28–44 beats, 4×4/4 | 34 / 34 / 34 | automatic changed / manual changed; hashes differ |
| Dear God | 96–128 beats, 8×4/4 | 165 / 154 / 165 | automatic changed / manual changed; manual hash differs |

Full source fingerprints, window bounds, producer hashes, duration checks, observed capture metrics, and portable paths are in the [reserved evaluation summary](https://github.com/Reedtrullz/Keyspilli/blob/codex/musically-useful-chords-mode/docs/superpowers/evidence/2026-09-17-chords-v2-reserved-evaluation.json) and [preserved capture packet](https://github.com/Reedtrullz/Keyspilli/tree/codex/musically-useful-chords-mode/docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet/). Every accepted capture passed the 250 ms decoded-duration completeness gate. A Blackbird Original-vs-Original repeat decoded 2.58/2.58 seconds for a 2.5-second request but varied in scheduler/PCM metrics, so oscillator events and decoded PCM are secondary observations only. WebM SHA-256 values are integrity checks, not audible-difference proof.

The retrospective deterministic windows are Near the Cross `0–24` beats, Prélude `0–16`, Pay Me My Money Down `0–16`, and Dear God `64–96`. They reuse the frozen candidate and are reported separately from the primary captures; no new audio capture or human rating is being presented as holdout evidence.

## Finding-by-finding ledger

| Area / finding | Status | Evidence | Remaining boundary |
| --- | --- | --- | --- |
| T2 event accounting and interval semantics | Fixed/tested | Player-core suite 230/230; MIDI suite 397/397; window-clipped producer multisets and hashes in the reserved packet | No claim beyond the tested source/options fixtures |
| T3 rests and local correction | Fixed/tested structurally | Rest-aware MIDI/player-core coverage, fingerprinted overrides, correction/reset/seek/loop browser checks | Semantic melody gold/source review and human recognizability review remain pending |
| T4 source/harmony boundary | Runtime policy fixed/tested; source contract remains limited | Actual ingest → `buildVariants`/`chordsAt` → `notes.json.chords` → catalog API → Player path traced; mixed and selected-LH fixtures; generated `none` / Auto `authored-only` / UG `all` policy; selected-R low-voicing fixture proves sounding guard alone is insufficient; player-core and source-policy regressions pass | Historical `notes.json` still has no selected identity. No general selected-melody exclusion or musical harmony claim; protected-note re-inference remains a larger adapter/candidate |
| T5 backing rhythm and sounding policy | Fixed/tested structurally | Source-reduction, sparse backing, meter/off-grid/pickup fixtures, lineage, coherent-phrase tests, producer captures | No live payload carries validated pickup-phase provenance; useful backing and human acceptance remain pending |
| T6 sounding/voicing/velocity/pedal | Fixed/tested as engineering behavior | Focused player-core tests, bounded voicing/sounding trims, CC64/velocity paths, same-stream checks | Instrument balance, physical playability, and musical preference remain pending |
| T7 worker/single stream/persistence | Fixed/tested | Full melody browser run; worker cancellation/keys/retry/stale guards; source fallback and persistence checks | Real mobile profile and production/catalog verification remain pending |
| T8 status/audition/accessibility | Fixed/tested | Phrase render counts preserve `unchanged` and separately count reason-classified `already-simple`; SoundControls covers partial/unavailable/missing chart; browser checks cover unavailable worker fallback, Original source preservation, reset, stale source fingerprint, role auditions, A/B position, 390px controls, keyboard focus and 200% zoom 8/8 | Human listening and physical/mobile acceptance remain pending |
| Evidence integrity | Fixed/tested | Decoded-duration gate, window-scoped deterministic producer accounting, preserved packet, SHA manifest, repeat control | Capture metrics remain observational and do not establish musical quality |
| Musical/source acceptance | Pending | Engineering evidence is reproducible and source-selected | Two useful phrases per song, source-semantic review, human listening/rubric, recognizability, harmonic plausibility, and playability are not complete |

## Explicit acceptance limits

- The reserved packet has one captured source-selected window per song. The retrospective windows are deterministic producer controls selected after the primary freeze; they are not new untouched holdouts and do **not** satisfy the requested two useful phrases per song. That acceptance criterion remains missing.
- Pickup-phase provenance is not actually present in the live catalog payload. The player therefore falls back to boundary/source timing when validated source-measure phase is unavailable; pickup-phase correctness is not claimed.
- Deterministic producer changes, event counts, waveform bytes, hashes, CI, and worker traces are not substitutes for source-semantic review or human musical acceptance.

## Deleted reattack exception and output-equivalence check

The deleted `sourceAttackStarts` / `sourceGestureSupportsReattack` path had one production caller; `rg "sourceGestureSupportsReattack|sourceAttackStarts" packages/player-core apps/web` now returns no references. Reproducible regression evidence is:

```text
npm test -w @keyspilli/player-core -- --run test/melody-accompaniment.test.ts
57 passed
npm test -w @keyspilli/player-core -- --run
230 passed
```

The supported coherent/resume behavior produced no observed output delta in these tests after removal. This is code-level output-equivalence evidence, not proof of identical audio for every possible input.

## Acceptance status

Engineering/runtime integration plus the new source-policy candidate is ready for parent review after the final exact-head CI check. Musical/source acceptance is pending. PR #100 remains draft and unmerged; no deployment, catalogue mutation, or production verification was performed.

## Review requests

1. Review the exact head and the T2–T8 ledger against the code and reproducible evidence.
2. Audit the preserved Original/Automatic/User-confirmed captures without treating oscillator/PCM variation as musical proof.
3. Treat the missing two-phrases-per-song sample and absent live pickup-phase provenance as explicit follow-up gates. Any tuning would invalidate the frozen evaluation and require fresh evidence.
