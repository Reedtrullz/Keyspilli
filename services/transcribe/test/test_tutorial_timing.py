"""Bounded synthetic audio and MIDI round-trip checks; no remote sources."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import numpy as np
import mido
spec = importlib.util.spec_from_file_location('tutorial_timing', Path(__file__).parents[1]/'src/tutorial_timing.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def clicks(times, rate=22050):
    audio = np.zeros(round((times[-1]+1)*rate))
    for second in times:
        start = round(second*rate)
        audio[start:start+100] = np.hanning(100)
    return audio


class TutorialTimingTest(unittest.TestCase):
    def test_constant_click_pulse_is_not_claimed_as_metrical_bpm(self):
        result = m.estimate_timing(clicks(np.arange(1, 25, .6)))
        self.assertEqual(result['status'], 'pulse-estimated')
        self.assertAlmostEqual(result['pulseBpm'], 100, delta=1)
        self.assertGreater(result['confidence'], .8)
        self.assertIsNone(result['bpm'])
        self.assertEqual(result['metricalTempoStatus'], 'unknown')
        self.assertFalse(result['variableTempo'])
        self.assertEqual(len(m.tempo_events(result)), 1)

    def test_sustained_variable_click_pulse(self):
        times = np.r_[1, 1 + np.cumsum(np.linspace(.65, .5, 60))]
        result = m.estimate_timing(clicks(times))
        self.assertEqual(result['status'], 'pulse-estimated')
        self.assertTrue(result['variableTempo'])
        self.assertGreater(len(m.tempo_events(result)), 2)

    def test_silence_and_irregular_attacks_are_unknown(self):
        for audio in [np.zeros(22050*10), clicks(np.r_[1, 1+np.cumsum([.3,.8,.4,.6]*8)])]:
            result = m.estimate_timing(audio)
            self.assertEqual(result['status'], 'unknown')
            self.assertIsNone(result['bpm'])
            self.assertEqual(result['tempoSegments'], [])
            self.assertEqual(m.tempo_events(result), [{'tick':0, 'tempo':500000}])

    def test_note_seconds_round_trip_across_tempo_changes(self):
        timing = {'status':'pulse-estimated', 'tempoSegments':[
            {'startSec':0, 'bpm':97.3}, {'startSec':3.217, 'bpm':114.7}, {'startSec':7.132, 'bpm':83.9}]}
        events = m.tempo_events(timing)
        expected = [0.213, 3.217, 4.981, 7.132, 12.99]
        mid = mido.MidiFile(ticks_per_beat=960)
        track = mido.MidiTrack(); mid.tracks.append(track)
        messages = [(e['tick'], mido.MetaMessage('set_tempo',tempo=e['tempo'])) for e in events]
        messages += [(m.seconds_to_tick(s, events), mido.Message('note_on',note=60+i)) for i,s in enumerate(expected)]
        previous = 0
        for tick,msg in sorted(messages, key=lambda pair:pair[0]):
            msg.time=tick-previous; track.append(msg); previous=tick
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'timing.mid'; mid.save(path)
            elapsed=0; actual=[]
            for msg in mido.MidiFile(path):
                elapsed += msg.time
                if msg.type == 'note_on': actual.append(elapsed)
        np.testing.assert_allclose(actual, expected, atol=.0004, rtol=0)

    def test_reject_invalid_input(self):
        for audio in [np.array([float('nan')]), np.zeros((10,2))]:
            with self.assertRaises(ValueError): m.estimate_timing(audio)
        with self.assertRaises(ValueError): m.seconds_to_tick(-1, [])

    def test_reject_invalid_or_duplicate_tempo_points(self):
        for segments in [
            [{'startSec':0,'bpm':100},{'startSec':0,'bpm':110}],
            [{'startSec':0,'bpm':float('nan')}],
            [{'startSec':float('inf'),'bpm':100}],
            [{'startSec':0,'bpm':100},{'startSec':.000001,'bpm':110}],
        ]:
            with self.assertRaises(ValueError):
                m.tempo_events({'status':'pulse-estimated','tempoSegments':segments})
        for events in [
            [{'tick':0,'tempo':500000},{'tick':0,'tempo':600000}],
            [{'tick':float('nan'),'tempo':500000}],
            [{'tick':0,'tempo':float('inf')}],
            [{'tick':-1,'tempo':500000}],
        ]:
            with self.assertRaises(ValueError): m.seconds_to_tick(0,events)

if __name__ == '__main__': unittest.main()
