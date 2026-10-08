# Section alignment continuation — 2026-10-08

Base: `b562155f1c87a95809b70e77a6551fb6c66af893` (PR224 merged and deployed). Node 22.22.3. This continuation completes the previously blocked active cohort acquisitions and re-evaluates shorter form spans while preserving the first batch's private evidence.

## Result

One additional partial chart map: Bonnie Tyler's Intro `[0,16)` at 68 BPM. Map entries **7 → 8**; expected served bases with at least one named chart/source span **5 → 6 of 441**. Across both autonomous batches, the gain is **4 → 6**, with Help and Bonnie each contributing an Intro only. The remaining 435 served bases retain estimates; this does not complete or certify every catalog form.

All 42 first-cohort rows have a final disposition for this implementation: six existing maps preserved (including Help), four disabled rows preserved, one new partial map, and 31 rejected bases. No active acquisition block remains. A fresh sequential probe succeeded and two charts were captured for each of Sia Chandelier, Status Quo Rockin All Over the World, Status Quo Whatever You Want, and Beatles Blackbird. Raw charts, lyrics, notes, source files and full trial outputs remain private in ignored `output/section-alignment-next/` and the preserved first-batch directory.

## Shorter-grid method

The default eight-bar method and Queen/Help regressions are preserved. The optional four-bar grid addresses demonstrably shorter spans, with a 64-phrase search bound (256 bars). Four-bar costs weigh half the eight-bar costs; the .15 gap threshold retains its existing units. Each interior boundary is still checked by a global re-solve with that position forbidden. Landmarks validate the result and do not constrain the search. No single-word or lyric-onset boundary strategy was added.

The offline harmony scorer now accepts exact `m7b5`, `dim7`, `7sus4` and `(b5)` chord qualities, including slash bass and explicit transposition. This fixes input limitations for Gloria, Rockin and Blackbird without changing playback chord voicing. All newly parseable charts still have to pass the separation and landmark gates.

## Retained Bonnie span

