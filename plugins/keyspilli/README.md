# Keyspilli for Codex

Personal plugin for preparing Original piano arrangements and backing-only Chords from a song name, YouTube link or supplied score/media. The agent performs verification and corrections; it does not assign the owner another listening pass.

Song deliveries lead with playable Original and Chords audio previews directly in chat. MIDI/MusicXML and import instructions follow. Existing rendered previews must be surfaced, not left hidden inside the package; provisional musical status remains explicit. The tutorial gate helper reports source-origin losses and unresolved evidence before an agent can call a candidate ready.

For ready songs, use **Approve and add to Keyspilli** beneath the previews, or reply “publish it.” The agent verifies the approved files, handles publication to the existing private catalog and returns a verified live player link. Approval applies to the identified versions and is not requested again on routine retries. The workflow checks live compatibility; the bundled offline installer is not a production updater.

## Use

Install `keyspilli` from your personal marketplace, then start a new chat. Ask:

- “Use Keyspilli to prepare [song or link] as Original and Chords.”
- “Use Keyspilli to prepare missing Chords in my catalog.”

This package contains the `keyspilli-song` skill, three small unapproved authored symbolic transformations, its workflow references, a read-only checkout check and a bounded SynTheory calibration helper. Its optional audio review is a pairwise Anti `listen` triage adapter with a no-HTTP dry run, explicit endpoint/model, single-attempt budget and pinned local evidence. It uses the existing Keyspilli repository pipeline and does not bundle the application, demo media, datasets, credentials or model access.

The Keyspilli checkout's `docs/audio-review-demo.md` points to a frozen synthetic pack, a completed no-upload preview report and the command for a fresh offline dry run. Synthetic controls are software checks only and never count as real-song listening calibration.

The separate Player listening pilot stopped at its first required no-audio gate: the provider made musical claims with zero audio attached. The route remains unqualified, the remaining tasks were not sent, and no paired comparison or prompt change is supported. See the Keyspilli checkout's `docs/ops/player-audio-qualification-study-stop.md` and the retained local offline Player package; that preview can reveal the construction key.

The adapter has an explicit `--review-profile evidence-v2` opt-in with an audio-neutral prompt, per-attachment evidence, and distinct compared/abstained coverage. Reports separate reserved attempts from validated completed responses; an abstention remains an unreviewed gap. The default legacy prompt bytes remain unchanged; the current 4096 transport ceiling and optional schema/binding identities are fingerprinted, so old runs cannot silently resume. Valid schema and provider self-report do not verify audio grounding or hearing; see `skills/keyspilli-song/references/audio-listening-review.md` and the checkout's `docs/ops/player-audio-evidence-v2.md`.

The offline-first `review-score.mts` workflow independently parses pinned MIDI/XML/MXL,
compares pitches/attacks/releases/multiplicity, screens structural playability and
returns located findings and supported repair previews. It requires no owner
listening or pianist. Check `score_review.status: compatible` and follow
[the score review workflow](skills/keyspilli-song/references/score-review-workflow.md).
Source fidelity, Player realization and optional bound Gemini interpretation remain
separate; musical acceptance and production admission are not established.

Before preparation, run from this plugin directory:

```sh
python3 skills/keyspilli-song/scripts/check_checkout.py /absolute/path/to/Keyspilli --node /absolute/compatible/node --discover
```

The default is ordinary preparation through the returned `preparation.command`. Preflight keeps a supported supplied checkout; only an unsupported checkout triggers discovery of other ordinary Git worktrees. Missing experimental drivers and optional audio/model capabilities do not block this route. Runtime, SQLite ABI, required-file and Git fingerprint-source failures do block it. Use the root of a real Git checkout/worktree; a downloaded source archive or nested directory cannot borrow another repository's identity. Preflight reports free space; `--minimum-free-gib` enforces an explicit budget for a planned job instead of applying a blanket 30 GiB requirement to read-only checks. Keep the returned absolute Node executable and use `--import tsx`. Actual isolated import, resolved Player events, export fidelity and musical assessment remain separate checks.

