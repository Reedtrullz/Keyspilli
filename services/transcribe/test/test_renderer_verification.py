import importlib.util, unittest, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
p=Path(__file__).resolve().parents[1]/'src/renderer_verification.py';s=importlib.util.spec_from_file_location('renderer',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class RendererTests(unittest.TestCase):
 def test_search_includes_unexpected_pitch(self):
  result=m.compare_activity([{ 'midi':60,'startSeconds':0.2},{'midi':61,'startSeconds':0.6}], [60])
  self.assertEqual(result['unexpectedPitches'],[61])
 def test_wrong_score_keeps_missing_and_residual(self):
  r=m.compare_activity([{'midi':60,'startSeconds':0.2}], [62]);self.assertEqual(r['missingExpectedPitches'],[62]);self.assertEqual(r['unexpectedPitches'],[60])
 def test_wrong_bank_is_unavailable(self):
  with self.assertRaises(ValueError):m.check_bank('a'*64,[{'bankSha256':'b'*64}])
 def test_shared_renderer_cannot_certify(self):
  self.assertEqual(m.compare_activity([],[])['musicalAcceptance'],'not-established')

 def test_real_nnls_search_is_not_restricted_to_expected_score(self):
  try:
   import numpy as np, scipy, soxr
  except ImportError:
   self.skipTest('Optional local DSP experiment dependencies absent')
  rate=8000; t=np.arange(rate)/rate
  templates=[(60,np.sin(2*np.pi*261.6256*t),rate),(67,np.sin(2*np.pi*391.9954*t),rate)]
  audio=np.zeros(2*rate);audio[rate//4:rate//4+rate//2]=.3*templates[0][1][:rate//2];audio[rate:rate+rate//2]=.3*templates[1][1][:rate//2]
  activity,residuals=m.spectral_activity(audio,rate,templates,.25)
  result=m.compare_activity(activity,[60])
  self.assertEqual(result['unexpectedPitches'],[67]);self.assertIn(60,result['matchedPitches']);self.assertTrue(residuals)
  wrong=m.compare_activity(activity,[62]);self.assertEqual(wrong['missingExpectedPitches'],[62]);self.assertEqual(wrong['unexpectedPitches'],[60,67])
