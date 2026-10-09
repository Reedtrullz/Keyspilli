"""Independent time-domain controls for disk-backed candidate selection."""
import sys,tempfile,unittest
from pathlib import Path
import numpy as np
from scipy.fft import rfft
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from player_history_search import PlayerHistorySearch
class PlayerHistorySearchTests(unittest.TestCase):
 def test_cached_correlation_matches_shifted_wave_and_pitch_exclusion(self):
  with tempfile.TemporaryDirectory() as d:
   n=52920; rng=np.random.default_rng(117)
   waves=[]
   for _ in range(2):
    x=np.zeros((n,2),np.float32);x[:8000]=rng.normal(0,.1,(8000,2));waves.append(x)
   pins=[{'midi':60,'velocity':76},{'midi':72,'velocity':76}]
   search=PlayerHistorySearch(waves,pins,d)
   atoms=[]
   for ri,duration in search.labels:
    ages=np.arange(n,dtype=np.float32)/44100
    envelope=np.ones(n,np.float32) if duration is None else np.clip(1-(ages-duration)/.5,0,1)
    atoms.append(waves[ri]*envelope[:,None])
   kernels=np.stack([rfft(w[::-1],search.fftlen,axis=0).astype(np.complex64) for w in atoms])
   norm=np.sqrt(np.maximum(np.stack([np.cumsum(np.sum(w*w,axis=1),dtype=np.float32)[::-1] for w in atoms]),1e-20))
   np.save(Path(d)/'0000-fft.npy',kernels);np.save(Path(d)/'0000-norm.npy',norm)
   target=np.zeros_like(waves[0]);target[37:]=.8*waves[0][:-37]
   score,index,frame=search.find_candidate(target,eligible=[3])
   self.assertEqual((index,frame),(3,37)); self.assertAlmostEqual(score,.8*float(np.linalg.norm(waves[0])),places=3)
   # Noncontiguous atom selection and centered search preserve the same answer.
   _,index,frame=search.find_candidate(target,eligible=[1,3,5,7],center=37)
   self.assertEqual((pins[search.labels[index][0]]['midi'],frame),(60,37))
   score,_,frame=search.find_candidate(target,eligible=[3],active=[{'ref':0,'frame':37}])
   self.assertTrue(abs(frame-37)>.02*44100)
