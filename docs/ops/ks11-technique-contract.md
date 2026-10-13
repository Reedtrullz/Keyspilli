# KS-11 source contracts and localized key observations

This is a separate development evaluator for issue #283. It reports physical
key occupation, successive register observations and repeated attacks of the
same hand/key. It does not select an arrangement, add a difficulty score, assign
fingers, change admission limits, or establish keyboard or musical acceptance.

The source contract was authored and independently reviewed before this
implementation. The exact freeze is documented in
`docs/plans/2026-10-12-ks11-corpus-freeze.md`. Its 24 payload files contain eleven
authored source cases, six explicit tier policies per case, and 54 applicable
PhrasePlans. The manifest SHA-256 is
`7114d50aabd64d706739e1083ca9f9f36e8de7149a307c47739904cfed5bff65`.
The historical proposed-version headers remain unchanged. The controls are
visible development inputs, not untouched holdouts or desired complete
arrangements.

## Run and inspect

Use the repository's supported Node 22 runtime and existing dependencies. The
output directory must not exist; its parent must exist. A new directory on
every run preserves first outcomes and refusals.

```bash
node --import tsx packages/midi/scripts/evaluate-technique-contract.ts \
  --output-dir /tmp/ks11-evaluation-001
```

The evaluator verifies all raw source/reference/policy/plan bytes against the
frozen manifest before parsing or generating. The source hash includes the
original final newline. It records the implementation HEAD/tree, working-tree
state, relevant source hashes and Node version before and after the run.
`cleanCommitQualification` is false for development runs with uncommitted work.
Run again on the final clean reviewed commit for final qualification.

`report.json` accounts for all 66 case/tier outcomes. Each outcome contains a
real artifact pair or an explicit stage and refusal reason. An overall
`evidenceStatus: complete` means the required outcomes and source reference
checks were recorded; it does not mean that all tiers generated successfully.
Unexpected evaluator failures and reference disagreements make the evidence
incomplete and the process exits with status 2. Generation and other supported
contract refusals remain ordinary recorded outcomes.

Every successfully returned requested tier retains:

- The whole generated ladder and the selected canonical Variant JSON, including
  current PhrasePlan/source preparation records.
- The exact extracted plan JSON passed to the maintained API, its hash, and its
  frozen wrapper file hash and JSON pointer.
- Actual MIDI and MusicXML bytes, their hashes, and the current maintained
  artifact validation result.
- Both actual reparses and explicit canonical-to-artifact physical mappings.
- Canonical and reparsed localized reports at native speed and half speed.
- Source identity, occurrence, allowed-change, rest and ending checks separately
  from physical artifact correspondence.

If a later stage refuses a result, available earlier bytes remain in its run
directory. The evaluator never overwrites output files. `MANIFEST.json` records
every emitted file except itself, with byte size and SHA-256. It is an evidence
inventory, not a persisted acceptance receipt.

## Three distinct claims

### Required source identities

Required physical events are resolved through their frozen source-origin
occurrences. Every required occurrence must appear once. The event's exact
pitch, velocity, attack, physical release and known source hand must survive
the maintained source-to-output clock transform. Identical musical notes with
different origins cannot substitute for a missing required event. Compatible
source unisons can carry multiple origins on one physical event; losing an
origin still fails source protection.

Optional identities may undergo only their named transformations. Required
all-role and bass-role rests are checked in the output clock, using maintained
channel-scoped CC64 eligibility where present. Their local source IDs map to
`caseId + ":" + localRestId` in each applicable PhrasePlan. The ending remains a
required exact source event. This is scoped identity preservation under
authored roles; it does not measure automatic role-selection accuracy.

For a source declaring CC64, its complete once-mapped controller timeline and
the channels of surviving source events must also be preserved. A reduction
that omits the timeline remains a source-contract refusal even when its own
canonical notes and exports round-trip correctly. Available bytes and physical
mappings are retained to make that distinction reviewable.

Unknown source hands have no L/R value to preserve. A generated hand assignment
is reported as an arrangement assumption, and does not fill source uncertainty.
MIDI channel or track names do not establish a source hand.

### Physical artifact correspondence

The maintained `validateArtifactFiles` check runs unchanged. The additional
correspondence check has a narrower purpose: it binds each canonical attack to
exactly one reparsed attack using the current writer's structural descriptors.
MIDI independently rounds onset and release to 480 ticks per quarter note;
MusicXML uses 960 divisions. The descriptor includes integer pitch, attack
velocity, declared output hand, and the MIDI channel when source pedal
preservation retains channels. The reparsed timestamps must obey that grid
within `1e-9` beat floating representation error. Residuals from original
canonical timestamps are retained.

