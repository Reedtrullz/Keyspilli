# Task 3 checkpoint — phrase-local correction UI

Date: 2026-09-18
Worktree: `/Users/reidar/.codex/worktrees/musically-useful-chords-mode`
Branch: `codex/musically-useful-chords-mode`

## Current state

- Core phrase-local override tests: passing in the full player-core suite (`258/258`).
- SoundControls focused tests: passing (`7/7`).
- Web workspace typecheck and production build: passing.
- Producer phrase-local browser/scratch test: passing (`1/1`) after a deterministic
  bar/seek gate and genuinely overlapping fixture pair; the overlap case now
  asserts that every phrase action is unselected until review is resolved.
- Source-only backing browser persistence check: passing (`1/1`) after a fresh
  web build; the status remains source-backed after reload.

## Earlier browser failure and fix

```text
getByTestId("melody-phrase-actions").toBeAttached({ timeout: 15000 })
```

The trace showed the worker reaches `worker-ready` and the first phrase (`0.0–6.5` beats) is briefly visible. The test had treated the interim source fallback's `Inferred melody` status as arrangement-ready, then searched by clicking `Next measure` while the active phrase could expire. The phrase action panel was therefore absent at the assertion; this was a browser-test readiness/seek race, not a source-backing reduction result.

## Applied fix

The test now gates on an actual rendered phrase and seeks deterministically to a
known phrase (bar 1 / beat 0) before asserting `melody-phrase-actions`. The
overlap case uses two intersecting invalid records so one record remains
non-exact after the producer splits phrase boundaries. Conflicts now clear all
phrase action radios, and the global reset is labelled `Reset all saved choices`.
Source-backing reduction remains a separate whole-song preview control.

## Non-claims

These focused browser checks do not claim broad browser acceptance, automatic
source-backing reduction, musical usefulness, or production readiness. Oops
`[64,108)` remains unresolved for automatic density reduction; the optional
source-only preview remains source-linked, does not change the attack grid, and
must keep support-only and full-stream denominators separate.
