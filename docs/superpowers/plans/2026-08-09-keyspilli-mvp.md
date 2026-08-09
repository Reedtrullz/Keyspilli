# Keyspilli Implementation Plan (v2 — private-use scope)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> This is the **master plan** for the full build. Each phase is a sub-project that gets its own detailed, task-level implementation plan (writing-plans format with per-task TDD steps) immediately before execution. Phase boundaries are chosen so each phase produces working, testable software.
>
> **Revision v2 (2026-08-09) — owner decisions:** private single-user app (no auth/accounts), no licensing/monetization/compliance concerns, YouTube conversion included (no quota), 4 view modes MVP, ~100-song catalog, deploy to owner's VPS. Supersedes v1 (which assumed public product with Stripe/SEO/licensing gates).

**Goal:** Build Keyspilli, a personal browser-based piano-learning app: color-coded interactive player (4 view modes), a ~100-song catalog of simplified arrangements, MIDI upload + YouTube conversion ingestion, live practice grading, and free PDF/MIDI/MusicXML export — deployed on the owner's VPS.

**Architecture:** Next.js (App Router) + TypeScript web app; a shared TypeScript "player core" package (timeline + Web Audio synthesis + input) that all view modes render from; a server-side arrangement pipeline (MIDI → quantize → hand-split → difficulty variants → MusicXML/PDF via Verovio); **SQLite** (single user) + filesystem artifact storage; a simple DB-backed job queue for conversions; no auth, no payments, no external analytics.

**Tech Stack:**
- Web: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, PWA manifest
- Player: Web Audio API (synth), Web MIDI API, `getUserMedia` + pitch detection (mic fallback), Verovio (WASM) for engraving, Bravura font
- Data: SQLite (Drizzle or Prisma) + filesystem storage for PDF/MIDI/MusicXML/audio
- Jobs: SQLite-backed job table + worker process (polling; no Redis needed)
- Ingestion: yt-dlp (audio download) + Basic Pitch (Spotify, open source) or chosen transcription model
- Deploy: Docker Compose on VPS (web + worker + Caddy reverse proxy/TLS)

## Global Constraints

- **Private, single-user app.** No auth, no accounts, no Stripe, no paywalls, no quotas. Everything is free and unlimited by design.
- Every song arrangement must be playable without any setup (browser-only; no login step exists).
- **4 view modes for MVP:** Fall Down, Beginner, Sheet Music, Lead Sheet. Bars Sheet, Simple Sheet, Kid modes, Karaoke are post-MVP stretch.
- **~100 songs at launch**, sourced from public-domain/CC collections (Mutopia, IMSLP, Musopen) plus any personal MIDI files. Personal-use only; no redistribution.
- Catalog ingestion is automated: raw MIDI + metadata → 5–6 difficulty variants via the pipeline (Phase 3).
- Color coding is a fixed pitch→color mapping (C=red, D=orange, E=yellow, F=green, G=blue, A=purple, B=pink) applied consistently everywhere.
- Data model follows the analyzed schema shape: songs carry `key`, `tempo`, `difficulty`, `difficultyScore`, `style`, `mood`, `bassPattern`, `visibility`, `acquiredVia`, `sourceYoutubeUrl`, `contentType`, `hasSheetXml`, `sections`.
- No secrets in repos/env docs; API keys (if any) via `.env` files excluded from git.
- Every phase ends with runnable proof: `npm run typecheck`, `npm test`, and a manual browser check logged to the Obsidian daily note (evidence + non-claims).
- Disk hygiene: builds use `$PWD/.build`/`$PWD/.next`; check `df -h /System/Volumes/Data` before long pipeline runs (30 GiB guard).
- Naming: product = **Keyspilli**; package scope `@keyspilli/*`; UI strings centralized in one i18n file from day one.

---

## Phase 0 — Foundation (3–5 days)

**Goal:** Repo, stack, data model, seed catalog, CI, and the one remaining technical pilot (transcription) in place.

### Pilot gate (before Phase 7 code)