[Ultimate Guitar chart 87254](https://tabs.ultimate-guitar.com/tab/bonnie-tyler/total-eclipse-of-the-heart-chords-87254), transposed +1 semitone from Am to the retained B-flat-minor opening. The source hash `58a723323f4e85764b563bd11acd171f1c8ead8c13f7a499cd35d6687909c945` matches the fresh production artifact manifest. Exact Advanced production notes hash: `4a61acb2eae46f6611483fa6bfab7a654a2cb19a75371650827cdda08388a44b`. Producer reference is `seed:bonnie-tyler-total-eclipse-of-the-heart.mid`; source and playback calibration are 68 BPM.

Independent raw-source check: only the piano track sounds before beat 16, playing the minor figure across four bars. A separate cue track enters at beat 16 with pitches 70, 72 and 73 at beats 16, 16.5 and 16.75; the main melody track enters at beat 18. All 36 opening producer pitch/onset pairs and all 2,197 full-piece pairs correspond to retained raw onsets within .04 beat. Source note duration is 349.75 beats; the producer's final measure is rounded to 352. These observations corroborate the four-bar Intro on this clock; track names are not timed form markers or artist-authoritative annotations.

Intro's end-boundary gap is **0.1645833333**, confidence **0.6**. Overall assignment cost is **5.9433531746**; the global runner-up gap is only **0.009375**, so every interior span is dropped. The alternative chart's best four-bar cost is 6.1003472222 (difference .1569940476); chart choice is explicit and is not calibrated into the confidence score. The score describes symbolic fit/separation, not a probability or musical acceptance. The map pins production notes bytes. Checked-in regression material contains only aggregate pitch-class, density and chord statistics.

## Updated first-cohort disposition

| Base | Disposition | Reason |
|---|---|---|
| `abba-lay-all-your-love-on-me` | Preserved map | Existing exact source/chart map retained, including blocked entries. |
| `abba-the-winner-takes-it-all` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `adele-skyfall` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `aerosmith-i-dont-want-to-miss-a-thing` | Rejected; estimate-only | Production clock ends at 300 beats while retained source is 800; candidate source-clock landmark not established. |
| `avenged-sevenfold-afterlife` | Preserved map | Existing exact source/chart map retained, including blocked entries. |
| `avenged-sevenfold-so-far-away` | Rejected; estimate-only | Four-bar grid now fits chart occurrences; best boundary alternatives remain below .15. |
| `bon-jovi-always` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `bon-jovi-bed-of-roses` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `bonnie-tyler-total-eclipse-of-the-heart` | Partial chart map | Four-bar Intro only; separated boundary and exact raw piano-only/cue-track-entry landmark. |
| `britney-spears-oops-i-did-it-again` | Preserved map | Existing exact source/chart map retained, including blocked entries. |
| `coldplay-viva-la-vida` | Disabled; preserved | No publication change. |
| `creedence-clearwater-revival-have-you-ever-seen-the-rain` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `elton-john-circle-of-life` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `frank-sinatra-fly-me-to-the-moon` | Rejected; estimate-only | Best transposed chart has near-equal boundary alternatives; source title names Como rather than Sinatra. |
| `frank-sinatra-my-way` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `gloria-gaynor-i-will-survive` | Rejected; estimate-only | Altered chord parsing now succeeds; repeated harmony leaves best boundary alternatives below .15. |
| `john-lennon-imagine` | Rejected; estimate-only | Four-bar grid now fits chart occurrences; repeated harmony remains ambiguous. Matched lyric onsets do not establish form boundaries. |
| `journey-dont-stop-believin` | Preserved map | Existing exact source/chart map retained, including blocked entries. |
| `journey-separate-ways` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `mary-hopkin-those-were-the-days` | Rejected; estimate-only | No chords in Verse |
| `meat-loaf-id-do-anything-for-love` | Rejected; estimate-only | Source ends at 1080 beats but arrangement at 1064; short inferred tail does not match the chart Outro itinerary. |
| `midnight-oil-beds-are-burning` | Rejected; estimate-only | Saved chart headings describe only two fragments; its END-CHORUS opening and whole-piece Chorus are not performed itinerary. |
| `miley-cyrus-flowers` | Disabled; preserved | No publication change. |
| `misc-cartoons-neon-genesis-evangelion-a-cruel-angels-thesis` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `misc-traditional-land-of-hope-and-glory` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `nomy-cocaine` | Rejected; estimate-only | Best boundary alternatives below .15; no independent validated span. |
| `nothing-more-freefall` | Disabled; preserved | No publication change. |
| `ozzy-osbourne-crazy-train` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `ozzy-osbourne-dreamer` | Rejected; estimate-only | Key/tempo/form disagreement; zero-transpose stable spans are not valid source landmarks. |
| `ozzy-osbourne-mr-crowley` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `queen-somebody-to-love` | Preserved map | Existing exact source/chart map retained, including blocked entries. |
| `rammstein-mein-herz-brennt` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `rihanna-umbrella` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `sabaton-82nd-all-the-way` | Rejected; estimate-only | Short stable tail in the finer-grid fit has no independently matched source form/clock landmark. |
| `sia-chandelier` | Rejected; estimate-only | Two charts acquired; best +1-semitone assignments have no separated span. |
| `status-quo-in-the-army-now` | Rejected; estimate-only | Best plausible chart/key boundary alternatives remain below .15; independently supported form span not established. |
| `status-quo-rockin-all-over-the-world` | Rejected; estimate-only | Two charts acquired; diminished-seventh parsing succeeds; no independently supported separated span. |
| `status-quo-whatever-you-want` | Rejected; estimate-only | Two charts acquired; best-key fit remains ambiguous. Stable wrong-key tail rejected; alternate chart has an empty Beat heading. |
| `the-beatles-blackbird` | Rejected; estimate-only | Two charts acquired; altered/suspended chord parsing succeeds; best boundaries remain ambiguous. |
| `the-beatles-help` | Partial chart map | Intro only; separated boundary plus independently inspected Bm-G-E-A landmarks. |
| `the-beatles-let-it-be` | Rejected; estimate-only | Four-bar grid now fits chart occurrences; repeated verse/chorus harmony remains ambiguous. |
| `the-killers-human` | Disabled; preserved | No publication change. |

## Remaining registry and served inventory

All 82 UG registry rows were reconciled against canonical base IDs and artist/title identities in the manifest, served inventory and local retained seeds. The 42 first-cohort rows are accounted for above. None of the other 40 rows has a matching canonical manifest/served base or local retained seed. A registry name alone cannot bind a map to source bytes and playback notes. The unmatched canonical identities are recorded below so this residual scope is concrete.

| Registry row | Canonical identity without a verified retained-source/clock pair |
|---|---|
| 1 | `james-blunt-youre-beautiful` |
| 7 | `lewis-capaldi-someone-you-loved` |
| 9 | `misc-traditional` |
| 11 | `spalexma-we-are-charlie-kirk` |
| 20 | `hozier-take-me-to-church` |
| 21 | `grotesco-bogarnas-fel` |
| 22 | `age-aleksandersen-levva-livet` |
| 23 | `d-d-e-det-fine-vi-hadd-sammen` |
| 24 | `d-d-e-vinsjan-p-kaia` |
| 29 | `the-warning-hell-you-call-a-dream` |
| 30 | `hozier-too-sweet` |
| 31 | `bruce-springsteen-pay-me-my-money-down` |
| 34 | `ozzy-osbourne-mama-im-coming-home` |
| 35 | `sabaton-carolus-rex` |
| 39 | `ava-max-kings-and-queens` |
| 41 | `sabaton-a-lifetime-of-war` |
| 42 | `sabaton-en-livstid-i-krig` |
| 43 | `sabaton-the-last-stand` |
| 44 | `sabaton-the-final-solution` |
| 46 | `sabaton-christmas-truce` |
| 47 | `brandi-carlile-the-story` |
| 49 | `tix-sjeiken-2015` |
| 50 | `p-nk-u-plus-ur-hand` |
| 54 | `nothing-more-if-it-doesnt-hurt` |
| 57 | `avenged-sevenfold-dear-god` |
| 58 | `nothing-more-just-say-when` |
| 60 | `john-legend-all-of-me` |
| 61 | `coldplay-fix-you` |
| 62 | `misc-soundtrack-the-greatest-showman-never-enough` |
| 63 | `misc-soundtrack-the-greatest-showman-this-is-me` |
| 68 | `gavin-degraw-i-dont-want-to-be` |
| 70 | `nomy-you-better-die-young` |
| 72 | `the-pretty-reckless-make-me-wanna-die` |
| 73 | `linkin-park-the-emptiness-machine` |
| 74 | `nothing-more-fadein-fadeout` |
| 76 | `foo-fighters-my-hero` |
| 79 | `ghost-mary-on-a-cross` |
| 80 | `misc-soundtrack-the-greatest-showman-from-now-on` |
| 81 | `falling-in-reverse-the-drug-in-me-is-reimagined` |
| 82 | `the-pretty-reckless-just-tonight` |

The full public list contains 441 bases / 1,764 variants. Local filenames exist for 355 served bases; 86 lack a matching local retained seed. Filename presence is an inventory observation, not a production hash verification. Of 387 local seeds scanned, 37 contain timed lyrics (35 are served) and two have form-like FF01 track/text names. Those text names are not timed FF06/FF07 form markers. Diagnostic lyric matches are fractional onsets and can be pickups or later lines; they were not converted into published sections.

The 109 Classical bases remain with estimates under the handoff's explicit rule; no classical form was fabricated. The prior five additional chord registrations outside the cohort still lack a complete independently checked source/production-clock/form-heading pair. Further acquisition or a different independently validated evidence method is required for residual coverage; repeated harmony is not resolved by lowering thresholds or treating an exact lyric cue as an entire form boundary.

## Verification and release

Section audit: 410 known bases, eight maps, zero errors, two expected blocked-map warnings; lanes are 367 estimate-only, 35 UG candidates, five source maps and three chart maps. Full local gates passed: 2,540 tests across 282 files, production build and sequential typecheck. Independent read-only review passed with no actionable findings; the reviewer verified receipt/clock/provenance consistency but did not independently recompute all onset matches. CI/release receipts will be added after they complete. Owner-authored metadata, `inferSongForm`, playback voicing and learner-blocked maps are preserved. No audition, artist authority, recognizability, playability or musical acceptance is established.
