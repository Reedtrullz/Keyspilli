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
 def test_24fps_key_lights_keep_native_timing(self):
  rows=np.zeros((12,3,3),dtype=np.uint8);rows[3:5]=[245,164,0]
  self.assertEqual(m.key_events(rows,24,60),[{'midi':60,'startSec':3/24,'durationSec':2/24,'color':'yellow'}])
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
 def test_yellow_notes_are_not_lost_or_confused_with_ivory_keys(self):
  rows=np.full((20,3,3),[250,240,200],dtype=np.uint8)
  rows[5:12]=[255,230,60]
  notes=m.key_events(rows,60,64)
  self.assertEqual(notes,[{'midi':64,'startSec':5/60,'durationSec':7/60,'color':'yellow'}])
  import tempfile,mido
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'out.mid';m.save_midi(notes,path)
   self.assertEqual([n.note for n in mido.MidiFile(path) if n.type=='note_on'],[64])
 def test_unrecognized_saturated_key_is_rejected_not_silently_omitted(self):
  rows=np.zeros((20,3,3),dtype=np.uint8);rows[5:12]=[240,20,30]
  with self.assertRaisesRegex(ValueError,'Unsupported key color'):
   m.key_events(rows,60,64)
 def test_muted_purple_black_keys_are_preserved(self):
  rows=np.zeros((20,3,3),dtype=np.uint8);rows[4:14]=[134,107,139]
  self.assertEqual(m.key_events(rows,30,51),[{'midi':51,'startSec':4/30,'durationSec':10/30,'color':'purple'}])
 def test_acoustic_octave_mapping_and_ambiguous_audio(self):
  rate=22050;notes=[];audio=np.zeros(rate*24)
  for i in range(24):
   pitch=36+i%12;notes.append(dict(midi=pitch,startSec=float(i),durationSec=.7))
   t=np.arange(int(rate*.7))/rate;f=440*2**((pitch+12-69)/12)
   audio[i*rate:i*rate+len(t)]=np.sin(2*np.pi*f*t)+.3*np.sin(4*np.pi*f*t)
  evidence=m.acoustic_octave(notes,audio,rate)
  self.assertEqual(evidence['semitones'],12)
  with self.assertRaisesRegex(ValueError,'octave'):
   m.acoustic_octave(notes,np.zeros_like(audio),rate)
  # Two equally strong octaves must not become a confident mapping.
  ambiguous=audio.copy()
  for i,n in enumerate(notes):
   t=np.arange(int(rate*.7))/rate;f=440*2**((n['midi']-69)/12)
   ambiguous[i*rate:i*rate+len(t)]+=np.sin(2*np.pi*f*t)
  with self.assertRaisesRegex(ValueError,'octave'):
   m.acoustic_octave(notes,ambiguous,rate)
 def test_ambiguous_pitch_range_rejected(self):
  with self.assertRaisesRegex(ValueError,'88'):
   m.validate_geometry({'keys':[{'midi_num':n} for n in range(24,101)],'bounds':[0,580,1280,140],'edges':[]},1280,720)
 def test_relative_geometry_requires_explicit_opt_in(self):
  pitches=list(range(24,78))
  c={'keys':[{'midi_num':n,'color':'b' if n%12 in [1,3,6,8,10] else 'w'} for n in pitches],
     'bounds':[0,400,1280,300],'edges':[[i*20,i*20+18] for i in range(len(pitches))]}
  with self.assertRaises(ValueError):m.validate_geometry(c,1280,720)
  m.validate_geometry(c,1280,720,allow_relative=True)
 def test_out_of_frame_geometry_rejected(self):
  c={'keys':[{'midi_num':n} for n in range(21,109)],'bounds':[0,580,1280,140],'edges':[[0,1281]]*88}
  with self.assertRaises(ValueError):m.validate_geometry(c,1280,720)
if __name__=='__main__':unittest.main()