- [ ] **G0.1 Transcription pilot** — run Basic Pitch on 5 solo-piano YouTube clips (local Mac). Record note accuracy + wall time per minute of audio, then **re-run one clip on the VPS** to measure CPU runtime. Decide: worker lives on VPS, or pipeline runs on the Mac and uploads results (recommended if VPS conversion > 5 min/song). Record in `docs/decisions/0002-transcription-worker.md`.

### Tasks

- [ ] **T0.1 Initialize repo** — `git init` in `/Users/reidar/Projectos/Keyspilli`; monorepo skeleton:
  - `apps/web` (Next.js), `packages/player-core`, `packages/midi`, `packages/engrave`, `packages/catalog`, `services/transcribe` (worker), `docs/decisions/`, `docs/superpowers/plans/`
  - Root `package.json` workspaces, `.gitignore` (`.next`, `.build`, `.env*`, `.playwright-cli`, SQLite data files), `.editorconfig`, README with run instructions.
  - Verify: `npm install && npm run typecheck` exits 0; initial commit.
- [ ] **T0.2 CI + quality gates** — GitHub Actions: lint, typecheck, unit tests, one e2e smoke (home page renders). Verify: pushed branch shows green checks.
- [ ] **T0.3 Design system** — Tailwind tokens (pitch colors, difficulty badges, BPM/key chips); three reference screens (home, player, song list) in code. Verify: `/?dev=components` page renders all tokens.
- [ ] **T0.4 Data model + migrations** — SQLite schema:
  - `Song` (id, title, artist, category, difficulty, difficultyScore, key, tempo, style, mood, bassPattern, duration, visibility, contentType, acquiredVia, sourceYoutubeUrl, hasSheetXml, sections JSON, plays, createdAt)
  - `ConversionJob` (id, youtubeUrl, status, jobId, songId, error, createdAt, finishedAt)
  - Verify: `prisma migrate dev` (or Drizzle push) + generate green; seed script idempotent.
- [ ] **T0.5 Seed catalog** — acquire 100 public-domain/CC songs (Mutopia/IMSLP/Musopen) as MIDI or MusicXML; hand-verify metadata (title, artist/composer, key, tempo, difficulty). Verify: seed script produces 100 songs, each parses in Verovio without error; source + license recorded per song in a `catalog/manifest.json`.
- [ ] **T0.6 Decisions log** — write `0001-catalog-source.md` (sources + per-song license records), `0002-transcription-worker.md` (result of G0.1), `0003-color-mapping.md`. Verify: committed.

**Exit criteria:** green CI on main; 100 playable seed songs; G0.1 answered; detailed Phase 1 plan written.

---

## Phase 1 — Player Core (2–3 weeks)

**Goal:** A working Fall Down player: timeline, audio, keyboard input, tempo/transpose/loop — the thing that proves "play a song in hours."

**Dependencies:** T0.4, T0.5.

### Tasks

- [ ] **T1.1 Timeline engine** (`packages/player-core/src/timeline.ts`) — schedule note-on/note-off from parsed MIDI at variable speed (0.25×–1.5×), measure/beat tracking, seek, A–B loop region. TDD: tempo-change keeps note offsets consistent; loop clamps to region; seek fires correct events.
- [ ] **T1.2 Audio synthesis** (`packages/player-core/src/audio.ts`) — Web Audio: piano voice (sampled or synthesized), separate voice/piano gain (defaults 100%/40%), metronome click, "chord mode" (synthesize chord on chord change) vs "piano background" (play recorded LH). TDD: gain ramps, chord buffer generation, metronome timing at 50% speed.
- [ ] **T1.3 Input** (`packages/player-core/src/input.ts`) — computer-keyboard mapping (two octaves, shift for octave), Web MIDI keyboard connect (Chrome/Edge/Opera/Android; detect support, show mic fallback hint on Safari/Firefox), on-screen keyboard rendering with correct pitch colors. TDD: key-down/up → note events; octave shift maps correctly; unsupported-browser detection.
- [ ] **T1.4 Fall Down renderer** (`packages/player-core/src/views/falling.ts`) — canvas/render loop: colored note bars falling onto keyboard, bar length = duration, chord labels left edge, lyrics scroll right, red playhead sync at all speeds. TDD: note lane math (x=key, y=time), speed scaling, pause/seek correctness. Manual check: plays seed songs smoothly at 50%/100%/150%.
- [ ] **T1.5 Player shell** (`apps/web/app/player/[id]/page.tsx` + `/topdown` route) — page layout: header chips (genre/key/difficulty/artist), L/R/All buttons, Chord Keys + Metronome pills, Play/LOOP/measure controls, BPM −/+, Key −/+ with reset, wait-mode stub, settings dialog (background sound, voice/piano volume), mode dropdown (only Fall Down + placeholders), song data from `/api/songs/{id}`, PWA manifest registration. Verify: full keyboard navigation, focus states, `prefers-reduced-motion` respected (pause animations).
- [ ] **T1.6 Persistence** — per-song + global prefs (mode choice, tempo, transpose) in localStorage; play-count increments to DB (`/api/songs/{id}/play`) for popularity sorting. TDD: prefs survive reload; per-song key/tempo restored.
- [ ] **T1.7 Player e2e** — Playwright: open song, play, loop A–B, change tempo, transpose, hand toggle, settings. Verify: green on Chrome + WebKit.

