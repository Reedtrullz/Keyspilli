# Keyspilli Tasks 17–18 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish original Keyspilli Tasks 18 and 17 with exact-revision green CI, verified runtime behavior, and independent acceptance, without weakening the existing guards.

**Architecture:** First remove the remaining task-count pressure from the guarded Chromium lane by limiting non-browser Node worker pools and recording role-level task counts. Qualify that runtime once, then measure the web build-context optimization and the player performance investigation independently against the qualified common graph.

**Tech Stack:** Node 22.22.3, TypeScript, pnpm 10.34.5, Playwright/Chromium, Python 3 stdlib, Docker/BuildKit, GitHub Actions.

**Spec:** `/Users/reidar/Documents/Codex/2026-10-20/new-chat/.omo/plans/keyspilli-t17-t18-complete-20261106.md` (SHA-256 `4c9e00ed8e7c0c3a0bed6c50343ed7916ce173fd350087b4cf2871eb6c0ffc47`). Original acceptance remains in `/Users/reidar/Documents/Codex/2026-10-20/new-chat/.omo/plans/portfolio-performance-optimization.md`, Tasks 17 and 18.

## Global Constraints

- Work only in owned worktrees; preserve dirty primary checkout and all prior evidence.
- Keep the container network disabled, read-only root, UID/GID `1000:1000`, capability drop `ALL`, `no-new-privileges`, `1.5` CPUs, `1 GiB` memory where currently fixed, writable mounts, and PID limit `128`.
- Do not change Chromium launch flags or weaken any seccomp, filesystem, network, model, codec, worker, restore, or cancellation guard.
- Keep the 64 MiB aggregate transport cap, 16 MiB log cap, 512 MiB extraction cap, ten-part maximum, 7 MiB part maximum, and 60-second download deadline.
- Keep the 30 GiB local disk floor and `33,867,431,936` byte hosted reservation plus managed usage.
- No local dependency installation, paid runner, new provider/login, production call, private data, merge, deploy, force-push, generic retry, or counter reset.
- One active heavy hosted job at a time. The runtime comparison gets one attempt on one new exact head. A failed comparison stops the runtime-dependent chain.
- No task credit until exact current-head ordinary CI, separate guarded native evidence, task measurements, and independent acceptance all pass.

## File Structure

- `deploy/player-guard-run.mjs`: owns guarded container creation, process identity, evidence lifecycle, and the no-cleanup selector.
- `apps/web/scripts/verify-native-player.mts`: owns in-container phase records and native player proof.
- `apps/web/scripts/native-task-counts.ts`: new focused helper for classifying processes into bounded roles.
- `deploy/test/player-guard.test.mjs`: unit and contract tests for guard launch, phase evidence, and result parsing.
- `.github/workflows/runtime-rehearsal.yml`: owns the single guarded Ubuntu 26.04 comparison/full lanes and scoped PR selectors.
- `apps/web/Dockerfile.dockerignore`: Task 18 product change; must contain the complete root ignore rules plus only `/services/transcribe/test/*.py`.
- `deploy/test/test-web-dockerignore.py`: focused Task 18 ignore-rule contract test.
- `apps/web/e2e/performance-baseline.spec.ts` and `apps/web/e2e/perf-viewport.ts`: Task 17 native benchmark surface.
- `work/portfolio-performance/tools/keyspilli_perf_probe.mjs`: Keyspilli-only explicit-argv adapter from `MEASURE_REQUEST` to the existing Playwright benchmark.
- `work/portfolio-performance/cases/T17-*.json` and `T18-{cold,steady}.json`: six frozen Task 17 cases and two Task 18 timing cases.
- `.omo/evidence/keyspilli-t17-t18-20261107/`: immutable attempt, raw, comparison, CI, and publication evidence.

## Review Focus

- A Chords capture may create enough threads to hit `pids.max=128`; it must remain at or below 120 tasks with no `pids.events max` increment.
- A browser pass may report success without actual sampled audio, the worker-rendered sheet, or required exports.
- Evidence may be truncated, forged, stale, duplicated, or reconstructed from the wrong revision.
- Task 18 may exclude a non-test runtime file, leak private build context, or charge the ignore file incorrectly.
- Task 17 may compare timestamps across different hosts, count nested renderer observations as runs, or label incomplete coverage as no-gain.

---

### Task 1: Bound Non-Browser Node Thread Pools

