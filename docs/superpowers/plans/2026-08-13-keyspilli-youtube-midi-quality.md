# Keyspilli YouTube → MIDI quality & reliability plan

> Goal: make every YouTube-converted song usable for piano practice: correct
> tempo, readable rhythm, playable textures, honest difficulty levels, and an
> in-app path to fix what transcription still gets wrong.
>
> Evidence basis: 7 parallel investigation lanes (worker/ingest, MIDI cleanup,
> player consumption, raw Basic Pitch output, tempo tooling, worker ops,
> player/UI verification) plus direct artifact/DB checks. All file:line refs
> verified against HEAD `e9cc308`.

## Verified facts (what is actually wrong)

- Every YouTube transcription is written at a fixed 120 BPM (`basic_pitch/predict.py:124`; measured in 6 raw files, all `tempoBpm=120`). No tempo detection exists anywhere. Everything downstream — metronome, practice speed, beat grid, stored `tempo` row, exported MIDI — is wrong for real songs.
- Raw Basic Pitch output is unquantized: 88–98% of note starts miss a 1/16 grid even at ±0.05 beats (6 real files). Durations floor at ~0.26 beats; velocities are continuous (48–75 distinct values) and worth preserving.
- The "44-note wall" is real but rare and localized: exactly 2 of 6 files, each a single 43–44-note closing chord held to the final tick. Elsewhere maxSim is 6–9.
- Served artifacts (Aug 11 03:58) predate the Aug 12–13 cleanup commits (`b8c0948`, `0e1acb1`, `e9cc308`): the fixes exist in code but were never re-ingested into the catalog. Current artifact durMax is ≤19 beats (Für Elise); the committed 2-beat cap would chop legato into staccato on re-run and needs a musical ceiling first.
- Difficulty ladder degenerates: advanced vs medium note counts are 1111/1111, 829/830, 894/894, 1387/1387 on real songs. `topVoices`/`thinChord` only differ beyond 4 simultaneous notes, which piano covers rarely exceed.
- The `re/` re-ingest lane bypasses `filterTranscription` and differs materially from the worker path (−32%, −28%, +20% note counts on the same songs).
- Worker ops are latent bugs, not burning ones: no claim guard (two workers would double-process), crash leaves `processing` forever, no retries, title split on `|` corrupts pipe-containing titles, under-5-min guidance unenforced (only 80MB cap). Live DB: 63/63 jobs done, 0 stuck.
- No in-app fix path: no per-song key/tempo/title edit, no re-transcribe UI, no delete; re-uploading an edited MusicXML duplicates instead of replacing; `.mxl` is advertised but unparseable (no zip support); validation failures are terse 422 dead-ends.
- Key/tempo edits would be clobbered by re-transcription today: the worker only forwards `title/artist/category` into `ingestSource` (`worker.ts:70-79`), so key re-detects and tempo re-derives.
- `songIds[3]` positional magic (points at "easy") breaks silently if `LEVEL_ORDER` ever changes.
- Player applies its metric-accent/jitter velocity curve unconditionally (`timeline.ts:23`) even though transcribed velocities are already expressive; falling view silently drops notes outside the clamped 54-semitone window (`falling.ts:68-80`).

Non-claims: no ground-truth accuracy measurement exists yet (ADR 0002 flagged the feature experimental); stem separation, meter detection, and tempo maps are deliberately out of scope for this round; no code changed during the investigation.

## Phase A — Measurement harness (do first; everything below gets tuned against it)

- [ ] **A1. Fixture accuracy study** — new `packages/catalog/scripts/audit-transcriptions.ts`: for each YouTube base in `data/db.sqlite`, report per variant: tempoBpm, note count, durMax, % notes >2 and >8 beats, maxSim, % starts on grid (1/16 ±0.01), velocity range. Print before/after tables. This turns every later phase into a measurable diff.
- [ ] **A2. Reference comparison for 5 known piano covers** — pick 5 already-transcribed songs, obtain a reference MIDI/score (existing seed data or manual), add a `compareTranscription` helper (pitch-class hit rate, onset distance) used by A1. Sets the gate the ADR promised. Mark pass/fail thresholds explicitly (target: ≥80% pitch-class coverage, median onset error < 60 ms).

