# TypeScript 7 assessment

Status: assessment and CSS declaration only. The compiler remains TypeScript
5.9.3; this PR changes no dependency, lockfile, compiler command or CI gate.

Refreshed 2026-10-18 on Node 22.22.3 against qualified provisional parent
`0a8b3af2fac778fb8e3a8360d8e4eb84c6d56f39` (PR336, including PR331).
That candidate selects Next 16.4.2 with webpack, React 19.3.1, Vitest 5.0.5,
Playwright 1.64.1 and the merged lint foundation's typescript-eslint 8.71.2.
These are candidate-source observations, not a claim that the pending
framework, native-library and test-runner prerequisites have landed on main.
The compiler remains TypeScript 5.9.3 throughout this assessment.

## Upstream compatibility

The [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
describes the native compiler and the API transition. Fresh registry metadata
confirms `typescript@7.0.2`: the main export is `lib/version.cjs`, the
compiler executable is `tsc`, and the available programmatic entry points
are under `typescript/unstable/*`. Replacing the installed JavaScript API
with that main export breaks existing API consumers.

Microsoft documents an npm alias for the compatibility API:
`"typescript": "npm:@typescript/typescript6@^6.0.2"`, alongside a separately
named TypeScript 7 package. The compatibility package exposes `tsc6`.
The current compatibility-package version is **6.0.2**; a fresh lookup of
`@typescript/typescript6@6.0.3` returns E404. Plain `typescript@6.0.3`
and the compatibility package are different package identities.

The [TypeScript 6 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
describe changed defaults, including `types: []` and
`noUncheckedSideEffectImports: true`. Root configuration already uses
bundler resolution, ES2022, strict checking and esModuleInterop. Five
non-web workspace configurations explicitly include Node types; the web
configurations do not. Their effective ambient types must be checked during
any migration.

## Current repository obligations

| Consumer | Current source evidence | Migration obligation |
|---|---|---|
| Stylesheets | `apps/web/src/app/layout.tsx` imports `./globals.css`; this PR adds `src/types/css.d.ts` | Check both web projects with side-effect import checking enabled. The wildcard describes bundled CSS; it does not independently verify stylesheet existence. |
| Player lifecycle test | `apps/web/src/components/player/player-practice-pulse-lifecycle.test.ts` uses createSourceFile, ScriptTarget and transpileModule | Preserve its executable AST checks through a compatible API or a separately reviewed parser change. |
| Mutation-auth coverage | `apps/web/src/lib/api-auth.test.ts` also uses createSourceFile and transpileModule after PR315 | Preserve discovery and execution of actual protected handlers. There are **two** direct repository API consumers, not one. |
| Lint | Selected `@typescript-eslint/typescript-estree` peer range is `>=4.8.4 <6.1.0` | A plain TypeScript 7 replacement is outside that range. Verify the compatibility alias and the complete lint gate before changing it. |
| Next 16 | Installed `next/dist/server/config-shared.js` defaults useTypeScriptCli to true; the config loader uses SWC/native Node resolution | This removes the historical Next15 config-loader assumption. It does not qualify the entire Next16 build, type generation or editor under TypeScript7. |

Repository API inventory excludes dependencies, generated builds and offline
bundles. Installed tool internals have separate compatibility obligations;
the fact that tsx, Vitest or Playwright transpile code does not establish
that none of their surrounding tools load the compiler API.

## Historical measurements

The original author reported these 2026-10-17 measurements on main
`6742f240`, Next15.5.25 and a shared loaded host. They were **not rerun**
against the current source or the proposed compatibility alias in this
qualification. They are historical observations, not current acceptance.

| Check | TS5.9.3 | TS6.0.3 | TS7.0.2 |
|---|---|---|---|
| Seven typecheck projects, sequential/cold | 42.0s | 42.8s | 4.2s |
| Catalog only | 8.8s | not measured | 0.9s |
| Web only | 11.4s | not measured | 1.0s |

The earlier single-test and Next15 results do not cover the added auth API
consumer, current Next16, the changed runner, or current lint dependencies.
No new speedup or complete TypeScript6/7 compatibility is claimed.

## Recommended next step

Land this compatible CSS declaration and accurate assessment while retaining
TypeScript5.9.3. If a compiler migration is separately authorized, compare
side-by-side compatibility against a future stable API using exact package
identities. Recheck all seven typecheck projects, generated Next types,
webpack/standalone builds, both API-dependent tests, lint, runtime suites and
editor behavior on the actual intended revision. Preserve default test
discovery and deadlines.

Incremental caches, emitted code, native platform binaries, CI resource usage
and editor/LSP adoption need their own evidence. No 7.1 release date or
half-day implementation estimate is assumed. This PR does not perform the
migration.
