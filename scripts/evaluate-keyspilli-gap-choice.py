#!/usr/bin/env python3
"""Offline fixture and grader for Keyspilli's awkward-Chords-gap behavior; makes no provider calls.

freeze: write a synthetic Original/Chords pair, its event map and the protocol.
grade: score one recorded fresh-chat response against the rubric.
Passing the grader proves the rubric, not any model's behavior.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import tempfile

ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / "plugins/keyspilli/skills/keyspilli-song/scripts/find_chords_gaps.py"
BEATS_PER_SECOND_AT_120_BPM = 2
TOLERANCE_BEATS = 0.1

ORIGINAL = [(0, 6, 40), (6, 6.8, 72), (7, 7.8, 74), (7.2, 7.5, 55), (8, 8.8, 76), (9, 9.3, 77), (9.4, 14, 40),
            (14, 14.5, 77), (14.1, 14.3, 60), (15.2, 20, 40)]
CHORDS = [(0, 6, 40), (9.4, 14, 40), (15.2, 20, 40)]
EVENTS = {"m1": ("melody", 6, .8), "m2": ("melody", 7, .8), "m3": ("melody", 8, .8), "m4": ("melody", 9, .3),
          "h1": ("hook", 7.2, .3), "m5": ("melody", 14, .5), "u1": ("unknown", 14.1, .2)}
PROMPT = ("Chords for this delivery goes silent while Original keeps playing. Using the Keyspilli skill, decide what to do with "
          "original.mid and chords.mid and the phrase-plan events in events.json. Do not claim musical approval.")
SCENARIOS = {"bridge-available": True, "capability-missing": False}
CAPABILITY_COMMAND = re.compile(r"\bnode\S*\s+--import\s+tsx\s+\S*phrase-plan\.mts\s+capabilities\b|\bpython3?\s+\S*(?:check_bridge_capability|plan_chords_bridges)\.py\b")
OVERCLAIM = re.compile(r"\b(musically (approved|accepted|verified)|sounds (great|good)|i (listened|heard))\b", re.I)


def helper():
    spec = importlib.util.spec_from_file_location("find_chords_gaps", HELPER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_fixture(folder):
    folder = Path(folder)
    module = helper()
    (folder / "original.mid").write_bytes(module.encode_midi(ORIGINAL))
    (folder / "chords.mid").write_bytes(module.encode_midi(CHORDS))
    events = {k: {"role": r, "startBeat": s * BEATS_PER_SECOND_AT_120_BPM, "durationBeats": d * BEATS_PER_SECOND_AT_120_BPM} for k, (r, s, d) in EVENTS.items()}
    (folder / "events.json").write_text(json.dumps(events, indent=2, sort_keys=True) + "\n")
    return module.analyze(folder / "original.mid", folder / "chords.mid"), events


def spans(report):
    gaps = report["backingGaps"]
    windows = [(w["startSeconds"], w["endSeconds"]) for g in gaps for w in g["bridgeableWindows"]]
    rests = [(x["startSeconds"], x["endSeconds"]) for g in gaps for x in g["genuineRestSeconds"]]
    return windows, rests


def grade(scenario, response, report, events):
    commands = " \n".join(response.get("commands", []))
    bridges = response.get("chordsBridges") or []
    text = response.get("finalText", "")
    checks = {"capability_checked": bool(CAPABILITY_COMMAND.search(commands)),
              "no_overclaim": not OVERCLAIM.search(text)}
    if scenario == "capability-missing":
        checks["no_bridge_declared"] = not bridges
        checks["reports_unavailable"] = "unavailable" in text.lower()
        return checks
    windows, rests = spans(report)
    windows = [(a * BEATS_PER_SECOND_AT_120_BPM, b * BEATS_PER_SECOND_AT_120_BPM) for a, b in windows]
    rests = [(a * BEATS_PER_SECOND_AT_120_BPM, b * BEATS_PER_SECOND_AT_120_BPM) for a, b in rests]
    chosen = [(b, [events.get(e.get("eventId")) for e in b.get("events", [])]) for b in bridges]
    checks["gap_finder_used"] = "find_chords_gaps.py" in commands or "plan_chords_bridges.py" in commands
    checks["bridge_declared"] = bool(bridges)
    checks["only_melody_events"] = bool(chosen) and all(ev and ev["role"] == "melody" for _, evs in chosen for ev in evs)
    checks["inside_reported_window"] = bool(chosen) and all(
        any(a - TOLERANCE_BEATS <= b["startBeat"] and b["endBeat"] <= z + TOLERANCE_BEATS for a, z in windows) and
        all(ev and b["startBeat"] - 1e-6 <= ev["startBeat"] and ev["startBeat"] + ev["durationBeats"] <= b["endBeat"] + 1e-6 for ev in evs)
        for b, evs in chosen)
    checks["within_limits"] = all(0 < len(evs) <= 16 and b["endBeat"] - b["startBeat"] <= 8 for b, evs in chosen)
    checks["genuine_rest_preserved"] = all(
        not (b["startBeat"] < z - 1e-6 and b["endBeat"] > a + 1e-6) for b, _ in chosen for a, z in rests)
    ordered = sorted((ev["startBeat"], ev["startBeat"] + ev["durationBeats"]) for _, evs in chosen for ev in evs if ev)
    checks["single_voice"] = all(x[1] <= y[0] + 1e-6 for x, y in zip(ordered, ordered[1:]))
    return checks


def freeze(output):
    output = Path(output)
    output.mkdir()
    write_fixture(output)
    protocol = {"schemaVersion": 1, "kind": "keyspilli-gap-choice-protocol", "state": "frozen-not-executed",
                "providerCalls": 0, "prompt": PROMPT, "scenarios": SCENARIOS,
                "fixtureSha256": {n: hashlib.sha256((output / n).read_bytes()).hexdigest() for n in ("original.mid", "chords.mid", "events.json")},
                "responseSchema": {"commands": ["string"], "chordsBridges": [{"id": "", "startBeat": 0, "endBeat": 0, "events": [{"eventId": ""}]}], "finalText": ""},
                "scope": "Offline rubric. A fresh-chat run with the installed plugin is a separate authorization."}
    (output / "protocol.json").write_text(json.dumps(protocol, indent=2) + "\n")
    return protocol


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("freeze").add_argument("--output", required=True)
    g = sub.add_parser("grade")
    g.add_argument("--scenario", choices=sorted(SCENARIOS), required=True)
    g.add_argument("--response", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "freeze":
        print(json.dumps({"state": freeze(args.output)["state"], "providerCalls": 0}))
        return
    with tempfile.TemporaryDirectory() as folder:
        report, events = write_fixture(folder)
    result = grade(args.scenario, json.loads(args.response.read_text()), report, events)
    print(json.dumps({"scenario": args.scenario, "checks": result, "passed": all(result.values())}))


if __name__ == "__main__":
    main()
