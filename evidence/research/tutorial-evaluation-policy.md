# Tutorial evaluation phase 1

The 30 original recording URL manifest fixes 20 development and 10 held-out positions. Metadata-only checks may correct demonstrably wrong recording labels before freezing the final manifest; no held-out extraction, candidate discovery, tuning, or listening is authorized in phase 1. Held-out execution requires a separately created candidate-code freeze artifact, the sealed manifest, and exactly the ten fixed inputs. Preparing this mode does not execute held-out sources. Existing selected source MIDI bytes and parsed note events are frozen independently in `tutorial-evaluation-source-freeze.json`; these are baseline artifacts, not an answer key for new songs.

Frozen structural threshold: at least 8 of all 10 held-out inputs must complete the actual import queue and return four nonempty parseable MIDI exports. Every input remains in the denominator, including unavailable sources, import errors, extraction failures, invalid/empty exports and timeouts. A skipped or partial cohort cannot pass. The release gate also requires the explicitly identified held-out split, verified manifest seal, and exactly the ten distinct frozen held-out IDs; even ten successful development rows cannot pass. `done` alone is insufficient. Runtime budget is 20 minutes per import, 15 seconds per HTTP request, serial execution, continuing after explicit terminal job failure or a completed job with invalid exports; stopping on transport, unknown job status, disk failure, or timeout to avoid overlapping an unresolved worker. HTTP 429 retries respect Retry-After seconds/date within a two-minute total budget and at most three retries; no parallel imports. Disk floor is 30 GiB. The HTTP origin must be a local isolated preview.

Structural candidate is separate from musical usability. Listening must independently assess recognizable melody, useful left hand, rhythm, hand balance and playability at each public level. Human musical acceptance remains pending and `usable` remains false in automated receipts. No source rights or original-performance fidelity claim follows from completion.

Run from repository root with Node 22:

```sh
/Users/reidar/.nvm/versions/node/v22.22.3/bin/node node_modules/tsx/dist/cli.mjs services/transcribe/scripts/evaluate-tutorial-pipeline.ts http://127.0.0.1:3103 output/tutorial-evaluation-NEW 1 development
```

Set the preview's existing `KEYSPILLI_API_TOKEN` in the environment if required; it is never written to receipts. Use a new output directory. The manifest hash, selected input IDs, job ID/status, timestamps, export bytes and note-event hashes are recorded. Never silently resume or replace inputs after seeing outcomes. Held-out execution requires the candidate artifact argument described below; without it the runner rejects before filesystem/network mutation.

Validation: evaluator scoring test passes, malformed MIDI rejects, held-out CLI invocation without a candidate artifact exits 1 before creating output. Source-freeze hashes were computed from eight existing local raw outputs: three selected HTTP sources plus Bohemian, Nothing Else Matters, In My Mind, Just Tonight partial v1, and For I Am Death. Raw baseline preservation does not imply user musical acceptance; unknown acceptance remains explicit. No new import, extraction, media download, build, or musical acceptance run was performed for this infrastructure change.

## Candidate freeze and later held-out execution

After development changes and checks are final, create a new, non-overwritable artifact with no network or media work:

```sh
/Users/reidar/.nvm/versions/node/v22.22.3/bin/node node_modules/tsx/dist/cli.mjs services/transcribe/scripts/evaluate-tutorial-pipeline.ts --freeze-candidate output/CANDIDATE.json
```

The artifact freezes the manifest hash and the complete recursive file sets and bytes (excluding generated Python `__pycache__`) under worker source, MIDI source, catalogue source, web API and web library directories, plus the evaluator and dependency manifests. An added, removed or changed source file fails verification. Before every source and after every source/run, the evaluator checks against this artifact. Any drift makes the release gate false and stops the batch. This attests local source files; the operator must restart the isolated preview and worker from this checkout before running. It does not prove which code a separately running server loaded, Python environment identity, or external YouTube behavior.

A later explicitly authorized held-out run uses exactly this command shape:

```sh
/Users/reidar/.nvm/versions/node/v22.22.3/bin/node node_modules/tsx/dist/cli.mjs services/transcribe/scripts/evaluate-tutorial-pipeline.ts http://127.0.0.1:3103 output/HELDOUT-NEW 10 heldout output/CANDIDATE.json
```

There is no held-out subset selection. The release gate requires verified candidate hashes before and after with no intermediate change. Do not tune against held-out outcomes or recreate the freeze after seeing them.

For targeted development reruns, replace the count with `ids=01,04,07` and keep `development`. IDs must be unique members of the development cohort. Receipts distinguish full cohort size, selected denominator, attempted imports, unattempted selected IDs, completed structural candidates and failed rows. A disk/check failure before submission is unattempted. A failed HTTP submission is attempted with unknown job ownership and stops the batch. Public job error text (bounded to 2000 characters), local failure reason and job status are retained. Targeted reruns do not replace earlier results or establish whole-cohort coverage.


## Fresh prospective cohort after a failed frozen run

The original v1 result remains4/10 and immutable. A later candidate may use a separately selected, sealed prospective cohort; this does not replace or improve the historical score. Declare the pool, exclusion rule and selection before any extraction, retain metadata search evidence, and never replace inputs after outcomes.

Set `KEYSPILLI_EVALUATION_MANIFEST` to the absolute JSON path for both freeze and execution. A matching `.sha256` sidecar is mandatory. The candidate binds that manifest hash; a candidate frozen for another cohort is rejected. All ten prospective rows, candidate stability checks and existing structural/listening boundaries still apply. Default commands continue using the original manifest.
