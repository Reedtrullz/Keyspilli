# KS-11 original technique contract corpus, version 1

**Status: PROPOSED freeze, candidate `1.0.0-proposed-3`. Independent reference review and root freeze are still
required.** These are original, author-visible development controls created
before the new KS-11 diagnostic implementation. They are not untouched holdouts,
complete desired tier arrangements, human-reviewed performances, or production
acceptance pins.

## What is frozen by a future approval

The candidate consists of seven original phrase families, eight primary source
cases, and three explicitly derived direct controls. Every case has six named
tier-policy rows, for **66 required outcomes**. The primary sources contain
28–34 physical attacks each; the required exact event inventory starts at 18
per tier. Inventory was authored to avoid a trivially short source. It does not
predict that a generator or an admission gate will accept every tier.

| File or directory | Authority and purpose |
| --- | --- |
| `sources/*.source.json` | Exact original ParsedMidi-shaped JSON bytes. Hash these bytes before parsing. They were authored directly, not parsed from acquired media. |
| `technique-contract-corpus-v1.json` | Source hashes, clocks, event and occurrence IDs, exact rational note declarations, hand and pedal authority, roles, rests, and endings. |
| `technique-contract-reference-v1.json` | Independently entered local witnesses and direct interval arithmetic over the original source declarations. |
| `technique-contract-policy-v1.json` | Grouping, anchors, half-open occupation, clock/scenario policy, uncertainties, artifact correspondence obligations, and all six required/optional identity policies. |
| `phrase-plans/*.plans.json` | Nine wrappers containing six ordinary `PhrasePlanV1` objects each. The wrapper itself is not a PhrasePlanV1. Select the named `/plans/<tier>` object. |
| `proposed-freeze-manifest.json` | Raw-byte SHA-256 and byte sizes for the candidate payload. It excludes its own bytes, avoiding a recursive hash definition. |

There are no plan objects for the unknown-clock and malformed-clock controls.
Their six rows each require a retained refusal. The same-key-overlap control has
plans because its source/clock declarations are well-formed; exact incompatible
physical release requirements are the intended refusal condition. The report
may still describe its symbolic overlap without approving a physical export.

The source hash recipe is **SHA-256 over the exact UTF-8 source file bytes,
including the final newline, without JSON canonicalization**. Object order and
whitespace are therefore part of the raw source pin. The parsed object, source
hash, and source-clock object must remain bound. The plan wrapper and JSON
pointer bind the authored policy; a later evaluator must also retain the exact
extracted plan bytes/hash it passes to the maintained API.

## Cases and independently authored purposes

| Family | Source cases | Local purpose |
| --- | --- | --- |
| Aperture | `aperture-open`, `aperture-held` | Same attacks at beats 0 and 4 and the same 19-semitone pitch displacement. Only the first key release differs: beat 1/2 or 9/2. |
| Boundary Garden | `boundary-garden` | Release exactly at attack, a held chord member, and a carried key originating before the immediately previous attack group. |
| Alternating Beacon | `alternating-beacon` | Consecutive R/key-60 attacks remain consecutive for that hand/key even when L attacks intervene. |
| Prism at the Barline | `prism-barline` | One physical attack with two source origins, chord multiplicity, a tie crossing beat 4, and triplet attacks at one-third-quarter-beat intervals. |
| Changing Hourglass | `changing-hourglass` | A 120→60 native tempo change at beat 4 crosses a hold; a separate half-speed scenario changes seconds without changing notes. |
| Pedal Envelope | `pedal-envelope` | Physical key release precedes the new attack while channel-0 CC64 is down. The L/channel-1 note is outside that sustain declaration. |
| Unnamed Hands | `unnamed-hands` | Some physical events have unknown source hands despite a fully declared clock. Output L/R assignments cannot fill that source uncertainty. |

The three derived direct controls retain their parent family's continuation:

| Control | Deliberate declaration | Required outcome |
| --- | --- | --- |
| `clock-unknown` | `tempoMetaPresent=false`, no tempo events, and an explicitly untrusted numeric 120 placeholder. | Beat facts are available; native seconds are unknown; six retained tier refusals. |
| `clock-malformed` | The explicitly declared beat-4 tempo event has zero microseconds per quarter. | Invalid explicit clock metadata; six retained refusals; no filtering or fallback. |
| `same-key-overlap` | The first R/key-60 release moves to beat 2 while the next independent attack remains at beat 3/2. | Report a 1/2-beat overlap and retain the six exact-protection refusals. |

Every source has an original 20-event continuation, five separately selected L
anchors, and an exact ending at beat 88 with physical release at beat 90. The
continuations use different authored pitch sequences for the seven families.
The Aperture pair intentionally shares its continuation to isolate release.
The local all-role rest is `[8,12)`, the declared bass-role rest is `[40,48)`,
and the terminal all-role rest is `[90,96)`. Source CC64 is off before all of
those rests. The rests are not inferred from generated arrangements.

