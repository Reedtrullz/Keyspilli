import argparse
from copy import deepcopy
import json
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Mapping
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.keyspilli_workflow_api_admission import Admission, BudgetPort, Cell, Experiment, Fixture, load_module
from scripts.keyspilli_workflow_api_tools import TOOLS, Trace, execute_tool, qualifies, remaining_seconds, validate_tool
from scripts.keyspilli_workflow_api_runtime import absolute_deadline, qualify_runtime
from scripts.keyspilli_workflow_chat_stream import ChatStreamFailure, parse_chat_stream

CORE = load_module("evaluate-keyspilli-workflow")


def request_configuration(model: str, messages: list[dict[str, object]]) -> dict[str, object]:
    if model not in ("gpt-6-luna", "B.AI/mimo-v2.6-flash"): raise ValueError("unapproved workflow model")
    body: dict[str, object] = {"model": "main/gpt-6-luna" if model == "gpt-6-luna" else model,
        "messages": messages, "tools": TOOLS, "max_tokens": 2048, "stream": True}
    if model == "gpt-6-luna": body["reasoning_effort"] = "low"
    return body


def encode_request(body: Mapping[str, object]) -> tuple[bytes, int]:
    wire = json.dumps(body, ensure_ascii=True).encode()
    if len(wire) > 131072:
        raise ValueError("request exceeds the fixed 128 KiB history bound")
    return wire, len(wire) * 4 + 4096


def model_request(model: str, body: dict[str, object], cell: Cell, directory: Path,
                  deadline: float, turn: int, budget: BudgetPort, admitted: Admission):
    with absolute_deadline(deadline):
        message = _model_request(model, body, cell, directory, deadline, turn, budget, admitted)
        admitted.record_success(model, directory / f"response-{turn + 1}.json")
        return message


def _model_request(model: str, body: dict[str, object], cell: Cell, directory: Path,
                   deadline: float, turn: int, budget: BudgetPort, admitted: Admission):
    admitted.recheck(cell["task"])
    budget.native_quota_verified = False
    executable = admitted.fixtures[cell["task"]].get("ocxExecutable")
    if not executable: raise ValueError("qualified OCX executable pin is required")
    runtime = qualify_runtime(model, executable)
    budget.native_quota_verified = runtime["nativeQuotaIncluded"]
    admitted.bind_runtime(runtime, cell["model"])
    wire, bound = encode_request(body)
    reservation = budget.reserve(model, bound, 2048)
    admitted.append({"kind": "admitted", "cell": cell["id"], "call": turn + 1, "model": model,
        "inputTokensBound": bound, "outputTokensBound": 2048, "reservedUsd": reservation.cost, "runtime": runtime})
    request = urllib.request.Request("http://127.0.0.1:10100/v1/chat/completions", data=wire,
        headers={"Content-Type": "application/json"}, method="POST")
    usage = None
    started = time.monotonic()
    try:
        timeout = min(180, remaining_seconds(deadline))
        admitted.append({"kind": "dispatched", "cell": cell["id"], "call": turn + 1, "model": model})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024: raise ValueError("response exceeds 2 MiB")
        (directory / f"response-{turn + 1}.json").write_bytes(raw)
        streamed = raw.lstrip().startswith((b"data:", b"event:", b":"))
        if streamed: (directory / f"response-{turn + 1}.sse").write_bytes(raw)
        data = parse_chat_stream(raw) if streamed else json.loads(raw)
        if streamed: (directory / f"response-{turn + 1}.json").write_text(json.dumps(data))
        if not isinstance(data, dict): raise ValueError("response envelope must be an object")
        reported_usage = data.get("usage")
        if isinstance(reported_usage, dict):
            incoming, outgoing = reported_usage.get("prompt_tokens"), reported_usage.get("completion_tokens")
            if isinstance(incoming, int) and not isinstance(incoming, bool) and incoming >= 0 and isinstance(outgoing, int) and not isinstance(outgoing, bool) and outgoing >= 0:
                usage = {"prompt_tokens": incoming, "completion_tokens": outgoing}
        reported = data.get("model")
        identities = (model, "main/gpt-6-luna") if model == "gpt-6-luna" else (model, "mimo-v2.6-flash")
        if reported not in identities:
            budget.stopped = True
            raise ValueError("response model does not match the admitted exact route")
        choices = data.get("choices")
        if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
            raise ValueError("response choices must contain one object")
        message = choices[0].get("message")
        if not isinstance(message, dict) or message.get("role") != "assistant":
            raise ValueError("response message must be an assistant object")
        if message.get("content") is not None and not isinstance(message["content"], str):
            raise ValueError("assistant content must be a string or null")
        calls = message.get("tool_calls")
        if calls is not None:
            if not isinstance(calls, list): raise ValueError("assistant tool_calls must be a list")
            for call in calls:
                if not isinstance(call, dict) or not isinstance(call.get("id"), str) or not isinstance(call.get("function"), dict):
                    raise ValueError("assistant tool call must identify one function")
                if not isinstance(call["function"].get("name"), str) or not isinstance(call["function"].get("arguments"), str):
                    raise ValueError("assistant function name and arguments must be strings")
        return message
    finally:
        before = budget.spent
        try:
            budget.settle(reservation, usage, model)
        finally:
            admitted.append({"kind": "settled", "cell": cell["id"], "call": turn + 1, "deltaUsd": budget.spent - before,
                "usage": usage, "stopped": budget.stopped, "modelWallSeconds": time.monotonic() - started})