**Exit criteria:** a seeded song plays in all tested browsers; tempo/transpose/loop work; computer keyboard + Web MIDI input functional; CI green; checkpoint logged to Obsidian.

---

## Phase 2 — Sheet Rendering & Modes (1–2 weeks)

**Goal:** Sheet Music, Beginner, and Lead Sheet on the same timeline; mode switching mid-playback with deep-linked routes.

**Dependencies:** T1.1, T0.4.

### Tasks

- [ ] **T2.1 Verovio integration** (`packages/engrave`) — load Verovio WASM; render MusicXML → SVG with colored noteheads (pitch→color mapping); server-side engraving route `/api/v1/sheet/{id}?mode=...` for Sheet Music mode. TDD: renders known MusicXML fixture without error; colored-notehead option toggles; tempo/key metadata displayed.
- [ ] **T2.2 Beginner view** — big colored dots with letter names, lyrics under each note, chord symbols per bar, melody-only. Data: derive note+lyric alignment from MusicXML (lyric syllables mapped to notes).
- [ ] **T2.3 Lead Sheet view** — lyrics + melody dots + chord changes; no staff.
- [ ] **T2.4 Mode router** — `/player/{id}/{mode}` deep links; dropdown switches mid-playback; mode preference persists (localStorage). TDD: URL→mode mapping, unknown mode → 404-friendly fallback.
- [ ] **T2.5 `hasSheetXml` gating** — Sheet Music mode only for songs with MusicXML source; others show a notice ("not available for converted/uploaded songs"). TDD: song without sheetXml → mode disabled.

**Exit criteria:** 4 modes render synchronized audio; mode URLs shareable (bookmarkable); CI green.

---

## Phase 3 — Arrangement Pipeline (3–4 weeks) — critical path

**Goal:** Automated pipeline from a source MIDI to a full song record: quantization, hand-split, difficulty variants, lyrics, MusicXML, PDF/MIDI export, metadata.

**Dependencies:** T0.4, T2.1.

### Tasks

- [ ] **T3.1 MIDI parser/quantizer** (`packages/midi`) — parse SMF, quantize timing (configurable grid), strip artifacts (overlapping unisons, tiny gaps), detect key/tempo. TDD: known fixture → expected note list; quantize tolerance tests.
- [ ] **T3.2 Hand split** — polyphonic voice separation: register-based + contrapuntal rules (melody = upper/higher-register voice, bass = LH); configurable override. TDD: 2-track and 1-track fixtures both produce correct RH/LH; LH `bassPattern` classifier (block/octave/oompah/walking/pedal).
- [ ] **T3.3 Difficulty engine** — generate variants (very-beginner → advanced): simplify by removing ornaments, thinning chords (root+5th), reducing LH patterns, octave shifts; compute `difficultyScore` (1–5 scale calibrated to seed set). TDD: each variant is a strict simplification (note subset or equal); scores monotonic across levels.
- [ ] **T3.4 Lyrics alignment** — load lyrics file, syllable-align to melody notes (heuristic: syllable count vs note count per phrase; manual fixups stored as overrides). TDD: fixture alignment correct; mismatch falls back to chord-only.
- [ ] **T3.5 Exporters** — MusicXML writer (round-trips through Verovio), MIDI writer (level variants), PDF generators: engraved (Verovio) + "simplify" (Beginner/Lead layout). TDD: exported files re-import cleanly (parse back == input); PDFs render with Bravura font.
- [ ] **T3.6 Pipeline runner** (`packages/catalog`) — CLI: MIDI + metadata → all variants → records + artifacts → filesystem + DB rows with provenance (`contentType: "arrangement"`). Verify: 100-song seed pipeline runs end-to-end in <30 min locally; idempotent re-run.

