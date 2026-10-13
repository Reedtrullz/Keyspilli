import argparse
import fcntl
import importlib.util
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Mapping
from pathlib import Path


def load_core():
    spec = importlib.util.spec_from_file_location("workflow_core", Path(__file__).with_name("evaluate-keyspilli-workflow.py"))
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CORE = load_core()
LEVELS = ("a", "m", "e", "ve", "b", "vb")
PARAMS = {"read_reference": {"path": {"type": "string"}}, "checkout_preflight": {},
          "prepare_song": {"previews": {"type": "boolean"}, "level": {"type": "string", "enum": list(LEVELS)}},
          "deliver_song": {"level": {"type": "string", "enum": list(LEVELS)}}, "verify_delivery": {}, "pin_request": {}}
TOOLS = [{"type": "function", "function": {"name": name, "description": description,
    "parameters": {"type": "object", "properties": PARAMS[name], "additionalProperties": False}}}
    for name, description in {"read_reference": "Read a packaged reference relative to the skill directory.",
        "checkout_preflight": "Run the packaged checkout checker, read only.",
        "prepare_song": "Run the existing preparation on this task's fixed supplied input. Optional previews default false.",
        "deliver_song": "Deliver the task's existing prepared run with both previews. Never prepares again.",
        "verify_delivery": "Read-only verify this task's delivery and return both preview/export paths.",
        "pin_request": "Run the packaged request-pinning helper on this task's fixed source/instruction."}.items()]


def validate_tool(name: str, args: dict[str, object]) -> None:
    if name not in PARAMS or not isinstance(args, dict) or set(args) - set(PARAMS[name]):
        raise ValueError("tool or argument not permitted")
    if "level" in args and args["level"] not in LEVELS:
        raise ValueError("unknown Original tier")
    if "previews" in args and type(args["previews"]) is not bool:
        raise ValueError("previews must be boolean")
    if name == "read_reference":
        path = args.get("path")
        if not isinstance(path, str) or path.startswith("/") or ".." in Path(path).parts or not path.endswith(".md"):
            raise ValueError("only packaged Markdown references are readable")


def encode_request(body: Mapping[str, object]) -> tuple[bytes, int]:
    wire = json.dumps(body, ensure_ascii=True).encode()
    if len(wire) > 131072:
        raise ValueError("request exceeds the fixed 128 KiB history bound")
    return wire, len(wire) * 4 + 4096


