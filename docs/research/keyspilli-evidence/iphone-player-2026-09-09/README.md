# iPhone player correction — 2026-09-09

The user supplied portrait/landscape iPhone screenshots where controls pushed the keyboard below the viewport. They also confirmed sound returned when Silent Mode was turned off.

## Changes

- Compact mobile speed selector and Song actions menu; sections follow the stage. Short landscape removes the page header, preserves transport, and reserves the remaining viewport for the piano.
- Mobile keyboard gutters are narrower; short stages give keys more height. Fit keys is available directly in the portrait title row, while the existing fixed Fit Passage range and saved 88-key choice are preserved.
- All three audio engines request the optional `navigator.audioSession.type = "playback"` before creating their context. Existing `play-and-record` sessions are preserved. Browsers without the API retain existing behavior.
- CI runs the mobile regression file in WebKit in addition to Chromium.

The Audio Session API documents Web Audio's default as ambient: [MDN Audio Session API](https://developer.mozilla.org/en-US/docs/Web/API/Audio_Session_API). See also [type](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type).

## Evidence

Production-build captures: [portrait, 428 × 700](portrait.png) and [landscape, 926 × 320](landscape.png), including browser-chrome-reduced viewport heights. Both retain the full keyboard without enabling Focus. These are automated desktop browser captures, not device screenshots.

Local checks: 145 player-core tests and 179 web tests passed; workspace typecheck and production build passed. Browser checks cover default portrait/landscape keyboard visibility, stage height, width overflow, and piano/organ playback-session requests, alongside existing player/application regression tests. Exact CI results are tracked on the PR.

## Limits

Silent Mode cause was confirmed by the user. Actual iPhone playback with Silent Mode enabled after this patch remains unverified. The Audio Session API is optional; unsupported browsers can still require Silent Mode off. No physical touch/MIDI or listening acceptance is claimed. No new dependency or silent-media workaround was added.
