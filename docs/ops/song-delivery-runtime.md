# Complete-delivery runtime qualification

Use the actual stock FluidSynth executable with a licensed acoustic piano bank.
The delivery command does not acquire a bank or change the selected MIDI program.
Record both the executable build version and the loaded library version, which
can differ on a system with compatible shared-library updates. Keep their hashes
and the selected bank/preset in the verification receipt; do not distribute a bank
merely because the rendered audio is included in a handoff.

## Checked paths

Batch 1 exercises MIDI, MusicXML and compressed MXL, selected Original levels,
source tempo changes, pickup measures and terminal rests. It also checks an
unavailable backend, rendering again from preserved preparation, and read-only
verification after relocation. All six Original variants and the one explicitly
shared Advanced-derived Chords backing remain in the package.

The renderer forcibly terminates its direct backend process at the configured
timeout. A reproduced TERM-ignoring backend previously remained pending beyond
that timeout. A permanent actual-process regression now checks this case without
extending the timeout or treating partial audio as success. Arbitrary wrappers
that spawn independent descendants are outside the stock-backend qualification;
this change is not a generic process-tree supervisor.

Extra release-tail warnings remain visible even when both modes are structurally
complete. A duration check does not prove that the correct musical content is
present. A stock-rendered MIDI preview is not a recording of the web Player.

## Container process ownership

The deterministic preparation host requires confirmed absence of its owned
process group after completion. Some container init environments reap exited
runtime helpers slowly enough to exceed its existing passive drain window.
Do not make an ambiguous receipt successful, extend that window, or remove the
ownership assertions to get a green test result.

Use an actual init/subreaper when testing in containers. Compare base and candidate
under the same conditions and retain the original failures. A controlled test
supervisor can establish whether prompt reaping changes the result, but that is
environment qualification, not a change to the preparation host. Keep test
concurrency, runtime and individual deadlines explicit; one-worker evidence is
not a claim that a default-concurrency timeout was repaired.

## Local macOS qualification

Select the absolute compatible Node returned by the packaged checkout preflight
and put its directory first on PATH before `npm ci` or Python helper tests.
The shell can select a different Node after entering another worktree; a
successful install with an engine warning does not qualify the native SQLite
runtime.

For tests that create external source/reference fixtures, use one bounded
temporary directory outside the checkout and resolve its physical path before
exporting TMPDIR. macOS's default `/var` alias is deliberately rejected by the
deterministic host's no-symlink input policy. A temporary directory inside the
checkout also changes the meaning of negative tests requiring external paths.
Neither condition is a reason to weaken the policy. Retain the original failed
receipts and remove the owned temporary directory after the run.

The Batch 1 macOS qualification passed the full suite at default repository
concurrency with Node 22.22.3 and an external physical temporary path. A separate
matched base/candidate focused comparison still observed intermittent finite
descendant-drain failure on unchanged base source. Preserve that observation;
the supported passing run does not establish a universal process-reaping fix.

## Acceptance scope

Keep code review, stock-renderer operation, actual browser handoff, independent
musical/keyboard assessment and installation separate. Where a local browser is
blocked by environment policy, retain that refusal and use the supported CI
browser environment for the same owned test artifacts; do not disable browser
policy or describe an unexecuted browser check as passing.
