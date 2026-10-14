import json
import math
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import TypedDict
from scripts.keyspilli_workflow_api_admission import Fixture, load_module, sha

CORE = load_module("evaluate-keyspilli-workflow")
LEVELS = ("a", "m", "e", "ve", "b", "vb")
PARAMS = {"read_reference": {"path": {"type": "string"}}, "checkout_preflight": {},
          "prepare_song": {"previews": {"type": "boolean"}, "level": {"type": "string", "enum": list(LEVELS)}},
          "deliver_song": {"level": {"type": "string", "enum": list(LEVELS)}}, "verify_delivery": {}, "pin_request": {}}
TOOLS = [{"type": "function", "function": {"name": name, "description": description,
    "parameters": {"type": "object", "properties": PARAMS[name], "additionalProperties": False}}}
    for name, description in {"read_reference": "Read a packaged Markdown reference relative to the skill directory.",
        "checkout_preflight": "Run the packaged checkout checker, read only.",
        "prepare_song": "Prepare this task's fixed source; previews default false. All flags and paths are restricted.",
        "deliver_song": "Deliver the fixed existing preparation with both previews; never prepares again.",
        "verify_delivery": "Read-only verify this task's delivery; return both mode/export paths and playback index.",
        "pin_request": "Pin the fixed local MIDI and instruction using the packaged helper; XML/MXL use ordinary preparation."}.items()]


class Trace(TypedDict, total=False):
    tool: str
    command: list[str]
    exitCode: int
    cpuAndRenderWallSeconds: float
    log: str
    diagnostic: str
    previewAttempted: bool
    deliveryStatus: str
    originalLevel: str
    modes: object
    playbackIndex: str
    deliveryDirectory: str
    requestPath: str
    requestSha256: str
    text: str
    sha256: str
    rejected: bool
    error: str


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


def remaining_seconds(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("session deadline exhausted")
    return remaining


def audio_failure(modes: object, task: str) -> bool:
    if not isinstance(modes, dict): return False
    for mode in modes.values():
        if not isinstance(mode, dict) or mode.get("status") != "blocked": continue
        render = mode.get("render")
        if task == "missing-renderer":
            if render is None and str(mode.get("error", "")).startswith("FluidSynth unavailable"): return True
            continue
        if not isinstance(render, dict) or not isinstance(render.get("wav"), dict): continue
        wav = render["wav"]
        if task == "silent-clipped-preview":
            if wav.get("rms") == 0 and wav.get("silenceRatio") == 1: return True
            if isinstance(wav.get("rawClippingCount"), int) and wav["rawClippingCount"] > 0: return True
        duration = render.get("duration")
        if task == "truncated-preview" and isinstance(duration, dict) and duration.get("status") == "fail":
            expected, actual, tolerance = (number(duration.get(k)) for k in ("expectedSeconds", "renderedSeconds", "toleranceSeconds"))
            rms = number(wav.get("rms"))
            if expected is not None and actual is not None and tolerance is not None and rms is not None and expected > actual + tolerance and rms > 0 and wav.get("rawClippingCount") == 0: return True
    return False


def number(value: object) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def qualifies(task: str, final: dict[str, object], traces: list[Trace]) -> bool:
    if task in CORE.POSITIVE_TASKS:
        return final.get("status") == "complete-provisional" and any(t.get("tool") == "verify_delivery"
            and t.get("exitCode") == 0 and t.get("deliveryStatus") == "complete-provisional"
            and final.get("playbackIndex") == t.get("playbackIndex") and isinstance(t.get("playbackIndex"), str)
            and (task != "requested-tier" or t.get("originalLevel") == "e") for t in traces)
    if final.get("status") != "refused-or-incomplete": return False
    if task == "unqualified-url": return not any(t.get("tool") in ("prepare_song", "deliver_song") for t in traces)
    if task in ("stale-phrase-pin", "unsupported-score"):
        marker = "prepare-song: phrase plan: source hash mismatch" if task == "stale-phrase-pin" else "prepare-song: parse failed: unsupported musicxml"
        return any(t.get("tool") == "prepare_song" and t.get("exitCode") == 1 and marker in t.get("diagnostic", "").lower() for t in traces)
    return any(t.get("tool") in ("prepare_song", "deliver_song") and t.get("exitCode") == 1
        and t.get("previewAttempted") is True and t.get("deliveryStatus") == "incomplete" and audio_failure(t.get("modes"), task) for t in traces)


def run_command(command: list[str], cwd: Path, deadline: float, log: Path) -> Trace:
    started = time.monotonic()
    with log.open("xb") as output:
        process = subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL, stdout=output,
            stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=remaining_seconds(deadline))
        except (subprocess.TimeoutExpired, TimeoutError):
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            process.wait(timeout=5)
            raise TimeoutError("tool deadline expired; owned command group terminated")
    return {"command": command, "exitCode": code, "cpuAndRenderWallSeconds": time.monotonic() - started,
            "log": str(log), "diagnostic": log.read_text(errors="replace")[-12000:]}