Rest IDs in `authoredRestDeclarations[].id` and tier `requiredRestIds[]` are
local to their enclosing case. The explicit
`identityPolicy.restIdBinding` rule maps local rest `R` in case `C` to the
PhrasePlan rest ID `C + ":" + R`, preserving the same start, end, and scope.
For example, Aperture Open's `local-breath` maps to
`aperture-open:local-breath`. The same mapping applies to every tier with a
plan; it does not imply a plan exists for the refused unknown/malformed-clock
controls. Candidate proposed-3 makes this existing authoring convention
explicit and corrects the triplet label above. Source JSON, corpus declarations,
PhrasePlans, tier requirements, and interval references retain proposed-2's
exact bytes; unchanged files retain their own earlier version labels.

## Source events, physical attacks, and occurrences

An `eventId` in the corpus names one physical source attack. Each source Note
carries its stable source-origin IDs, and the event declarations additionally
pin occurrence numbers and original IDs. Matching a source event by its current
array index is insufficient. The input-array order is intentionally irrelevant
to local diagnostic ordering.

The `prism-barline:unison60` Note carries two distinct source origins. Its
declared physical multiplicity is one. The phrase plan selects one primary
origin because the existing compiler forbids assigning the same Note twice;
the separate tier policy explicitly requires **both** origin occurrences.
This preserves five source-origin occurrences in four physical attacks at
beat 0. It does not invent a second MIDI key attack.

`prism-barline:barline-tie69` is a single Note with attack 3 and release 5. Its
two declared notation segments are `[3,4)` and `[4,5)`. There is no new attack
at beat 4. A future MusicXML reparse must validate the tie chain before treating
the two serialized segments as one attack.

Alternating Beacon declares two finite played occurrences of its authored
`returned-key60` component with different occurrence IDs. These remain
event-level source metadata. The ordinary measure timeline has only
`index/startBeat/endBeat`; no measure repeat map or `repeatPlayback` claim is
supplied. This is not an assertion that an acquired score's repeat notation
was unfolded or verified. All event-level source origins remain unique in the
full performance.

Pedal-absent API sources omit `sourcePedal`, because the maintained API rejects
an empty pedal-change array. Their separate corpus declarations explicitly
state complete no-pedal coverage through beat 96. Pedal Envelope uses the
schema-supported logical track source `midi:0`; the corpus separately preserves
named CC64 control IDs. That track label is authored and does not assert an
acquired MIDI file.

## Required identities and allowed changes

Each of the six physical tiers is explicitly named. All tiers require the
local R and unknown-hand probe events, 16 continuation events including the
ending, their physical releases, and the three source-declared rests. The four
upper physical tiers additionally require the local L events. Required L
continuation anchors increase from none in very-beginner/beginner, to anchors
1 and 5 in very-easy, to 1/3/5 in easy, and all five in medium/advanced.

Required events have no permitted transformations. Optional events may be
omitted or undergo the explicitly named onset, release, octave, hand, or
velocity changes. Their survival is not required, and no complete desired tier
inventory is supplied. Changes must still obey the protected identities,
declared rests, and unchanged maintained validation. If the requested exact
events conflict with current gates, retain the reason instead of weakening the
corpus to create six successes.

Known source hand labels are self-authored declarations. Unknown source hands
remain unknown even if ordinary generation assigns L/R. That output assignment
may be recorded as an arrangement assumption only. Physical key occupation uses
`start + dur`; CC64 eligibility stays separate.

## How to use the references without a circular oracle

The local held-event sets and comparison pairs were entered by the author.
Their intervals use direct rational arithmetic over these source notes. No
new diagnostic, current reducer, `buildVariants`, previous corpus output, or
evaluation result supplied the expected facts.

The source references are exact for the complete authored local context. In a
future tier output, the mapped required pair's pitches, attacks, and releases
can be checked against its source reference when applicable. Optional changes
can introduce additional context or change adjacency; the complete resulting
held sets and successive-group observations then remain **observed generated
facts**, not rewritten source expectations. Required event pairs may still
provide fixed local witnesses without asserting that the entire generated
arrangement was independently approved.

Only after independent review and root freeze may the unchanged generator be
run. Every case/tier then needs actual canonical notes, actual MIDI and
MusicXML bytes and hashes, and reparses with exact unambiguous correspondence,
or a retained refusal. Source preservation, physical artifact correspondence,
and localized observations are three separate results. A format that does not
encode source IDs cannot be credited with carrying those IDs merely because a
nearby note was found.

## Limits

No finger numbers, hand centers, physical travel model, calibrated grade,
ergonomic acceptance, musical approval, or keyboard acceptance is supplied.
No generation, reducer, admission limit, public selector, accepted pin,
production catalog, provider call, or acquired-media operation is part of
this authoring packet. The read-only schema context was draft candidate
`790dba16317ec353d1594a787fa23ee469f1e967`; the actual implementation base must be
bound later to the separately reviewed Wave 4 integration. No merge is implied.
