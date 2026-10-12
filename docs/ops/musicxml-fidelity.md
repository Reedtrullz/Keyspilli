# MusicXML fidelity boundary

MusicXML intake and the native MusicXML/MXL score-review adapter share a
deterministic semantic policy. A parsed note list is not certification that
every expression or playback instruction in a score was preserved.

## Sources that require a different export

`<transpose>` and `<octave-shift>` are explicitly unsupported. The importer does
not track sounding-pitch conversion by part, staff or changing declarations.
It refuses these elements, including a zero/reset declaration, before notes can
be used for generation or source review. Export **concert-pitch MusicXML with
the transposition applied to its notes**, or concert-pitch MIDI. Deleting the
declaration alone does not establish the correct sounding pitches.

Nonzero note `attack`/`release` playback offsets also require a MIDI performance
with the offsets applied or a supported score with explicit event timing.
The policy reads exact unqualified attributes. Qualified metadata and namespace
declarations cannot hide an offset or change its result with attribute order;
duplicate source attributes are rejected.
These refusals apply to compressed MXL and to the namespace-tolerant native
adapter. The score-review timing fallback cannot bypass them. An unsupported
native result retains the original byte hash and source provenance and contains
no canonical score. Comments, CDATA and escaped words are not declarations.

Existing restrictions on navigation, repeat order and tempo remain in force.
The playback importer and notation adapter have different timing coverage; a
notation-only parse does not certify an unfolded playback clock.

### Compressed source selection

Upload, upload preflight and native score review share one MXL root selector.
It parses `META-INF/container.xml` and selects the first actual `rootfile`
element, as specified by the [MusicXML compressed-file format](https://www.w3.org/2021/06/musicxml40/tutorial/compressed-mxl-files/).
Quoted attribute syntax, namespaces and XML entities do not change the selected
source. Comments, CDATA and other attribute text cannot select a companion score.
The unqualified `full-path` attribute is exact and case-sensitive; namespace
declarations and qualified lookalikes cannot overwrite it, and duplicates refuse.
Container elements are matched by inherited namespace URI and case-sensitive
local name. Same-URI prefixes remain interchangeable; foreign elements cannot
select a score. Missing prefix bindings and mismatched closing names refuse.
An absent, malformed or missing declared root is an explicit error; it is never
replaced by another file. Legacy archives without a container remain supported
only when exactly one score file is present outside `META-INF`. Multiple possible
scores require an explicit container. This intentionally tightens the previous
fallback behavior while retaining original archive bytes and provenance hashes.

## Supported per-note attack velocity

The maintained writer and ordinary playback importer preserve integer MIDI Note
On attack velocities **1 through 127** using the exact unqualified MusicXML
`note` attribute `dynamics`. The [MusicXML 4.0 note reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/note/)
defines this as a percentage of the default MIDI forte velocity **90**. It is
neither a MIDI integer field nor a visible dynamic mark. The writer emits
`(velocity * 100 / 90).toFixed(6)`; the importer rounds `percentage * 90 / 100`
to the nearest integer (half upward). The maximum six-decimal conversion error
is below one millionth of a MIDI integer, so every supported writer value
reconstructs exactly. Percentages can exceed 100: velocity 127 writes 141.111111.

A missing exact attribute retains the established default velocity 80. Explicit
values must use finite non-negative decimal syntax (optional leading `+`,
whitespace trimmed; no exponent notation), be positive and at most
`127 * 100 / 90`, and round to 1..127. Zero, values rounding to zero, invalid
syntax and out-of-range values refuse; none are clamped. MIDI Note On zero is a
release instruction, not a supported attack. The writer refuses noninteger,
nonfinite, zero or out-of-range source attack velocities. It neither invents
velocity for malformed source notes nor silently repairs them.

Both importer validation and note decoding use exact source attribute keys.
Qualified lookalikes, namespace declarations, case changes, attribute order,
quoted metadata containing `>` and entity-encoded values cannot overwrite the
actual value. Original XML references decode in one pass: `&#51;0` becomes 30, but
`&amp;#51;0` remains literal `&#51;0` and refuses as a percentage. The native
reader consumes the entire attribute source, refusing unquoted, bare or unmatched
tokens rather than treating malformed explicit dynamics as absence.
Duplicate attributes refuse. Tied continuations do not create
fresh attacks: merged notes retain the initial attack velocity. Independent
chord notes and staves retain their own velocities.

The native score-review adapter validates the same percentage contract but its
notation note model **does not carry attack velocity**. It reports explicit
per-note velocities as omitted from that model, including compressed MXL and
namespaced scores. This is a notation representation limit; its canonical score
must not be described as velocity-preserving. Original source bytes and hashes
remain intact.

## Expression that is reported as omitted

Dynamic marks and direction-level `sound` dynamics, wedges, articulations,
ornaments, slurs, fermatas and note release dynamics remain unsupported. They
are not converted into velocity curves, extra attacks, phrasing or playback
timing. The existing warnings continue through upload preflight, source review,
short studies and ordinary variants. Supported per-note attack dynamics no
longer produce an omission warning in the ordinary importer. Pedal retains its
separate channel-bound controller contract.

## Artifact validation and historical reads

`writeVariantArtifacts` returns fidelity schema **2**, persisted by ingest as
`artifactFidelity`. The exact record declares MIDI and MusicXML note velocities
`encoded`, MusicXML dynamic markings `omitted`, validation scope
`symbolic-events-and-attack-velocities`, and expressive preservation
`not-established`. It describes capabilities, not a receipt claiming validation
or musical review ran. Unknown versions, extra keys and malformed records fail
validation rather than selecting a less strict policy.

Fresh artifact validation defaults to schema 2 and compares integer attack
velocities in both real reparsed formats, in addition to pitches, onsets, key
releases, tempo, meter and supported source pedal. Source 20/100 now reparses as
20/100 through MusicXML. Current validation matches attack multiplicities by pitch and exact velocity,
then requires a one-to-one pairing within the existing 0.01-beat onset/duration
tolerance. Sorting rounded durations cannot manufacture a velocity swap; attacks
at distinguishable times still cannot exchange their velocities. Ambiguous
windows use a matching search rather than a greedy pair or deduplication.
Changing only note dynamics is detected when it changes the reparsed attack
integer; an absent attribute still has the documented default 80.

Historical reads explicitly use `artifactFidelityForRead`: a missing diagnostic
record adopts the exact schema 1 contract; a present schema 1 record retains
its historic symbolic-event-only validation, with MusicXML velocities declared
omitted. A present null, malformed or future record refuses. The legacy policy
still checks pitches, onsets, key releases, tempo, meter and source pedal; it
does not claim that historical velocities were preserved. This read policy is
used at stored catalog export, staged publication, legacy migration inspection
and catalog verification. It does not rewrite bytes, upgrade identity, or repin
any old artifact, golden, accepted reference or human-review receipt.

Active Player export writes the actual selected variant's velocities, including
source expression or meter accents when the existing flat-velocity and validated
source-phase policy permits them. Its existing hands, audible support, speed,
transpose and source pedal contracts apply. Source data remains unchanged.

## Boundaries of the evidence

Tests cover actual MIDI/XML serialization and reparsing and the active download
response. They establish bounded symbolic integer equality, not acoustic or
expressive equivalence. Third-party playback/rendering, piano loudness, timbre,
articulation, phrasing, ornament realization, aesthetic quality, listening and
keyboard acceptance are not established by this change. Full transposition and
expressive direction realization still require their own source-based acceptance.
