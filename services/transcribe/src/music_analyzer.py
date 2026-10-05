#!/usr/bin/env python3
"""Opt-in, local-only PCM analyzer. Dependencies and weights are acquired separately."""
import argparse, array, hashlib, json, math, os, resource, struct, sys, time, wave
from pathlib import Path

class Unavailable(Exception):
    pass

def digest(data):
    return hashlib.sha256(data).hexdigest()

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()

def read_bounded(path, maximum=2*1024*1024):
    with Path(path).open('rb') as handle:
        if not os.path.isfile(path):raise ValueError('regular file required')
        data=handle.read(maximum+1)
    if len(data)>maximum:raise ValueError('file exceeds limit')
    return data

def decode_pcm(path, expected_hash):
    import io
    raw=read_bounded(path)
    if digest(raw)!=expected_hash:raise ValueError('changed audio hash')
    with wave.open(io.BytesIO(raw),'rb') as w:
        rate,channels,frames=w.getframerate(),w.getnchannels(),w.getnframes()
        if w.getsampwidth()!=2 or w.getcomptype()!='NONE' or channels not in (1,2) or not 8000<=rate<=48000 or not 0<frames<=rate*30:raise ValueError('unsupported PCM16')
        data=w.readframes(frames)
    if len(data)!=frames*channels*2:raise ValueError('truncated PCM')
    channel_data=[tuple(x/32768 for x in row) for row in struct.iter_unpack('<'+'h'*channels,data)]
    mono=[sum(row)/channels for row in channel_data]
    floats=array.array('f',mono)
    if sys.byteorder!='little':floats.byteswap()
    return channel_data,mono,{'sha256':expected_hash,'sampleRate':rate,'channels':channels,'frames':frames,'durationSeconds':frames/rate,'derivativeSha256':digest(floats.tobytes())}

def check_request(request):
    if request.get('model') not in ('basic-pitch','transkun','hft') or request.get('timeoutSeconds')!=120:raise ValueError('unsupported analyzer request')
    identity=request['analyzerIdentity'];config=identity['config']
    if digest(canonical(config))!=identity['configSha256']:raise ValueError('changed analyzer config')
    if digest(Path(__file__).read_bytes())!=identity['codeSha256']:raise ValueError('changed worker code')
    frontend=config.get('frontend')
    if frontend!={'decode':'pcm16-le','channels':'mean-mono','precision':'float32','resampling':'soxr-HQ'} or digest(canonical(frontend))!=identity['frontendSha256']:raise ValueError('unsupported frontend identity')
    if identity['device']!='cpu' or identity['precision']!='float32':raise Unavailable('Only explicit CPU float32 qualified by this adapter')
    return request

def check_assets(config):
    path=config.get('checkpointPath')
    if not path or not Path(path).is_file():raise Unavailable('Missing explicit local checkpoint; no download attempted')
    raw=read_bounded(path,512*1024*1024)
    if digest(raw)!=config['checkpointSha256']:raise ValueError('changed checkpoint')
    return Path(path)

def normalize_rows(rows,duration):
    notes=[];rejected=0
    for row in rows:
        start,end,pitch,confidence=row
        if not (type(pitch) is int and 0<=pitch<=127 and math.isfinite(start) and 0<=start<duration and math.isfinite(end) and start<=end<=duration and (confidence is None or math.isfinite(confidence) and 0<=confidence<=1)):
            rejected+=1;continue
        # Backend endpoints do not establish comparable key-release/pedal semantics.
        notes.append({'id':f'n{len(notes)}','midi':pitch,'onsetSeconds':start,'keyOffsetSeconds':None,'soundingOffsetSeconds':None,'confidence':confidence})
    if len(notes)>20000:raise ValueError('note inventory limit')
    return notes,rejected

