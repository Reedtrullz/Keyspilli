#!/usr/bin/env python3
"""Optional renderer-informed spectral activity; never independent source truth."""
import argparse, json, math
from pathlib import Path
from music_analyzer import decode_pcm, read_bounded, write_new, digest, deny_network

def check_bank(bank,templates):
    if not bank or not templates or any(t.get('bankSha256')!=bank for t in templates):raise ValueError('wrong or unknown template bank')
    pitches=[t['midi'] for t in templates]
    if len(set(pitches))!=len(pitches) or not all(type(p) is int and 0<=p<=127 for p in pitches):raise ValueError('invalid template pitch inventory')

def compare_activity(activity,expected):
    detected=sorted({n['midi'] for n in activity});target=set(expected)
    return {'activity':activity,'matchedPitches':sorted(target.intersection(detected)),'unexpectedPitches':sorted(set(detected)-target),'missingExpectedPitches':sorted(target-set(detected)),'origin':'renderer-informed','musicalAcceptance':'not-established','limitations':['Shared renderer/bank can share defects; blind acoustic channel remains separate','Pitch presence does not establish accurate offsets, repeated attacks or source fidelity']}

def spectral_activity(samples,rate,templates,threshold):
    import numpy as np
    from scipy.optimize import nnls
    import soxr
    if not math.isfinite(threshold) or not 0<threshold<1:raise ValueError('explicit activity threshold required')
    if len(templates)>88:raise ValueError('template bound')
    fs=8000;size=1024;hop=160;window=np.hanning(size)
    audio=soxr.resample(np.asarray(samples,dtype=np.float32),rate,fs,quality='HQ');columns=[]
    for midi,signal,sr in templates:
        waveform=soxr.resample(np.asarray(signal,dtype=np.float32),sr,fs,quality='HQ');waveform=np.pad(waveform,(0,max(0,size-len(waveform))))[:size]
        spectrum=np.abs(np.fft.rfft(waveform*window));norm=np.linalg.norm(spectrum)
        if norm<=1e-10:raise ValueError('silent template')
        columns.append(spectrum/norm)
    matrix=np.stack(columns,axis=1);activity=[];residuals=[];active=set()
    for start in range(0,len(audio),hop):
        segment=np.pad(audio[start:start+size],(0,max(0,size-len(audio[start:start+size]))));spectrum=np.abs(np.fft.rfft(segment*window));norm=np.linalg.norm(spectrum)
        if norm<1e-6:active=set();continue
        coefficients,residual=nnls(matrix,spectrum,maxiter=len(templates)*5);residuals.append(float(residual/norm))
        now={i for i,c in enumerate(coefficients) if c/norm>=threshold}
        for i in sorted(now-active):activity.append({'midi':templates[i][0],'startSeconds':start/fs,'strength':float(coefficients[i]/norm)})
        active=now
    return activity,residuals

def main():
    import sys
    parser=argparse.ArgumentParser();parser.add_argument('--request',required=True);parser.add_argument('--output',required=True);args=parser.parse_args();sys.addaudithook(deny_network)
    request=json.loads(read_bounded(args.request,65536));check_bank(request['bankSha256'],request['templates']);_,mono,info=decode_pcm(request['audioPin']['path'],request['audioPin']['sha256']);templates=[]
    for t in request['templates']:
        _,data,meta=decode_pcm(t['path'],t['sha256']);templates.append((t['midi'],data,meta['sampleRate']))
    activity,residuals=spectral_activity(mono,info['sampleRate'],templates,request['activityThreshold']);result=compare_activity(activity,request.get('expectedPitches',[]));result.update(schemaVersion=1,kind='keyspilli-renderer-verification',status='ok',audioSha256=info['sha256'],templateBankSha256=request['bankSha256'],templatePins=request['templates'],unexpectedPitchSearch='all registered templates',residualRatios=residuals,configuration={'activityThreshold':request['activityThreshold'],'frameSeconds':0.128,'hopSeconds':0.02,'rate':8000})
    write_new(args.output,result)
if __name__=='__main__':main()
