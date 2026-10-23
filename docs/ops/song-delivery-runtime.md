# Complete-delivery runtime qualification

Use the actual stock FluidSynth executable with a licensed acoustic piano bank.
The delivery command does not acquire a bank or change the selected MIDI program.
Record both the executable build version and the loaded library version, which
can differ on a system with compatible shared-library updates. Keep their hashes
and the selected bank/preset in the verification receipt; do not distribute a bank
merely because the rendered audio is included in a handoff.

The current delivery profile keeps22050Hz,gain0.2,120s per backend and256MiB WAVs.
Local banks have a separate1536MiB cap. This bounded exception admits the already
installed FreePats Salamander Yamaha C5 bank (1,266,462,334bytes) after a matched
MIDI diagnostic identified improved bass attack/pitch clarity over TimGM6mb.
The stock macOS diagnostic took6.26s and maximumRSS1,517,518,848bytes; this does
not qualify arbitrary banks or memory configurations. Bank selection stays explicit,
no bank is acquired/copied, and comparison arms must use the same bank. Old256MiB
bank refusals and adverse TimGM listening evidence remain retained. No WAV, symbolic
input, phrase-plan, renderer deadline or clipping limit is increased.

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
and put its directory first on PATH before `pnpm install --frozen-lockfile` or Python helper tests.
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

The pre-correction Batch 1 macOS qualification had both a passing full run and a later full run
with one finite-helper ownership failure, using Node 22.22.3, default repository
concurrency and an external physical temporary path. A matched base/candidate
comparison also observed this intermittent failure on unchanged base source.

