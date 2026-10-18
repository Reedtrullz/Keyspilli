# Public five-level difficulty contract implementation — 2026-09-04

This checkpoint implements the already-decided public difficulty contract. It
changes validation semantics only; generation, playability limits, density
policy, artifacts, and catalog data are unchanged.

Starting revision: `971974231016bded91769fc938850fce38ea7827`.

## Contract

Physical artifacts remain six rows:

`very-beginner → beginner → very-easy → easy → medium → advanced`

Every physical row is still individually validated, including legacy
`very-easy`. Production cross-level ancestry and monotonicity now use only the
public five-level order:

`very-beginner → beginner → easy → medium → advanced`

`very-easy` remains serializable, round-trippable, and legacy-accessible, but
is not a public ordering edge. The generation ladder in `simplify.ts` was not
changed. `LADDER_TOL` remains canonical: `.26`, `.02`, `.02`, `.02` for the
public edges from Very Beginner, Beginner, Easy, and Medium respectively.

The report's `.08` onset tolerance is diagnostic matching only. It is not used
as a production ladder tolerance.

## Evidence

The three trusted project-owned fixtures (Clair de lune, River Flows in You,
and Hello) pass the production validator and independently validate Very Easy.
The private Lane A fixture remains diagnostic: its physical outputs are byte
identical to the starting checkpoint, but Easy, Medium, and Advanced still
fail the existing individual `0.08s` median-IOI floor. Candidate A remains
unpromoted.

The deterministic note-set parity report compares all six physical rows at
the starting revision and found no changed level for Classical, Cover, Pop,
or Lane A. The report records each before/after SHA rather than relying on
note counts alone.

Report: [difficulty-contract-implementation-2026-09-04.json](./difficulty-contract-implementation-2026-09-04.json)

- Report canonical SHA: `b4285e94b984bbd1445f818313533293dabadeee3bacd70c56967bbed2f69f03`
- Report bytes SHA: `4a80c3279efe31382c0d1581fa62ee216b7c1406d1f995a1cf88c2fb862af18b`

## Decisions and boundaries

- Contract decision: `PUBLIC_FIVE_LEVEL_CONTRACT_IMPLEMENTED`.
- Timed symbolic MVP: `TIMED_SYMBOLIC_MVP_READY_FOR_NORMALIZATION_REEVALUATION`.
- Real symbolic alignment: `REAL_SYMBOLIC_ALIGNMENT_PARTIAL`.
- Real shadow path: `REAL_SHADOW_BLOCKED_AT_DIFFICULTIES` for Lane A's existing IOI gate.
- Musical quality: `MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`.
- Human listening: `NOT_REQUIRED_BY_DEFAULT`.
- Deployment: `NOT_DEPLOYED`.

The next single task is `REEVALUATE_FROZEN_DENSITY_NORMALIZATION_UNDER_PUBLIC_CONTRACT`.
