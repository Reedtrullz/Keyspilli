# Optional experimental host preparation

Use only when the task calls for this experimental driver and preflight reports `host_workflow.status: compatible`. Preflight checks an available driver's implementation hash against an independent file fingerprint. Ordinary checkout discovery does not require this driver. Neither check changes branches or certifies music.

Use actual file pins in a request (replace these example paths/hashes, never invent them):

```json
{
  "schemaVersion": 1,
  "title": "TITLE", "artist": "ARTIST", "decisionMode": "baseline",
  "source": {"path": "/absolute/source.mid", "sha256": "actual 64-character SHA256"},
  "soundfont": {"path": "/absolute/sampled-grand.sf2", "sha256": "actual 64-character SHA256"},
  "instructionPin": {"path": "/absolute/loaded-skill/SKILL.md", "sha256": "actual 64-character SHA256"}
}
```

Compute pins with the existing host tools, for example `shasum -a 256 /absolute/source.mid`. MIDI intake is bounded to 16 MiB. Native MusicXML/MXL still uses ordinary intake below; do not relabel it as MIDI. Baseline uses no model and preserves the input; unqualified harmony uses the ordinary inferred backing engine. This is an engineering baseline, not a source-confirmed arrangement.

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/song-workflow.mts prepare /absolute/request.json output/song-prep/NEW-RUN
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/song-workflow.mts respond output/song-prep/NEW-RUN SPAN_ID /absolute/response.json
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/song-workflow.mts resume output/song-prep/NEW-RUN
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/song-workflow.mts verify output/song-prep/NEW-RUN
```

`plan` additionally accepts pinned v2 `evidence` and actual `referenceAssets`; each response is one strict ArrangementPlan for its owned span. `selection` requires pinned `referenceCorpus` plus `referenceCaseId`; each response selects a finite choice ID from that span's packet. Use the existing reference checker to prepare these facts. Known source-confirmed no-chord phrases are handled by the host even while Original sounds; source authority is never a model field.

Read `workflow.json.pending` and each listed `SPAN_ID/decision-packet.json` (maximum 512 events/32 KiB). Return only the declared response schema. `respond` retains the initial response and at most two repairs, with precise validation errors; no new orchestration code or binary MIDI generation is needed. Submitted files do not prove a model call: comparisons additionally require independently verified exact session route/effort and final-turn receipts.

Copy each actual pending ID exactly; an interface/arm label such as `A` is not a span ID. A plan's sounding chord uses `sourceKind:"inferred",inferred:true`; unknown silent harmony uses `name:"N.C.",notes:[],sourceKind:"unknown",inferred:false` with its actual bounds/evidence IDs. The host derives unresolved warnings even if the response has `unresolved:[]`. Never apply the sounding-chord provenance recipe to N.C. Confirmed source rests are owned and authenticated by the host, not by a model claim.

The host writes compiled source/lineage, warnings, six-tier portable bundle, second isolated installation, protected-event audit, checked Player replay, actual Original/Chords MP3s and `index.html`. Its finite local stages resume without reissuing model/audio requests. Interrupted owned directories are preserved and deterministic stage retries are bounded. `verify` checks existing pins and completed imports without advancing unfinished stages. Changed source, evidence, code or pinned instructions requires a new run. A missing bank keeps the useful prepared bundle `review-required` (exit 2); other failures remain `blocked` with receipts. `complete` means the provisional artifacts exist, never musical readiness. Retain the entire run and its actual inputs; see the musical gate for independent listening/keyboard requirements.


This driver is absent from ordinary supported checkouts. Its absence does not block [ordinary preparation](evaluation-and-repair.md#intake-and-preparation). Do not create or guess its commands to finish a routine symbolic task.
