# Player UI Implementation - 1 October 2026

Local implementation of PR-63 through PR-78, associated with issues #174-#189.
Branch: `codex/player-ui-improvements`, based on main
`359d22204428f82710d587d0835c41a90c7d1abf`.
Worktree: `/Users/reidar/.codex/worktrees/player-ui-improvements/Keyspilli`.
The primary checkout and its existing WIP were preserved.

## Coverage

| Proposal | Local change |
| --- | --- |
| PR-63 / #174 | Separate transport and secondary controls; segmented hands; compact mobile rows; named desktop settings triggers. |
| PR-64 / #175 | Song identity, return-to-library action and source notices remain visible in focus/landscape; arrangement retry is outside the header. |
| PR-65 / #176 | Sound sections distinguish arrangement from instrument/mix settings, retaining existing handlers. |
| PR-66 / #177 | Effective playback key, speed and practice BPM; provisional-tempo label; original-key sheet warning retained. |
| PR-67 / #178 | Scrub destination includes bar, time and existing section; bounded section marks reuse current navigation. |
| PR-68 / #179 | Loop endpoints are one draft, validated together; Apply/Cancel and distinct draft range. |
| PR-69 / #180 | Stable stage status; previews remain identified and stoppable after Tools closes; existing grading/count-in actions retained. |
| PR-70 / #181 | Pitch positions retain timing; grouped intrinsic-size annotation columns wrap lyrics/chords without overlapping text. |
| PR-71 / #182 | Timestamp-indexed, grouped lyrics in a bounded DOM lane; hide control; no per-frame song scan. |
| PR-72 / #185 | Display-only 2/3.2/5-second reading windows; 3.2 default; no scheduler/grading changes. |
| PR-73 / #183 | Manual note-letter review holds its bar/scroll position; explicit Resume following; chord panels stop recentering. New data resets following; seek does not. |
| PR-74 / #184 | Falling-only display controls disappear in other views; sheet tools point to the existing zoom control. |
| PR-75 / #186 | Flat chord-practice target/result sections, restrained wrapping heading, one completion retry. |
| PR-76 / #187 | Lazy sheet-first loading retained; zoom/page/vertical offset/horizontal scroll passed through controls handoff, after transition animations finish. |
| PR-77 / #188 | Setup summary resolves the same range used by Start, with hands/key/speed/input readiness; Cancel leaves transport alone. |
| PR-78 / #189 | Left-hand Lead Sheet mismatch and unavailable guidance have explicit recovery actions; no inferred musical rest claims. |

## Verification

- Node 22.22.3; existing locked dependencies, no new dependency or lockfile change.
- `npm test`: 2,290 passing (web 294, catalog 1,129, engrave 10, MIDI 428, player-core 330, transcribe 99).
- `npm run typecheck`: passed across workspaces after the browser server stopped.
- `npm run build`: production build passed.
- `npx playwright test --config=playwright.player-ui.config.ts --timeout=25000` from `apps/web`: 15 passing.
- Browser checks use an isolated synthetic 16-bar catalog and intercepted 80-bar MusicXML. They cover staged loops, preview stop, exact setup, view-specific tools, following across a bar change, sheet failure/retry and page-2 position within 5px, canvas colored pixels and animation, tool bounds, dense lead annotations, and normal/focus layouts at 320x640, 390x844, 844x390, 1024x768 and 1440x900.
- Desktop, phone and landscape screenshots inspected in `apps/web/output/playwright`.
- Scratch teardown normalizes macOS temporary-root aliases; test data is separate from production.
- Local preview: http://127.0.0.1:3111/player/ui-fixture-m (synthetic fixture, not the owner catalog).

## Boundaries

Owner global-appearance follow-up (01:46): promoted the existing persisted Light/Charcoal preference to app-wide appearance. Header sun/moon toggle and Display > App appearance share the existing player preference, preserve other settings and sync across tabs. Static pre-paint restoration avoids waiting for hydration. Charcoal covers navigation, library, forms, menus/dialogs, player chrome and lyrics; notation pages and reference piano keys retain readable paper/key colors, with screen-only overrides leaving print styles unchanged. Verification: 2,291 workspace tests, 16 focused Chromium regressions and production build pass; web typecheck passes. Additional live checks cover five top-level routes, reload/light recovery, bidirectional controls, cross-tab sync and 320/390/1440px dark surfaces/playback without horizontal overflow. Screenshots reviewed. No dependency, production catalog or deployment changes.

Owner timeline follow-up: shared desktop row for bar/section context, seek slider, elapsed time and Loop; tightened section-navigation padding below. Loop editor overlays the stage rather than expanding the timeline. Phones retain position/time on the first row and a full-width seek track. Actual synthetic navigation height: 93px desktop/landscape, 109px phone. Web typecheck and 294 tests pass; five live Chromium viewport checks verify seek, sections, staged loops, bounded loop editor and no horizontal overflow. Screenshots inspected. No deploy or new production build for this follow-up.

Owner bar-controls follow-up: removed previous/next measure buttons and the bar-number input, plus their now-unused handlers. Slider destination text, elapsed time and loop editor remain. Browser tests that used the removed input now seek through the slider; a shared test helper uses actual playback measures and displayed effective tempo. Verification: web typecheck and 294 tests pass; live Chromium checks at 390/844/1440px verify absence and working seek/loop. Updated helper checked against measured bar 3 and final bar. No deploy or new production build for this follow-up.

Owner toolbar follow-up: combined transport and secondary controls into one row on desktop and wide landscape. Existing Tools collapses named settings on narrower surfaces; desktop retains speed presets. Phones retain two compact rows rather than clipped controls. Follow-up checks: web typecheck and 294 tests pass; live Chromium checks cover 320/390/844/900/1024/1440px widths, normal/focus overflow, single-row alignment on wide views and functioning desktop speed presets. No new production build was run for this follow-up.

Owner follow-up: removed the falling-view chord sequence and Full chord progression strip on explicit request. Chords remain in the canvas and other learning views; playback/practice status remains. Follow-up verification: 294 web tests pass; live-preview Chromium checks at all five viewport sizes confirm strip absence, readable lyrics, visible canvas and working Play/Pause. Browser regression expectations were updated. The earlier 15-test/build results above precede this two-line rendering removal.

Release authorized by the owner after the global-appearance follow-up. The isolated UI browser suite is now explicitly included in CI and excluded from the default seeded suite. Publication, issue reconciliation and deployment evidence will be recorded in the release PR and Obsidian after verification.
The original discovery/publication documents remain historical evidence.
No production song, source authority, scheduler, grading tolerance, import or export format changes.
Existing native symbols/text were reused; no icon dependency or new controller framework.
Sheet SVG sessions still remount on controls handoff; this preserves reader state, not worker-session identity.
Real-song listening/keyboard acceptance, physical touch devices, screen-reader listening, 200% browser zoom, the private arrangement-audition suite and the optional reading-window owner trial remain unverified.