The continuation traced the failed finite helper's actual group probes: after
natural completion they returned `EPERM`, including the attempted TERM, and the
receipt correctly remained `descendants` with `groupClosed=false`. On macOS
27.2 arm64, a controlled same-UID kernel experiment held a known exited group
member unreaped: `kill(-group, 0)` returned `EPERM`; reaping that member changed
the identical probe to `ESRCH`. The experiment reproduced twice. Apple's public
[XNU group-signalling code](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_sig.c#L1612)
excludes zombies and permits this error when the group still exists but has no
eligible member. Natural completion alone therefore does not establish absence.

The captured failure was an OS reaping/probe limitation, not evidence that the
helper ignored its natural-exit timer. Do not translate `EPERM` into success:
the same error can represent a real permission failure. All unknown-probe and
signal-error refusals, the 250 ms passive window, and ownership assertions remain
unchanged. Seven of eight bounded diagnostic finite-helper runs passed and one
reproduced the exact failure; these overlapping runs do not replace the latest
full-suite result or qualify every macOS process environment. Linux CI and stock
tini qualification remain separate applicable receipts.

The preparation host observes Darwin group membership through stock
`/bin/ps -g <owned-group> -p <caller>,<observer> -o pid=,pgid=`. A fixed `/bin/sh`
command uses `exec` to retain the observer PID and passes numeric selectors as
positional arguments. Targeted selection avoids whole-table output; the
whole-table query previously exceeded its 250 ms cap during native
tests. Any matching member, including a zombie, keeps the group present until
reaped. Absence requires a successful, bounded, strictly parsed process-table
snapshot containing both the observer and caller. A failed query, stderr warning,
truncated/malformed output or missing sentry remains sticky uncertainty. There
is no fallback that translates `EPERM` into success. Linux retains its signal-zero
probe, with `ESRCH` interpreted only by that backend; an observer spawn error
with the same code cannot prove group absence.

The 250 ms passive window, original command deadline, 500 ms KILL escalation and
5,000 ms cleanup bound are unchanged. Snapshot execution counts against the
existing monotonic before/after checks; absence first observed after a passive
or command deadline cannot grant successful delivery. Each stock query itself
has a 250 ms cap and bounded output. TERM and KILL are each attempted once per
owned group across timers and cleanup, avoiding repeated signals to an exited
group while waiting for reaping. First signal errors still prevent certification.

The controlled native regression holds a known same-UID zombie unreaped, observes
actual `kill EPERM` alongside positive stock enumeration, explicitly reaps it,
then observes absence. This validates the changed observation mechanism; it is
not a guarantee about escaped descendant trees or silently restricted OS process
visibility. Existing cancellation, late-observation, unknown-probe and signal-error
assertions remain required.

Private-edge CI pulls the official Caddy 2.6.2 image from Docker Hub by immutable
index digest. The web build and isolated restore prefetch use Docker Hub with the
existing Node 22.22.3 image digest unchanged. ECR Public's anonymous data-transfer
quota produced `Data limit exceeded` across both retained runner attempts; the
existing bounded retries cannot clear that quota. Registry acquisition does not
skip the edge, restore, browser or image checks.

## Native browser rehearsal

The existing `runtime-rehearsal.yml` builds the web and worker on native Linux
amd64 using the public seed catalog. Its opt-in `deploy/restore-app.py ...
--sampled` check runs Chromium **inside** the restored web container, with an
inspected 1.5 CPU quota, 1 GiB memory and 128 PID limit. The host and immutable
image must both be amd64. Host-side playback or emulation does not qualify this
check. The five-argument restore command remains an HTTP/framing canary; its
`browserPlaybackAcceptance: not_tested` field is intentionally unchanged.

The sampled check mounts only the allowlisted test SDK and source paths read-only.
Its generated MusicXML software control is uploaded into the owned writable
restore copy, then deleted through the application API. It records six seconds
of actual Original and Chords PCM with the maintained Player capture helper,
including the full sampled-bank transfer barrier and unchanged readiness,
signal and clipping assertions. A separate idle, paired recorder control must
remain silent. MIDI and MusicXML are downloaded through the actual active UI
selection and checked for mode, hash and note/time parity. PDF requests reuse
that selection after the capture browser exits; this part checks the API path,
not a PDF button click. No provider inference is called.

The controller waits for startup without rendering PDFs, runs the native probe,
then runs all seven full HTTP/framing checks, including both PDF layouts.
This prevents the server's cached PDF Chromium from overlapping the recorder's
Chromium before capture. Readiness alone is never full application acceptance.
The first native run at test merge `8a5714b723059d96d800868749063911a2183754`
failed at the first browser page before PCM; browser overlap was confirmed,
but PID exhaustion was not established. Its raw evidence remains retained.
Native browser debug stderr is retained by the owned Docker lifecycle logs.

The generated native upload control has an explicit played left-hand C/E/G
stack, not octave-unison C notes. Its real ingest/detail/backing regression
requires playable Chords throughout the capture window; the former ambiguous
octave control remains a negative and must stay silent. This qualifies a software
control, without changing harmony refusal, catalog music or approval pins.
Raw mode WAVs and source/clock counters are persisted before signal rejection;
an empty-start failure also retains bounded page state and a screenshot. Those
diagnostics never make a rejected capture pass, and raw passing WAVs are reused
for the normal receipt rather than copied a second time.

The native workflow explicitly selects `--sampled --image-sizes` to record
Docker's measured uncompressed bytes for both backup-pinned images. Standalone
`--sampled` retains its web-only contract and needs no local worker image. Their conservative sum (including shared layers twice)
must fit the existing managed scratch budget, 16 GiB by default, before canary
container creation. Sizes and the selected limit are retained in the runtime
receipt. This is candidate qualification, not production disk admission.

The rehearsal stages the existing Player's complete 226-file Ogg bank before
starting the network-disabled container. `prepare-native-piano.mts` uses the
retained Chromium capture's URL/byte/SHA-256 pins, verifies the installed smplr
1.1.0 module and full preset inventory, and reuses only verified read-only,
single-link files. Writable or linked inputs are refused without chmod/repair.
Acquisition has four workers, a two-minute total bound, a 256 MiB inventory cap
and a 6 GiB free-space reserve. Failed/corrupt/foreign inputs are preserved and
refused; they are never silently repaired. The managed run seals these inputs
and diagnostics before releasing scratch on failure, cancellation or success.

Set `KEYSPILLI_NATIVE_PIANO_DIR` to that canonical input directory for the
sampled restore. It is mounted read-only at `/piano-input`; the browser fulfills
only the pinned sample URLs from those bytes. All 226 actual transfers, decoding
and signal assertions still run. This qualifies offline input transport, not
live CDN reachability. Upstream [documents AKAI's samples as public domain](https://github.com/sfzinstruments/SplendidGrandPiano#splendid-grand-piano);
the fixture records that authority and the retained capture hash. No bank is
added to the production image or musical baselines. Historical reference-bank
module pins remain unchanged. Recorder initialization is self-contained under
tsx's function-name serialization; the existing PCM and timing checks remain.

`native-player/result.json`, PCM, screenshots and exports are retained alongside
the restore report and lifecycle reconstruction evidence. Failures, timeouts
and cancellation cannot produce a successful application report; owned-container
cleanup still runs. A cleanup failure remains a failure. The job's existing
45-minute and restore-step 12-minute bounds are unchanged. This synthetic runtime
check does not establish musical, physical-keyboard, independent listening,
production-catalog or production-deployment acceptance.

## Acceptance scope

Keep code review, stock-renderer operation, actual browser handoff, independent
musical/keyboard assessment and installation separate. Where a local browser is
blocked by environment policy, retain that refusal and use the supported CI
browser environment for the same owned test artifacts; do not disable browser
policy or describe an unexecuted browser check as passing.