> **Owner-approved architecture correction after Task 2's first hosted attempt:** the one-container task limit cannot hold the app server and Chromium's audio workload together. The runtime must use two isolated sidecars with a private shared loopback namespace, preserving aggregate CPU `1.5`, aggregate memory `1 GiB`, aggregate writable tmpfs `40 MiB`, and an independent `128`-task limit on each container. The Node settings remain defense in depth.

**Files:**
- Modify: `deploy/player-guard-run.mjs:515-540`
- Test: `deploy/test/player-guard.test.mjs`

**Interfaces:**
- Produces: `NODE_RUNTIME_ENV: Readonly<{NODE_OPTIONS: '--v8-pool-size=2'; UV_THREADPOOL_SIZE: '2'}>`
- Produces: `guardEnvironment(diagnosticName?: string): string[][]`, whose returned pairs are passed only as guarded-container `-e` arguments.

- [ ] **Step 1: Write the failing test**

Add to `deploy/test/player-guard.test.mjs`:

```js
test('guarded runtime caps non-browser Node worker pools without changing Chromium or PID guards', () => {
  assert.deepEqual(NODE_RUNTIME_ENV, {
    NODE_OPTIONS: '--v8-pool-size=2',
    UV_THREADPOOL_SIZE: '2',
  });
  const pairs = guardEnvironment();
  assert(pairs.some(([key, value]) => key === 'NODE_OPTIONS' && value === '--v8-pool-size=2'));
  assert(pairs.some(([key, value]) => key === 'UV_THREADPOOL_SIZE' && value === '2'));
  assert(!pairs.some(([key]) => key.startsWith('CHROME_') || key === 'DEBUG'));
  const args = guardLaunchArgs('owned', diagnosticProfile('control'));
  assert.equal(args[args.indexOf('--pids-limit') + 1], '128');
  assert.equal(args[args.indexOf('--cpus') + 1], '1.5');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `/Users/reidar/.local/bin/node --experimental-strip-types --test deploy/test/player-guard.test.mjs`

Expected: FAIL because `NODE_RUNTIME_ENV` and `guardEnvironment` do not exist.

- [ ] **Step 3: Implement the exact environment contract**

Export the frozen `NODE_RUNTIME_ENV` and `guardEnvironment()` from `deploy/player-guard-run.mjs`. Keep the existing base environment pairs and diagnostic-only pairs in `guardEnvironment()`. Replace the inline loop at the current `host()` launch with:

```js
for (const [key, value] of guardEnvironment(diagnostic ? profileName : undefined)) {
  args.push('-e', `${key}=${value}`);
}
```

Do not mutate `process.env`; do not add either setting to the parent GitHub job or Docker image.

- [ ] **Step 4: Run the complete guard test**

Run: `/Users/reidar/.local/bin/node --experimental-strip-types --test deploy/test/player-guard.test.mjs`

Expected: `pass 30`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add deploy/player-guard-run.mjs deploy/test/player-guard.test.mjs
git commit -m "test(player): cap non-browser worker threads in the native guard"
```

### Task 2: Attribute Every Phase Task to a Known Role

**Files:**
- Create: `apps/web/scripts/native-task-counts.ts`
- Modify: `apps/web/scripts/verify-native-player.mts:7-51`
- Modify: `deploy/player-guard-run.mjs:220-229,537`
- Modify: `deploy/test/player-guard.test.mjs`
- Modify: `.github/workflows/runtime-rehearsal.yml:10-28`

**Interfaces:**
- Produces: `collectTaskCounts(procRoot: string, selfPid: number, guardPid: number): {processes:number;threads:number;vanished:number;roles:Record<'guard'|'app-node'|'automation-node'|'chromium'|'crashpad'|'unknown',{processes:number;threads:number}>}`
- Produces: `summarizeTaskCounts(rows: Array<{pid:number;ppid:number;name:string;threads:number}>, selfPid:number, guardPid:number)` returning the same shape; `collectTaskCounts()` reads `/proc` and delegates classification to this pure function.
- Produces: `requireDiagnosticEvidence()` rejects any guarded diagnostic sample containing `unknown.processes > 0` or role totals that do not equal aggregate totals.

- [ ] **Step 1: Write failing role-mapping tests**

Add tests that build temporary `/proc` fixtures and assert:

