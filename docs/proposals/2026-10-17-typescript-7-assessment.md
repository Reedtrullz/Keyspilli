# TypeScript 7 (tsgo) assessment

Status: assessment only. Nothing in this branch upgrades the compiler yet.
Measured on 2026-10-17 against `main` at `6742f240`, on Node 22.22.3.

## Where TypeScript 7 stands

- **TypeScript 7.0.2** is stable and ships as the plain `typescript` package. It is the Go port: its `tsc` is a native binary, installed through the `@typescript/typescript-<platform>` optional dependency.
- **7.0 has no JavaScript compiler API.** `require("typescript")` only exports the version (`lib/version.cjs`). Experimental APIs sit under `typescript/unstable/*`.
- **7.1 should stabilise a new, different API.** The RC is planned for 2026-11-10 and stable for 2026-11-24, but the beta has already slipped.
- **Microsoft's interim path is a side-by-side install:** `@typescript/typescript6` (the 6.0 API plus a `tsc6` binary) is aliased as `typescript`, and 7.0 is installed under a second name for `tsc`.
- **7.0 adopts 6.0's defaults and turns 6.0 deprecations into hard errors.** The relevant changes are:
  - `types` defaults to `[]`
  - `noUncheckedSideEffectImports` is on
  - strict mode is always on
  - `baseUrl`, `moduleResolution: node10` and ES5 targets are removed
  - `esModuleInterop` can no longer be `false`

Our `tsconfig.base.json` already uses `moduleResolution: "bundler"`, `ES2022`, `strict`, and `esModuleInterop: true`. Each package sets `types: ["node"]`. None of the removed options are in use.

## What breaks

| # | Breakage | Seen as | Fix | Effort |
|---|---|---|---|---|
| 1 | `apps/web/src/app/layout.tsx` imports `./globals.css` as a side effect. TS 6 and 7 check side-effect imports by default. | `TS2882: Cannot find module or type declarations for side-effect import of './globals.css'` (TS 6 *and* 7, and in `next build`'s type step) | `apps/web/src/types/css.d.ts` with `declare module "*.css";`. **Included in this branch**; harmless on TS 5. | done |
| 2 | Next 15.5 loads `next.config.ts` through the TypeScript JS API (`ts.sys`). | `next build` → `Failed to load next.config.ts … Cannot read properties of undefined (reading 'fileExists')` on plain TS 7 | Side-by-side install (the 6.0 API under `typescript`), **or** Next 16, whose `next build` defaults to the `tsc` CLI (`experimental.useTypeScriptCli`) and supports TS 7. Next 16 is #331. | small with side-by-side; tied to #331 otherwise |
| 3 | `apps/web/src/components/player/player-practice-pulse-lifecycle.test.ts` uses `ts.createSourceFile` and `ts.is*` to inspect `FullPlayer`. | 29 type errors under TS 7, and the test fails at runtime: `Cannot read properties of undefined (reading 'Latest')` | Works unchanged with side-by-side. On plain TS 7, port it to `typescript/unstable/ast` (unstable until 7.1) or another parser. | none with side-by-side; ~1 h to port |
| 4 | typescript-eslint (added in #314) needs the TS JS API, and its peer range is `<6.1.0`. | Install refuses TS 7, or crashes when forced | Side-by-side: `typescript` resolves to 6.0.3, which is inside the range. | none with side-by-side |

Nothing else broke:

- All 7 typecheck projects (`packages/{midi,engrave,player-core,catalog}`, `services/transcribe`, `apps/web`, `apps/web/tsconfig.song-tools.json`) pass on TS 6.0.3 and TS 7.0.2 once fix 1 is in. There are no new type errors from stricter defaults or from changed inference.
- Vitest, tsx and Playwright transpile with esbuild or their own pipelines and never load `typescript`.
- Every other runtime use of `typescript` in the repo is the one test in row 3.

## Measured results

| Check | TS 5.9.3 (today) | TS 6.0.3 | TS 7.0.2 |
|---|---|---|---|
| All 7 typecheck projects, sequential, cold | 42.0 s | 42.8 s | **4.2 s** (~10×) |
| `packages/catalog` alone | 8.8 s | n/a | 0.9 s |
| `apps/web` alone | 11.4 s | n/a | 1.0 s |
| `next build` (Next 15.5.25) | ✅ | ✅ (via the 6.0 API) | ❌ row 2 on plain 7; ✅ side-by-side |
| `player-practice-pulse-lifecycle.test.ts` | ✅ | ✅ | ❌ on plain 7; ✅ side-by-side (5/5) |

Timings come from a shared, loaded box, so read them as ratios rather than absolutes.

## Recommended path

**Option A: side-by-side now (about half a day including review).**
1. In every workspace that lists `typescript`, put both of these in `devDependencies`: `"typescript": "npm:@typescript/typescript6@^6.0.2"` and `"typescript-7": "npm:typescript@^7.0.2"`. Regenerate `package-lock.json`.
2. Point each `typecheck` script at the TS 7 binary, e.g. `node ../../node_modules/typescript-7/bin/tsc --noEmit`. Under the alias, plain `tsc` is not on PATH any more (the 6.0 package ships `tsc6`).
3. Keep fix 1. Next 15, the AST test and typescript-eslint keep using the 6.0 API.
4. Expect Dependabot noise: it will propose `typescript` bumps against the alias. Group or ignore them in `.github/dependabot.yml`.

**Option B: wait for 7.1 (end of November at the earliest), then go TS 7 only.**
This needs Next 16 (#331), typescript-eslint releasing TS 7 support, and the AST test ported to the 7.1 API. It is cleaner, but it is blocked on three outside releases.

The recommendation is **A**, with fix 1 landing now regardless. It brings the ~10× typecheck speed-up to CI and local runs at little cost, and Option B can follow once 7.1 and #331 land.

## Not covered

- Editor/LSP experience with the TS 7 language server.
- `--incremental` / `tsbuildinfo` behaviour in CI caches. `apps/web` sets `incremental: true`. TS 7 accepted it, but the timings above disable it.
- Emitted JS. Every project here is `--noEmit`, and bundlers do the emit.
