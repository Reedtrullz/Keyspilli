# Local native symbolic adapter

`packages/catalog/src/native-score-adapter.ts` is a direct-import utility for
local score research. It accepts an explicitly supplied byte buffer or an
absolute local file and returns the common `OmrScoreInput` plus a
`CanonicalScore` and path-free provenance. It does not download, invoke an
external converter, write source files, or modify the catalog.

Supported formats are:

- MIDI (`.mid`/`.midi`): tracks become parts; track names provide optional
  role/staff hints, MIDI channels become voices, and regular measures are
  derived from time-signature events.
- MusicXML (`.musicxml`/`.xml`) and MXL (`.mxl`): delegated to the existing
  namespace-tolerant notation adapter, retaining measure number/page/system,
  staff, voice, accidental, tie, and tuplet metadata when present.

MIDI has no standard page, accidental, or tie notation, so those fields are
reported as unavailable rather than guessed. MIDI percussion-channel notes
are omitted and counted in adapter warnings. A tempo-less MIDI remains
parseable, but its tempo is unavailable instead of being silently presented as
source evidence.

MSCZ is recognized by native discovery but intentionally returns an
`unsupported` adapter result. This package does not bundle a MuseScore parser;
export the score locally as MusicXML/MXL or MIDI and pass that permitted file
to the adapter. Malformed supported input returns an `invalid` result with a
sanitized error. Local-file paths must be absolute, regular, outside the
repository by default, and are never included in the result JSON.

The supplied source remains the caller's responsibility for permission and
provenance. A successful parse is structural evidence, not proof that the
arrangement is the desired edition or musically correct.