def remaining_seconds(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("session deadline exhausted")
    return remaining


def qualifies(task: str, final: dict[str, object], traces: list[dict[str, object]]) -> bool:
    if task in CORE.POSITIVE_TASKS:
        return final.get("status") == "complete-provisional" and any(t.get("tool") == "verify_delivery"
            and t.get("exitCode") == 0 and t.get("deliveryStatus") == "complete-provisional"
            and final.get("playbackIndex") == t.get("playbackIndex") and isinstance(t.get("playbackIndex"), str)
            and (task != "requested-tier" or t.get("originalLevel") == "e") for t in traces)
    if final.get("status") != "refused-or-incomplete":
        return False
    if task == "unqualified-url":
        return not any(t.get("tool") in ("prepare_song", "deliver_song") for t in traces)
    if task in ("stale-phrase-pin", "unsupported-score"):
        marker = "source hash mismatch" if task == "stale-phrase-pin" else "unsupported"
        return any(t.get("tool") == "prepare_song" and t.get("exitCode") == 1 and marker in str(t.get("diagnostic", "")).lower() for t in traces)
    return any(t.get("tool") in ("prepare_song", "deliver_song") and t.get("exitCode") == 1
        and t.get("previewAttempted") is True and t.get("deliveryStatus") == "incomplete" for t in traces)


def append_receipt(journal: Path, row: dict[str, object]) -> None:
    with journal.open("a") as handle:
        handle.write(json.dumps(row, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def run_command(command: list[str], cwd: Path, deadline: float, log: Path) -> dict[str, object]:
    started = time.monotonic()
    with log.open("xb") as output:
        process = subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL, stdout=output,
            stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=remaining_seconds(deadline))
        except (subprocess.TimeoutExpired, TimeoutError):
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)
            raise TimeoutError("tool deadline expired; owned command group terminated")
    return {"command": command, "exitCode": code, "cpuAndRenderWallSeconds": time.monotonic() - started,
            "log": str(log), "diagnostic": log.read_text(errors="replace")[-12000:]}


def execute_tool(name: str, args: dict[str, object], fixture: dict[str, str], cell: Path,
                 checkout: Path, plugin: Path, deadline: float, sequence: int) -> dict[str, object]:
    validate_tool(name, args)
    remaining_seconds(deadline)
    skill = plugin / "skills/keyspilli-song"
    if name == "read_reference":
        path = skill / str(args["path"])
        if not path.resolve().is_relative_to(skill.resolve()) or path.is_symlink() or not path.is_file():
            raise ValueError("reference not in the exact frozen skill")
        return {"tool": name, "text": path.read_text()[:24000], "sha256": CORE.digest(path)}
    prepared, delivered = cell / "run", cell / "delivery"
    node = fixture["node"]
    level = str(args.get("level", "a"))
    base = [node, "--import", "tsx"]
    render = ["--soundfont", fixture["soundfont"], "--executable", fixture["renderer"], "--level", level]
    if name == "checkout_preflight":
        command = [sys.executable, "-B", str(skill / "scripts/check_checkout.py"), str(checkout)]
    elif name == "pin_request":
        if not fixture.get("source"):
            raise ValueError("no qualified local source to pin")
        command = [sys.executable, "-B", str(skill / "scripts/pin_preparation_request.py"), "--source", fixture["source"],
            "--instruction", fixture["instruction"], "--output", str(cell / "request.json")]
    elif name == "prepare_song":
        if fixture.get("prepared"):
            raise ValueError("this task forbids rerunning preparation")
        if not fixture.get("source"):
            raise ValueError("task has no qualified local source")
        command = base + ["apps/web/scripts/prepare-song.mts", fixture["source"], str(prepared), "Workflow fixture", "Exposed software control"]
        if fixture.get("phrasePlan"):
            command += ["--phrase-plan", fixture["phrasePlan"]]
        if args.get("previews"):
            command += ["--previews"] + render
            delivered = prepared / "delivery"
    elif name == "deliver_song":
        command = base + ["apps/web/scripts/deliver-song.mts", fixture.get("prepared", str(prepared)), str(delivered)] + render
    else:
        if (prepared / "delivery").is_dir() and not delivered.exists():
            delivered = prepared / "delivery"
        command = base + ["apps/web/scripts/deliver-song.mts", "verify", str(delivered)]
    result = {"tool": name, **run_command(command, checkout, deadline, cell / f"tool-{sequence}.log")}
    result["previewAttempted"] = name == "deliver_song" or (name == "prepare_song" and args.get("previews") is True)
    manifest = delivered / "manifest.json"
    if manifest.is_file():
        receipt = json.loads(manifest.read_text())
        result["deliveryStatus"] = receipt.get("status")
        result["modes"] = receipt.get("modes")
        result["originalLevel"] = receipt.get("originalLevel")
        result["playbackIndex"] = str(delivered / "index.html")
        result["deliveryDirectory"] = str(delivered)
    return result


def evaluate_cell(cell: dict[str, object], fixture: dict[str, str], experiment: dict[str, object], root: Path,
                  budget, journal: Path) -> dict[str, object]:
    directory = root / str(cell["id"])
    directory.mkdir()
    model, task = str(cell["model"]), str(cell["task"])
    snapshots = experiment["skillSnapshots"]
    if not isinstance(snapshots, dict) or not isinstance(snapshots.get(str(cell["skill"])), dict):
        raise ValueError("invalid frozen skill snapshots")
    plugin_path = snapshots[str(cell["skill"])].get("path")
    checkout_path = experiment["checkout"]
    if not isinstance(plugin_path, str) or not isinstance(checkout_path, str):
        raise ValueError("frozen paths must be strings")
    plugin = Path(plugin_path)
    skill = plugin / "skills/keyspilli-song/SKILL.md"
    messages = [{"role": "system", "content": "Execute the supplied Keyspilli task through the restricted tools. "
        "Never invent a command result, musical approval, source, or complete delivery. Finish with a JSON object: "
        "{status: complete-provisional or refused-or-incomplete, explanation: string, playbackIndex: string or null}. "
        "No production, release, installation, acquisition, paid service, or arbitrary file/shell access is authorized.\n" + skill.read_text()},
        {"role": "user", "content": CORE.TASKS[task] + "\n" + fixture["description"] +
         "\nThis task's source, destinations, bank and renderer are fixed by tools. Tools expose the maintained command logs. "
         "Use returned paths to surface both modes or the verified playback index."}]
    deadline = time.monotonic() + 900
    traces: list[dict[str, object]] = []
    final: dict[str, object] = {}
    attempts = 0
    error = None
    started = time.monotonic()
    try:
        for turn in range(8):
            body: dict[str, object] = {"model": model, "messages": messages, "tools": TOOLS, "max_tokens": 2048, "stream": False}
            if model == "gpt-6-luna":
                body["reasoning_effort"] = "low"
            wire, bound = encode_request(body)
            reservation = budget.reserve(model, bound, 2048)
            append_receipt(journal, {"kind": "admitted", "cell": cell["id"], "call": attempts + 1, "model": model,
                "inputTokensBound": bound, "outputTokensBound": 2048, "reservedUsd": reservation.cost})
            attempts += 1
            request = urllib.request.Request("http://127.0.0.1:10100/v1/chat/completions", data=wire,
                headers={"Content-Type": "application/json"}, method="POST")
            usage = None
            try:
                with urllib.request.urlopen(request, timeout=min(180, remaining_seconds(deadline))) as response:
                    raw = response.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError("response exceeds 2 MiB")
                (directory / f"response-{turn + 1}.json").write_bytes(raw)
                data = json.loads(raw)
                usage = data.get("usage") if isinstance(data.get("usage"), dict) else None
            finally:
                before = budget.spent
                try:
                    budget.settle(reservation, usage, model)
                finally:
                    append_receipt(journal, {"kind": "settled", "cell": cell["id"], "call": attempts,
                        "deltaUsd": budget.spent - before, "usage": usage, "stopped": budget.stopped})
            message = data["choices"][0]["message"]
            messages.append(message)
            calls = message.get("tool_calls") or []
            if not calls:
                content = message.get("content") or ""
                final = json.loads(content.removeprefix("```json").removesuffix("```").strip())
                if not isinstance(final, dict):
                    raise ValueError("final result must be an object")
                break
            for call in calls:
                if len(traces) >= 24:
                    raise ValueError("tool attempt cap exceeded")
                name = call["function"]["name"]
                args = json.loads(call["function"]["arguments"])
                trace: dict[str, object]
                try:
                    trace = execute_tool(name, args, fixture, directory, Path(checkout_path), plugin, deadline, len(traces) + 1)
                except (ValueError, FileExistsError, FileNotFoundError) as tool_error:
                    trace = {"tool": name, "error": str(tool_error), "rejected": True}
                traces.append(trace)
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(trace)})
            if model.startswith("B.AI/"):
                time.sleep(min(4, remaining_seconds(deadline)))
    except (ValueError, KeyError, TimeoutError, OSError, urllib.error.URLError) as failure:
        error = str(failure)
    result = {**cell, "attempted_calls": attempts, "status": final.get("status", "failed"), "verified": qualifies(task, final, traces),
        "modelFinal": final, "error": error, "traces": traces, "elapsedSeconds": time.monotonic() - started,
        "accountedUsdAfterCell": budget.spent, "unknownUsageCallsAfterCell": budget.unknown_usage_calls}
    (directory / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Execute the explicitly authorized bounded OCX API skill comparison; no native-session claim.")
    parser.add_argument("--experiment", required=True, type=Path)
    parser.add_argument("--fixtures", required=True, type=Path)
    parser.add_argument("--results", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=96)
    args = parser.parse_args()
    if not 1 <= args.limit <= 96:
        raise ValueError("limit must be within the frozen 96-cell matrix")
    experiment = json.loads(args.experiment.read_text())
    checkout = Path(experiment["checkout"])
    head = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    if head != experiment["applicationHead"] or subprocess.check_output(["git", "-C", str(checkout), "status", "--porcelain", "--untracked-files=no"]):
        raise ValueError("application revision changed after freeze")
    for snapshot in experiment["skillSnapshots"].values():
        source = Path(snapshot["path"])
        if CORE.digest(source / "source-members.json") != snapshot["inventorySha256"]:
            raise ValueError("snapshot inventory changed after freeze")
        spec = importlib.util.spec_from_file_location("packager", checkout / "scripts/package-keyspilli-plugin.py")
        assert spec is not None and spec.loader is not None
        packager = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(packager)
        packager.collect_members(source)
    args.results.mkdir(exist_ok=True)
    config = {"experimentSha256": CORE.digest(args.experiment), "fixturesSha256": CORE.digest(args.fixtures), "api": "http://127.0.0.1:10100/v1/chat/completions",
              "scope": "authorized API harness; native routed adoption unqualified", "settings": {"Luna": "low", "MiMo": "provider advertised non-reasoning", "maxTokens": 2048}}
    config_path = args.results / "configuration.json"
    if config_path.exists():
        if json.loads(config_path.read_text()) != config:
            raise ValueError("cannot resume a changed experiment or fixture configuration")
    else:
        with config_path.open("x") as handle:
            json.dump(config, handle, indent=2)
    with (args.results / "exclusive.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        journal = args.results / "admissions.jsonl"
        budget = CORE.Budget(5)
        if journal.exists():
            for line in journal.read_text().splitlines():
                receipt = json.loads(line)
                budget.spent += receipt.get("reservedUsd", 0) + receipt.get("deltaUsd", 0)
                budget.stopped |= receipt.get("stopped", False)
        fixtures = json.loads(args.fixtures.read_text())
        rows = []
        for cell in experiment["cells"][:args.limit]:
            directory = args.results / cell["id"]
            if directory.exists():
                result = directory / "result.json"
                rows.append(json.loads(result.read_text()) if result.is_file() else {**cell, "status": "interrupted", "verified": False, "attempted_calls": 1})
                continue
            if budget.stopped or budget.spent >= budget.cap:
                rows.append({**cell, "status": "budget-stopped", "verified": False, "attempted_calls": 0})
                continue
            row = evaluate_cell(cell, fixtures[cell["task"]], experiment, args.results, budget, journal)
            rows.append(row)
            print(json.dumps({"cell": row["id"], "status": row["status"], "verified": row["verified"], "accountedUsd": budget.spent}), flush=True)
        summary = {"summary": CORE.summarize(rows), "accountedUsd": budget.spent, "hardCapUsd": 5,
                   "billing": "conservative token reference accounting, not provider fee receipt", "rows": rows}
        destination = args.results / f"summary-{args.limit}.json"
        with destination.open("x") as handle:
            json.dump(summary, handle, indent=2)
        print(json.dumps({"summary": summary["summary"], "accountedUsd": budget.spent}), flush=True)


if __name__ == "__main__":
    main()