**Exit criteria:** any valid MIDI becomes 5–6 difficulty variants with playable + printable artifacts; pipeline covered by fixtures; Obsidian checkpoint with run times.

---

## Phase 4 — Library & Browsing (1–2 weeks, parallel with Phase 3)

**Goal:** Find and sort the catalog the way a learner actually uses it: by difficulty, key, genre, tempo, chord count, mood, style, bass pattern.

**Dependencies:** T0.4, T3.1 (metadata), T3.6 (bulk data).

### Tasks

- [ ] **T4.1 Library page** `/songs` — filters (difficulty, key, genre, tempo, chord count, mood, style, bass pattern), sort (popular/title/artist/difficulty), cards with key chip + play count + BPM. TDD: filter combinatorics return expected sets.
- [ ] **T4.2 Artist pages** `/artist/{slug}` — song count, difficulty breakdown, keys, most-played list, full grid. (No A–Z hub or letter index needed for personal use; add if browsing feels incomplete.)
- [ ] **T4.3 Search** — title/artist search with debounce, keyboard-navigable results. TDD: partial-title match, artist match, empty-state.
- [ ] **T4.4 Home page** — recent songs, favorites row, "keep practicing" (last played), random song button, stats (songs count, plays). No SEO copy, no testimonials.
- [ ] **T4.5 robots.txt + basic meta** — allow crawlers (harmless for private app), disallow `/api/`; per-song OG title only if desired later. Verify: no 500s on `/robots.txt`.

**Exit criteria:** 100 songs browsable with all filter dimensions; search works; home page useful; CI green.

---

## Phase 5 — Favorites, Progress, Uploads & Exports (1 week)

**Goal:** The personal-use conveniences: save songs, track practice, ingest your own MIDI files, and download anything — free.

**Dependencies:** T1.6, T3.1, T3.5, T4.1.

### Tasks

- [ ] **T5.1 Favorites + progress** — heart toggle on every song (localStorage); play count/completion marker ("learned" checkbox) on profile-less home rows; "Favorites" filter in library. TDD: toggle persists; filter returns favorites only.
- [ ] **T5.2 Upload & play** (`/uploads`) — 3-step wizard (upload → details → preview & publish); formats `.mid/.midi/.musicxml/.mxl` up to 10 MB; private by default (single-user app: everything is private anyway); reuses T3.1 parser + hand-split + T2.1 renderer for instant playback. TDD: file-type/size validation; upload creates a playable song row.
- [ ] **T5.3 Free export dialog** — "Download Sheet & MIDI" button → dialog with three options (Simplify PDF, Sheet Music PDF, MIDI) — all instant, no gating; wire to T3.5 exporters via `/api/song/{id}/export?type=...` with artifact cache. TDD: each type returns a valid file (content-type + magic bytes); cached artifacts served fast.
- [ ] **T5.4 Converted/uploaded song handling** — songs without `hasSheetXml` show simplified PDF only (no Sheet Music PDF); export dialog adapts. TDD: missing sheetXml → option disabled.

**Exit criteria:** favorites/progress persist; upload→play e2e; all three export types downloadable; CI green.

---

## Phase 6 — Live Grading (2 weeks)

**Goal:** Practice mode with real-time note feedback (Web MIDI, computer keyboard, mic fallback).

**Dependencies:** T1.3, T1.4.

### Tasks