Optional constrained phrase edits require `apps/web/scripts/arrange-song.mts`; preflight executes capabilities and reports `arrangement.status: compatible`; legal choices also require `selection_supported`. See the skill's `references/constrained-arrangement.md`. Older preparation checkouts remain supported. The feature remains opt-in: the controlled phrase pilot found import timing/clock limits and has no listening or verified monetary comparison. Its final-MIDI audit must pass before claiming protected source timing survives.

For one completed local MIDI source, optional `prepare-workflow.mts` adds exact input/instruction pins, a prepared checkpoint, bounded explicit retries and read-only verification of retained outputs. Require `deterministic_workflow.status: compatible` and follow [deterministic preparation](skills/keyspilli-song/references/deterministic-preparation.md). This separate prototype reuses ordinary six-tier preparation and isolated bundle imports. The experimental decision/selection driver has its own compatibility check. Checkpoint completion leaves source, listening and musical acceptance provisional; the wrapper makes no model calls or cost-saving claim.

The packaged `pin_preparation_request.py` helper constructs that native request from selected local files, computes their hashes and refuses source-pin mismatches or existing outputs. It does not execute preparation or decide source/plan authority. Use the returned request path, then let the compatible host perform full admission.

No MCP server, daemon or deployment hook is included. Import commands prepare isolated offline catalogs; live publication still requires the user's authorization.

The optional [complete delivery procedure](skills/keyspilli-song/references/complete-delivery.md)
connects ordinary preparation to both checked WAV previews, matching exports,
all six Original variants and a relocatable playback index. Rendering failure
keeps the prepared bundle and usable mode; retry delivery to a new directory,
not source acquisition. Discover the actual CLI before using the new flags.
This is provisional software-checked delivery, not musical approval or release.

## Maintain

The 20261016 chord-led candidate refuses a raw source-backed preview when a
shared note also carries a declared melody or hook. The ordinary chordal route
remains available from the same input in a new run; Original is unchanged by
this refusal. This corrects a mode-boundary failure, not musical acceptance.

The earlier 20261014 source-backing candidate adds an opt-in from a pinned Advanced
PhrasePlan and preserves explicitly selected rests when a permitted optional
tail can be shortened. All six Original variants still ship; only targeted
tiers have exact phrase protections. This is a provisional source candidate,
with musical/keyboard review, inexpensive-model comparison and installed
adoption recorded separately. It has not been published or installed.

Edit this plugin's `skills/keyspilli-song/` as the canonical source and commit reviewed changes to Git. Installed plugin caches are release snapshots. Packaging and compatibility checks do not install or release a version. Version bumps, installed adoption and distribution require the relevant separate authorization; do not maintain a second independent skill copy.

Run these bounded checks from the plugin directory:

```sh
python3 skills/keyspilli-song/scripts/check_checkout.py --self-test
python3 skills/keyspilli-song/scripts/prepare_syntheory.py --self-test
python3 skills/keyspilli-song/scripts/check_tutorial_delivery.py --self-test
python3 skills/keyspilli-song/scripts/normalize_ug_score.py --self-test
python3 skills/keyspilli-song/scripts/recover_vocal.py --self-test
python3 skills/keyspilli-song/scripts/pin_preparation_request.py --self-test
```

From the repository root, run `python3 -B scripts/check-keyspilli-plugin.py --source plugins/keyspilli --checkout . --node /absolute/compatible/node --report /absolute/new-check.json`. This builds and extracts a candidate archive, validates the plugin/skill metadata and every packaged reference, runs every packaged helper's offline help/self-test, probes implemented host capabilities and completes a synthetic ordinary preparation in fresh temporary catalogs. When the deterministic host is compatible, it also constructs a request with the extracted helper and verifies that the actual TypeScript host admits those same input bytes. The report pins archive/source-tree hashes, the selected runtime, capabilities and test results. It does not render a sampled piano or contact a provider. Synthetic controls remain software evidence and never grant listening, source or publication approval.

The tracked `plugins/keyspilli` tree in Keyspilli is the release source for this candidate. Canonical and installed copies retain their previous versions until explicit adoption. Build with `scripts/package-keyspilli-plugin.py`; the sorted source inventory pins every source member.