## Phase B — Pipeline correctness (cheapest, highest leverage)

- [ ] **B1. Tempo detection** — add `services/transcribe/src/tempo.py` (librosa `beat_track`, clamp 40–220, `KEYSPILLI_TEMPO_OVERRIDE` env escape). In `worker.ts` before the Basic Pitch call: run `tempo.py`, pass `--midi-tempo <bpm>` to `basic-pitch` (verified: changes the output meta exactly; float accepted). Measured: 0.3–2.9 s per file, no new deps, no Docker changes (librosa already installed).
  - Why here and not later: `filterTranscription` converts note starts to seconds via `secPerBeat = 60 / tempoBpm` (`transcribe.ts:23`); at 95.7 vs 120 the onset window drifts tens of seconds deep into a song. Correcting the meta before inference fixes the filter for free.
- [ ] **B2. Metadata print + duration guard, one edit** — `worker.ts:53`: `--print "%(title)s\x1f%(uploader)s\x1f%(duration)s"`, split on `\x1f`, throw if `duration > 300` s. Fixes the `|` title bug and enforces the under-5-min rule where metadata is already fetched.
- [ ] **B3. One cleanup path** — add the `filterTranscription` call to `reingest-youtube.ts` and `retranscribe-youtube.ts` (mirror `restore-youtube.ts:29`), or consolidate into one `reingest-youtube.ts [baseId...] [--retranscribe]` that runs the exact worker pipeline; delete the redundant scripts.
- [ ] **B4. Worker reliability** — in `db.ts`: `claimJob(id)` atomic `UPDATE ... WHERE status='queued'` returning `changes===1`; narrow `getQueuedJobs` to `queued`; `requeueOrphaned()` on worker boot. In `worker.ts:48`: `if (!claimJob(jobId)) return;`. Add idempotent migration in `getDb()` (`ALTER TABLE conversion_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`) + `MAX_ATTEMPTS` env (default 2): on catch, `attempts+1`, re-queue if below max else `error`. Make BP timeout env-overridable (`KEYSPILLI_BP_TIMEOUT_MS`, keep 900 s default).
  - `ponytail:` single-instance assumption; multi-worker needs a `started_at` stale threshold.

## Phase C — MIDI musical quality (the "hard to use" core)

- [ ] **C1. Musical duration ceiling, not a chopper** — replace the blunt `maxDurBeats=2` cap (`clean.ts`) with an adaptive ceiling: `clamp(4 × median note dur, 2, 8)` beats, and only truncate notes that exceed it (keep legato under it). Raise `capHandOverlaps` floor from 0.125 to 0.25 beats. Raise quantize `minDur` from 0.05 to 0.125 (kills the 25 ms ghosts). Re-run A1 to compare.
- [ ] **C2. Real ladder separation** — `medium` currently ≈ `advanced` because voicing-only reduction never kicks in for piano covers. Add rhythmic simplification for `medium` and below: quantize to 0.25 grid, drop 16th-note passing tones (notes starting off-beat whose next same-hand note is <0.25 beats later), keep chord tones. `easy` and below keep melody+roots. Verify: each level's note count strictly decreases, and medium ≠ advanced on all fixture songs.
- [ ] **C3. Velocity honesty** — stop applying the metric accent/jitter curve when the source already has dynamic variance: compute velocity stddev in `timeline.ts`; if > threshold (e.g. 8), skip the manufactured curve. Verify with A1 velocity stats (BP files have 48–75 distinct values).
- [ ] **C4. Chord label noise** — in `chordsAt` (`simplify.ts:22`), exclude notes shorter than 0.25 beats from harmonic slices (passing tones pollute labels); keep melody-exclusion as a follow-up if A2 shows it matters.
- [ ] **C5. Hand split, measure first** — keep pitch-gap split but add an `opts.preferPercentile` for AI content and evaluate both on the fixture set (A2). Do not change the default without a measured win. Track-name/channel-aware split applies only to upload/standard MIDI (track names are parsed but unused; `parse.ts:81`).

## Phase D — In-app fix path (make bad transcriptions fixable)