```js
assert.deepEqual(summarizeTaskCounts([
  {pid: 10, ppid: 1, name: 'player-guard', threads: 1},
  {pid: 20, ppid: 10, name: 'node', threads: 18},
  {pid: 30, ppid: 10, name: 'node', threads: 20},
  {pid: 40, ppid: 30, name: 'chrome', threads: 31},
  {pid: 41, ppid: 30, name: 'chrome_crashpad_handler', threads: 3},
], 30, 10), {
  processes: 5, threads: 73, vanished: 0,
  roles: {
    guard: {processes: 1, threads: 1},
    'app-node': {processes: 1, threads: 18},
    'automation-node': {processes: 1, threads: 20},
    chromium: {processes: 1, threads: 31},
    crashpad: {processes: 1, threads: 3},
    unknown: {processes: 0, threads: 0},
  },
});
```

Add rejection cases for an unexpected executable, a process with no reachable owned parent, a zero thread count, and inconsistent aggregate totals. Add a source-contract assertion that Chromium launch arguments remain byte-identical to their pre-correction values.

- [ ] **Step 2: Run and verify failure**

Run: `/Users/reidar/.local/bin/node --experimental-strip-types --test deploy/test/player-guard.test.mjs`

Expected: FAIL because the role helper and role assertions do not exist.

- [ ] **Step 3: Implement bounded role classification**

Read only `/proc/<pid>/status` fields `Name`, `PPid`, and `Threads`. Build the owned process tree from `guardPid`; identify the caller PID as `automation-node`, its direct sibling Node process as `app-node`, and descendants named `chrome`, `chrome-headless-shell`, or `chromium` as `chromium`. Map `chrome_crashpad_handler` to `crashpad`. Every other reachable process is `unknown`.

Do not read `cmdline`, environment, maps, descriptors, headers, request bodies, or user data.

In `verify-native-player.mts`, keep aggregate process/thread data at every phase. Add `roles` only at these phases to remain below the 8 KiB phase trace: `startup`, each `*-browser-startup`, each `*-capture`, `silence`, each `*-browser-teardown`, `teardown`, and `result`.

Add the new helper to the explicit `MOUNTS` list and the workflow path triggers.

- [ ] **Step 4: Run all role tests**

Run: `/Users/reidar/.local/bin/node --experimental-strip-types --test deploy/test/player-guard.test.mjs`

