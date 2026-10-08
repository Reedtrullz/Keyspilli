# Section alignment cohort — 2026-10-08

Historical first-batch record; updated dispositions appear in [the continuation report](2026-10-08-section-alignment-continuation.md).

Base: `b3ba91d2732c97a148887fcdec7301313503d6c1`. Node 22.22.3. Read-only production inputs retrieved 8 October.

## Result

First cohort: every one of the 42 `source: ug-tabs` manifest rows received a disposition. 37 chart pages acquired; four active bases remain blocked by HTTP 429 after one sequential retry; the fifth rate-limited row is disabled. Five rows already mapped and four disabled are preserved. One new partial chart map is retained, increasing map entries **6 → 7** and expected served bases with at least one chart/source label **4 → 5 of 441**. This is one named Intro, not seven fully certified forms. All other bases remain estimated.

Raw saved charts, source bytes, notes and alternate assignments stay in gitignored `output/section-alignment/`. They include source material and are not republished. The checked-in Queen/Help fixtures contain aggregate pitch-class statistics and chord sets only.

## Retained span

`the-beatles-help`: Intro `[0,32)` at 173 BPM; source hash `278f693cc9859cedee170d7709c49b5e7a1c98de632ea3ed34092c7bff05279a`, independently matched to the production artifact manifest. Advanced notes hash `5c8415696a87858a486835db81e4904e7d8ce71d4f4bdc9f29dbe73cad4b5e55` comes from exact production bytes and is pinned. End-boundary alternative gap **0.269643**; global runner-up gap **0.117857** affects later spans, which are dropped. Algorithmic confidence **0.588889** is not a calibrated probability.

Independent symbolic source check: opening rest `[0,4)`, B-minor `[4,10)`, G-major `[10,20)` with late F# bass, E-major `[20,28)`, closing A-major bar `[28,32)`. This supports the Intro occurrence in [UG chart 17269](https://tabs.ultimate-guitar.com/tab/the-beatles/help-chords-17269). The chart Bm/A slash bass was not retained as the lowest source pitch; this is not a note-for-note chart equivalence claim. Interior form remains ambiguous and un-auditioned.

## Forty-two-row disposition

