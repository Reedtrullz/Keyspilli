# Beginner burst spacing

User identified Queen Beginner around2:48 as too difficult. Notes near2:49–2:51 were separated by62.5–187.5ms. The existing density limiter averages attacks over the whole song; sparse passages hid short dense runs, especially after source grid recovery restored them.

Added a final source-profile Beginner spacing pass: at least375ms between attack groups, preserve actual source onsets/pitches, prefer a longer held note over a colliding short ornament, and cap sustain at the next retained attack. No forced tempo change or invented notes. This is a timing ceiling, not a comprehensive fingering/leap difficulty certificate. Other profiles and Easy/Medium/Advanced are unchanged. Processing policy v8-source-beginner-spacing distinguishes rebuilt artifacts.

The sparse-song/fast-ending regression failed before the fix and passes afterward. The older off-grid isolation fixture now correctly expects a62.5ms-neighbor attack to be removed by final spacing, while marker isolation and ancestry assertions remain.370 MIDI tests,1,085 catalog tests and MIDI typecheck pass. All three regenerated ladders pass their variant and serialization validators. Higher-level MIDI files are byte-identical to previous outputs.

Queen167–172s now has nine attacks, with high C and final Bb landing retained; the shortest remaining gap is375ms. Three Beginner renders are refreshed privately and FFprobe-readable; old versions are retained. Review page provides a Queen2:44 jump button. No release or new listening acceptance claimed; these checks do not prove every Beginner leap is easy. No production change.
