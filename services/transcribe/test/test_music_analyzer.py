import importlib.util
from pathlib import Path
import unittest, tempfile, wave, hashlib, json
p=Path(__file__).resolve().parents[1]/'src/music_analyzer.py'
s=importlib.util.spec_from_file_location('music_analyzer',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class AnalyzerTests(unittest.TestCase):
 def test_invalid_backend(self):
  with self.assertRaises(ValueError):m.check_request({'model':'unknown'})
 def test_missing_weights_no_download(self):
  with self.assertRaises(m.Unavailable):m.check_assets({'checkpointPath':'/missing','checkpointSha256':'a'*64})
 def test_decode_preserves_channels_and_hash(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'a.wav'
   with wave.open(str(p),'wb') as w:w.setparams((2,2,8000,0,'NONE','not compressed'));w.writeframes(b'\x00\x40\x00\xc0'*8000)
   raw=p.read_bytes();channels,mono,info=m.decode_pcm(p,hashlib.sha256(raw).hexdigest())
   self.assertEqual(len(channels),8000);self.assertEqual(channels[0],(0.5,-0.5));self.assertEqual(mono[0],0.0)
   self.assertEqual(info['channels'],2)
   with self.assertRaises(ValueError):m.decode_pcm(p,'0'*64)
 def test_exclusive_output(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'out.json';m.write_new(p,{'status':'unavailable'})
   with self.assertRaises(FileExistsError):m.write_new(p,{})

class RawEventTests(unittest.TestCase):
 def test_invalid_rows_are_counted_without_rounding(self):
  notes,rejected=m.normalize_rows([(0.1,0.3,60,None),(-1,0.3,60,None),(0.1,0.3,60.1,None),(0.1,4,60,None)],2)
  self.assertEqual(len(notes),1);self.assertEqual(rejected,3);self.assertIsNone(notes[0]['keyOffsetSeconds'])
 def test_network_denied(self):
  with self.assertRaises(RuntimeError):m.deny_network('socket.connect',('example.invalid',443))
