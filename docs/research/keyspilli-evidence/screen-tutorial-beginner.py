"""Read-only structural screen; input is the private tutorial-recovery directory."""
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
rows = []
for name in ["bohemian", "nothing-else-matters", "in-my-mind"]:
    def read(level):
        return json.loads((root / f"{name}-spaced-levels/{level}/notes.json").read_text())
    v, e = read("beginner"), read("easy")
    scale = 60 / v["tempoBpm"]
    notes = sorted(v["notes"], key=lambda n: n["start"])
    assert all(n["hand"] == "R" for n in notes), "Screen assumes a single right-hand line"
    jumps = [
        {"timeSeconds": round(b["start"] * scale, 3),
         "semitones": abs(b["midi"] - a["midi"]),
         "gapSeconds": round((b["start"] - a["start"]) * scale, 3)}
        for a, b in zip(notes, notes[1:]) if abs(b["midi"] - a["midi"]) > 12
    ]
    missing = []
    end = max(n["start"] + n["dur"] for n in e["notes"]) * scale
    for t in range(0, int(end), 8):
        def active(items):
            return any(n["start"] * scale < t + 8 and (n["start"] + n["dur"]) * scale > t for n in items)
        if active(e["notes"]) and not active(notes):
            missing.append(t)
    rows.append({"song": name, "notes": len(notes),
                 "minimumAttackGapSeconds": min((b["start"] - a["start"]) * scale for a, b in zip(notes, notes[1:])),
                 "jumpsLargerThanOctave": jumps,
                 "eightSecondWindowsWithEasyButNoBeginner": missing})
print(json.dumps({"scope": "Whole-song structural screening of accepted local source-profile artifacts, not musical certification. Empty windows compare sustained activity, not melody identity.", "rows": rows}, indent=2))
