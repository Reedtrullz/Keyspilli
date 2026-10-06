"""Fixed native-rate full-range Player history pursuit. No score context input.

Algorithm extracted unchanged from the closed full-range development prototype.
Maintained packaging/fingerprints require separate fresh qualification.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('OMP_NUM_THREADS', '1')
import numpy as np
from scipy.fft import rfft, irfft, next_fast_len
from scipy.optimize import nnls, minimize_scalar
from pathlib import Path
CONFIG = {'prefixSeconds': 1.2, 'maximumEvents': 8, 'initialDurationsSeconds': [0.15, 0.3, 0.6, None], 'maximumRawResidual': 0.05, 'minimumImprovement': 0.001, 'minimumAmplitude': 0.05, 'minimumRmsDbfs': -50, 'minimumEventGapSeconds': 0.02, 'minimumHistorySeconds': 0.128, 'phaseOptimizationSamples': 1, 'coordinateRechooseRadiusSeconds': 0.01, 'releaseSeconds': 0.5, 'developmentOnly': True, 'usesExpectedNotesOrTargetSamplerStarts': False, 'referenceInventory': 'all88-MIDI21-through108', 'dictionaryBatchAtoms': 16, 'weakCandidatesWithholdAcceptedSet': True, 'maximumRssBytes': 2147483648, 'method': 'batched-native-rate-stereo-waveform-pursuit', 'minimumAmplitudeOrigin': 'velocity8 relative to filtered reference32 has nominal gain0.0625; new development choice, not a retune of the closed28-case study'}

class PlayerHistorySearch:
    def __init__(self, refs, pins, dictionary):
        self.config = dict(CONFIG)
        self.refs, self.referencepins = refs, pins
        self.sr = 44100
        self.N = round(self.config["prefixSeconds"] * self.sr)
        self.fftlen = next_fast_len(2 * self.N - 1)
        self.labels = [(i, d) for i in range(len(refs)) for d in self.config["initialDurationsSeconds"]]
        self.cache = Path(dictionary)

    def find_candidate(self, residual,active=None,eligible=None,center=None):
     spectrum=rfft(residual.astype(np.float32),self.fftlen,axis=0);best=(-np.inf,0,0);allowed=None if eligible is None else set(eligible)
     lo=0 if center is None else max(0,int(center-self.config['coordinateRechooseRadiusSeconds']*self.sr))
     hi=self.N-round(self.config['minimumHistorySeconds']*self.sr)+1 if center is None else min(self.N-round(self.config['minimumHistorySeconds']*self.sr)+1,int(center+self.config['coordinateRechooseRadiusSeconds']*self.sr)+1)
     for start in range(0,len(self.labels),self.config['dictionaryBatchAtoms']):
      selected=[i for i in range(start,min(start+self.config['dictionaryBatchAtoms'],len(self.labels))) if allowed is None or i in allowed]
      if not selected:continue
      local=np.asarray(selected)-start
      mapped=np.load(self.cache/f'{start:04d}-fft.npy',mmap_mode='r',allow_pickle=False);kernels=mapped[local].copy();mapped._mmap.close()
      mapped=np.load(self.cache/f'{start:04d}-norm.npy',mmap_mode='r',allow_pickle=False);norm=mapped[local].copy();mapped._mmap.close()
      correlations=irfft(np.sum(kernels*spectrum[None,:,:],axis=2),self.fftlen,axis=1)[:,self.N-1:self.N-1+self.N]/norm
      if active:
       for event in active:
        pitch=self.referencepins[event['ref']]['midi'];begin=max(0,int(event['frame']-self.config['minimumEventGapSeconds']*self.sr));end=min(self.N,int(event['frame']+self.config['minimumEventGapSeconds']*self.sr)+1)
        for j,index in enumerate(selected):
         if self.referencepins[self.labels[index][0]]['midi']==pitch:correlations[j,begin:end]=-np.inf
      option,lag=np.unravel_index(np.argmax(correlations[:,lo:hi]),correlations[:,lo:hi].shape);value=float(correlations[option,lo+lag]);choice=(value,selected[option],lo+lag)
      if value>best[0]:best=choice
     return best

    def fit(self, data):
     target=data[:self.N].astype(np.float64);targetnorm=np.linalg.norm(target);level=float(20*np.log10(max(np.sqrt(np.mean(target*target)),1e-12)))
     if level<self.config['minimumRmsDbfs']:return {'pitches':None,'reason':'below-level','rmsDbfs':level}
     active=[];amplitudes=np.zeros(0);reconstruction=np.zeros_like(target);previous=targetnorm
     def column(event):
      ref=self.refs[event['ref']];pos=np.arange(self.N)-event['frame'];wave=np.column_stack([np.interp(pos,np.arange(self.N),ref[:,ch],left=0,right=0) for ch in range(2)])
      if event['duration'] is not None:wave*=np.clip(1-((np.arange(self.N)/self.sr-event['frame']/self.sr)-event['duration'])/.5,0,1)[:,None]
      return wave.ravel()
     def refit(events):
      m=np.asarray([column(e) for e in events]).T;coeff,err=nnls(m,target.ravel(),maxiter=1000);return m,coeff,err
     for _ in range(self.config['maximumEvents']):
      residual=target-reconstruction
      score,index,frame=self.find_candidate(residual,active=active)
      if score<=0:break
      refidx,duration=self.labels[index];trial=active+[{'ref':refidx,'frame':float(frame),'duration':duration}]
      # Coordinate-refine only selected events; no authored target values enter.
      for _pass in range(2):
       for event_id,event in enumerate(trial):
        # Rechoose band/release after other voices are fitted; no target schedule.
        current_matrix,current_coeff,_=refit(trial)
        isolated=(target.ravel()-current_matrix@current_coeff+current_matrix[:,event_id]*current_coeff[event_id]).reshape(self.N,2)
        pitch=self.referencepins[event['ref']]['midi'];eligible=[i for i,(ri,_) in enumerate(self.labels) if self.referencepins[ri]['midi']==pitch]
        _,option,lag=self.find_candidate(isolated,eligible=eligible,center=event['frame'])
        event['ref'],event['duration']=self.labels[option];event['frame']=float(lag)
        current=event['frame']
        def phase_error(value):
         events=[dict(x) for x in trial];events[event_id]['frame']=value;return refit(events)[2]
        optimized=minimize_scalar(phase_error,bounds=(current-1,current+1),method='bounded',options={'xatol':.01});event['frame']=float(optimized.x)
        if event['duration'] is not None:
         def duration_error(value):
          events=[dict(x) for x in trial];events[event_id]['duration']=value;return refit(events)[2]
         optimized=minimize_scalar(duration_error,bounds=(.03,min(1.2,max(.04,1.2-event['frame']/self.sr))),method='bounded',options={'xatol':.001});event['duration']=float(optimized.x)
      matrix,coeff,error=refit(trial)
      if (previous-error)/targetnorm<self.config['minimumImprovement']:break
      active=trial;amplitudes=coeff;previous=error;reconstruction=(matrix@coeff).reshape(self.N,2)
     raw=float(np.linalg.norm(target-reconstruction)/targetnorm);events=[{**self.referencepins[e['ref']],'fittedStartSeconds':e['frame']/self.sr,'fittedReleaseAfterSeconds':e['duration'],'amplitude':float(a)} for e,a in zip(active,amplitudes)];pitches=sorted(set(e['midi'] for e in events if e['amplitude']>=self.config['minimumAmplitude']))
     weak=[e for e in events if 0<e['amplitude']<self.config['minimumAmplitude']]
     return {'pitches':pitches if raw<=self.config['maximumRawResidual'] and not weak else None,'proposed':pitches,'unresolvedWeakCandidates':weak,'rawResidual':raw,'events':events,'rmsDbfs':level,'fitInterval':{'startSeconds':0,'endSeconds':self.N/self.sr},'currentPresenceEstablished':False}