- [ ] **T6.1 Grading engine** (`packages/player-core/src/grading.ts`) — compare incoming notes vs expected window (pitch + timing tolerance); wait mode (pause until correct key); feedback summary (accuracy %, missed-note count, "off the beat" classification). TDD: exact-hit, wrong-pitch, late-hit, missed-note cases.
- [ ] **T6.2 MIDI + keyboard grading** — wire Web MIDI/computer-keyboard input through grader; octave-shift support for one-octave keyboards.
- [ ] **T6.3 Mic grading** — pitch detection (autocorrelation/ML model in WASM) via `getUserMedia`; Safari/iOS/Firefox fallback path with permission UX. TDD: synthetic sine-wave fixture detected at correct pitch.
- [ ] **T6.4 History** — save last N runs (localStorage), show recent runs + accuracy trend on the song page ("your last 5 runs").

**Exit criteria:** graded run produces accurate feedback with MIDI and computer keyboard; mic grading demo works in Chrome; CI green.

---

## Phase 7 — YouTube Conversion Pipeline (2–3 weeks; after G0.1)

**Goal:** Paste YouTube URL → playable arrangement in ~90 s, unlimited, personal use.

**Dependencies:** G0.1, T3.x.

### Tasks

- [ ] **T7.1 Job infrastructure** — `ConversionJob` table + worker process (polling loop); job status routes (`/youtube/processing/{id}`, `/youtube/result/{id}`); simple "My conversions" list on the youtube page (no auth needed).
- [ ] **T7.2 Transcription worker** — yt-dlp audio download (≤5 min, solo-piano guidance) → stem separation (if needed) → Basic Pitch (or chosen model) → MIDI cleanup (quantize, velocity, pedal) → hand-split → difficulty variants → song record with `sourceYoutubeUrl` + `contentType: "youtube"`.
- [ ] **T7.3 Accuracy validation** — fixture set of 10 known covers; record per-song note accuracy vs reference MIDI; gate: median ≥ 80% or feature flagged experimental in UI.
- [ ] **T7.4 Conversion UX** — landing page with URL input + progress indicator, demo list of successful conversions, content restrictions messaging (solo piano, <5 min).

**Exit criteria:** 10-fixture pipeline runs end-to-end; median accuracy recorded in Obsidian; conversion runtime measured on target hardware (per G0.1).

---

## Phase 8 — Deployment to VPS (1 week)

**Goal:** Keyspilli runs on the owner's VPS, reachable from any device, with backups.

**Dependencies:** Phases 1–5 (deployable incrementally; Phase 7 worker can be added later).

### Assumptions (confirm at deployment time)

- VPS runs Linux (Ubuntu assumed) with Docker available; no domain assumed — Caddy will serve over HTTP-on-IP or the owner's domain if provided; transcription may run on the Mac instead of the VPS if G0.1 shows VPS CPU is too slow.

### Tasks

- [ ] **T8.1 Containerize** — `Dockerfile` for the Next.js app (standalone output) + worker; `docker-compose.yml` with services: `web`, `worker`, `caddy` (TLS/HTTP), volumes for SQLite data + artifacts; `.env.example` documented. Verify: `docker compose up` works locally end-to-end.
- [ ] **T8.2 Deploy** — rsync/git pull + `docker compose up -d` on VPS; smoke test home, player, export, upload endpoints from another device (phone). Verify: all core flows work over LAN/public IP.
- [ ] **T8.3 Backups** — nightly cron: `sqlite3 .backup` to a dated file + tar of artifacts volume; retention 14 days; documented restore drill (restore into fresh volume). Verify: one real restore test.
- [ ] **T8.4 Maintenance docs** — `docs/ops.md`: deploy command, logs, backup/restore, worker restart, adding new songs to the catalog (run pipeline → commit data).

**Exit criteria:** app reachable from phone; backups run and one restore verified; Obsidian checkpoint with deploy evidence.

---

## Phase 9 — Stretch (optional, in order of value)

Personal-use extras, only after the core is stable:

