"""Run with the optional tutorial Python environment; no remote media required."""
import importlib.util
import unittest
from pathlib import Path
import numpy as np
spec=importlib.util.spec_from_file_location('tutorial_keys',Path(__file__).parents[1]/'src/tutorial_keys.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TutorialKeysTest(unittest.TestCase):
 def test_repeated_key_and_duration_use_native_frames(self):
  rows=np.zeros((20,3,3),dtype=np.uint8)
  rows[2:6]=[20,120,210];rows[9:15]=[20,120,210]
  self.assertEqual(m.key_events(rows,60,61),[
   {'midi':61,'startSec':2/60,'durationSec':4/60,'color':'blue'},
   {'midi':61,'startSec':9/60,'durationSec':6/60,'color':'blue'}])
 def test_purple_background_white_flash_and_one_frame_bleed_are_not_notes(self):
  rows=np.full((20,3,3),[80,30,90],dtype=np.uint8)
  rows[3:8]=[240,240,240];rows[10]=[20,120,210]
  self.assertEqual(m.key_events(rows,60,60),[])
 def test_green_key_at_end_is_closed_without_losing_onset(self):
  rows=np.zeros((12,3,3),dtype=np.uint8);rows[6:]=[20,210,80]
  self.assertEqual(m.key_events(rows,60,60),[{'midi':60,'startSec':.1,'durationSec':.1,'color':'green'}])
 def test_midi_export_preserves_initial_silence_and_event_times(self):
  import tempfile,mido
  notes=[{'midi':61,'startSec':5.0,'durationSec':.25,'color':'blue'},
         {'midi':64,'startSec':5.125,'durationSec':.5,'color':'green'}]
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'out.mid';m.save_midi(notes,path);time=0;events=[]
   for msg in mido.MidiFile(path):
    time+=msg.time
    if msg.type in ['note_on','note_off']:events.append((msg.note,msg.type,round(time,6)))
  self.assertEqual(events,[(61,'note_on',5.0),(64,'note_on',5.125),(61,'note_off',5.25),(64,'note_off',5.625)])
 def test_ambiguous_pitch_range_rejected(self):
  with self.assertRaisesRegex(ValueError,'88'):
   m.validate_geometry({'keys':[{'midi_num':n} for n in range(24,101)],'bounds':[0,580,1280,140],'edges':[]},1280,720)
 def test_out_of_frame_geometry_rejected(self):
  c={'keys':[{'midi_num':n} for n in range(21,109)],'bounds':[0,580,1280,140],'edges':[[0,1281]]*88}
  with self.assertRaises(ValueError):m.validate_geometry(c,1280,720)
if __name__=='__main__':unittest.main()
