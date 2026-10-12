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

## Expression that is reported as omitted

The importer reports dynamic marks and `sound`/note dynamics, wedges,
articulations, ornaments, slurs and fermatas. These are not converted into
expressive note velocities, extra attacks, phrasing or playback timing.
Supported ordinary pitches, starts and durations can still be imported. The
warnings are exposed by upload preflight, source review, short studies and all
six ordinary variants, including their stored `notes.json` files. Pedal has its
existing separate channel-bound controller contract.

`writeVariantArtifacts` returns a versioned `fidelity` record. Ingest persists it
as `artifactFidelity`. It declares that MIDI encodes the variant's velocities,
while the MusicXML writer omits note velocities and dynamic marks. Its
`expressivePreservation` is **not-established**. This record describes format
capabilities; it is not a receipt claiming validation or musical review ran.

`validateArtifactFiles` checks symbolic pitches, note onsets and key releases,
tempo, meter and supported source pedal. A zero-error result does not establish
dynamic, acoustic or aesthetic fidelity. For example, source velocities 20/100
survive MIDI export but currently reparse from MusicXML as the import default
80/80. The new record makes that loss explicit without changing accepted output
bytes. Active Player export follows its separately documented hand, selection
and transposition contract.

Original uploaded bytes and their identity hashes remain unchanged. No old
artifact, reference hash or human-review receipt is upgraded by this change.
Full transposition, ornament realization and expressive MusicXML export remain
future work requiring their own source-based acceptance cases.
