# Version-bound musical admission contract for #153 and #154

Status: implementation authorized by the owner on 3 October 2026. This document
does not approve any music or authorize publishing a particular candidate.

## Missing prerequisite

The owner inventory and harmony editor explicitly report admission as unavailable.
The inspected catalog contracts provide blocked learner policy, provisional song
preparation receipts, source-role evidence and atomic artifact publication. None
provides a musical admission receipt for a particular output, mode and tier.
The issue specifications require reuse of that contract. A provisional preparation
receipt cannot be substituted for listening or real-keyboard acceptance.

If the intended local WIP contract is available elsewhere, use it instead of
creating a second format. Otherwise, implement one canonical contract as a
prerequisite for both issues, with the following scope.

## Proposed receipt

One bounded JSON receipt describes one exact variant and mode. Its identity
contains the base ID, variant ID, publication revision, source artifact hash,
source fingerprint and a SHA-256 of the complete audible playback snapshot.
Original and Chords are separate. Chords identifies its Advanced input; selecting
a different Original tier cannot broaden a Chords review.

Each receipt records the review's actual author, date, reviewed beat ranges,
decision and rationale. Source, listening and keyboard evidence remain separate.
An imported receipt preserves partial, rejected and pending decisions. It cannot
turn a partial review into whole-song acceptance, infer pianist qualifications,
or promote automated/synthetic evidence into listening or keyboard evidence.
Unknown event provenance remains unknown. Unsupported symbols remain display-only.

Use ADR 0004's existing musical rubric and evidence distinctions. Existing owner
verdicts retain their exact historical scope; they are not migrated as independent
pianist assessments. Golden legacy hashes are immutable. The full playback pin
is a separate value and is only supplied by a review tied to that exact snapshot.

## Import and read path (#153)

The read-only inventory exposes per-mode and per-tier decisions, missing gates,
coverage and stale receipts. It includes excluded/rejected lessons without
changing learner policy. It exposes receipt identities without private asset
paths or source bytes.

The write route checks existing owner mutation authorization, a bounded strict
schema, exact output identity and the current publication revision under the
existing per-base artifact writer lock. It rejects pending reconciliation,
malformed receipts, identity mismatches, unsupported fields and stale versions.
Persist receipts atomically as immutable content-addressed sidecars. Conflicting
decisions remain inspectable rather than being silently overwritten. Receipt
import alone never re-enables a lesson or changes accepted music.

## Harmony preparation and publication (#154)

The current editor remains limited to symbols, quarter-beat spans, explicit
rests, unknown spans and supported voicings. Compile the proposed backing using
the same replay as the Player; audition, MIDI, MusicXML and output hash must agree.
Save the exact candidate and preparation receipt as sidecars, leaving Original
and accepted backing intact. Editing any event invalidates the preview receipt.

Replacement is a separate guarded operation requiring exact candidate identity,
current source/publication, and the canonical review contract's required source,
listening and keyboard evidence. Use the existing manifest-last publisher and
reconciliation protocol. Preserve Original bytes, current learner exclusions,
receipt history and recovery evidence. A stale source or revision refuses the
commit. Canceling or exporting a draft never replaces accepted backing.

## Verification

- Exact-version imports survive reload and remain private to the owner workspace.
- Malformed, stale, duplicate, contradictory and oversized receipts fail safely.
- Partial and rejected reviews stay partial/rejected; modes and tiers cannot bleed.
- A changed source, tempo, output or publication makes earlier acceptance stale.
- Excluded lessons stay excluded after every import and candidate operation.
- Candidate audition/export/Player snapshots match, including rests and unknowns.
- No write occurs on cancellation, failed review, stale revision or failed staging.
- An interrupted publication retains the existing reconciliation/rollback evidence.

This specification enables engineering implementation. It does not supply the
12 independently reviewed full-output pins still needed for #119 or assert that
any song has passed the musical release gate.
