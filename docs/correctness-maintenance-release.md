# Bounded correctness maintenance release

The owner authorized deploying all five correctness fixes from merged PR #249:
minor-key filtering, unknown physical keyboard range, library return context,
saved export naming and a 15-second version-loading deadline. Post-merge
Automatic checks passed on b491252f230da1829de4b08344f74c758543976c.

This release backports those changes onto exact live web baseline
ed0b138e33a787bf12220b0239730761225d9d06. The existing selector release and
the main four-gate music release contract remain unchanged. The music-capture
harness introduced after the live baseline is omitted; no music evidence
infrastructure or unrelated practice-focus change is promoted.

The scope verifier admits exactly the 17 reviewed application/test/config
paths and these five release files. The sole player-core change represents
unknown physical reach as null; notes, grading targets, audio scheduling,
MIDI/export producers, catalog, dependencies, worker and musical evidence
are preserved. Qualification remains unchanged; no musical pass is claimed.

The workflow runs scope refusal fixtures, full workspace unit/type checks,
production build and all four browser suites before publishing a pinned
amd64 web image smaller than 2 GiB. Its digest, CI and scope receipt are
required for cutover. Recheck the baseline, take a fresh backup, rehearse
the candidate on an isolated copy, retain the previous image and compose
configuration, then recreate only web. Never rebuild/reingest the catalog,
update the worker or rewrite acceptance/provenance.

Verify serving identity, health and anonymous private-edge denial after
cutover. Live browser checks cover exact minor filters and reload/history,
unknown MIDI range, filtered/paged library return through reload and version
switches, saved version export labels, and a browser-local stalled request
with recovery and late-response rejection. Intercept play-count POSTs.
Browser-local fault injection and synthetic MIDI do not prove physical
hardware or musical acceptance. Compare catalog/evidence fingerprints and
worker identity before/after; record live checks separately from rehearsal.