def execute_tool(name: str, args: dict[str, object], fixture: Fixture, cell: Path,
                 checkout: Path, plugin: Path, deadline: float, sequence: int) -> Trace:
    validate_tool(name, args)
    remaining_seconds(deadline)
    skill = plugin / "skills/keyspilli-song"
    if name == "read_reference":
        path = skill / str(args["path"])
        if not path.resolve().is_relative_to(skill.resolve()) or path.is_symlink() or not path.is_file():
            raise ValueError("reference not in the exact frozen skill")
        return {"tool": name, "text": path.read_text()[:24000], "sha256": sha(path)}
    prepared, delivered = cell / "run", cell / "delivery"
    base = [fixture["node"], "--import", "tsx"]
    level = str(args.get("level", "a"))
    render = ["--soundfont", fixture["soundfont"], "--executable", fixture["renderer"], "--level", level]
    if name == "checkout_preflight":
        command = [sys.executable, "-B", str(skill / "scripts/check_checkout.py"), str(checkout), "--node", fixture["node"]]
    elif name == "pin_request":
        if Path(fixture["source"]).suffix.lower() not in (".mid", ".midi"):
            raise ValueError("request-pinning supports local MIDI only; use ordinary XML/MXL preparation")
        command = [sys.executable, "-B", str(skill / "scripts/pin_preparation_request.py"), "--source", fixture["source"],
            "--instruction", fixture["instruction"], "--output", str(cell / "request.json"),
            "--title", fixture["title"], "--artist", fixture["artist"], "--expected-source-sha256", sha(Path(fixture["source"]))]
    elif name == "prepare_song":
        if fixture.get("prepared"): raise ValueError("this task forbids rerunning preparation")
        if not fixture.get("source"): raise ValueError("task has no qualified local source")
        command = base + ["apps/web/scripts/prepare-song.mts", fixture["source"], str(prepared), fixture["title"], fixture["artist"]]
        phrase_plan = fixture.get("phrasePlan")
        if phrase_plan: command += ["--phrase-plan", phrase_plan]
        if args.get("previews"):
            command += ["--previews"] + render
            delivered = prepared / "delivery"
    elif name == "deliver_song":
        command = base + ["apps/web/scripts/deliver-song.mts", fixture.get("prepared", str(prepared)), str(delivered)] + render
    else:
        if (prepared / "delivery").is_dir() and not delivered.exists(): delivered = prepared / "delivery"
        command = base + ["apps/web/scripts/deliver-song.mts", "verify", str(delivered)]
    result: Trace = {"tool": name, **run_command(command, checkout, deadline, cell / f"tool-{sequence}.log")}
    result["previewAttempted"] = name == "deliver_song" or (name == "prepare_song" and args.get("previews") is True)
    manifest = delivered / "manifest.json"
    if manifest.is_file():
        receipt = json.loads(manifest.read_text())
        result.update({"deliveryStatus": receipt.get("status"), "modes": receipt.get("modes"), "originalLevel": receipt.get("originalLevel"),
            "playbackIndex": str(delivered / "index.html"), "deliveryDirectory": str(delivered)})
    if name == "pin_request" and result.get("exitCode") == 0:
        request = cell / "request.json"
        result.update({"requestPath": str(request), "requestSha256": sha(request)})
    return result
