# Task 3 checkpoint — phrase-local correction UI

Date: 2026-09-18
Worktree: `/Users/reidar/.codex/worktrees/musically-useful-chords-mode`
Branch: `codex/musically-useful-chords-mode`

## Current state

- Core phrase-local override tests: passing.
- SoundControls focused tests: passing in the last agent run (`7/7`).
- Web workspace typecheck: passing in the last agent run.
- Producer phrase-local browser/scratch test: passing (`1/1`) after a deterministic
  bar/seek gate and genuinely overlapping fixture pair; no production or live-state mutation.
- Source-only backing browser persistence check: passing (`1/1`) after a fresh web build.

## Exact failure

```text
getByTestId("melody-phrase-actions").toBeAttached({ timeout: 15000 })
```

The trace showed the worker reaches `worker-ready` and the first phrase (`0.0–6.5` beats) is briefly visible. The test had treated the interim source fallback's `Inferred melody` status as arrangement-ready, then searched by clicking `Next measure` while the active phrase could expire. The phrase action panel was therefore absent at the assertion; this was a browser-test readiness/seek race, not a source-backing reduction result.

## Narrow next fix

Gate the test on an actual rendered phrase and seek deterministically to a known
phrase (bar 1 / beat 0) before asserting `melody-phrase-actions`. The overlap
case uses two intersecting invalid records so one record remains non-exact after
the producer splits phrase boundaries. Preserve the existing phrase-local
storage assertions and keep source-backing reduction as a separate control/path.

## Non-claims

This checkpoint does not claim browser acceptance, automatic source-backing reduction, musical usefulness, or production readiness. Oops `[64,108)` remains unresolved for automatic density reduction; current full-stream metrics remain source-linked and must keep support-only and full-stream denominators separate.
