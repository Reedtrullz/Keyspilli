# Exact local inputs and a bounded full-output review package

Scope: KS-17 and tooling supporting the still-open musical acceptance in #119
(KS-10). The user has authorized implementation of the Recovery Report's Wave 2.
This design records the concrete implementation before product changes.

## Contracts

1. A private `keyspilli-exact-input-registry` manifest identifies each asset by
   SHA-256, explicit relative locations under caller-supplied local roots,
   permission assertions with separate audit/review scopes, historical snapshot
   membership and optional transformation inputs/code/config/renderer references.
   An object-store location is `sha256/<first-two>/<full-hash>`; the resolver does
   not download, search outside supplied locations, copy musical assets, infer
   permissions, or choose a similar performance. Duplicate/conflicting bindings
   are invalid. Different observed bytes at several candidate locations are
   reported as ambiguous instead of choosing silently.
2. A deterministic finite resolver checks exact bytes and reports every asset as
   available, unavailable, mismatch, ambiguous, permission-blocked or invalid
   historical membership. Read budgets, regular-file checks and root containment
   apply before reading. Permission assertions are declarations, not legal or
   human-authentication conclusions. A changed manifest or any changed bytes,
   including review receipts, invalidates the prior audit receipt.
3. A golden adapter reads existing corpus/source-map metadata without modifying
   it. It records current notes/timeline pins and accepted backing/playback pins
   separately from historical members. It never promotes historical bytes or an
   accepted backing/excerpt hash into full playback approval.
4. A `keyspilli-full-output-review-request` declares at most three distinct
   composition families, a specific performance, source and output clock files,
   complete output extent and per-mode MIDI, MusicXML, Player snapshot, actual
   capture receipt and WAV references. Code/config/renderer are independently
   pinned. Null/missing real inputs produce a useful blocked package, not a
   forged placeholder hash. Every Original/Chords mode remains independent.
5. Package generation reuses `musical-review.ts` for receipt parsing, identity,
   coverage and source/listening/keyboard summaries. Hash-bound receipt evidence
   references must be locally available; summaries describe supplied attestations
   without authenticating the reviewer. Source correctness and output evidence
   completeness remain distinct. No package generation grants musical acceptance
   or changes accepted playback pins. Synthetic inputs always remain unapproved.

## Verification

Focused baseline: 34 existing catalog tests passed in four files on Node 22.22.3
(musical-review, artifact-manifest, fixture-evidence, listening-manifest).
New tests first cover exact/changed/missing bytes, ambiguous locations, missing
permission, escaped roots, historical mismatch, receipt mutation, partial output,
mode confusion and source-only judgments. A tiny self-authored distributable
fixture exercises preparation. Run the CLI against all current 12 golden entries
and the explicitly related audit archive metadata/available files, retaining a
max-three blocked review report if exact real inputs remain unavailable.

The integration owner runs the full suite. Known starting environment failures:
10 TSX Unix-IPC `listen EPERM` startup failures, alongside 3019 passing tests.
No merges, publication, provider requests, installed plugin replacement, accepted
hash repins, copyrighted asset commits or actual musical approvals are in scope.

## Independent-review corrections

The first review found that echoed output seconds and loosely shaped snapshot
JSON could produce false completeness. The bounded correction validates the
existing Original/Chords snapshot shapes without changing their receipt digest:
finite native tempo/meter, typed note/chord events, supported pedal, nonempty
sounding inventory and no event beyond the declared end. Required capture
seconds are derived from the snapshot's constant beat clock. The current legacy
recorder fixes speed to 1 and transpose to 0; unsupported clock/plan settings
remain blocked rather than being treated as recorded controls. Both recorder and
audio metadata must agree with actual PCM frames. Exported sounding events must
fit the declared extent, and both export containers must cover it; silent format
padding is not additional claimed playback. Modes share one base/publication,
with independently pinned tier/playback identities. When their tier is the same,
the source fingerprint must also agree. None of these checks authenticate capture
origin or establish correspondence between music and audio.

Regression controls preserve the independently supplied invalid receipts and
exercise shortened audio with consistently repinned declarations, malformed or
out-of-extent snapshots, unsupported recording controls, recorder/WAV mismatch,
export overrun and unrelated mode identities. Corrections are verified through
the actual preparation API and CLI, and then independently reviewed again.
