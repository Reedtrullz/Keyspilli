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

The preflight selects the supplied capable checkout or one verified candidate from its existing worktrees. The preferred MIDI path is the resumable host driver: baseline or bounded plan/selection decisions, six tiers, checked second import and both sampled-piano previews. Code/schema fingerprints must match. Ordinary preparation remains available after a separate successful preflight. The selected checkout needs its pinned Node runtime and installed dependencies. A successful preflight checks prerequisites only; actual isolated import, Player replay and musical assessment remain required. Keep its absolute `node_executable` for subsequent script calls with `--import tsx`, and read its optional audio/retrieval capability report. Follow the skill when a source or audio reviewer is unavailable.

Optional constrained phrase edits require `apps/web/scripts/arrange-song.mts`; preflight executes capabilities and reports `arrangement.status: compatible`; legal choices also require `selection_supported`. See the skill's `references/constrained-arrangement.md`. Older preparation checkouts remain supported. The feature remains opt-in: the controlled phrase pilot found import timing/clock limits and has no listening or verified monetary comparison. Its final-MIDI audit must pass before claiming protected source timing survives.

No MCP server, daemon or deployment hook is included. Import commands prepare isolated offline catalogs; live publication still requires the user's authorization.

## Maintain

Edit this plugin's `skills/keyspilli-song/` as the canonical source. On the original machine, `~/.codex/skills/keyspilli-song` is a compatibility symlink to it. Installed plugin caches are release snapshots, not editable sources. After validation, bump `.codex-plugin/plugin.json`'s version and run the available Codex CLI's `plugin add keyspilli@personal`, then verify installed version/bytes and test in a new chat. Do not maintain a second independent skill copy.

Run these bounded checks from the plugin directory:

```sh
python3 skills/keyspilli-song/scripts/check_checkout.py --self-test
python3 skills/keyspilli-song/scripts/prepare_syntheory.py --self-test
python3 skills/keyspilli-song/scripts/check_tutorial_delivery.py --self-test
python3 skills/keyspilli-song/scripts/normalize_ug_score.py --self-test
python3 skills/keyspilli-song/scripts/recover_vocal.py --self-test
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/keyspilli-song
```

The skill validator requires an already available PyYAML runtime; if absent, inspect its two frontmatter fields and all local reference links without installing dependencies. The older `plugin-creator/scripts/validate_plugin.py` command is not shipped in this environment. Validate `.codex-plugin/plugin.json` as JSON with the required name/version/skills paths and verify those paths exist, then verify installed snapshot bytes against the canonical source. Synthetic demo/control assets are software integration evidence only; keep `controls/evaluator-only/answer-key.json` outside reviewer context. Listening stays unqualified triage and does not grant song approval.

The tracked `plugins/keyspilli` tree in Keyspilli is the release source for this candidate. Canonical and installed copies retain their previous versions until explicit adoption. Build with `scripts/package-keyspilli-plugin.py`; the sorted source inventory pins every source member.
