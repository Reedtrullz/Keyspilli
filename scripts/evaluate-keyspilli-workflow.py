import argparse
import hashlib
import json
import math
import subprocess
from pathlib import Path
from typing import NamedTuple


TASKS = {
    "simple-midi": "Complete both modes from the supplied qualified MIDI.",
    "supported-xml": "Complete both modes from the supplied supported MusicXML.",
    "supported-mxl": "Complete both modes from the supplied compressed MXL.",
    "existing-preparation": "Deliver the retained preparation without preparing or acquiring again.",
    "requested-tier": "Deliver Original Easy and shared Advanced-derived Chords; retain all six Original exports.",
    "unavailable-reviewer": "Deliver both modes provisionally while the optional reviewer is unavailable.",
    "missing-renderer": "Return incomplete delivery with preserved preparation and inspectable evidence.",
    "truncated-preview": "Reject a successful renderer exit with truncated PCM; preserve preparation.",
    "silent-clipped-preview": "Reject silent or raw-clipped preview PCM; never claim complete delivery.",
    "stale-phrase-pin": "Refuse a working PhrasePlan with a stale source pin; do not alter genuine pins.",
    "unsupported-score": "Refuse unsupported MusicXML sounding-pitch semantics; preserve the source.",
    "unqualified-url": "Treat the song/URL as a lead and refuse musical completion without qualified local bytes.",
}
MODELS = ("gpt-6-luna", "B.AI/mimo-v2.6-flash")
RATES = {"gpt-6-luna": (0.0, 0.0), "B.AI/mimo-v2.6-flash": (.14, .28)}


def matrix() -> list[dict[str, str | int]]:
    return [{"id": f"{task}-{model.replace('/', '_')}-{skill}-{repetition}", "task": task,
             "model": model, "skill": skill, "repetition": repetition,
             "expected": "complete-provisional" if task in list(TASKS)[:6] else "refused-or-incomplete"}
            for repetition in (1, 2) for task in TASKS for model in MODELS for skill in ("old", "new")]


class Reservation(NamedTuple):
    id: int
    model: str
    cost: float


class Budget:
    def __init__(self, cap: float):
        if not math.isfinite(cap) or not 0 <= cap <= 5:
            raise ValueError("workflow budget must be finite and at most the approved $5")
        self.cap = cap
        self.spent = 0.0
        self.unknown_usage_calls = 0
        self.serial = 0
        self.pending: dict[int, Reservation] = {}

    def reserve(self, model: str, input_tokens_bound: int, output_tokens_bound: int) -> Reservation:
        if model not in RATES or any(type(v) is not int or v < 0 for v in (input_tokens_bound, output_tokens_bound)):
            raise ValueError("unknown model price or invalid token bound")
        incoming, outgoing = RATES[model]
        reserve = (input_tokens_bound * incoming + output_tokens_bound * outgoing) / 1e6
        if self.spent + reserve > self.cap:
            raise ValueError("workflow budget exhausted before request")
        self.spent += reserve
        self.serial += 1
        reservation = Reservation(self.serial, model, reserve)
        self.pending[reservation.id] = reservation
        return reservation

    def settle(self, reservation: Reservation, usage: dict[str, int] | None, model: str) -> None:
        if model != reservation.model or self.pending.get(reservation.id) != reservation:
            raise ValueError("budget reservation is not pending for this model")
        del self.pending[reservation.id]
        if usage is None:
            self.unknown_usage_calls += 1
            return
        incoming, outgoing = RATES[model]
        tokens = [usage.get("prompt_tokens"), usage.get("completion_tokens")]
        if any(type(t) is not int or t < 0 for t in tokens):
            self.unknown_usage_calls += 1
            return
        cost = (usage["prompt_tokens"] * incoming + usage["completion_tokens"] * outgoing) / 1e6
        self.spent += cost - reservation.cost
        if cost > reservation.cost + 1e-12 or self.spent > self.cap:
            raise ValueError("reported usage exceeded the admitted budget bound; stop calls")