Expected: all tests pass, including sum consistency and adversarial role failures.

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/native-task-counts.ts apps/web/scripts/verify-native-player.mts deploy/player-guard-run.mjs deploy/test/player-guard.test.mjs .github/workflows/runtime-rehearsal.yml
git commit -m "test(player): attribute native phase tasks by owned role"
```

### Task 3: Pass the Offline Runtime Gate and Seek Admission

**Files:**
- Create: `.omo/evidence/keyspilli-t17-t18-20261107/E/01/admission.json`
- Preserve: prior run `42234361082` and `.omo/operations/keyspilli-original-chords-20261106/*`

**Interfaces:**
- Consumes: Tasks 1–2 exact commit and tree.
- Produces: an admission manifest containing the repository, ref, head, tree, current main, plan hash, test hashes, one comparison attempt, and one full attempt.

- [ ] **Step 1: Run every self-contained check**

```text
/usr/bin/python3 -B deploy/test/test-evidence.py
/usr/bin/python3 -B deploy/test/test-evidence-transport.py
/usr/bin/python3 -B deploy/test/test-restore-app.py
/Users/reidar/.local/bin/node --experimental-strip-types --test deploy/test/player-guard.test.mjs
```

Expected: exit `0` for each; evidence lifecycle `38`, transport `5`, restore `25`, player guard at least `30`.

- [ ] **Step 2: Verify graph and capacity before push**

Run `git status --porcelain=v1`, `git rev-parse HEAD HEAD^{tree}`, `git merge-base --is-ancestor origin/main HEAD`, and `df -Pk /System/Volumes/Data`.

Expected: clean tracked tree, exact hashes, current main ancestor true, at least `31457280` KiB free.

- [ ] **Step 3: Freeze admission and intent**

Create `E/01/admission.json` with plan SHA, base/head/tree, self-contained test log hashes, host capacity, one allowed comparison, one allowed full qualification, transport cap `67108864`, and no-retry flag.

- [ ] **Step 4: Push nonforce and dispatch once**

Push the descendant commit to `codex/keyspilli-native-full-20261104`, verify remote HEAD, then:

```bash
gh workflow run runtime-rehearsal.yml -R Reedtrullz/Keyspilli \
  --ref codex/keyspilli-native-full-20261104 \
  -f expected_commit="$SHARED_SHA" \
  -f mode=observe-control-v1
```

Expected: one run, attempt `1`, exact SHA.

- [ ] **Step 5: Collect and adjudicate**

Use a task-local copy of `collect-transport.py` with the new head and retained 64 MiB cap. Require three browser launches, no `pids.events max` increment, `unknown.processes == 0`, Chords completion, all native outputs, verified reconstruction, and released resources.

If any condition fails, preserve the evidence and stop this runtime branch. Do not dispatch a replacement.

### Task 4: Pass the One Full Shared Qualification

**Files:**
- Create: `.omo/evidence/keyspilli-t17-t18-20261107/E/02/{intent,run,transport,verdict,cleanup}.json`

**Interfaces:**
- Consumes: accepted Task 3 comparison at the same head/tree.
- Produces: one `SHARED_RUNTIME_ACCEPTED` receipt binding both native images, player evidence, worker shutdown, restore, and release.

- [ ] **Step 1: Recheck the exact graph**

Require remote/ref/head/tree equality, no active run on the ref, clean local checkout, and capacity reservation.

- [ ] **Step 2: Dispatch the full qualification once**

```bash
gh workflow run runtime-rehearsal.yml -R Reedtrullz/Keyspilli \
  --ref codex/keyspilli-native-full-20261104 \
  -f expected_commit="$SHARED_SHA" \
  -f mode=rehearsal-no-cleanup-v1
```

- [ ] **Step 3: Verify all required behavior**

Require both amd64 images, Original/Chords/silence, all 226 pins, nonzero PCM, worker sheet, MIDI/MusicXML/PDF, clean worker SIGTERM, real backup, isolated restore, restored application/player checks, cap compliance, and resource release.

- [ ] **Step 4: Independently accept evidence**

Run the task-local full checker against reconstructed evidence and the exact checkout. A green workflow without accepted raw evidence leaves the gate closed.

### Task 5: Reconcile Task 18 on the Qualified Graph

**Files:**
- Modify: `apps/web/Dockerfile.dockerignore`
- Modify: `.github/workflows/runtime-rehearsal.yml`
- Create: `deploy/test/test-web-dockerignore.py`

**Interfaces:**
- Consumes: `SHARED_RUNTIME_ACCEPTED` and current `main`.
- Produces: a Task 18 candidate whose only product-context delta is the web-specific Python-test omission.

- [ ] **Step 1: Write the failing ignore test**

Create `deploy/test/test-web-dockerignore.py` that asserts the web file starts with the byte-exact `.dockerignore`, adds only the non-comment directive `/services/transcribe/test/*.py`, and leaves root/tutorial-worker ignore files unchanged.

- [ ] **Step 2: Run and verify failure**

Run: `/usr/bin/python3 -B deploy/test/test-web-dockerignore.py`

Expected on the stale draft: FAIL because current main and the old PR graph are not reconciled.

- [ ] **Step 3: Reconcile draft #377**

Merge current `main` into `codex/perf-web-python-tests-context-20261028` without force. Resolve duplicate PR #362 changes in favor of main. Retain the shared runtime correction and only the Task 18 context diff. Ensure the web file contains the complete root exclusions followed by the one extra test-only rule.

- [ ] **Step 4: Run contract tests**

Run the Python ignore test and the player-guard test. Expected: both exit `0`; cap and Chromium flags remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/web/Dockerfile.dockerignore deploy/test/test-web-dockerignore.py .github/workflows/runtime-rehearsal.yml
git commit -m "perf(build): omit Python unit tests from the web source copy"
```

### Task 6: Measure Task 18 and Prove Runtime Parity

**Files:**
- Create: `work/portfolio-performance/cases/T18-cold.json`
- Create: `work/portfolio-performance/cases/T18-steady.json`
- Copy: `.omo/operations/portfolio-keyspilli-copy-20261028-0915/copy_projection.py` to task-owned evidence and update only paths/head.
- Create: `.omo/evidence/keyspilli-t17-t18-20261107/E/03/*`

**Interfaces:**
- Consumes: Task 18 baseline/candidate heads and accepted common graph.
- Produces: strict effective-context reduction, cold/steady comparison, semantic parity, failure parity, and capability parity.

- [ ] **Step 1: Freeze the copy oracle**

Hash `.dockerignore`, `apps/web/Dockerfile.dockerignore`, both Dockerfiles, web Docker COPY inputs, tutorial-worker inputs, native dependencies, codecs, models, fixture inputs, and harness. Freeze only the intended file-removal set.

- [ ] **Step 2: Run the native no-RUN COPY controls**

Run baseline, candidate, and both canary contexts through the copied oracle. Require private files absent, TypeScript files preserved, Python implementation files preserved, only `/services/transcribe/test/*.py` removed for web, modes/symlinks preserved, and full configuration cost charged.

- [ ] **Step 3: Measure cold and steady cases**

Run five A/A pilot pairs in each cohort, then five scored AB/BA cold pairs and ten scored steady pairs with two unrecorded steady warmups. Keep each pair on one runner.

- [ ] **Step 4: Build and inspect both images serially**

Run exact Linux amd64 web and tutorial-worker builds once per revision. Record image/config/layer digests, compressed sizes, UID, imports, startup, codecs, models, and scratch bytes.

- [ ] **Step 5: Prove five offline outputs and failures**

Run the five fixed synthetic jobs on both revisions and compare semantic hashes. Probe read-only/unwritable output, missing optional backend, malformed and oversized input, cancellation, and scratch limit. Preserve explicit failures.

- [ ] **Step 6: Compare**

```bash
python3 work/portfolio-performance/tools/compare.py --task 18 \
  --evidence .omo/evidence/keyspilli-t17-t18-20261107/E/03 \
  --case work/portfolio-performance/cases/T18-cold.json \
  --case work/portfolio-performance/cases/T18-steady.json
```

Require strict effective web-context reduction, no worker context change, semantic/capability parity, no deterministic secondary increase, and timing within the frozen tolerance.

### Task 7: Deliver Task 18

**Files:**
- Modify: draft `#377` branch and body
- Create: `.omo/evidence/keyspilli-t17-t18-20261107/E/03/{ci,guard,review,publication}.json`

**Interfaces:**
- Consumes: Task 6 `T18_ACCEPTED`.
- Produces: one exact-head draft with green ordinary and guarded CI and an independent acceptance receipt.

- [ ] **Step 1: Push the final Task 18 head once**

Verify ancestry, compute the expected check matrix, and push nonforce. Do not rerun an ordinary suite after a source change.

- [ ] **Step 2: Verify ordinary CI**

Require Automatic checks, lint, worker smoke, native restore, applicable CodeQL/music checks, exact head, and intended base synthetic merge. Record every check and actual job checkout.

- [ ] **Step 3: Verify the separate guarded run**

Dispatch or confirm the exact-head `rehearsal` PR lane. Ordinary CI cannot substitute.

- [ ] **Step 4: Obtain complementary review**

Review the final diff, measurements, runtime parity, CI, and issue criteria from a qualified independent model family. Preserve rejected findings if any.

- [ ] **Step 5: Publish and count**

Attach sanitized evidence to Issue #376 and draft #377, verify GitHub readback, and advance original progress from `15/39` to `16/39` only after every criterion passes.

### Task 8: Discover the Task 17 Residual and Freeze Six Cases

**Files:**
- Create: `work/portfolio-performance/tools/keyspilli_perf_probe.mjs`
- Create: `work/portfolio-performance/tests/test_keyspilli_perf_probe.py`
- Create: six `work/portfolio-performance/cases/T17-{small,span,stress}-{mobile,desktop}.json` files
- Modify only if measured need: `apps/web/e2e/performance-baseline.spec.ts` and `perf-viewport.ts`

**Interfaces:**
- Consumes: accepted shared runtime and Task 18 terminal disposition.
- Produces: one justified product change or a frozen baseline-only decision, plus an adapter that emits one `status=complete` native receipt containing every `MEASURE_REQUEST` binding.

- [ ] **Step 1: Run unscored discovery**

Capture first note, first view, Verovio first use/layout, first sheet/PDF, long tasks, transferred bytes, retained SVG, JS/native/WASM memory or explicit unsupported, worker/fallback, playback/seek/wait/rapid switching/stale cancellation/disposal.

- [ ] **Step 2: Confirm the dominant residual at a second layer**

Use a browser trace plus source/runtime evidence. If no single actionable cause exists, freeze a complete baseline-only investigation.

- [ ] **Step 3: Write failing adapter tests**

Test malformed `MEASURE_REQUEST`, wrong fixture, wrong viewport, missing worker proof, zero selected tests, nonzero child exit, missing attachment, duplicate metrics, unsupported dimension, and output over bound.

- [ ] **Step 4: Implement the adapter**

Run the single intended Playwright test with explicit cwd/env/argv and 180-second small / 600-second span/stress deadlines. Preserve nested renderer observations, upload-once accounting, worker/main cohorts, semantic digest, capability digest, and clean process-group teardown.

- [ ] **Step 5: Freeze six cases and slots**

Use 640, 4,096, and 20,000 notes at `390x844` and `1280x800`. Freeze five A/A pilot pairs per case, ten measured pairs for each small case, five measured pairs for each long case, and the exact 56-job map. No post-observation edits.

- [ ] **Step 6: Commit only real source changes**

For a discovered fix, commit its smallest product change and direct regression. For no-gain, commit no player product change.

### Task 9: Size and Execute the Task 17 Matrix

**Files:**
- Create: `.omo/evidence/keyspilli-t17-t18-20261107/E/04/{sizing,slots,samples,failures,comparison}.json`

**Interfaces:**
- Consumes: frozen six cases, adapter, harness hashes, and job map.
- Produces: 60 valid pilot invocations, 80 valid scored invocations, and six paired failure batches.

- [ ] **Step 1: Run one unscored sizing job**

Require the longest case plus warmups, artifacts, cleanup, and 20-minute setup reserve to fit a 45-minute job. Failure retires that path before sample zero.

- [ ] **Step 2: Execute fixed jobs**

Use two small pairs or one long pair per job. Keep both revisions on one runner, one active job, no substitution, no retry, and no backfill.

- [ ] **Step 3: Verify each unit**

Reject missing/clipped/duplicated/rebound samples, wrong phase order, wrong worker/fallback, unsupported dimensions, changed fixture/harness, nonzero teardown, or inadequate headroom.

- [ ] **Step 4: Run failure batches**

For every case, exercise both revisions with malformed/oversized input, cancellation, stale navigation, repeated switching, and disposal.

- [ ] **Step 5: Compare**

Require median improvement above `max(5%, 2 x pilot noise)`, paired-bootstrap lower 95% above zero with 2,000 resamples and seed `1127`, unchanged semantics, and secondary tolerances. No qualifying improvement means keep the baseline and publish the complete investigation.

### Task 10: Deliver Task 17 and Settle the Goal

**Files:**
- Modify: Issue `#363`; create at most one focused Task 17 draft if required
- Create: `.omo/evidence/keyspilli-t17-t18-20261107/E/04/{ci,guard,review,publication}.json`
- Modify: `.omo/boulder.json` and Hermes daily Log

**Interfaces:**
- Consumes: complete Task 17 matrix and verdict, plus Task 18 acceptance.
- Produces: exact-revision CI, guarded native proof, independent acceptance, original progress `17/39`, and closed resource ledger.

- [ ] **Step 1: Recheck exact source**

Verify current base, head, tree, harness, fixture, cases, and actual GitHub checkout. Any source change invalidates affected samples.

- [ ] **Step 2: Run final ordinary CI and guarded native gate**

One suite on the final Task 17 revision, plus the separate full guarded player/worker/restore run. No skipped required check.

- [ ] **Step 3: Obtain complementary review**

Check gain/no-gain logic, comparator inputs, all six cases, 60 pilot and 80 scored launches, six failure batches, runtime correctness, and privacy.

- [ ] **Step 4: Publish**

Publish the supported optimization or complete no-gain investigation to Issue #363 with native attachment/readback. Do not claim incomplete coverage as no-gain.

- [ ] **Step 5: Final audit**

Run F1 plan compliance, F2 code review, F3 raw QA replay, and F4 success criteria. Confirm all workers/watchers/collectors/CI are terminal, leases released, unused allowance retired, evidence paths valid, and no merge/deploy occurred.

- [ ] **Step 6: Count and log**

Advance `15/39 -> 16/39` after Task 18 acceptance and `17/39` only after Task 17 acceptance. Update Boulder, immutable checkpoint, and Hermes daily Log with exact evidence and remaining 37 rows preserved.

## Stop Conditions

- Stop before dispatch if any local contract test, graph check, capacity check, or owner scope check fails.
- Stop the runtime branch after one failed corrected `observe-control-v1`; do not retry or raise the PID cap.
- Stop Task 18 if context reduction is not strict, every intended file is not preserved, worker context changes, offline parity fails, or CI is stale.
- Stop Task 17 if any sample or failure slot is missing, any pair crosses runners, coverage changes after observation, or the comparator rejects the dataset.
- A complete no-gain Task 17 result may close Task 17; an incomplete matrix may not.
