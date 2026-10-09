# Anti Gemini Account Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Native parent execution; no subagents.

**Goal:** Make a selected eligible Google account enforceable for a bounded Gemini study, with truthful dry-run/refusal and no silent rotation.

**Architecture:** Add optional gateway-issued instance-scoped opaque binding to reusable native Gemini transport. The helper forwards binding only to its authenticated local gateway; request leases remain managed by the existing account-state owner. No Keyspilli/DSP dependency or provider-hearing claim enters Anti.

**Tech Stack:** Existing Python3.10+ package, FastAPI, account-state/store locks, pytest isolation harness, bundled Anti helper/schema copies.

**Spec:** [Qualification design](../specs/2026-10-06-music-evidence-qualification-design.md). Parent: [End-to-end plan](2026-10-06-music-evidence-next-phase-to-github.md).

## Global Constraints

- Compact review: one clip/claim,2048tokens default/4096maximum,90seconds,oneattempt.
- Bound mode does not refresh credentials, mutate preferred account, rotate, retry, fall back or dispatch BYOK.
- Twelve proposed serial jobs are an upper bound. Malformed/stale evidence refuses before upload/generation.
- No secrets/emails in logs/public artifacts. Instance-scoped bindings stay private and are never sent upstream.
- Ordinary unbound routes remain compatible; local observations never claim account-wide concurrency enforcement.

## Review Focus

1. Gateway restart/account reorder: stale binding refuses, never selects a different account (A1).
2. Expiring/disabled/cooled account or active lease: refuse before generation, no refresh (A1/A2).
3. Disconnect/deadline during acquisition: release a late lease exactly once (A2).
4. Bound request to BYOK/Claude/unsupported Gemini: reject without upstream call (A2).
5. Correct HTTP but truncated/contradictory advisory: partial/failed, no retry or hearing claim (A3).

## Paths

All implementation files below are relative to `A=/Users/reidar/Projectos/.worktrees/anti-music-review-afk`. Start an isolated successor branch from `1ac54cc15cb80c3d13ce80f2815052d2c26025b6`, preserve existing PR170 and primary WIP. Commands use A/.venv/bin/python. New tests are proposed additions.

## A1 — Read-only binding and exact leased acquisition

**Files:** modify `codex_antigravity_auth/accounts.py`, `account_state.py`, `account_diagnostics.py`; create `codex_antigravity_auth/account_binding.py`, `tests/test_account_binding.py`; extend `tests/test_account_state.py`, `test_accounts.py`, `test_account_explain.py`.

**Interfaces:** `AccountBinding` is `{schemaVersion:1,gatewayInstance:str,accountRef:str,inventorySha256:str}`. `binding_inventory(model: str) -> dict` returns redacted current references, model-family eligibility and token state, without refresh/preference writes. `acquire_bound_account(model: str, binding: AccountBinding) -> dict` rechecks the serving instance/inventory and all eligibility under the existing store/owner lock, acquires exactly that account without calling automatic selection, and refuses an observed in-flight account. Token must remain valid>=300seconds. Use process_logs.account_ref inside the gateway process, not account-2 indices or helper-process refs. Retain existing lease-release interface.

- [ ] Write tests `test_restart_and_inventory_reorder_refuse`, `test_missing_duplicate_or_stale_reference_refuses`, `test_expiring_disabled_cooled_or_busy_account_refuses_without_refresh`, `test_bound_acquisition_preserves_preferences`, `test_same_owner_lock_prevents_two_bound_leases`. Assert zero generation/refresh calls and unchanged store on read-only inventory; acquisition/release may change only lease bookkeeping.
- [ ] Run `.venv/bin/python scripts/run_tests.py tests/test_account_binding.py tests/test_account_state.py tests/test_accounts.py tests/test_account_explain.py -q`; expect RED for missing APIs.
- [ ] Implement binding validation on current account state. Preserve credential redaction and existing cooldown semantics; never persist raw binding credentials or a parallel account store. Do not imply process-local leases observe another host/process.
- [ ] Repeat targeted suite GREEN and commit `feat: acquire exact Gemini account from private gateway binding`.

## A2 — Gateway boundary and cancellation correctness

**Files:** modify `codex_antigravity_auth/server.py`; create `tests/test_server_account_binding.py`; extend `tests/test_wav_audio.py`, `test_server_streaming.py` and existing deadline/disconnect suites found from server imports.