def summarize(rows: list[dict[str, object]]) -> dict[str, int]:
    attempted = [r for r in rows if isinstance(calls := r.get("attempted_calls"), int) and not isinstance(calls, bool) and calls > 0]
    return {"matrixCells": len(rows), "executed": len(attempted),
            "notRunOrUnavailable": len(rows) - len(attempted),
            "verifiedDeliveries": sum(r.get("status") == "complete-provisional" and r.get("verified") is True for r in attempted),
            "verifiedRefusals": sum(r.get("status") == "refused-or-incomplete" and r.get("verified") is True for r in attempted)}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def freeze(checkout: Path, old: Path, new: Path, output: Path) -> tuple[dict[str, object], list[dict[str, object]]]:
    def git(*args: str) -> str:
        return subprocess.check_output(["git", "-C", str(checkout), *args], text=True).strip()
    if git("status", "--porcelain", "--untracked-files=no"):
        raise ValueError("freeze requires clean tracked application and plugin source")
    if output.exists() or output.is_symlink():
        raise FileExistsError("exclusive new experiment manifest required")
    snapshots = {}
    for label, source in (("old", old), ("new", new)):
        inventory = json.loads((source / "source-members.json").read_text())
        for name, expected in inventory["sha256"].items():
            path = source / name
            if path.is_symlink() or digest(path) != expected:
                raise ValueError(f"{label}: altered plugin snapshot {name}")
        snapshots[label] = {"path": str(source.resolve()), "skillSha256": digest(source / "skills/keyspilli-song/SKILL.md"),
                            "inventorySha256": digest(source / "source-members.json")}
    cells: list[dict[str, object]] = [{**c, "status": "not-run", "attempted_calls": 0, "verified": False} for c in matrix()]
    result: dict[str, object] = {"schemaVersion": 1, "kind": "keyspilli-workflow-evaluation", "benchmarkId": "keyspilli-next-update-v1",
        "applicationHead": git("rev-parse", "HEAD"), "applicationTree": git("rev-parse", "HEAD^{tree}"),
        "checkout": str(checkout.resolve()), "skillSnapshots": snapshots, "models": list(MODELS),
        "hardCurrencyCapUsd": 5, "sessionDeadlineSeconds": 900, "maximumModelCallsPerCell": 8,
        "maxOutputTokensPerCall": 2048, "toolAccess": ["read-packaged-reference", "checkout-preflight", "prepare-song", "deliver-song", "read-only-delivery-verify", "request-pinning"],
        "pricingBasis": {"B.AI/mimo-v2.6-flash": "B.AI standard USD reference rates dated 2026-10-14; no cache/discount credit; billed fees require billing records",
                         "gpt-6-luna": "Existing native Codex account allowance; no API price claim. Verify quota-backed route before dispatch."},
        "state": "frozen-not-executed", "tasks": TASKS,
        "cells": cells,
        "goNoGoPerNewSkillModel": {"validDeliveries": "at least 11/12", "correctNegativeOutcomes": "12/12", "unauthorizedWritesOrFalseCompleteClaims": 0},
        "scope": "Controlled software workflow; no independent musical/keyboard acceptance or installed adoption"}
    with output.open("x") as handle:
        handle.write(json.dumps(result, indent=2) + "\n")
    return result, cells


def main() -> None:
    parser = argparse.ArgumentParser(description="Freeze and account the finite Keyspilli skill comparison without provider calls.")
    parser.add_argument("--checkout", type=Path, required=True)
    parser.add_argument("--old-plugin", type=Path, required=True)
    parser.add_argument("--new-plugin", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result, cells = freeze(args.checkout, args.old_plugin, args.new_plugin, args.output)
    print(json.dumps({"applicationHead": result["applicationHead"], "summary": summarize(cells), "providerCalls": 0}))


if __name__ == "__main__":
    main()