Descriptor counts and uniqueness are mandatory. An identical pair of
descriptors admits multiple different physical assignments and is refused as
ambiguous. One artifact note cannot satisfy two canonical attacks. The code
does not select a nearest note or enlarge timing tolerance until a match is
found. A writer result that does not conform to the pinned direct structural
mapping is retained as a refusal; the general artifact validator's separate
0.01-beat tolerance does not authorize it here.

MIDI and MusicXML do not encode the original authored event IDs. The reparsers
create their own local origin handles. The report retains those handles and an
explicit physical mapping; it never credits the formats with carrying the
source identities. Local canonical and parsed diagnostic IDs identify positions
in their separately hashed inventories.

The MusicXML reparser merges supported connected ties into one physical attack.
Parser success alone is not a blanket assertion that arbitrary tie syntax was
validated. A focused real-writer contract checks a barline tie as one attack,
then removes its tie markers and confirms that the resulting two attacks fail
physical correspondence. This bounded evidence does not change the parser.

### Localized observations

`analyzeTechnique` is a report-only API. Callers supply physical event IDs,
Notes, clock authority, hand authority and a separate pedal declaration. It
returns a report or a categorized refusal. It never infers source IDs from
pitch/time matching.

Attack groups use the earliest unused onset as their fixed anchor, with an
inclusive `1e-9` beat grouping tolerance and no transitive chaining. They are
partitioned by declared hand, with unknown hands visible. Events are ordered
deterministically by onset, pitch and event ID; source-origin lists have stable
ordering. Physical occupation uses the half-open interval `[attack, release)`.
Releases exactly at the new attack precede it. Carried events include all
earlier groups, not only the immediate predecessor, and exclude current-group
attacks. CC64-only eligibility is a separate observation.

Register comparisons retain complete prior and next attacked pitch ranges.
Their pitch anchor is the highest attacked MIDI note; their release anchor is
the latest physical release of the complete prior group. Signed pitch
displacement and release-to-next-attack gaps are observations, not measured
hand travel. Negative gaps denote overlap. Same-key recurrence follows each
known hand/key independently of attacks in the other hand or at other keys.
Unknown-hand interference remains explicitly unqualified.

The report compares selected source event, held-key, register-transition and
same-key witnesses against the independently frozen arithmetic. Whole generated
held sets and adjacency remain observed output context, because allowed optional
material can change them. They do not become retrospective expected references.

## Clocks and playback scenarios

Source beats are quarter-note beats. Native time comes only from a valid
declared complete native clock. Missing authority leaves seconds unknown; the
presence of a numeric 120-BPM field alone is insufficient. Explicit malformed
tempo metadata is invalid and refused. It must not be filtered into a fallback
clock. The unknown-clock and malformed-clock controls each retain six tier
refusals before generation.

Maintained generation maps native seconds once to constant arrangement beats:
`variantBeat = nativeSeconds * constantSourceTempoBpm / 60`. Canonical
diagnostics then use that arrangement's constant clock. Reparses use their
actual exported constant clock. Source tempo changes are never integrated a
second time. For the authored 120-to-60 BPM control, this distinction preserves
the four-second key hold crossing the tempo change and the negative one-second
release gap at the next attack.

The half-speed scenario reuses the exact input arrangement. Its elapsed playback
seconds double, while source identities, pitches, beat coordinates, native
seconds, event grouping and relations remain unchanged. The evaluator compares
all such fields and all materialized elapsed-time fields between scenarios.
Changing speed is not a new arrangement and does not establish suitability.

## Limits and review

Report budgets are independent of production admission gates. The core API
declares finite event, source-origin, native-clock, controller-work and
materialized-relation limits. The physical correspondence helper refuses more
than 4,096 notes per side before allocating descriptor groups. None of these
report limits raises or replaces a generation limit.

Focused tests cover the independently authored interval contrasts, ordering,
release boundaries, unison multiplicity, unknowns and malformed inputs. The
evaluator contracts additionally cover raw-byte freeze tampering, actual
MIDI/XML rendering, ties/triplets, changed velocity/hand/channel descriptors,
ambiguous or reused correspondences, missing source occurrences, rest intrusion
and a once-integrated tempo witness. First behavioral RED results and later
observed generator refusals are retained separately from final clean-commit
verification.

Fingering and hand-position travel are not assessed. Ergonomic suitability,
keyboard acceptance and musical acceptance remain unestablished. Broad KS-11
optimization still needs source-qualified musical output and independent
keyboard/fingering evidence. This evaluator changes no reducer, selector,
difficulty score, source hand inference, default profile, production catalog,
accepted pin or persisted receipt semantics.
