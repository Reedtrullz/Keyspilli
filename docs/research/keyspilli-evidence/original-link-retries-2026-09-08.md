# Original recording retries — 8 September 2026

The two latest user failures were caused by the 30GiB disk guard before YouTube retrieval. With explicit user approval, cleared only npm download cache using npm cache clean --force; free space returned above30GiB. Classified the resolver guard as SOURCE_REVIEW_REQUIRED to prevent futile retry and mapped legacy errors to the storage message.

Subsequent real retries exposed title parsing: double pipes and Artist "Song", live… were unsupported. Added generic parsing with regression cases. Search found khDfiL16CTg, a piano score video with an88-key keyboard, but the tutorial-only title filter excluded it. Added piano sheet music eligibility; extraction remains required. Its24fps video was rejected by the25fps floor; now24fps is supported with native event-timing regression coverage.999 source notes extracted. No song IDs, manual MIDI or source pins added.

After worker restart, fresh original-link submissions through the actual API completed:
- lVNGBcstF5c lyrics recording -> khDfiL16CTg:9.756s.
- U3qJ6eT54rI live recording -> khDfiL16CTg:9.751s.
- Y7VGOnV2QhU Just Tonight original -> gCcAjUdFpko:19.375s.

All12 public HTTP MIDI exports match their automatically selected candidate reductions; details in the adjacent JSON. A fourth submission through the user's visible browser form completed as job-38cfed45-6f47-4c9b-a17c-e5eeff3197f5. Opened lesson has correct artist/title, requested recording and automatically selected alternate source, and four levels. This proves completion for these original links, not universal source coverage or independent musical acceptance.

Checks:67 worker tests,12 Python tests,5 web error tests,worker typecheck and diff check pass. Development preview only; production unchanged. Preserved existing songs and failed-job evidence.
