# MusicXML attack velocity preservation — #279

Baseline: reviewed Wave 3 `ecddf8a08d3540ba09898b0951ed22d1fd809bd6`.
Tracking: https://github.com/Reedtrullz/Keyspilli/issues/279.

## Design

Use standard exact unqualified note `dynamics`, whose unit is percent of forte
MIDI velocity 90 (W3C MusicXML 4.0 note reference linked in the operations doc).
Write six-decimal `100*v/90`, parse decimal and round `0.9*d` half upward. Bound
positive MIDI attacks to integers 1..127; absent attributes keep default 80,
invalid values refuse without clamping. Share source attribute parsing between
ordinary validation and decoding; native notation validates but warns that its
note model cannot represent velocity. Tie merging retains the initial attack.

Version generated artifact fidelity to 2 and validate actual MIDI/XML attack
integers. Recognize exact v1/v2 records only. Historical callers explicitly
select v1 only when the stored diagnostic record is absent; present invalid or
future records refuse. Preserve every old artifact and accepted pin.

## Verification

Before production edits, the actual writer-to-parser test at the baseline fails
with 20/100 becoming 80/80; retain raw RED logs outside the repo. Contract tests
cover all 127 supported attack integers; standard decimal rounding; missing,
invalid, qualified, duplicate and entity-encoded attributes; quoted metadata;
ties, chords, two staves, pedal, source immutability and tampering. Native XML/MXL
checks assert honest model omission and fail closed on invalid input. Historical
migration and stored export tests distinguish exact legacy reads from strict
v2 or invalid records. Active export response tests check both MIDI and XML,
source and actual meter-accent expression, selected hands/support, half speed,
transpose, key-release timing and pedal. Run affected tests/typechecks; root
owns independent review, combined gates and publication.

## Nonclaims

No source acquisition or provider calls, accepted-pin update, merge or deploy.
Symbolic velocity equality cannot establish acoustic loudness, articulation,
third-party renderer compatibility, listening/keyboard approval or musical
acceptance. Direction dynamics, wedges and ornaments remain unimplemented.