def tool_turn(message, fixture: Fixture, cell: Cell, directory: Path, experiment: Experiment,
              deadline: float, traces: list[Trace], admitted: Admission) -> list[dict[str, object]]:
    replies: list[dict[str, object]] = []
    for call in message.get("tool_calls") or []:
        if len(traces) >= 24: raise ValueError("tool attempt cap exceeded")
        admitted.recheck(cell["task"])
        name = call["function"]["name"]
        args = json.loads(call["function"]["arguments"])
        plugin = Path(experiment["skillSnapshots"][cell["skill"]]["path"])
        try:
            trace = execute_tool(name, args, fixture, directory, Path(experiment["checkout"]), plugin, deadline, len(traces) + 1)
        except (ValueError, FileExistsError, FileNotFoundError) as error:
            trace: Trace = {"tool": name, "error": str(error), "rejected": True}
        admitted.recheck(cell["task"])
        traces.append(trace)
        replies.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(trace)})
    return replies


def evaluate_cell(cell: Cell, fixture: Fixture, root: Path, budget: BudgetPort, admitted: Admission) -> dict[str, object]:
    directory = root / cell["id"]
    directory.mkdir()
    experiment = admitted.experiment
    fixture = deepcopy(fixture)
    alternate = fixture.get("renderer2")
    if cell["repetition"] == 2 and alternate: fixture["renderer"] = alternate
    model, task = cell["model"], cell["task"]
    skill = Path(experiment["skillSnapshots"][cell["skill"]]["path"]) / "skills/keyspilli-song/SKILL.md"
    messages: list[dict[str, object]] = [{"role": "system", "content":
        "Execute this Keyspilli task through the restricted tools. Never invent source, approval, command success or complete delivery. "
        "Finish with JSON: status (complete-provisional or refused-or-incomplete), explanation (string), playbackIndex (string or null), "
        "musicalAcceptance (not-established), productionAdmission (false). No acquisition, production, release, installation or arbitrary shell/files.\n" + skill.read_text()},
        {"role": "user", "content": CORE.TASKS[task] + "\n" + fixture["description"] +
         "\nSources, destinations, metadata and renderers are fixed by tools. Use returned paths to surface both previews or the verified playback index."}]
    deadline, started = time.monotonic() + 900, time.monotonic()
    traces: list[Trace] = []
    final: dict[str, object] = {}
    attempts = 0
    error = None
    try:
        for turn in range(8):
            body = request_configuration(model, messages)
            attempts_before = admitted.admission_count(cell["id"])
            try:
                message = model_request(model, body, cell, directory, deadline, turn, budget, admitted)
            finally:
                attempts += admitted.admission_count(cell["id"]) - attempts_before
            messages.append(message)
            remaining_seconds(deadline)
            if not message.get("tool_calls"):
                content = (message.get("content") or "").strip()
                if content.startswith("```json"): content = content[7:]
                if content.endswith("```"): content = content[:-3]
                parsed = json.loads(content.strip())
                if not isinstance(parsed, dict): raise ValueError("final result must be an object")
                if parsed.get("musicalAcceptance") != "not-established" or parsed.get("productionAdmission") is not False:
                    raise ValueError("final result lacks the required provisional/production boundary")
                final = parsed
                break
            with absolute_deadline(deadline):
                messages.extend(tool_turn(message, fixture, cell, directory, experiment, deadline, traces, admitted))
            if model.startswith("B.AI/"): time.sleep(min(4, remaining_seconds(deadline)))
    except (ValueError, KeyError, TypeError, TimeoutError, OSError, urllib.error.URLError) as failure:
        error = str(failure)
        if isinstance(failure, urllib.error.HTTPError) and failure.code in (401, 403, 404, 429):
            admitted.block_route(model, str(failure))
        elif isinstance(failure, ChatStreamFailure) and failure.blocks_route:
            admitted.block_route(model, str(failure))
    result: dict[str, object] = {**cell, "attempted_calls": attempts, "status": final.get("status", "failed"),
        "verified": error is None and qualifies(task, final, traces), "modelFinal": final, "error": error, "traces": traces,
        "elapsedSeconds": time.monotonic() - started, "accountedUsdAfterCell": budget.spent, "unknownUsageCallsAfterCell": budget.unknown_usage_calls}
    (directory / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the authorized $5 OCX API comparison; no native-session adoption claim.")
    parser.add_argument("--experiment", required=True, type=Path)
    parser.add_argument("--fixtures", required=True, type=Path)
    parser.add_argument("--results", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=96)
    parser.add_argument("--retry-blocked-route", action="append", default=[], choices=["gpt-6-luna", "B.AI/mimo-v2.6-flash"],
        help="Explicit repaired-protocol trial in this invocation; preserves historical blocks and spending.")
    args = parser.parse_args()
    if not 1 <= args.limit <= 96: raise ValueError("limit must be within the frozen 96-cell matrix")
    with Admission(args.experiment, args.fixtures, args.results) as admitted:
        for model in args.retry_blocked_route: admitted.retry_route(model)
        budget: BudgetPort = CORE.Budget(5)
        budget.spent, budget.stopped, budget.unknown_usage_calls = admitted.accounted_usd, admitted.stopped, admitted.unknown_usage_calls
        rows: list[dict[str, object]] = []
        for cell in admitted.experiment["cells"][:args.limit]:
            admitted.recheck(cell["task"])
            directory = args.results / cell["id"]
            if directory.exists():
                result = directory / "result.json"
                rows.append(json.loads(result.read_text()) if result.is_file() else {**cell, "status": "interrupted", "verified": False, "attempted_calls": admitted.admission_count(cell["id"])})
            elif budget.stopped or budget.spent >= budget.cap or cell["model"] in admitted.blocked_routes:
                rows.append({**cell, "status": "budget-or-route-stopped", "verified": False, "attempted_calls": 0})
            else:
                row = evaluate_cell(cell, admitted.fixtures[cell["task"]], args.results, budget, admitted)
                rows.append(row)
                print(json.dumps({"cell": row["id"], "status": row["status"], "verified": row["verified"], "accountedUsd": budget.spent}), flush=True)
        summary = {"summary": CORE.summarize(rows), "accountedUsd": budget.spent, "hardCapUsd": 5, "accountingRoot": str(admitted.accounting_root),
            "billing": "conservative token reference accounting; native included entitlement; no provider fee receipt", "rows": rows}
        with (args.results / f"summary-{args.limit}.json").open("x") as handle: json.dump(summary, handle, indent=2)
        print(json.dumps({"summary": summary["summary"], "accountedUsd": budget.spent}), flush=True)


if __name__ == "__main__":
    main()