| Base | Disposition | Reason |
|---|---|---|
| `abba-lay-all-your-love-on-me` | Preserved map | Existing source evidence; learner-blocked maps retained. |
| `abba-the-winner-takes-it-all` | Rejected; estimate-only | Best boundary alternatives below .15; no independent validated span. |
| `adele-skyfall` | Rejected; estimate-only | Grid separation does not validate the repeated Cm/Ab/Fm lyric/form transitions; no independent matching boundary. |
| `aerosmith-i-dont-want-to-miss-a-thing` | Rejected; estimate-only | Production clock ends at 300 beats while retained source is 800; candidate source-clock landmark not established. |
| `avenged-sevenfold-afterlife` | Preserved map | Existing source evidence; learner-blocked maps retained. |
| `avenged-sevenfold-so-far-away` | Rejected; estimate-only | Chart has more sections than eight-bar phrases or is empty |
| `bon-jovi-always` | Rejected; estimate-only | Retained intro/verse harmonic transition occurs before the fixed 32-beat boundary; coarse phrase map not independently confirmed. |
| `bon-jovi-bed-of-roses` | Rejected; estimate-only | Alternative chart/key choices have equal best costs; arrangement is transposed relative to chart. |
| `bonnie-tyler-total-eclipse-of-the-heart` | Rejected; estimate-only | Transposed charts disagree in form; best/next chart costs differ below .15. |
| `britney-spears-oops-i-did-it-again` | Preserved map | Existing source evidence; learner-blocked maps retained. |
| `coldplay-viva-la-vida` | Disabled; preserved | No publication change. |
| `creedence-clearwater-revival-have-you-ever-seen-the-rain` | Rejected; estimate-only | Best boundary alternatives below .15; no independent validated span. |
| `elton-john-circle-of-life` | Rejected; estimate-only | Best boundary alternatives below .15; no independent validated span. |
| `frank-sinatra-fly-me-to-the-moon` | Rejected; estimate-only | Best transposed chart has near-equal boundary alternatives; source title names Como rather than Sinatra. |
| `frank-sinatra-my-way` | Rejected; estimate-only | 32-beat candidate Intro includes the source chromatic verse progression; no matching independent landmark. |
| `gloria-gaynor-i-will-survive` | Rejected; estimate-only | Unsupported chord quality "m7b5" |
| `john-lennon-imagine` | Rejected; estimate-only | Chart has more sections than eight-bar phrases or is empty |
| `journey-dont-stop-believin` | Preserved map | Existing source evidence; learner-blocked maps retained. |
| `journey-separate-ways` | Rejected; estimate-only | Best boundary alternatives below .15; no independent validated span. |
| `mary-hopkin-those-were-the-days` | Rejected; estimate-only | No chords in Verse |
| `meat-loaf-id-do-anything-for-love` | Rejected; estimate-only | Source ends at 1080 beats but arrangement at 1064; short inferred tail does not match the chart Outro itinerary. |
| `midnight-oil-beds-are-burning` | Rejected; estimate-only | Saved chart headings describe only two fragments; its END-CHORUS opening and whole-piece Chorus are not performed itinerary. |
| `miley-cyrus-flowers` | Disabled; preserved | No publication change. |
| `misc-cartoons-neon-genesis-evangelion-a-cruel-angels-thesis` | Rejected; estimate-only | Opening harmonic content repeats; isolated Intro boundary not independently confirmed. |
| `misc-traditional-land-of-hope-and-glory` | Rejected; estimate-only | Best boundary alternatives below .15; no independent validated span. |
| `nomy-cocaine` | Rejected; estimate-only | Best boundary alternatives below .15; no independent validated span. |
| `nothing-more-freefall` | Disabled; preserved | No publication change. |
| `ozzy-osbourne-crazy-train` | Rejected; estimate-only | Best boundary alternatives below .15; no independent validated span. |
| `ozzy-osbourne-dreamer` | Rejected; estimate-only | Key/tempo/form disagreement; zero-transpose stable spans are not valid source landmarks. |
| `ozzy-osbourne-mr-crowley` | Rejected; estimate-only | Best boundary alternatives below .15; no independent validated span. |
| `queen-somebody-to-love` | Preserved map | Existing chart evidence; learner-blocked maps retained. |
| `rammstein-mein-herz-brennt` | Rejected; estimate-only | Retained opening A-G-F-E line followed by D material does not validate proposed 32-beat Intro/Refrain split. |
| `rihanna-umbrella` | Rejected; estimate-only | Best boundary alternatives below .15; no independent validated span. |
| `sabaton-82nd-all-the-way` | Rejected; estimate-only | Chart has more sections than eight-bar phrases or is empty |
| `sia-chandelier` | Source acquisition blocked | HTTP 429 after one bounded sequential retry; retain estimates. |
| `status-quo-in-the-army-now` | Rejected; estimate-only | Best boundary alternatives below .15; no independent validated span. |
| `status-quo-rockin-all-over-the-world` | Source acquisition blocked | HTTP 429 after one bounded sequential retry; retain estimates. |
| `status-quo-whatever-you-want` | Source acquisition blocked | HTTP 429 after one bounded sequential retry; retain estimates. |
| `the-beatles-blackbird` | Source acquisition blocked | HTTP 429 after one bounded sequential retry; retain estimates. |
| `the-beatles-help` | Partial chart map | Intro only; separated boundary plus independently inspected Bm-G-E-A landmarks. |
| `the-beatles-let-it-be` | Rejected; estimate-only | Chart has more sections than eight-bar phrases or is empty |
| `the-killers-human` | Disabled; preserved | No publication change. |

## Further UG candidates

The first cohort is complete as an inventory/disposition, including explicit external blocks. The corrected ledger identifies candidates using `source: ug-tabs`, canonical artist/title, and canonical base slugs; the old ledger incorrectly compared titles to base IDs and reported zero UG candidates. The corrected retained-seed ledger reports 410 known bases: 367 estimate-only, 36 UG candidates, five source maps and two chart maps. No additional known bases match UG registry identities outside the first cohort. The 82-row UG registry includes intended candidates without a retained canonical catalog base; a registry name alone is insufficient to produce a source-pinned map. New chart acquisition is deferred while UG continues returning HTTP 429. Five chart registrations outside the first cohort (`coldplay-clocks` and four piano covers) do not provide a complete independently validated seed-MIDI/production-clock identity for this helper; their prior chord timelines are not section maps. No classical form is fabricated.

## Verification and limits

Local section audit: seven maps, zero errors (two expected learner-block warnings); 410 retained-seed bases classified. Full workspace unit tests: 2,528 passed across 282 files. Production build passed. The CLI rejects changed notes/source/base/provider/tab-ID inputs before emitting output; the independent review finding about unbound CLI inputs was corrected with mandatory identity receipts and executable CLI regressions. Typecheck and build must run sequentially because Next.js regenerates `.next/types`; running them together produced a transient missing-generated-file error, followed by a clean sequential typecheck. PR224 merged as `b562155f1c87a95809b70e77a6551fb6c66af893`; PR checks and main deployment run 37715612703 succeeded. Both containers were healthy. The post-deploy sweep read all 1,764 variants / 441 bases, found five bases with named spans and no numbered labels or read errors. Selected stored song identity fields remained unchanged across 2,730 rows / 455 bases. This is not a full database-byte equivalence claim. No map is `source`; no owner-authored metadata or `inferSongForm` was changed. No listening, recognizability, playability, artist authority or musical acceptance is claimed. The Queen Bridge regression reproduces `[144,192)` / zero-based bars `[48,64)` without imposing it as a DP constraint. Existing Queen map is preserved, including its un-auditioned ambiguous tail.
