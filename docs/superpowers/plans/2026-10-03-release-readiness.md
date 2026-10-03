# Issue-completion integration and release plan

> **For agentic workers:** Use superpowers:executing-plans for the checked steps below. A checked engineering candidate does not close an unmet acceptance gate.

**Goal:** Integrate the completed issue fixes into one reviewable candidate, retain the remaining acceptance work, and obtain separate owner approval before merging main.

**Architecture:** Preserve the focused PRs as review references. Reconcile their actual heads into the tested integration branch using normal merge commits, then propose one draft PR to main. Musical receipts and candidate publication retain their existing exact-output admission checks.

**Tech stack:** Node 22.22.3 / npm 10.9.8, Next.js/npm workspaces, Python ops fixtures, Chromium/WebKit, GitHub Actions and Ansible.

**Spec:** The 39 open issues as inspected on 3 October 2026, [roadmap ledger](2026-10-02-roadmap-implementation.md), and [ADR 0004](../../decisions/0004-release-gates.md).

## Constraints and review focus

- Preserve primary/donor WIP and the existing historical musical approvals.
- No main merge or application deployment is authorized by this plan. Main push triggers the release pipeline; merge approval therefore also needs to address its deployment behavior.
- Qualified musical review is unavailable. Do not invent receipts, equate AI/synthetic checks with independent keyboard evidence, or assign that gate to the beginner.
- Keep source, structural, musical and runtime evidence distinct. An engineering integration is not an approved musical release.
- Check current heads again before acting: stacked PR heads, main and workflow evidence can change.
- Public-seed image restore is separate from the private backup drill and from physical playback. A skipped step is not restore proof.

## Task 1: Reconcile the review branches

**Files:** All existing focused PR changes; this plan and the native accessibility receipt are the only new tracked documentation.

- [x] Inspect current main: `d9aff249900e053b4a9ee21cd40df6e1419541f3` is an ancestor of the tested integration.
- [x] Retain the tested source checkpoint `5c2c329b54b304762e15e481c892bb851d34e604`, tree `d7007bef743e43d459b636b735639e4dcbc4a97e`.
- [x] Create `codex/release-readiness` in the owned player-state-review worktree.
- [x] Merge #196 first; its history reconciles #195. Merge #197–#204 next in number order. #192 and #205–#207 were already ancestors. Verify each merge produces exactly the tested tree before proceeding.
- [x] Confirm all fourteen heads below are ancestors of reconciliation commit `60b455424ae553ede689fe5f8e4f89ed7f44aa8e`, with no file changes from the tested checkpoint.

