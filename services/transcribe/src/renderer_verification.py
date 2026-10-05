#!/usr/bin/env python3
"""Optional renderer-informed spectral activity; never independent source truth."""
import argparse
import json
import math

from music_analyzer import decode_pcm, deny_network, read_bounded, write_new


def check_bank(bank,templates):
    if not bank or not templates or any(t.get('bankSha256')!=bank for t in templates):raise ValueError('wrong or unknown template bank')
    pitches=[t['midi'] for t in templates]
    if len(set(pitches))!=len(pitches) or not all(type(p) is int and 0<=p<=127 for p in pitches):raise ValueError('invalid template pitch inventory')

def compare_activity(activity,expected):
    detected=sorted({n['midi'] for n in activity});target=set(expected)
    return {'activity':activity,'matchedPitches':sorted(target.intersection(detected)),'unexpectedPitches':sorted(set(detected)-target),'missingExpectedPitches':sorted(target-set(detected)),'origin':'renderer-informed','musicalAcceptance':'not-established','limitations':['Shared renderer/bank can share defects; blind acoustic channel remains separate','Pitch presence does not establish accurate offsets, repeated attacks or source fidelity']}

def template_matrix(templates,fs):
    import numpy as np
    import soxr
    if not 1<=len(templates)<=88:raise ValueError('template bound')
    size=round(fs*.128);window=np.hanning(size);columns=[]
    for template in templates:
        _midi,signal,sr=template[:3];attack=template[3] if len(template)==4 else 0
        if type(attack) not in (int,float) or not math.isfinite(attack) or attack<0:raise ValueError('invalid template attack alignment')
        waveform=soxr.resample(np.asarray(signal,dtype=np.float32),sr,fs,quality='HQ');offset=round(attack*fs)
        if len(template)==4 and offset+size>len(waveform):raise ValueError('template attack must leave a complete analysis window')
        waveform=np.pad(waveform[offset:],(0,max(0,size-len(waveform[offset:]))))[:size]
        spectrum=np.abs(np.fft.rfft(waveform*window));norm=np.linalg.norm(spectrum)
        if norm<=1e-10:raise ValueError('silent template')
        columns.append(spectrum/norm)
    return np.stack(columns,axis=1)

def fit_pitch_set(samples,rate,templates,threshold):
    """One128ms window;16kHz preserves the top of the piano's pitch range."""
    import numpy as np
    import soxr
    from scipy.optimize import nnls
    if not math.isfinite(threshold) or not 0<threshold<1:raise ValueError('explicit activity threshold required')
    fs=16000;size=2048
    audio=soxr.resample(np.asarray(samples,dtype=np.float32),rate,fs,quality='HQ')
    if len(audio)<size:raise ValueError('complete128ms audio window required')
    spectrum=np.abs(np.fft.rfft(audio[:size]*np.hanning(size)));norm=np.linalg.norm(spectrum)
    if norm<1e-6:raise ValueError('silent analysis window')
    coefficients,residual=nnls(template_matrix(templates,fs),spectrum,maxiter=len(templates)*5)
    strengths=[{'midi':t[0],'relativeCoefficient':float(c/norm)} for t,c in zip(templates,coefficients)]
    return {'pitches':sorted(t['midi'] for t in strengths if t['relativeCoefficient']>=threshold),
            'strengths':strengths,'residualRatio':float(residual/norm)}

def spectral_activity(samples,rate,templates,threshold):
    import numpy as np
    import soxr
    from scipy.optimize import nnls
    if not math.isfinite(threshold) or not 0<threshold<1:raise ValueError('explicit activity threshold required')
    fs=8000;size=1024;hop=160;window=np.hanning(size)
    audio=soxr.resample(np.asarray(samples,dtype=np.float32),rate,fs,quality='HQ')
    matrix=template_matrix(templates,fs);activity=[];residuals=[];active=set()
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
        _,data,meta=decode_pcm(t['path'],t['sha256']);templates.append((t['midi'],data,meta['sampleRate'],t['attackSeconds']) if 'attackSeconds' in t else (t['midi'],data,meta['sampleRate']))
    activity,residuals=spectral_activity(mono,info['sampleRate'],templates,request['activityThreshold']);result=compare_activity(activity,request.get('expectedPitches',[]));result.update(schemaVersion=1,kind='keyspilli-renderer-verification',status='ok',audioSha256=info['sha256'],templateBankSha256=request['bankSha256'],templatePins=request['templates'],unexpectedPitchSearch='all registered templates',residualRatios=residuals,configuration={'activityThreshold':request['activityThreshold'],'frameSeconds':0.128,'hopSeconds':0.02,'rate':8000})
    write_new(args.output,result)
if __name__=='__main__':main()
