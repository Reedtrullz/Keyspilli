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
five-page window already bounds the measured path. Main-thread fallback lays
out all page strings and is not covered by this worker result. Maximum-supported
source stress, slower owner devices, fallback retention, worker CPU/RSS/PID
measurement and real deployed limits remain explicit additional measurements.
Record these before choosing performance or container budgets. Do not infer
real keyboard/audio, musical, screen-reader or disaster-recovery acceptance
from this receipt.