- [ ] **T9.1 Bars Sheet + Simple Sheet modes** (2 more of the original 8).
- [ ] **T9.2 Kid mode** — Kid Simple/Kid Bar views with OFF/C/1 labels and bigger keyboard (useful if kids use it).
- [ ] **T9.3 Karaoke mode** — bouncing-ball lyrics.
- [ ] **T9.4 Free tools** — chord finder, transposer, BPM tap, circle of fifths, scale explorer.
- [ ] **T9.5 Practice courses** — structured right-hand/left-hand/hands-together lessons using the player.
- [ ] **T9.6 Accompaniment tracks** — melody-toggle + transpose-follows-backing for singing along.
- [ ] **T9.7 Playlists** — localStorage playlists (name + song list + reorder).

**Exit criteria:** each stretch item ships as its own small phase with the standard Definition of Done.

---

## Parallelization & Team Strategy

- **Track A (critical path):** Phase 1 → 2 → 3 (player + pipeline). No parallelization inside until T3.1/T3.2 land.
- **Track B (parallel, starts with Phase 3):** Phase 4 (library) — depends only on metadata + data shape.
- **Track C (parallel, after T3.5):** Phase 5 (favorites/uploads/exports) — can be built against fixture songs.
- **Track D (after G0.1):** Phase 7 (conversion pipeline) — independent worker service.
- Phase 6 (grading) slots into any free lane after T1.3.
- Per-phase plans dispatch fresh subagents per task (subagent-driven-development), with the phase owner reviewing each task's diff against its acceptance criteria before merge.

## Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Transcription too slow on VPS CPU | High | G0.1 pilot measures runtime first; fallback: run pipeline on Mac and sync artifacts |
| YouTube downloading breaks (yt-dlp cat-and-mouse) | Medium | Pin yt-dlp version in Docker; documented update step; accept local-file upload as permanent fallback (T5.2) |
| Transcription accuracy < 80% | Medium | T7.3 gate; experimental flag in UI; manual MIDI cleanup pass before publishing to catalog |
| SQLite single-writer contention (web + worker) | Low | Single user = negligible; WAL mode + busy_timeout; worker retries on lock |
| Data loss (songs, artifacts, progress) | Medium | T8.3 nightly backups + one verified restore drill |
| Verovio/engraving performance | Medium | Server-side engraving + filesystem cache; WASM client fallback; perf budget (LCP < 2.5 s) |
| Web MIDI unavailable on Safari/iOS/Firefox | Medium | Mic grading fallback (T6.3); "supported browsers" note in help |
| Scope creep (stretch list grows) | Medium | Phase 9 strictly after core stable; one stretch item per phase |

## Timeline (focused effort + agent assists)

- Weeks 1–2: Phase 0 + Phase 1 (timeline/audio/input)
- Weeks 3–4: Phase 1 renderer/shell + Phase 2 modes
- Weeks 5–7: Phase 3 pipeline (critical path) ∥ Phase 4 library
- Week 8: Phase 5 (favorites/uploads/exports) ∥ Phase 6 grading
- Weeks 9–10: Phase 7 conversion pipeline
- Week 11: Phase 8 deployment on VPS
- **Working app on VPS target: end of week 11**, with 100 songs, 4 modes, grading, uploads, free exports, and YouTube conversion (flagged experimental if accuracy gate unmet).

## Definition of Done (every phase)

- [ ] All tasks checked, acceptance criteria met, tests green (`npm run typecheck && npm test`)
- [ ] Manual browser verification recorded (what was tested, in which browser, evidence)
- [ ] No secrets committed; catalog sources recorded in `catalog/manifest.json`
- [ ] Obsidian daily-note checkpoint: evidence + non-claims
- [ ] Next phase's detailed task-level plan written and reviewed

## Assumptions (owner can correct any)

1. VPS = Linux with Docker (Ubuntu assumed); no domain → Caddy on IP unless a domain is provided at deployment.
2. Pipeline transcription may run on the Mac (results synced to VPS) if G0.1 shows VPS CPU is too slow.
3. The 100 songs come from Mutopia/IMSLP/Musopen + personal MIDI files; per-song provenance recorded in the manifest.
4. "Learned" markers, favorites, and grading history live in localStorage (per-browser), while play counts live in SQLite (for popularity sort). Cross-device sync is not a goal.
5. No analytics, no user accounts, no email — the app is for the owner only.
