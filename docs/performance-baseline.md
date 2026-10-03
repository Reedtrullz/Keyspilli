# Product performance baseline

Run the isolated fixture with Node 22.22.3 after building the web app:

```sh
cd apps/web
KEYSPILLI_PERF_BASELINE=1 npx playwright test --config playwright.roadmap.config.ts
```

The test creates and removes one authored 640-note, 160-measure fixture in a
run-owned scratch catalog. Its JSON attachment records exact fixture SHA-256,
Node/browser versions, viewport, three fresh browser contexts, cold/warm browser
navigation, first scheduled synth note, upload, sheet readiness, PDF latency,
long tasks, estimated retained SVG string bytes and Chromium heap estimates.
Cold/warm navigation means browser cache state; it does not prove worker layout
reuse across a full navigation. First scheduled audio excludes speaker/device
latency. The upload currently has one sample, clearly marked in the JSON.

The retained checked receipt is `performance-baseline-2026-10-02.json`.
After the Verovio 6.3.0 upgrade, three runs observed cold Home 123–227 ms, warm Home 93–151 ms,
first scheduled note 234–496 ms, sheet readiness 1130–2182 ms and PDF
1155–1307 ms. These are local timings, not production thresholds or speedup
claims. The seven-page worker score retained at most five interactive SVG strings
and approximately 1.01 MB of UTF-16 string content while scrolling through all
pages and back. No monotonic whole-score string accumulation was observed on
this worker path. WASM/native renderer memory is outside that estimate.

No new cache or latency budget is justified by this small baseline. The current
five-page window bounds both renderer paths after PR-23; main-thread fallback
holds its toolkit and generates only requested pages. Native/WASM toolkit memory
remains outside the retained-string estimate. Generated decoder CPU/RSS/PID probes
are recorded separately in `docs/research/2026-10-02-local-decoder-resource-probe-3.json`;
they do not qualify full-worker or deployed limits. Owner-device, speaker/keyboard,
musical, screen-reader and disaster-recovery acceptance remain separate.

For the joint supported note/grid-workload ceiling, run:

```sh
cd apps/web
KEYSPILLI_PERF_BASELINE=1 KEYSPILLI_PERF_STRESS=1 npx playwright test --config playwright.roadmap.config.ts
```

The generated 5/4 fixture contains 20,000 notes, 500 measures and 2,500 beats:
200 million note/grid pairs at the default quarter-beat arrangement grid. It uses
three new browser contexts for each of the worker and forced main-thread paths.
The second fixed shape uses 4,096 notes across 4,096 beats and 2,048 2/4 measures.
Run it with `KEYSPILLI_PERF_STRESS=span` in the same command. Owner-device
measurements remain separate. Stress waits are bounded at 40 seconds; the ordinary
small-fixture five-second wait is not a product performance budget. PDF rendering
retains its production deadline. No arbitrary device thresholds are adopted.

The retained stress receipt is `performance-stress-2026-10-02.json` (six samples,
no pre-warmed export request). Worker sheet readiness ranged 3.01–13.81 seconds
and fallback 2.66–12.37 seconds; classic PDF ranged 4.15–5.23 seconds across both.
Both paths retained at most five interactive SVG pages within the 4 MiB ceiling.
These repeated local timings include shared-host contention and establish no
production or owner-device latency promise. The earlier five-second measurement
timeout triggered cleanup while a sheet read was pending; the resulting stale
pin was a cleanup consequence, not proof of a publication race.

The second retained receipt is `performance-span-2026-10-02.json` (six samples).
Worker sheet readiness ranged 5.03–8.77 seconds, main-thread fallback 3.91–6.66
seconds, and classic PDF 5.18–8.35 seconds. Both paths retained at most five pages
and stayed within the same 4 MiB interactive string ceiling. This reaches the
beat/measure limits without pretending every combination of source limits fits.

For a physical input trial, use the [input timing validation protocol](input-timing-validation.md). Its manual offsets retain raw results and do not measure hardware latency.
