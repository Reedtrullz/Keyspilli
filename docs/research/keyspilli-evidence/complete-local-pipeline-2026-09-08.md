# Complete local tutorial pipeline — 8 September 2026

## Implemented path

The development-only /youtube form posts to /api/youtube/import. The route uses the existing mutation-origin check and authenticated queue handler. The real worker claims the job, searches YouTube, downloads a selected tutorial, runs colored-key extraction, builds source-profile variants and ingests them under a new preview base. The player exposes the actual tutorial, the requested recording, unverified rights/melody status, four difficulties and downloads.

The CLI and worker now share tutorial-route.ts. Neither full-band audio transcription nor a manually supplied MIDI was used in these runs.

## Live evidence

Three original recording links were submitted through the in-app browser to an initially empty local catalog on port3103. No transport mocks, pre-seeded videos or MIDI:

| Recording | Seconds from queue creation to done | Selected tutorial | Public levels |
|---|---:|---|---:|
| Metallica — Nothing Else Matters | 19.841 | DzAGQbvDpns | 4 |
| AC/DC — Back In Black | 12.238 | vo2EKse1FUM | 4 |
| Nirvana — Come As You Are | 18.845 | YbCciu_p9VA | 4 |

All12 MIDI HTTP exports parse and match the selected candidate's reductions. Metallica and AC/DC also match their earlier reference note sets. Nirvana selected a different tutorial from the earlier CLI run, so no earlier musical acceptance is claimed for it. All three current searches succeeded on their first selected candidate; the two-failure Nirvana fallback was an earlier CLI result, not this worker result.

The browser opened Metallica's resulting player, displayed four levels and source provenance, advanced playback from0:00 to0:38, paused, and emitted a download event when MIDI was clicked. This observes player operation and download, not an independent auditory evaluation.

## Checks

64 worker tests,151 web tests and1,085 catalog tests pass. Worker coverage includes development-only eligibility, production rejection, source provenance, unsupported candidates and cancellation without resurrecting a song. Web coverage includes same-origin submission, cross-origin rejection, rejection of existing-song overrides and production-mode disablement. Web, worker and catalog typechecks pass.

The real-run receipt is complete-local-pipeline-2026-09-08.json. Private reproduction/check scripts are output/tutorial-recovery/check-complete-pipeline.mts and check-three-complete.mts.

## Running locally

Start the existing web app and worker with KEYSPILLI_TUTORIAL_PREVIEW=1 and the same isolated KEYSPILLI_DATA_DIR. Worker NODE_ENV must be development. Set KEYSPILLI_TUTORIAL_PYTHON to the optional Python3.12 environment containing lumachords0.1.4. Configure the normal application API token without committing it. The current local database is output/tutorial-recovery/complete-pipeline.

The optional Python environment is not packaged in the production Docker image. Production mode deliberately refuses this preview. Source rights remain unverified, and three familiar songs are not broad musical-quality/coverage proof. No production deployment or existing-song replacement occurred.
