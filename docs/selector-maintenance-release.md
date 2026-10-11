# Bounded selector maintenance release

The owner explicitly authorized resolving the manifest blocker and deploying
the selector while preserving Original, B, C and failed-call evidence on
11 October 2026. This maintenance release backports the already merged PR248
onto the exact live baseline678a6068b14490598b9f3e50dd7b3849591c5b49.

The full main music release remains subject to ADR0004 and its four gates.
This bounded maintenance operation changes only the five reviewed selector
files and the release documentation, manifest, verifier/tests and workflow.
Its manifest deliberately records musical qualification as unchanged; it
does not assert a fresh musical pass. Any catalog, MIDI, audio, rendering
engine, dependency, worker or other source change fails scope admission.

Release checks require the exact backport, full workspace unit/type checks,
production build, existing four browser suites and an immutable amd64 web
image under2GiB. Publication does not itself authorize production cutover:
the operator must bind its digest and successful CI to a separate receipt,
recheck that production is still the baseline, take a fresh backup, rehearse
the candidate on an isolated data copy, retain the old image/config for
rollback, and recreate only the web service. Never reingest or rebuild the
catalog, update the worker, or rewrite musical acceptance/provenance.

After cutover, verify the exact version and private edge, Original/B/C APIs
and real browser switching, and compare pinned musical/evidence hashes and
family rows. Playback verification must intercept play-count POSTs to keep
the rows untouched. Record production observations separately from rehearsal.
This exception applies only to this selector backport and does not qualify
the broader main baseline or create a generic bypass for music releases.