| Focused PR | Scope | Retained head |
|---|---|---|
| [#192](https://github.com/Reedtrullz/Keyspilli/pull/192) | Roadmap foundation | `e2ec2082` |
| [#195](https://github.com/Reedtrullz/Keyspilli/pull/195) | Grand Piano preparation | `f3e5018f` |
| [#196](https://github.com/Reedtrullz/Keyspilli/pull/196) | Home navigation | `4c41cb83` |
| [#197](https://github.com/Reedtrullz/Keyspilli/pull/197) | Worker health/shutdown | `a5baec30` |
| [#198](https://github.com/Reedtrullz/Keyspilli/pull/198) | Owner-state export | `fcb22653` |
| [#199](https://github.com/Reedtrullz/Keyspilli/pull/199) | Library URL state | `d0054fc3` |
| [#200](https://github.com/Reedtrullz/Keyspilli/pull/200) | Saved passage identity | `714531ed` |
| [#201](https://github.com/Reedtrullz/Keyspilli/pull/201) | Committed sheet focus | `ea1d8cc4` |
| [#202](https://github.com/Reedtrullz/Keyspilli/pull/202) | Device timing protocol | `f6ff2a62` |
| [#203](https://github.com/Reedtrullz/Keyspilli/pull/203) | Deterministic rhythm fixture | `d62f8411` |
| [#204](https://github.com/Reedtrullz/Keyspilli/pull/204) | Dialog dismissal/focus | `2a8fe00b` |
| [#205](https://github.com/Reedtrullz/Keyspilli/pull/205) | Backup retention | `0a9957fa` |
| [#206](https://github.com/Reedtrullz/Keyspilli/pull/206) | Canonical musical receipts | `7f9412cc` |
| [#207](https://github.com/Reedtrullz/Keyspilli/pull/207) | Frozen harmony publication | `de492db6` |

Reconciliation used ordinary Git merges, not a claim that cherry-pick ancestry was already present. No source conflict required a resolution. The separate #195 run failed downstream rhythm/sheet cases; the combined integration includes their later fixes. Several focused heads have no standalone CI run. Do not present every focused PR as independently green.

## Task 2: Retain acceptance observations

- [x] Preserve the earlier native 200% zoom/keyboard receipt and its scope.
- [x] Record the owner-confirmed VoiceOver announcement and remaining full walkthrough gap in [the native receipt](../../accessibility-native-check-2026-10-03.md).
- [x] Prepare a cloned, loopback-only Nocturne Easy trial at 50% speed, with Fall Down and Display open. Leave existing browser storage intact.
- [x] Record the owner's **5 seconds** reading-window preference. Keep the initial product default at 3.2 seconds. This completes #185's preference trial, not a measured improvement in performance or musical acceptance.
- [x] Restore and verify VoiceOver off. This session did not change Chrome zoom; the prior reset remains owner-confirmed.

## Task 3: Verify the final candidate

- [x] Read back [CI 37117625918](https://github.com/Reedtrullz/Keyspilli/actions/runs/37117625918) for exact checkpoint `5c2c329b`: 2,480 unit tests / 274 files, 148 browser cases, types/build/catalog/private-edge/ops passed. Public-seed application-image restore was skipped in this dispatch run.
- [ ] Publish a draft integration PR against main, preserving all focused PR histories and linking this plan. Use references rather than automatic issue-closing directives for unfinished acceptance work.
- [ ] Require the new PR's current-head checks, including its actual public-seed web-image restore step, and current-head worker runtime smoke. Record exact SHAs/run IDs and any skipped steps separately.
- [ ] If source changes are needed, run the affected regression first, review the change, and repeat the relevant candidate checks. Documentation-only changes do not require another local full build.

## Task 4: Resolve or retain the five explicit issue gates

| Issue | Current evidence | Required next event |
|---|---|---|
| [#119](https://github.com/Reedtrullz/Keyspilli/issues/119) | Retention/current-cost item complete; canonical receipt tooling implemented; 12 complete-playback acceptance pins unset | Independently reviewed exact complete outputs; preserve historical owner approvals and do not auto-fill pins |
| [#157](https://github.com/Reedtrullz/Keyspilli/issues/157) | Automated four-view checks and native 200% workflow retained; owner heard one focused control | Retained nonvisual target → passage → practice/result → download walkthrough; current caption/command inspection remains incomplete |
| [#158](https://github.com/Reedtrullz/Keyspilli/issues/158) | Existing source selection remains intact; #154 frozen candidates now exist | A concrete need for a second admitted authored peer; the issue explicitly says to skip generalization until that need exists |
| [#171](https://github.com/Reedtrullz/Keyspilli/issues/171) | Version-bound fingering interface/prototype | Competent independent keyboard evidence at target tempo for two exact small arrangements |
| [#173](https://github.com/Reedtrullz/Keyspilli/issues/173) | Existing upstream research does not yet qualify the required case | Rights-cleared matching recording/score, independent regional timing truth and qualified held-out alignment; no duplicate bakeoff or source acquisition |

#185 now has its owner preference observation. In the 39-issue accounting, 34 have engineering/operational candidates or completed scoped observations; five retain explicit issue-level gates. This count is not 34 closed issues. Real-device, production and musical release evidence must still be read in their own scope.

No qualified musician is currently available. Keep #119's new approvals and #171's reviewed teaching material pending, with provisional material clearly marked. Do not contact, recruit or pay a reviewer without owner authorization. Existing owner listening feedback in [listening-review.md](../../listening-review.md) does not establish independent keyboard review of the new outputs.

## Task 5: Merge and release only after a concrete decision

- [ ] Present the final candidate, current-head checks, and unresolved gates to the owner. Ask for merge/deployment approval only after those results are reviewable. Do not state that every open issue is solved.
- [ ] After approval, refresh main and every candidate head. Reconcile/retest if main changed.
- [ ] Merge the approved integration PR using a merge commit, preserving ancestry. Avoid squash/rebase for this integration: the focused PR heads need to remain reachable from main.
- [ ] Reconcile the focused PR statuses against their exact retained heads; retain their review discussion and annotate any superseded PR instead of merging duplicate changes.
- [ ] Close only issues whose complete acceptance criteria are met. Keep the five gated issues open until their required evidence exists, or until the owner explicitly changes their scope.
- [ ] Observe the release workflow and verify live navigation, Grand Piano readiness, selected playback/export and rollback evidence before claiming deployment. Preserve production song data; no catalog rebuild or candidate replacement is implicit.

ADR 0004 still governs release promotion. This plan proposes no automatic exemption for missing musical evidence and no default change from the owner reading preference alone.