- [ ] **D1. Edit song metadata** — `PATCH /api/songs/[id]` accepting `key`, `tempo`, `title`, `artist`, `category`, `style`, `mood`; rewrite all 6 variants (`notes.json`, `variant.mid`, `variant.xml`) via `writeMidi`/`writeMusicXml` reusing `ingest.ts:97-120`; `upsertSong` already overwrites `key/tempo` on conflict. UI: edit form on the player/library row.
- [ ] **D2. Re-transcribe in place** — `/api/youtube` accepts optional `songId` + override fields; pass into `insertJob` (column exists); worker already keeps `baseId` and metadata (`worker.ts:69-79`) — extend it to forward `existing.key/tempo/style/mood` into `ingestSource` so D1 edits survive re-transcription. UI: "Re-transcribe" button on converted songs.
- [ ] **D3. Delete** — `deleteSongsByBase(baseId)` in `db.ts`; `DELETE /api/songs/[id]` that also removes `data/artifacts/<baseId>` and the stored upload source. UI: delete button with confirm.
- [ ] **D4. `.mxl` support** — detect `PK\x03\x04` in `ingestSource`, unzip in memory, parse the first `.xml` (or `META-INF/container.xml` rootfile). Add `fflate` (tiny, battle-tested) rather than a hand-rolled ZIP reader. Fix the saved-source extension (`ingest.ts:89` currently would write `.mid` for XML).
- [ ] **D5. Job list + retry** — `/youtube` page shows recent jobs (status/error), with retry (re-queue errored jobs) and delete. Uses B4's `attempts`/status fields.
- [ ] **D6. No silent note drops** — falling view (`falling.ts:68-80`): when the measure span exceeds the clamp, widen to fit (cap 88 keys) instead of skipping notes at x=-100; or render edge indicators. Keep the existing 88-keys toggle.

## Phase E — Rebuild the catalog, then verify

- [ ] **E1. Re-ingest all YouTube bases in place** — script over the 37 YouTube base ids: for each, reuse the stored job audio (`data/transcribed/<job>/audio.mp3`) or re-download, run the Phase B/C pipeline (tempo → BP → filter → clean → variants → ingest with same `baseId`). Do NOT run before B3/C1 land, or the catalog gets rebuilt twice.
- [ ] **E2. Re-run A1 audit + A2 accuracy study** — record before/after tables in `docs/decisions/0002-transcription-worker.md` (or a new ADR) and update the "experimental" flag decision.
- [ ] **E3. Extend `verify-catalog`** with duration/velocity/density checks (max dur per level, % notes >8 beats, min velocity variance for advanced), and add the tests the lanes found missing: `capHandOverlaps` direct, `normalizePianoRange`, `claimJob`, `filterTranscription` (needs the Python subprocess — guard behind env), `ingestSource` end-to-end, real-artifact re-validation.
- [ ] **E4. Ops docs** — `docs/ops.md`: note boot requeue, retry behavior, `KEYSPILLI_TEMPO_OVERRIDE`/`KEYSPILLI_BP_TIMEOUT_MS`, and the re-ingest command.

## Phase F — Rollout

- [ ] **F1. Full verification** — `npm run test`, `npm run typecheck`, `npm run verify-catalog`, e2e suite, prod build. Listen-test 2–3 converted songs (metronome vs original, practice at 70% speed).
- [ ] **F2. Deploy** — web + worker images, confirm migration applies on boot, convert one new YouTube song end-to-end on the VPS, verify tempo row + player BPM chip + practice speeds.
- [ ] **F3. Update ADR 0002** with measured accuracy results and the tempo/meter notes; mark feature status accordingly.

Out of scope this round (explicit deferrals): stem separation, meter detection (4/4 stays), tempo maps/rubato, autodetection of 2x/1/2x BPM octave errors (measured worse than the env override; `KEYSPILLI_TEMPO_OVERRIDE` is the escape hatch).

Estimated order of magnitude: B1+B2+B3+B4 ≈ 1 day; C1-C5 ≈ 2-3 days with A2 measurements; D1-D6 ≈ 2-3 days; E1-E3 ≈ 1 day + re-ingest runtime; F1-F2 ≈ 1 day.
