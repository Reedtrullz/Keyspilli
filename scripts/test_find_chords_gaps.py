import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SCRIPTS = Path(__file__).parent
HELPER = SCRIPTS.parent / "plugins/keyspilli/skills/keyspilli-song/scripts/find_chords_gaps.py"


class GapHelperTests(unittest.TestCase):
    def setUp(self):
        self.helper = load("find_chords_gaps", HELPER)
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def write(self, name, notes, tempo=120):
        path = Path(self.dir.name) / name
        path.write_bytes(self.helper.encode_midi(notes, tempo))
        return path

    def test_reports_gap_window_candidates_and_genuine_rest(self):
        original = [(0, 4, 40), (4, 4.5, 72), (4.7, 5.2, 74), (5.2, 6, 76), (7.5, 10, 40)]
        report = self.helper.analyze(self.write("o.mid", original), self.write("c.mid", [(0, 4, 40), (7.5, 10, 40)]))
        gap = report["backingGaps"][0]
        self.assertEqual((gap["backingEndsSeconds"], gap["backingResumesSeconds"]), (4.0, 7.5))
        window = gap["bridgeableWindows"][0]
        self.assertEqual((window["startSeconds"], window["endSeconds"], len(window["candidateOriginalNotes"])), (4.0, 6.0, 3))
        self.assertEqual(gap["genuineRestSeconds"], [{"startSeconds": 6.0, "endSeconds": 7.5}])
        self.assertTrue(gap["withinBridgeBounds"])

    def test_refuses_oversized_gap_and_ignores_intro_and_outro(self):
        original = [(0, 1, 72), (2, 8, 72), (9, 10, 40)]
        chords = [(1, 2, 40), (9, 10, 40)]
        report = self.helper.analyze(self.write("o.mid", original), self.write("c.mid", chords))
        self.assertEqual(len(report["backingGaps"]), 1)
        self.assertFalse(report["backingGaps"][0]["withinBridgeBounds"])
        self.assertTrue(any("six native seconds" in n for n in report["backingGaps"][0]["notes"]))

    def test_note_crossing_the_backing_boundary_is_not_a_candidate(self):
        original = [(0, 2, 40), (2, 5, 72), (4, 6, 40)]
        report = self.helper.analyze(self.write("o.mid", original), self.write("c.mid", [(0, 2, 40), (4, 6, 40)]))
        gap = report["backingGaps"][0]
        self.assertEqual(gap["originalNotesCrossingBoundary"], 1)
        self.assertEqual(gap["bridgeableWindows"], [])

    def test_lead_shadow_flags_sustained_repeats_but_not_a_clean_backing(self):
        top = [(t, t + 0.4, 72 + (i % 3)) for i, t in enumerate((1, 2, 3, 4, 5, 6, 7))] + [(0, 8, 40)]
        clean = self.helper.analyze(self.write("o.mid", top), self.write("c.mid", [(0, 8, 40), (4, 8, 47)]))
        self.assertIsNone(clean["leadShadow"]["firstSuspectSeconds"])
        leaked = self.helper.analyze(self.write("o2.mid", top), self.write("c2.mid", [(0, 8, 40)] + top[:7]))
        self.assertEqual(leaked["leadShadow"]["firstSuspectSeconds"], 0.0)

    def test_tempo_map_difference_is_warned(self):
        a = self.write("o.mid", [(0, 2, 40)], 120)
        b = self.write("c.mid", [(0, 2, 40)], 90)
        self.assertTrue(self.helper.analyze(a, b)["warnings"])

    def test_rejects_non_midi_and_truncated_input(self):
        with self.assertRaises(ValueError):
            self.helper.parse_midi(b"not midi")
        good = self.helper.encode_midi([(0, 1, 60)])
        with self.assertRaises(ValueError):
            self.helper.parse_midi(good[:-6])


class GapChoiceGraderTests(unittest.TestCase):
    def setUp(self):
        self.module = load("gap_choice", SCRIPTS / "evaluate-keyspilli-gap-choice.py")
        with tempfile.TemporaryDirectory() as folder:
            self.report, self.events = self.module.write_fixture(folder)
        self.good = {"commands": ["node phrase-plan.mts capabilities", "python3 scripts/find_chords_gaps.py original.mid chords.mid"],
                     "chordsBridges": [{"id": "g1", "startBeat": 12, "endBeat": 18.6, "events": [{"eventId": e} for e in ("m1", "m2", "m3", "m4")]},
                                       {"id": "g2", "startBeat": 28, "endBeat": 29, "events": [{"eventId": "m5"}]}],
                     "finalText": "Bridged two gaps and kept the rest. Hearing and musical acceptance are unassessed."}

    def grade(self, response, scenario="bridge-available"):
        return self.module.grade(scenario, response, self.report, self.events)

    def mutated(self, change):
        response = copy.deepcopy(self.good)
        change(response)
        return response

    def test_fixture_exposes_the_expected_windows_and_rest(self):
        windows, rests = self.module.spans(self.report)
        self.assertEqual(windows, [(6.0, 9.3), (14.0, 14.5)])
        self.assertEqual(rests, [(9.3, 9.4), (14.5, 15.2)])

    def test_reference_response_passes(self):
        self.assertTrue(all(self.grade(self.good).values()), self.grade(self.good))

    def test_each_wrong_strategy_fails_its_own_check(self):
        def swap_hook(r): r["chordsBridges"][0]["events"][1] = {"eventId": "h1"}
        def add_unknown(r): r["chordsBridges"][1]["events"].append({"eventId": "u1"})
        def span_rest(r): r["chordsBridges"][1]["endBeat"] = 30.4
        def outside_window(r): r["chordsBridges"][0]["startBeat"] = 2
        def skip_capability(r): r["commands"] = ["python3 scripts/find_chords_gaps.py a b"]
        def no_bridges(r): r["chordsBridges"] = []
        def overclaim(r): r["finalText"] = "I listened and it is musically approved."
        for change, check in ((swap_hook, "only_melody_events"), (add_unknown, "only_melody_events"),
                              (span_rest, "genuine_rest_preserved"), (outside_window, "inside_reported_window"),
                              (skip_capability, "capability_checked"), (no_bridges, "bridge_declared"),
                              (overclaim, "no_overclaim")):
            self.assertFalse(self.grade(self.mutated(change))[check], change.__name__)

    def test_missing_capability_requires_no_bridge_and_an_unavailable_report(self):
        ok = {"commands": ["node phrase-plan.mts capabilities"], "chordsBridges": [], "finalText": "Bridge support is unavailable here; backing kept."}
        self.assertTrue(all(self.grade(ok, "capability-missing").values()))
        bad = dict(ok, chordsBridges=self.good["chordsBridges"])
        self.assertFalse(self.grade(bad, "capability-missing")["no_bridge_declared"])

    def test_freeze_writes_a_zero_call_protocol_once(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "run"
            protocol = self.module.freeze(target)
            self.assertEqual((protocol["providerCalls"], protocol["state"]), (0, "frozen-not-executed"))
            with self.assertRaises(FileExistsError):
                self.module.freeze(target)


if __name__ == "__main__":
    unittest.main()
