#!/usr/bin/env python3
"""Explicit offline Player-input history receipts; never arbitrary audio AMT."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import stat
import struct
import sys
import time

from player_pitch_support import DEFAULT_POLICY, PitchSupportPolicy, support_receipt

os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
os.environ.setdefault('OMP_NUM_THREADS','1')

MAX_BANK_BYTES = 4 * 1024**3
LIMITATIONS = [
    'Known-renderer first 1.2-second input history only; no full event transcription.',
    'Metadata asserts provenance; byte hashes cannot authenticate acoustic domain or source authority.',
    'Quiet absence, completeness, current keys, note-offs, pedal and audible-output perception remain unknown.',
    'Fit coefficients are alternatives, not physical velocities/releases or calibrated confidence.',
    'Independent provider hearing, source fidelity, repairs and musical acceptance are not established.',
]

def digest(b):
    return hashlib.sha256(b).hexdigest()


def analyzer_identity(policy=DEFAULT_POLICY):
    files = [
        Path(__file__).read_bytes(),
        Path(__file__).with_name('player_history_search.py').read_bytes(),
        Path(__file__).with_name('player_pitch_support.py').read_bytes(),
    ]
    return digest(b''.join(files) + policy.sha256().encode('ascii'))

def bounded(path, maximum):
    p = Path(path)
    if not p.is_absolute() or p.is_symlink() or not stat.S_ISREG(p.stat().st_mode) or p.stat().st_size > maximum:
        raise ValueError('absolute regular bounded file required')
    with p.open('rb') as handle:
        b = handle.read(maximum + 1)
    if len(b) > maximum:
        raise ValueError('file exceeds bound')
    return b

def read_json(path, maximum=1024*1024):
    def unique(pairs):
        result={}
        for k,v in pairs:
            if k in result: raise ValueError('duplicate JSON field')
            result[k]=v
        return result
    return json.loads(bounded(path,maximum),object_pairs_hook=unique,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))

def signal(pin, encoding, channels):
    if not isinstance(pin,dict) or pin.get('encoding')!=encoding or pin.get('channels')!=channels or pin.get('sampleRate')!=44100:
        raise ValueError('unsupported input domain/encoding/rate')
    frames=pin.get('frames')
    if type(frames) is not int or not 0<frames<=176400:raise ValueError('invalid signal frames')
    b=bounded(pin['path'],2*1024*1024)
    if digest(b)!=pin['sha256']:raise ValueError('stale signal hash')
    width=4 if encoding=='pcm-f32le' else 2
    if len(b)!=44+frames*channels*width or b[:4]!=b'RIFF' or b[8:16]!=b'WAVEfmt ' or b[36:40]!=b'data':raise ValueError('unsupported WAV layout')
    if struct.unpack_from('<I',b,4)[0]!=len(b)-8 or struct.unpack_from('<I',b,16)[0]!=16 or struct.unpack_from('<HHIIHH',b,20)!=(3 if width==4 else 1,channels,44100,44100*channels*width,channels*width,width*8) or struct.unpack_from('<I',b,40)[0]!=len(b)-44:raise ValueError('WAV metadata mismatch')
    if width==4:
        import numpy as np
        if not np.isfinite(np.frombuffer(b, dtype='<f4', offset=44)).all():raise ValueError('nonfinite signal')
    return b

def capture(path):
    r=read_json(path)
    if not isinstance(r,dict) or r.get('kind')!='keyspilli-player-paired-capture' or r.get('schemaVersion')!=1 or r.get('input',{}).get('encoding')!='pcm-f32le':raise ValueError('unsupported input domain')
    blobs=[signal(r[k],enc,ch) for k,enc,ch in [('input','pcm-f32le',2),('output','pcm-s16le',1),('forwardOutput','pcm-f32le',1)]]
    if len({r[k]['frames'] for k in ['input','output','forwardOutput']})!=1 or r['input']['frames']<52920:raise ValueError('unsupported signal frames/history length')
    clock=r.get('firstSampleContextSeconds')
    if type(clock) not in (int,float) or not math.isfinite(clock) or clock<0:raise ValueError('invalid frame clock')
    return r,blobs[0]

def accept_history(fit):
    pitches=fit.get('pitches');raw=fit.get('rawResidual')
    if pitches is None or not pitches or not isinstance(raw,(int,float)) or not math.isfinite(raw) or raw>.05 or raw<0:return None
    support=fit.get('support')
    if not isinstance(support,dict) or support.get('status')!='supported':return None
    if fit.get('unresolvedWeakCandidates') or any(0<e['amplitude']<.05 for e in fit.get('events',[])):return None
    if len(pitches)>8 or pitches!=sorted(set(pitches)) or any(type(x) is not int or not 21<=x<=108 for x in pitches):raise ValueError('invalid fitted pitch inventory')
    return pitches

def profile_identity(value):
    if not isinstance(value,dict) or set(value)!={'threshold','knee','ratio','attack','release'} or any(type(x) not in (int,float) or not math.isfinite(x) for x in value.values()):raise ValueError('invalid compressor profile')
    return {k:struct.unpack('<f',struct.pack('<f',v))[0] for k,v in value.items()}

def dictionary_identity(bank_sha):
    algorithm = Path(__file__).with_name('player_history_search.py').read_bytes() + Path(__file__).with_name('player_pitch_support.py').read_bytes() + DEFAULT_POLICY.sha256().encode('ascii')
    return {'bankSha256':bank_sha,'algorithmSha256':digest(algorithm),'method':'player-input-v1'}

def validate_dictionary(directory, expected):
    d=Path(directory)
    if not (d/'identity.json').is_file():raise ValueError('partial dictionary')
    receipt=read_json(d/'identity.json')
    if receipt.get('identity')!=expected:raise ValueError('stale dictionary identity')
    files=receipt.get('files',[])
    names={f'{start:04d}-{suffix}.npy' for start in range(0,1760,16) for suffix in ('fft','norm')}
    if len(files)!=220 or {p.get('name') for p in files}!=names:raise ValueError('partial dictionary inventory')
    total=0
    for pin in files:
        path=d/pin['name']
        if path.is_symlink() or not path.is_file() or path.stat().st_size!=pin['bytes']:raise ValueError('partial dictionary file')
        total+=pin['bytes']
        if total>MAX_BANK_BYTES:raise ValueError('dictionary bound')
        h=hashlib.sha256()
        with path.open('rb') as f:
            for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
        if h.hexdigest()!=pin['sha256']:raise ValueError('stale dictionary hash')
    return receipt

def bank(path):
    r=read_json(path)
    if r.get('kind')!='keyspilli-player-reference-bank' or r.get('schemaVersion')!=1 or r.get('localUsePermission') is not True or not isinstance(r.get('rightsSource'),str) or not r['rightsSource']:raise ValueError('pinned local-use permission and rights source required')
    pins=r['references']
    if len(pins)!=440 or {(p['midi'],p['velocity']) for p in pins}!={(m,v) for m in range(21,109) for v in [32,56,76,92,112]}:raise ValueError('full 440-reference inventory required')
    import numpy as np
    waves=[];n=52920
    for pin in pins:
        b=signal(pin,'pcm-f32le',2)
        if pin.get('referenceAlignmentSeconds')!=.05:raise ValueError('unsupported reference alignment')
        x=np.frombuffer(b[44:],dtype='<f4').reshape(-1,2);grid=np.arange(len(x));pos=np.arange(n)+.05*44100
        wave=np.column_stack([np.interp(pos,grid,x[:,ch],left=0,right=0) for ch in range(2)]).astype(np.float32)
        if np.max(np.abs(wave))==0:raise ValueError('silent reference')
        waves.append(wave)
    return r,waves

def build_dictionary(reference_manifest,output):
    """Explicit generation only; never called by analyze_player_input."""
    d=Path(output)
    if not d.is_absolute() or d.exists():raise FileExistsError('new absolute dictionary directory required')
    r,refs=bank(reference_manifest)
    import numpy as np
    from scipy.fft import rfft,next_fast_len
    n=52920;fftlen=next_fast_len(2*n-1);ages=np.arange(n,dtype=np.float32)/44100;labels=[(i,d) for i in range(440) for d in [.15,.3,.6,None]]
    d.mkdir(mode=0o700);files=[];total=sum(Path(pin['path']).stat().st_size for pin in r['references'])
    for start in range(0,len(labels),16):
        stats=os.statvfs(d)
        if stats.f_bavail*stats.f_frsize<30*1024**3:raise RuntimeError('disk reserve below 30GiB')
        waves=[refs[i]*(np.ones(n,dtype=np.float32) if duration is None else np.clip(1-(ages-duration)/.5,0,1))[:,None] for i,duration in labels[start:start+16]]
        spectrum=np.stack([rfft(w[::-1],fftlen,axis=0).astype(np.complex64) for w in waves]);norm=np.sqrt(np.maximum(np.stack([np.cumsum(np.sum(w*w,axis=1),dtype=np.float32)[::-1] for w in waves]),1e-20))
        for suffix,data in [('fft',spectrum),('norm',norm)]:
            file=d/f'{start:04d}-{suffix}.npy'
            with file.open('xb') as handle:np.save(handle,data,allow_pickle=False)
            b=bounded(file,64*1024*1024);total+=len(b)
            if total>MAX_BANK_BYTES:raise ValueError('dictionary cap exceeded')
            files.append({'name':file.name,'sha256':digest(b),'bytes':len(b)})
        del waves,spectrum,norm
    identity=dictionary_identity(digest(bounded(reference_manifest,1024*1024)))
    staging=d/'.identity.partial'
    with staging.open('x') as handle:
        handle.write(json.dumps({'identity':identity,'files':files},sort_keys=True)+'\n');handle.flush();os.fsync(handle.fileno())
    os.replace(staging,d/'identity.json')
    return identity

def analyze_player_input(request):
    if not isinstance(request,dict) or set(request)!={'captureManifestPath','referenceManifestPath','dictionaryDir'}:raise ValueError('unsupported request keys; no target score context')
    started=time.monotonic();r,input_bytes=capture(request['captureManifestPath']);b,refs=bank(request['referenceManifestPath'])
    if r['renderer']!=b['renderer'] or profile_identity(r['compressor'])!=profile_identity(b['compressor']):raise ValueError('unsupported renderer/profile identity')
    assets={p['url']:p for p in b['sampleAssetPins']}
    if not r['sampleAssetPins'] or any(assets.get(p['url'])!=p for p in r['sampleAssetPins']):raise ValueError('unsupported sample assets')
    bank_sha=digest(bounded(request['referenceManifestPath'],1024*1024));cache=validate_dictionary(Path(request['dictionaryDir']),dictionary_identity(bank_sha))
    if sum(p['bytes'] for p in cache['files'])+sum(Path(p['path']).stat().st_size for p in b['references'])>MAX_BANK_BYTES:raise ValueError('combined bank/dictionary bound')
    import numpy as np
    from player_history_search import PlayerHistorySearch
    fitted=PlayerHistorySearch(refs,b['references'],request['dictionaryDir']).fit(np.frombuffer(input_bytes[44:],dtype='<f4').reshape(-1,2))
    import resource
    peak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024)
    if peak>2*1024**3:raise ValueError('fit RSS exceeds 2GiB')
    fitted_support=fitted.get('support') if isinstance(fitted.get('support'),dict) else None
    if fitted_support and fitted_support.get('status') in {'supported','ambiguous'}:
        current_support=support_receipt(fitted_support['status'], DEFAULT_POLICY, fitted_support.get('minimumRemovalMargin'), fitted_support.get('minimumAlternativeMargin'))
    else:
        current_support=support_receipt('not-computed')
    pitches=accept_history(fitted)
    return {'schemaVersion':1,'kind':'keyspilli-player-input-evidence','captureSha256':digest(bounded(request['captureManifestPath'],1024*1024)),'inputSha256':r['input']['sha256'],'analyzerSha256':analyzer_identity(),'referenceBankSha256':bank_sha,'fitInterval':{'startSeconds':0,'endSeconds':1.2},'status':'matched' if pitches is not None else 'uncertain','support':current_support,'historyPitchCandidates':pitches,'rawResidual':fitted.get('rawResidual'),'currentPitchSetEstimate':None,'completeness':'unknown','audibility':'not-established','resources':{'elapsedSeconds':time.monotonic()-started,'peakRssBytes':peak},'limitations':LIMITATIONS}

def write_player_input_evidence(request,output):
    output=Path(output)
    if output.exists() or not output.is_absolute():raise FileExistsError('new absolute output directory required')
    receipt=analyze_player_input(request);output.mkdir(mode=0o700)
    with (output/'receipt.json').open('x') as f:json.dump(receipt,f,allow_nan=False,sort_keys=True,indent=2)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--request');parser.add_argument('--output',required=True);parser.add_argument('--build-dictionary',metavar='REFERENCE_MANIFEST');args=parser.parse_args()
    def offline(event,_args):
        if event in ('socket.connect','socket.getaddrinfo','socket.bind'):raise RuntimeError('offline Player analyzer')
    sys.addaudithook(offline)
    if args.build_dictionary:build_dictionary(str(Path(args.build_dictionary).resolve()),Path(args.output).resolve())
    elif args.request:write_player_input_evidence(read_json(str(Path(args.request).resolve())),Path(args.output).resolve())
    else:parser.error('--request or --build-dictionary required')
if __name__=='__main__':main()
