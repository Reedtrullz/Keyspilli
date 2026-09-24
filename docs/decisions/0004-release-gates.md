# ADR 0004 — Release gates

Status: accepted (2026-08-21)

## Decision

Keyspilli releases must pass four separate gates. Passing one gate must never
be reported as passing the others. Each gate has distinct evidence requirements.

## Gates

### 1. Source gate

Source is present, checksummed, and provenance is intact.

**Evidence:**
- `npm run verify-catalog` exits 0
- Every base in `catalog/manifest.json` has a corresponding artifact directory
- No disabled bases have been silently re-enabled
- YouTube sources have valid provenance metadata

### 2. Structural gate

MIDI/XML round-trip, valid notes, difficulty ladder, and playability checks pass.

**Evidence:**
- `npm test` exits 0 (all unit + integration tests)
- `npm run typecheck` exits 0
- `npm run build` exits 0
- `verifyVariants()` passes for all bases (note counts monotonic, difficulty scores monotonic)
- `verifyMonotonicity()` passes for sampled bases
- `chord-diagnostic.ts` reports no errors
- No variant exceeds PLAYABILITY_LIMITS

### 3. Musical gate

Human playback/listening confirms melody, LH usefulness, rhythm, balance, and playability.

**Evidence:**
- At least 10 representative songs (spanning difficulty levels and source types) have been listened to
- Each listened song passes the learning arrangement rubric:
  - Clear, continuous melody (right hand)
  - Useful left-hand chords/bass patterns
  - Stable rhythm and tempo
  - Playable at the intended difficulty level
  - Recognizable as the source song
- Results logged in `docs/listening-review.md`

**Note:** This gate requires human judgment. Automated checks are supporting evidence only.

### Chords backing-only interpretation (2026-09-23)

Chords is one song-wide arrangement derived from Advanced; changing the selected
difficulty does not require a different Chords arrangement. For a backing-only
release, replace the melody item in the rubric with: the piano leaves room for
singing and does not play the sung vocal line as its own part. Human review must
also confirm recognizable harmony, characteristic accompaniment rhythm, usable
bass, section transitions, endings, and real-keyboard playability. Listen to at
least 10 representative songs across source types and include unsupported or
ambiguous passages. A listening pass for one song or a source-note count does
not pass the musical gate for the mode. Original and optional melody arrangements
retain the melody item above.

The intended learner may not know how to play piano yet. Do not make that
learner responsible for the real-keyboard playability gate. The project must
arrange an independent player or teacher to assess fingering, releases, hand
changes and sustained tempo. Separately, check that a beginner can start a
short guided passage with computer or on-screen keys, see the next notes,
repeat it and understand the result. An automated perfect score shows that
the input and grading path works; it is not a human learning or playability
result.

### 4. Runtime gate

Rebuild is idempotent, DB/API/player behavior is correct, and deployment evidence exists.

**Evidence:**
- `npm run pipeline` is idempotent (two consecutive runs produce identical song counts)
- Health endpoint returns 200 with correct version
- Song list API returns expected count
- Player loads and plays a song in the browser
- Export endpoint generates valid PDF/MIDI/MusicXML
- YouTube ingestion completes (or is gracefully disabled)
- Deployment was performed with immutable image tags
- Rollback procedure has been tested

## Consequences

- Release checklists must explicitly reference which gate(s) were passed
- CI handles structural gate automatically; source, musical, and runtime gates require human verification
- A release candidate must not be promoted to production without all four gates passing
