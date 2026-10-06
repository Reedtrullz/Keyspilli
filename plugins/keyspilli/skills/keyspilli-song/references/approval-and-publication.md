# Approve and add to Keyspilli

The normal user flow is: playable previews → one approval → verified live player link. The agent handles the technical work. This is a chat follow-up workflow using existing tools, not an installed server endpoint or automatic background uploader.

## Offer approval for concrete music

Offer the action by default only when both modes are `ready` under the musical quality gate. Finish preparation and local import verification, verify both audio files against the delivery manifest, and retain any material limitations. A provisional candidate can be played in chat, but do not ask Reidar to supply the missing agent review or present a default publication action. If Reidar explicitly authorizes publishing a named provisional version, preserve that status and follow the authorized scope. Compute SHA256 of `manifest.json` and `bundle.json`; the former pins the delivered previews and the latter pins the installable music. Resolve the selected private Keyspilli target from project context; if multiple targets genuinely conflict, settle that identity before mutation.

In Codex, emit this as a real Markdown list item, not inside a code block. Substitute the actual song, absolute path and hashes, escaping any double quotes inside the prompt:

```markdown
- :codex-followup[Approve and add to Keyspilli]{prompt="I approve the previewed Original and Chords for ARTIST — TITLE and authorize publishing those exact versions to my existing private Keyspilli catalog. Use DELIVERY_PATH, manifest SHA256 MANIFEST_HASH, bundle SHA256 BUNDLE_HASH. Verify the files still match, preserve unrelated songs, verify both modes on the live target, and give me the live player link. Follow the Keyspilli approval-and-publication workflow. Do not ask me to approve the same publication again."}
```

The action sends a user request when clicked; simply displaying it grants no authorization. Offer one action per song, or an explicitly scoped batch action naming a frozen manifest. On surfaces without follow-up actions, say “Reply ‘publish it’ to add these versions to Keyspilli.” Resolve a short reply against the immediately preceding identified delivery. Do not display a fictional upload URL or imply the local import command updates production.

## Preserve the owner's decision

Record the actual user statement, song/base ID, approved modes and immutable manifest/bundle/preview hashes in a run-local `owner-feedback.json` or `publication-receipt.json` outside the frozen delivery. Distinguish positive listening feedback, publication authorization and verified live publication. User approval is real owner feedback, not independent pianist certification; keep technical findings intact. Do not invent complete listening coverage or relabel model judgments as human decisions.

On publication approval, verify all pinned package files before mutation. If the audio or musical assets have changed, restore the approved bytes when available. Materially revised music needs its own surfaced previews and approval. Metadata-only operational changes do not require another listening session.

## Carry publication through

1. Inspect the actual target version, catalog, supported import path and existing song identity. Reuse authorized browser/session, process-environment or host-managed access without reading `.env` or credential files. Same-title songs are not automatically safe to replace. Identical installed content is an idempotent success; preserve differing existing versions unless replacement was authorized.
2. Validate target compatibility in staging and prepare a bounded backup/rollback for the affected song and map. Use the existing catalog publisher/reconciliation and Chords map mechanisms. Preserve unrelated rows, files and map entries; never replace the live catalog with an empty one-song installation.
3. Publish Original and the prepared backing as **one song with two modes**, preserving the approved music and source mapping. The current `song-bundle.mts install` is isolated/offline only. Raw `/api/uploads` re-ingests symbolic bytes and does not attach the prepared backing; separately uploading `chords.mid` is not this workflow. Inspect the current implementation rather than assuming either route gained live-bundle support.
4. Resolve routine import/compatibility work within the authorized song-publication scope. If a separate application merge/deployment or replacement of unrelated content is necessary, finish and verify a concrete proposal before asking for that additional authorization; explain the exact dependency. Never turn missing live-import support into false success, a request for more listening, or an unexplained terminal assignment to the user.
5. Read back the actual live song ID and both modes through the catalog loader/Player. Compare Original notes/clock and realized Chords events with the frozen approved package; verify selected harmony/source identity and full extent. Check the reachable player URL and mode selection. A 200 response or local import alone is insufficient. Preserve failure evidence and restore affected content when needed using the prepared rollback.

Finish with **Added to Keyspilli** and a clickable verified player link only after live verification. Record target/version, base ID, hashes, checks and result in the publication receipt and Obsidian. If blocked, identify the concrete blocker and retain the approval for these unchanged assets; do not ask the user to repeat it on retry.