**Interfaces:** add authenticated read-only `GET /v1/account-bindings?model=...` for supported native Gemini only. Add optional `X-Anti-Account-Binding` header containing bounded serialized AccountBinding (maximum2048bytes), parsed by `parse_account_binding_header(value: str) -> AccountBinding` before account acquisition. Honor existing host/origin/auth boundary. Do not add binding fields to Gemini payloads. Bound requests skip schedule_refresh_accounts_ahead and select acquire_bound_account; normal requests retain current behavior.

- [ ] Add tests for endpoint auth/host/origin refusal, oversized/malformed binding, native Gemini success, unsupported modality/Claude/BYOK refusal, zero fallback after429/5xx/transport error and unchanged ordinary account rotation. Assert exact selected account in mocked transport while output stays redacted.
- [ ] Run `.venv/bin/python scripts/run_tests.py tests/test_server_account_binding.py tests/test_wav_audio.py tests/test_server_streaming.py -q`; expect RED. Implement bounded parse/route check, exact acquisition and terminal logging.
- [ ] Add deadline/disconnect tests that force a late acquisition result and assert release exactly once, no leaked lease, no generation after cancellation; repeat targeted tests GREEN. Verify bound requests do not schedule global background refresh. Commit `feat: enforce request-scoped Gemini binding without fallback`.

## A3 — Helper, installed compatibility and portable import

**Files:** modify `codex_antigravity_auth/skills/anti/scripts/anti.py`, `codex_antigravity_auth/skill_assets.json` if its declared inventory changes, and required packaged skill/schema assets checked by `scripts/check_artifacts.py`; extend `tests/test_gemini_music_review.py`, `test_anti_run_control.py`, `test_anti_spend_controls.py`. Installed user/agent skill copies remain untouched until selected adoption. In K modify `apps/web/src/lib/music-review-jobs.ts`, `.test.ts`, `apps/web/scripts/prepare-music-review-jobs.mts` and Anti bridge tests.

**Interfaces:** helper optional `--account-binding-json PRIVATE.json` requires a selected advertised native Gemini model. Dry-run validates local file and prints redacted intended binding, but never claims live acquisition. A separate explicit eligibility read obtains serving gateway inventory. request_json forwards the bounded header only to the local configured gateway. CompactReviewConfiguration adds private binding identity/gatewayInstance to its configuration fingerprint; import checks helper/schema/configuration/binding and one-attempt receipt match. Binding content never enters portable provider evidence or public release JSON.

- [ ] Write helper tests for malformed/stale local file, changed gateway instance, unsupported route, no binding forwarded upstream, dry-run zero generation, header forwarding, one-attempt truncated/error response and secret-free diagnostics. Add K job tests for binding drift and unsupported result certainty.
- [ ] Run `.venv/bin/python scripts/run_tests.py tests/test_gemini_music_review.py tests/test_anti_run_control.py tests/test_anti_spend_controls.py -q` and K `npm exec -w @keyspilli/web -- vitest run src/lib/music-review-jobs.test.ts src/lib/anti-music-evidence.test.ts`; expect RED for new contract.
- [ ] Implement optional binding, sync all packaged copies using the repository's artifact inventory, keep normal review unchanged and standalone. Run targeted tests GREEN, `scripts/check_artifacts.py`, full `scripts/run_tests.py -q`, and `scripts/check_installed.py` on exact newly built wheel and rebuilt sdist in bounded clean environments. Commit both repos' narrow integration changes separately.
- [ ] Prepare a new pinned study packet from unchanged measured evidence:8valid packets plus contradictory/silence/unknown-source/malformed controls, serialone, at most12generation attempts/uploads,2048tokens default,90seconds,oneattempt. Dry-run every job; local malformed/stale refusals count as zero uploads. Freeze rubric: consistency with supplied values, appropriate uncertainty, no independent hearing or source authority inference, strict response bounds.
- [ ] Leave upload/account selection for the final owner packet. If approved, re-read advertisement/capability, instance binding/eligibility and observable in-flight usage; dispatch only the reviewed bytes. Stop affected study on first provider/transport/schema failure; preserve failed results. Import/summarize advisory results separately from acoustic and musical gates. Successful interpretation does not certify m04/m05 independent hearing.

## Exit

Exact-bound reusable Gemini behavior, unbound regressions, packaged-copy parity and prepared offline jobs are independently shippable experimental software. Live interpretation is optional and needs its explicit final upload choice. Keyspilli and additional music accounts are never installation prerequisites.