def infer(request, mono, rate):
    identity=request['analyzerIdentity'];config=identity['config'];checkpoint=check_assets({**config,'checkpointSha256':identity['checkpointSha256']})
    if request['model']=='hft':raise Unavailable('hFT conversion/reference parity required; not an enabled fallback')
    manifest_path=config.get('backendManifestPath')
    if not manifest_path:raise Unavailable('Explicit backend code/runtime manifest required')
    manifest_bytes=read_bounded(manifest_path,1024*1024)
    if digest(manifest_bytes)!=config.get('backendManifestSha256'):raise ValueError('changed backend manifest')
    manifest=json.loads(manifest_bytes)
    import importlib.metadata
    for package,version in manifest['runtimeVersions'].items():
        if importlib.metadata.version(package)!=version:raise ValueError('changed runtime dependency '+package)
    for pin in manifest['files']:
        if digest(read_bounded(pin['path']))!=pin['sha256']:raise ValueError('changed backend code '+pin['path'])
    import numpy as np
    import soxr
    if request['model']=='basic-pitch':
        from basic_pitch.inference import Model, run_inference
        from basic_pitch.note_creation import model_output_to_notes
        import importlib.metadata
        if importlib.metadata.version('basic-pitch')!=identity['version']:raise ValueError('runtime package version mismatch')
        samples=soxr.resample(np.asarray(mono,dtype=np.float32),rate,22050,quality='HQ')
        model=Model(checkpoint)
        # Supply the decoded derivative; prevent a second implicit decoder/frontend.
        from basic_pitch import inference
        old=inference.librosa.load
        try:
            inference.librosa.load=lambda *args,**kwargs:(samples,22050)
            output=run_inference('explicit-decoded-derivative.wav',model,debug_file=None)
        finally:inference.librosa.load=old
        options=config.get('noteOptions')
        if not isinstance(options,dict) or 'onset_thresh' not in options or 'frame_thresh' not in options:raise ValueError('explicit Basic Pitch thresholds required')
        if model.model_type != Model.MODEL_TYPES.ONNX:raise ValueError('explicit ONNX runtime required')
        _,events=model_output_to_notes(output,**options)
        rows=[(float(start),float(end),int(pitch),float(amplitude)) for start,end,pitch,amplitude,*_ in events]
    else:
        import torch, moduleconf, importlib.metadata
        if importlib.metadata.version('transkun')!=identity['version']:raise ValueError('runtime package version mismatch')
        conf_path=config.get('modelConfigPath')
        if not conf_path or digest(read_bounded(conf_path))!=config.get('modelConfigSha256'):raise ValueError('changed Transkun model configuration')
        manager=moduleconf.parseFromFile(conf_path);entry=manager['Model'];model=entry.module.TransKun(conf=entry.config).to('cpu')
        weights=torch.load(str(checkpoint),map_location='cpu',weights_only=True)
        model.load_state_dict(weights.get('best_state_dict',weights.get('state_dict')),strict=True);model.eval()
        samples=soxr.resample(np.asarray(mono,dtype=np.float32),rate,model.fs,quality='HQ')
        with torch.inference_mode():events=model.transcribe(torch.from_numpy(samples[:,None]),stepInSecond=config.get('segmentHopSize'),segmentSizeInSecond=config.get('segmentSize'),discardSecondHalf=False)
        rows=[(float(n.start),float(n.end),int(n.pitch),None) for n in events]
    return rows,digest(np.asarray(samples,dtype='<f4').tobytes())

def analyze(request):
    started=time.monotonic();audio={k:v for k,v in request['audioPin'].items() if k!='path'};status='failed';notes=[];rejected=0;limitations=[]
    try:
        check_request(request);_,mono,measured=decode_pcm(request['audioPin']['path'],audio['sha256'])
        for key in ('sampleRate','channels','frames','durationSeconds'):
            if audio[key]!=measured[key]:raise ValueError('audio clock pin mismatch')
        rows,derivative=infer(request,mono,measured['sampleRate']);audio['derivativeSha256']=derivative
        notes,rejected=normalize_rows(rows,measured['durationSeconds']);status='ok'
        limitations=['Uncalibrated confidence; offsets and tempo/key/meter unqualified','Mono derivative explicitly decoded; original channels preserved']
    except (Unavailable,ImportError) as exc:status='unavailable';limitations=[str(exc)]
    except Exception as exc:limitations=[type(exc).__name__+': '+str(exc)]
    rss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024)
    return {'schemaVersion':1,'kind':'keyspilli-acoustic-receipt','status':status,'audio':audio,'analyzer':request['analyzerIdentity'],'notes':notes,'rejectedRows':rejected,'metadata':{'tempoBpm':None,'key':None,'meter':None,'origin':'unknown'},'resources':{'elapsedSeconds':time.monotonic()-started,'peakRssBytes':rss},'limitations':limitations}

def write_new(path,value):
    with Path(path).open('x') as handle:json.dump(value,handle,allow_nan=False,sort_keys=True);handle.write('\n')

def deny_network(event,args):
    if event in ('socket.connect','socket.getaddrinfo'):raise RuntimeError('Analyzer network disabled')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--request',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    request=json.loads(read_bounded(args.request,65536));sys.addaudithook(deny_network)
    os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',OMP_NUM_THREADS='1')
    import signal
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(TimeoutError('Analyzer deadline')));signal.alarm(120)
    result=analyze(request);write_new(args.output,result)
    return 0 if result['status']=='ok' else 1
if __name__=='__main__':raise SystemExit(main())
