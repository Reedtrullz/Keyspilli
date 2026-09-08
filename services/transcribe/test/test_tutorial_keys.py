"""Run with the optional tutorial Python environment; no remote media required."""
import importlib.util
import unittest
import asyncio
from unittest.mock import patch,AsyncMock
from pathlib import Path
import numpy as np
spec=importlib.util.spec_from_file_location('tutorial_keys',Path(__file__).parents[1]/'src/tutorial_keys.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TutorialKeysTest(unittest.TestCase):
 def test_measured_red_keys_and_short_flash(self):
  for color in ([236,118,117],[233,97,88],[216,28,51]):
   rows=np.zeros((20,3,3),dtype=np.uint8);rows[3:9]=color;rows[12]=color
   self.assertEqual(m.key_events(rows,60,46),[{'midi':46,'startSec':3/60,'durationSec':6/60,'color':'red'}])
  unknown=np.zeros((10,3,3),dtype=np.uint8);unknown[2:8]=[240,20,240]
  with self.assertRaisesRegex(ValueError,'Unsupported key color'):m.key_events(unknown,60,46)
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
 def test_fractional_ntsc_rate_keeps_native_timing(self):
  rows=np.zeros((12,3,3),dtype=np.uint8);rows[3:5]=[245,164,0]
  note=m.key_events(rows,24000/1001,60)[0]
  self.assertAlmostEqual(note['startSec'],3*1001/24000)
  self.assertAlmostEqual(note['durationSec'],2*1001/24000)
 def test_dim_red_key_is_not_rejected_as_an_unknown_color(self):
  rows=np.zeros((20,3,3),dtype=np.uint8);rows[5:12]=[111,30,47]
  self.assertEqual(m.key_events(rows,60,75),[{'midi':75,'startSec':5/60,'durationSec':7/60,'color':'red'}])
 def test_dark_red_activations_require_an_observed_neutral_key(self):
  for color in [[33,0,11],[41,2,11],[52,1,13],[53,3,13]]:
   rows=np.full((30,3,3),[130,130,130],dtype=np.uint8);rows[10:20]=color
   self.assertEqual(m.key_events(rows,60,60),[{'midi':60,'startSec':10/60,'durationSec':10/60,'color':'red'}])
   self.assertEqual(m.key_events(np.full((30,3,3),color,dtype=np.uint8),60,60),[])
 def test_geometry_color_fallback_keeps_the_original_frame_unchanged(self):
  import asyncio
  frame=np.full((10,10,3),[20,140,210],dtype=np.uint8);original=frame.copy()
  async def detector(image,*args):
   if not np.all(image==20):raise ValueError('lit black key width outlier')
   self.assertTrue(np.all(image==20))
   return {'bounds':[0,1,10,9]}
  with patch.object(m,'_detect_geometry',new=detector,create=True):
   result=asyncio.run(m.detect_geometry(frame,10,10,True))
  self.assertEqual(result['colorMode'],'blue-channel')
  np.testing.assert_array_equal(frame,original)
 def test_warm_ivory_is_not_a_dark_red_note_after_a_neutral_flash(self):
  rows=np.full((30,3,3),[250,220,200],dtype=np.uint8);rows[:6]=[240,240,240];rows[10:20]=[20,120,210]
  self.assertEqual(m.key_events(rows,60,60),[{'midi':60,'startSec':10/60,'durationSec':10/60,'color':'blue'}])
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
  rows=np.zeros((20,3,3),dtype=np.uint8);rows[5:12]=[240,20,240]
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
 def test_audio_tail_and_internal_gaps_cannot_hide_behind_extracted_notes(self):
  audio=np.ones(22050*20,dtype=np.float32)*.1
  notes=[{'startSec':0,'durationSec':8}]
  with self.assertRaisesRegex(ValueError,'without extracted notes'):m.audio_coverage(notes,audio)
  notes=[{'startSec':0,'durationSec':20}]
  self.assertEqual(m.audio_coverage(notes,audio)['activeBounds'],[0,20])
 def test_missing_or_silent_audio_cannot_pass_completeness(self):
  for audio in [np.array([]),np.zeros(22050)]:
   with self.assertRaisesRegex(ValueError,'audio required'):m.audio_coverage([{'startSec':0,'durationSec':1}],audio)
 def test_edge_width_noise_does_not_imply_key_movement(self):
  import copy
  c={'bounds':[0,500,1280,200],'keys':[{'midi_num':n} for n in range(21,109)],'edges':[[i*14,i*14+12] for i in range(88)]}
  noisy=copy.deepcopy(c);noisy['edges'][32][1]-=3
  self.assertTrue(m.geometry_matches(c,noisy,1280))
  shifted=copy.deepcopy(c);shifted['edges'][32]=[v+3 for v in shifted['edges'][32]]
  self.assertFalse(m.geometry_matches(c,shifted,1280))
  distorted=copy.deepcopy(c);distorted['edges'][32][1]-=5
  self.assertFalse(m.geometry_matches(c,distorted,1280))
 def test_geometry_comparison_rejects_movement_and_different_key_counts(self):
  import copy
  c={'bounds':[0,500,1280,200],'keys':[{'midi_num':n} for n in range(21,109)],'edges':[[i*10,i*10+8] for i in range(88)]}
  self.assertTrue(m.geometry_matches(c,copy.deepcopy(c),1280))
  glow=copy.deepcopy(c);glow['bounds'][1]-=8;glow['bounds'][3]+=8
  self.assertTrue(m.geometry_matches(c,glow,1280))
  moved=copy.deepcopy(c);moved['bounds'][1]+=8
  self.assertFalse(m.geometry_matches(c,moved,1280))
  cropped=copy.deepcopy(c);cropped['keys'].pop();cropped['edges'].pop()
  self.assertFalse(m.geometry_matches(c,cropped,1280))
 def test_frame_endpoint_drift_does_not_relax_interior_geometry(self):
  import copy
  a={'bounds':[0,560,1280,159],'keys':[{'midi_num':n} for n in range(21,24)],'edges':[[0,20],[10,25],[25,1276]]}
  b=copy.deepcopy(a);b['edges'][-1][1]=1279
  self.assertTrue(m.geometry_matches(a,b,1280))
  b['edges'][1]=[v+3 for v in b['edges'][1]]
  self.assertFalse(m.geometry_matches(a,b,1280))
  b=copy.deepcopy(a);b['edges'][-1][1]=1270
  self.assertFalse(m.geometry_matches(a,b,1280))
 def test_relative_geometry_requires_explicit_opt_in(self):
  pitches=list(range(24,78))
  c={'keys':[{'midi_num':n,'color':'b' if n%12 in [1,3,6,8,10] else 'w'} for n in pitches],
     'bounds':[0,400,1280,300],'edges':[[i*20,i*20+18] for i in range(len(pitches))]}
  with self.assertRaises(ValueError):m.validate_geometry(c,1280,720)
  m.validate_geometry(c,1280,720,allow_relative=True)
 def test_only_visible_boundary_key_fragments_are_clipped(self):
  self.assertEqual(m.clip_boundary_keys([[-5,10],[10,30],[30,55]],50),[[0,10],[10,30],[30,50]])
  with self.assertRaisesRegex(ValueError,'Interior'):m.clip_boundary_keys([[0,10],[10,60],[30,50]],50)
  with self.assertRaisesRegex(ValueError,'too narrow'):m.clip_boundary_keys([[0,10],[49,60]],50)
 def test_out_of_frame_geometry_rejected(self):
  c={'keys':[{'midi_num':n} for n in range(21,109)],'bounds':[0,580,1280,140],'edges':[[0,1281]]*88}
  with self.assertRaises(ValueError):m.validate_geometry(c,1280,720)
 def test_terminal_outro_requires_quiet_and_bounded_terminal_restart(self):
  audio=np.ones(100*22050,dtype=np.float32)*.1;audio[88*22050:90*22050]=0
  notes=[{'startSec':0,'durationSec':87}]
  self.assertEqual(m.terminal_outro_start(notes,audio,100),90)
  with self.assertRaisesRegex(ValueError,'without extracted notes'):m.audio_coverage(notes,audio)
  audio[88*22050:90*22050]=.1
  self.assertIsNone(m.terminal_outro_start(notes,audio,100))
  audio[88*22050:90*22050]=0
  self.assertIsNone(m.terminal_outro_start(notes,audio,200))
 def test_terminal_outro_requires_absent_keyboard_throughout_tail(self):
  keyboard=np.zeros((20,100,3),dtype=np.uint8);keyboard[:,::2]=255
  blank=np.zeros_like(keyboard)
  relocated=blank.copy();relocated[:8]=keyboard[:8]
  audio=np.ones(100*22050,dtype=np.float32)*.1;audio[88*22050:90*22050]=0
  c={'bounds':[0,0,100,20],'framesSeconds':[0,1]}
  meta={'duration':100,'width':100,'height':20,'fps':1};notes=[{'startSec':0,'durationSec':87}]
  class Capture:
   def __init__(self,tail):self.tail=tail;self.remaining=1;self.is_tail=False
   def set(self,_,value):self.is_tail=value>=90000;self.remaining=10 if self.is_tail else 1
   def read(self):
    if not self.remaining:return False,None
    self.remaining-=1;return True,self.tail if self.is_tail else keyboard
   def release(self):pass
  with patch('cv2.VideoCapture',return_value=Capture(keyboard)),patch.object(m,'detect_geometry',new=AsyncMock(side_effect=ValueError('absent'))):
   self.assertIsNone(asyncio.run(m.verify_terminal_outro('video',c,meta,notes,audio)))
  with patch('cv2.VideoCapture',return_value=Capture(relocated)),patch.object(m,'detect_geometry',new=AsyncMock(side_effect=ValueError('absent'))):
   self.assertIsNone(asyncio.run(m.verify_terminal_outro('video',c,meta,notes,audio)))
  with patch('cv2.VideoCapture',return_value=Capture(blank)),patch.object(m,'detect_geometry',new=AsyncMock(side_effect=ValueError('absent'))):
   evidence=asyncio.run(m.verify_terminal_outro('video',c,meta,notes,audio))
   self.assertEqual(evidence['excludedRangeSeconds'],[90,100]);self.assertEqual(evidence['framesChecked'],10)
   self.assertEqual(evidence['relativeQuietBeforeSeconds'],2);self.assertEqual(evidence['nearZeroDurationSeconds'],2)
   self.assertEqual(evidence['quietRmsMaximum'],0)
  with patch('cv2.VideoCapture',return_value=Capture(blank)),patch.object(m,'detect_geometry',new=AsyncMock(return_value=c)):
   self.assertIsNone(asyncio.run(m.verify_terminal_outro('video',c,meta,notes,audio)))
  self.assertEqual(notes,[{'startSec':0,'durationSec':87}])
if __name__=='__main__':unittest.main()
