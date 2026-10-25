# Skeleton alternative versions implementation plan

> **For agentic workers:** Use inline execution, retaining this checklist as the task authority.

**Goal:** Show the approved studio Skeleton once in the library, with the three older Audiotree arrangements available as alternative versions.

**Architecture:** Keep every base ID, source identity, musical file and difficulty level. An explicit, validated `data/artifacts/.song-versions.json` relates existing bases and travels with the existing artifact backup/restore path. The catalog folds matching members into the designated primary before pagination; the player reuses its existing version selector at the current difficulty. Different performances start at beat zero on switching. No inferred title matching or rewriting of source URLs.

**Tech stack:** Existing TypeScript, SQLite read model, React and native HTML controls. No new dependency or schema migration.

**Spec:** This document's Goal and Architecture implement the owner's request to add the old Skeleton songs to the new one as alternative versions.

## Constraints and review focus

- Preserve all 24 physical rows, exact musical bytes and existing player URLs.
- Keep the studio recording as the primary regardless of the older versions' play counts.
- Search, favorites, filters, pagination and artist pages must not recreate duplicate song cards.
- Hidden/unavailable bases must not become visible through a relationship; invalid/duplicate/cyclic family configuration must fail validation.
- Retain the existing same-video Original/B/C selector when no explicit family is configured.
- Never carry an Audiotree playhead or loop into the studio clock.
- Use the existing release gates; do not widen their allowlists to ship this feature.

## Tasks

- [x] Inspect the deployed revision, grouping code, version selector and release contract; preserve primary WIP.
- [x] Added family/grouping/player tests, implemented explicit families and library/artist display, verified focused tests, both typechecks and the production build.
- [x] Prepared exact Skeleton configuration, all 24 musical-payload/file preservation receipts and an actual built preview; all three alternatives start playback and same-level switching starts at zero.
- [ ] In progress: integrate onto current main and qualify exact-head CI and immutable images. The owner's "yes" authorizes release and waives musical-listening and physical-keyboard reviews for this grouping change only; all technical gates remain required.
- [ ] Promote with deploy_only, atomically install the family metadata, verify the live library and all alternatives, and log production receipts in Obsidian.
