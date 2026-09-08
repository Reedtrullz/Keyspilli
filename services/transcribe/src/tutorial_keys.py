"""Experimental colored-keyboard extraction for the isolated development preview.

Requires the separately installed lumachords==0.1.4 environment (Apache-2.0).
Reuses its keyboard geometry only, and Keyspilli's accepted key-light detector.
Source rights and melody inclusion are unknown; this command never publishes.
"""
import argparse
import asyncio
import hashlib
import json
import math
import subprocess
from pathlib import Path
import numpy as np


def key_events(rgb, fps, pitch):
    a=rgb.astype('int16')
    blue=(a[:,:,2]-a[:,:,0]>35)&(a[:,:,1]-a[:,:,0]>12)&(a[:,:,2]>85)
    green=(a[:,:,1]-a[:,:,0]>35)&(a[:,:,1]-a[:,:,2]>25)&(a[:,:,1]>85)
    yellow=(a[:,:,0]-a[:,:,2]>70)&(a[:,:,1]-a[:,:,2]>55)&(a[:,:,0]>120)&(a[:,:,1]>100)
    purple=(a[:,:,0]-a[:,:,1]>18)&(a[:,:,2]-a[:,:,1]>18)&(a[:,:,0]>100)&(a[:,:,2]>110)&(a[:,:,1]>60)
    red=(a[:,:,0]>120)&(a[:,:,0]-a[:,:,1]>50)&(a[:,:,0]-a[:,:,2]>50)
    colors={'blue':blue,'green':green,'yellow':yellow,'purple':purple,'red':red}
    supported=blue|green|yellow|purple|red
    unknown=((a.max(axis=2)-a.min(axis=2)>80)&(a.max(axis=2)>100)&~supported).sum(axis=1)>=2
    for start,end in np.flatnonzero(np.diff(np.r_[False,unknown,False])).reshape(-1,2):
        if (end-start)/fps>=.06:raise ValueError(f'Unsupported key color at pitch {pitch}, {start/fps:.3f}s')
    active=supported.sum(axis=1)>=2
    notes=[]
    for start,end in np.flatnonzero(np.diff(np.r_[False,active,False])).reshape(-1,2):
        if (end-start)/fps>=.06:
            notes.append({'midi':pitch,'startSec':float(start/fps),'durationSec':float((end-start)/fps),
                          'color':max(colors,key=lambda color:colors[color][start:end].sum())})
    return notes


def validate_geometry(c,width,height,allow_relative=False):
    pitches=[k['midi_num'] for k in c['keys']]
    relative=allow_relative and 25<=len(pitches)<88 and pitches==list(range(pitches[0],pitches[0]+len(pitches)))
    if pitches!=list(range(21,109)) and not relative:
        raise ValueError('An unambiguous complete 88-key keyboard is required')
    x,y,w,h=c['bounds'];edges=np.asarray(c['edges'])
    if not (0<=x<x+w<=width and 0<y<y+h<=height) or edges.shape!=(len(pitches),2):
        raise ValueError('Invalid keyboard bounds')
    if not np.isfinite(edges).all() or np.any(edges[:,0]>=edges[:,1]) or np.any(edges<0) or np.any(edges>w):
        raise ValueError('Invalid key edges')
    if np.any(np.diff(edges.mean(axis=1))<=0):raise ValueError('Keys are not ordered')


def geometry_matches(a,b,width):
    if len(a['keys'])!=len(b['keys']):return False
    if [k['midi_num'] for k in a['keys']]!=[k['midi_num'] for k in b['keys']]:return False
    tolerance=max(1,2*width/1280)
    ax,ay,aw,ah=a['bounds'];bx,by,bw,bh=b['bounds']
    edge_a=np.asarray(a['edges']);edge_b=np.asarray(b['edges']);difference=abs(edge_a-edge_b)
    # Only the outer image endpoints can fluctuate with compression/cropping.
    boundary_tolerance=max(tolerance,4*width/1280)
    if max(abs(edge_a[0,0]),abs(edge_b[0,0]))<=boundary_tolerance:difference[0,0]=0
    if max(abs(edge_a[-1,1]-aw),abs(edge_b[-1,1]-bw))<=boundary_tolerance:difference[-1,1]=0
    # Strike-line glow can extend the detected top; columns and the bottom must stay fixed.
    return (max(abs(ax-bx),abs(aw-bw),abs(ay+ah-by-bh))<=tolerance
            and abs(ay-by)<=max(tolerance,min(12,.15*ah))
            and np.max(difference)<=tolerance)


def clip_boundary_keys(edges,width):
    """A cropped keyboard may expose only part of its first/last key."""
    result=np.asarray(edges).copy()
    for i,(left,right) in enumerate(result):
        if left<0 or right>width:
            if i not in (0,len(result)-1):raise ValueError('Interior key extends outside keyboard')
            left=max(0,left);right=min(width,right)
            if right-left<3:raise ValueError('Boundary key too narrow to sample')
            result[i]=[left,right]
    return result.tolist()


async def detect_geometry(frame,width,height,allow_relative):
    import cv2
    from lumachords.keybed_detector import KeybedDetector
    from lumachords.image_input import ImagePreprocessor
    from lumachords.preferences import Preferences
    from lumachords.runtime_config import RuntimeConfig,AppMode,ProdMode,LogLevel
    scale=1280/width
    frame=cv2.resize(frame,(1280,round(height*scale)))
    detector=KeybedDetector(Preferences(),RuntimeConfig(AppMode.HEADLESS,ProdMode.PROD,LogLevel.LOGLEVEL_NONE))
    detector.init_state()
    result=await detector.detect(await ImagePreprocessor.preprocess_for_keybed(frame))
    if result.evaluation_result is not None:raise ValueError(str(result.evaluation_result))
    c={'bounds':[round(v/scale) for v in result.keybed_bounds],
       'keys':[{'midi_num':int(k['midi_num']),'color':k['color']} for k in result.all_keys_data],
       'edges':np.round(result.all_keys_edge/scale).astype(int).tolist()}
    if allow_relative and len(c['keys'])<88:
        c['edges']=clip_boundary_keys(c['edges'],c['bounds'][2])
    validate_geometry(c,width,height,allow_relative)
    return c


async def calibrate(video,width,height,allow_relative=False):
    import cv2
    cap=cv2.VideoCapture(str(video));candidates=[];attempts=[]
    try:
        for second in [0,1,2,4,8,12,16,24]:
            cap.set(cv2.CAP_PROP_POS_MSEC,second*1000);ok,frame=cap.read()
            if not ok:continue
            try:c=await detect_geometry(frame,width,height,allow_relative)
            except ValueError as e:
                attempts.append({'second':second,'reason':str(e)});continue
            for prior_time,prior in candidates:
                if geometry_matches(c,prior,width):
                    return {**prior,'framesSeconds':[prior_time,second],'attempts':attempts}
            candidates.append((second,c))
    finally:cap.release()
    raise ValueError('No consistent keyboard calibration: '+json.dumps(attempts))


async def verify_layout(video,c,meta,notes):
    """Sample throughout active playback; a moved or unrecognizable keyboard rejects.

    ponytail: ten-second checks bound detector cost; not proof against sub-second edits.
    """
    import cv2
    start,end=meta.get('audioActiveBounds',[min(n['startSec'] for n in notes),max(n['startSec']+n['durationSec'] for n in notes)])
    samples=sorted(set([start+(end-start)*.5]+list(np.arange(start+.1,end,10))))
    cap=cv2.VideoCapture(str(video));checked=[]
    try:
        for second in samples:
            matched=False;failures=[]
            for offset in [0,.5]:
                when=min(second+offset,end-.01)
                cap.set(cv2.CAP_PROP_POS_MSEC,when*1000);ok,frame=cap.read()
                if not ok:continue
                try:observed=await detect_geometry(frame,meta['width'],meta['height'],True)
                except ValueError as e:failures.append(str(e));continue
                if geometry_matches(c,observed,meta['width']):matched=True;checked.append(float(when));break
                failures.append('Keyboard geometry changed')
            if not matched:raise ValueError(f'Unstable keyboard layout at {second:.2f}s: '+str(failures))
    finally:cap.release()
    return {'sampleSeconds':checked,'maxSampleGapSeconds':10,'status':'sampled-stable','coverageOwner':'audio' if 'audioActiveBounds' in meta else 'extracted-notes-only'}


def extract(video,c,meta):
    fps=meta['fps'];width=meta['width'];x,y,_,height=c['bounds']
    # Sample black keys above their ends and white keys below them; avoid glow at the strike line.
    scanlines=[round(y+.3*height),round(y+.8*height)];rows=[]
    max_frames=math.ceil(meta['duration']*fps)+2
    if max_frames*width*3*2>256*1024**2:raise ValueError('Scan data exceeds 256MiB budget')
    for row in scanlines:
        raw=subprocess.check_output(['ffmpeg','-nostdin','-v','error','-i',str(video),'-vf',
            f'setpts=PTS-STARTPTS,fps={fps},format=rgb24,crop={width}:1:0:{row}',
            '-frames:v',str(max_frames),'-f','rawvideo','-'],timeout=120)
        rows.append(np.frombuffer(raw,np.uint8).reshape(-1,width,3))
    if len(rows[0])!=len(rows[1]):raise ValueError('Scan frame counts differ')
    notes=[]
    for key,(left,right) in zip(c['keys'],c['edges']):
        center=round(x+(left+right)/2)
        if center<1 or center+1>=width:raise ValueError('Key sampling falls outside frame')
        rgb=rows[0 if key['color']=='b' else 1][:,center-1:center+2]
        notes.extend(key_events(rgb,fps,key['midi_num']))
    if not notes:raise ValueError('No supported blue/green/yellow/purple/red key lights detected')
    return sorted(notes,key=lambda n:(n['startSec'],n['midi'])),scanlines


def terminal_outro_start(notes,audio,duration,rate=22050):
    """A terminal audio restart after silence is only a candidate, not permission to trim."""
    if not notes or not len(audio) or not np.isfinite(audio).all():return None
    size=round(rate*.5);count=len(audio)//size
    if not count:return None
    rms=np.sqrt(np.mean(audio[:count*size].reshape(count,size).astype(float)**2,axis=1))
    active=rms>max(1e-5,float(rms.max())*.03)
    last=max(n['startSec']+n['durationSec'] for n in notes)
    later=np.flatnonzero(active & (np.arange(count)*.5>last+2))
    if not len(later):return None
    i=int(later[0]);start=i*.5;tail=duration-start
    if not 0<tail<=min(30,duration*.15) or i<4:return None
    if active[i-4:i].any() or not (rms[i-4:i]<=1e-4).any():return None
    # No notes are removed, and unexplained earlier music still reaches audio_coverage.
    return start


def frame_vertical_edges(frame):
    """Look across the full frame for repeated boundaries persisting vertically."""
    import cv2
    gray=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY).astype('int16')
    edges=np.abs(np.diff(gray,axis=1))>50
    height=max(4,round(frame.shape[0]*16/720))
    sums=np.vstack([np.zeros((1,edges.shape[1]),dtype=np.int32),np.cumsum(edges,axis=0)])
    return int(edges.sum(axis=1).max()),int(((sums[height:]-sums[:-height])>=height*.8).sum(axis=1).max())


async def verify_terminal_outro(video,c,meta,notes,audio):
    """Exclude only a bounded audio restart over a continuously absent keyboard."""
    import cv2
    start=terminal_outro_start(notes,audio,meta['duration'])
    if start is None:return None
    cap=cv2.VideoCapture(str(video));x,y,w,h=c['bounds'];row=round(y+.8*h)
    def contrast(frame):
        line=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)[row,x:x+w].astype('int16')
        return int((np.abs(np.diff(line))>50).sum())
    try:
        baselines=[];vertical_baselines=[]
        for second in c['framesSeconds']:
            cap.set(cv2.CAP_PROP_POS_MSEC,second*1000);ok,frame=cap.read()
            if not ok:return None
            baselines.append(contrast(frame));vertical_baselines.append(frame_vertical_edges(frame)[1])
        baseline=min(baselines)
        if baseline<20 or min(vertical_baselines)<32:return None
        vertical_limit=min(32,min(vertical_baselines)*.5)
        cap.set(cv2.CAP_PROP_POS_MSEC,start*1000)
        frames=0;max_edges=0;max_row_edges=0;max_vertical_edges=0;checks=[];last_frame=None
        while True:
            ok,frame=cap.read()
            if not ok:break
            last_frame=frame;when=start+frames/meta['fps'];edges=contrast(frame)
            max_edges=max(max_edges,edges)
            row_edges,vertical_edges=frame_vertical_edges(frame)
            max_row_edges=max(max_row_edges,row_edges);max_vertical_edges=max(max_vertical_edges,vertical_edges)
            if vertical_edges>=vertical_limit:return None
            if edges>max(2,baseline*.1):return None
            if frames % max(1,round(meta['fps']*2))==0:
                try:await detect_geometry(frame,meta['width'],meta['height'],True)
                except ValueError:checks.append(float(when))
                else:return None
            frames+=1
        if frames<max(1,math.floor((meta['duration']-start)*meta['fps'])-2) or last_frame is None:return None
        try:await detect_geometry(last_frame,meta['width'],meta['height'],True)
        except ValueError:checks.append(float(min(meta['duration'],start+frames/meta['fps'])))
        else:return None
        quiet=audio[round((start-2)*22050):round(start*22050)].reshape(4,11025)
        quiet_rms=np.sqrt(np.mean(quiet.astype(float)**2,axis=1))
        bins=audio[:len(audio)//11025*11025].reshape(-1,11025)
        threshold=max(1e-5,float(np.sqrt(np.mean(bins.astype(float)**2,axis=1)).max())*.03)
        return {'status':'excluded-nonkeyboard-terminal-audio','excludedRangeSeconds':[start,meta['duration']],
                'relativeQuietBeforeSeconds':2,'quietRmsMaximum':float(quiet_rms.max()),'relativeQuietRmsThreshold':threshold,
                'nearZeroDurationSeconds':float((quiet_rms<=1e-4).sum()*.5),'nearZeroRmsThreshold':1e-4,'baselineContrastEdges':baseline,
                'maximumAnyRowContrastEdges':max_row_edges,'maximumPersistentVerticalEdges':max_vertical_edges,
                'persistentVerticalEdgeRejectThreshold':vertical_limit,
                'maximumTailContrastEdges':max_edges,'framesChecked':frames,'geometryAbsentSamplesSeconds':checks,
                'interpretation':'separate nonkeyboard outro; not proof of musical completeness'}
    finally:cap.release()


def audio_coverage(notes,audio,rate=22050):
    if not np.isfinite(audio).all():raise ValueError('Invalid audio samples')
    size=round(rate*.5);count=len(audio)//size
    if not count:raise ValueError('Decoded tutorial audio required for completeness verification')
    rms=np.sqrt(np.mean(audio[:count*size].reshape(count,size).astype(float)**2,axis=1))
    active=rms>max(1e-5,float(rms.max())*.03)
    indices=np.flatnonzero(active)
    if not len(indices):raise ValueError('Audible tutorial audio required for completeness verification')
    covered=np.zeros(count,dtype=bool)
    for n in notes:
        start=max(0,int(n['startSec']/.5));end=min(count,math.ceil((n['startSec']+n['durationSec']+2)/.5))
        covered[start:end]=True
    missing=active&~covered
    runs=np.flatnonzero(np.diff(np.r_[False,missing,False])).reshape(-1,2)
    gaps=[{'startSec':float(a*.5),'durationSec':float((b-a)*.5)} for a,b in runs if b-a>=8]
    if gaps:raise ValueError('Unexplained audio without extracted notes: '+json.dumps(gaps))
    return {'status':'checked','activeBounds':[float(indices[0]*.5),float((indices[-1]+1)*.5)],'maxUnexplainedGapSeconds':4}


def acoustic_octave(notes,audio,rate=22050):
    """Resolve only a global octave shift; never invent pitches or change timing.

    ponytail: spectral fundamentals suffice for clean piano tutorials; reject
    ambiguous/polyphonic evidence instead of enabling general audio transcription.
    """
    offsets=[o for o in range(-36,49,12) if all(21<=n['midi']+o<=108 for n in notes)]
    frequencies=np.fft.rfftfreq(8192,1/rate);rows=[];pitches=set()
    eligible=[n for n in notes if n['durationSec']>=.25]
    starts=np.array([n['startSec'] for n in notes]);ends=np.array([n['startSec']+n['durationSec'] for n in notes])
    pitches_all=np.array([n['midi'] for n in notes])
    # Anchor on the top voice: accompaniment harmonics otherwise double-count the same sounding pitch.
    for n in eligible[::max(1,len(eligible)//480)]:
        if np.any((pitches_all>n['midi'])&(starts<n['startSec']+.23)&(ends>n['startSec']+.04)):continue
        start=round((n['startSec']+.04)*rate);frame=audio[start:start+4096]
        if len(frame)!=4096 or np.sqrt(np.mean(frame**2))<1e-5:continue
        spectrum=abs(np.fft.rfft(frame*np.hanning(4096),8192))
        energies=[]
        for offset in offsets:
            f=440*2**((n['midi']+offset-69)/12)
            bins=abs(frequencies-f)<max(3,f*.012)
            energies.append(float(spectrum[bins].max(initial=0)))
        if max(energies,default=0)<=1e-7:continue
        rows.append(np.asarray(energies)/max(energies));pitches.add(n['midi']%12)
    if len(rows)<24 or len(pitches)<4 or len(offsets)<2:
        raise ValueError('Insufficient acoustic octave evidence')
    rows=np.asarray(rows);scores=np.median(rows,axis=0);order=np.argsort(scores)
    best=int(order[-1]);runner=int(order[-2]);agreement=float(np.mean(rows.argmax(axis=1)==best))
    # Require the same winner in both halves, not only one convenient passage.
    consistent=all(int(np.argmax(np.median(part,axis=0)))==best for part in np.array_split(rows,2))
    if not consistent or scores[best]<.75 or scores[runner]>.7 or scores[best]-scores[runner]<.18 or agreement<.6:
        raise ValueError('Ambiguous acoustic octave evidence: '+str(dict(zip(offsets,scores.tolist()))))
    return {'method':'piano-audio-fundamental-octave-comparison','semitones':offsets[best],
            'sampleCount':len(rows),'pitchClasses':len(pitches),'agreement':agreement,
            'scores':dict(zip(offsets,scores.tolist()))}


def save_midi(notes,path):
    import mido
    mid=mido.MidiFile(ticks_per_beat=960)
    # Color is provenance, not a claim about left/right hand or vocal melody.
    for channel,color in enumerate(sorted({n['color'] for n in notes})):
        track=mido.MidiTrack();mid.tracks.append(track)
        track.append(mido.MetaMessage('track_name',name=color+' keys'))
        track.append(mido.MetaMessage('set_tempo',tempo=500000))
        events=[]
        for n in notes:
            if n['color']!=color:continue
            events.extend([(n['startSec'],True,n['midi']),(n['startSec']+n['durationSec'],False,n['midi'])])
        previous=0
        for sec,on,pitch in sorted(events,key=lambda e:(e[0],e[1],e[2])):
            tick=round(sec*1920)
            track.append(mido.Message('note_on' if on else 'note_off',note=pitch,velocity=80 if on else 0,channel=channel,time=tick-previous));previous=tick
    mid.save(path)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('video',type=Path);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--audio',type=Path,help='Same tutorial audio for partial-keyboard octave verification')
    args=parser.parse_args();video=args.video.resolve()
    if args.output.suffix!='.json':raise ValueError('Output must be a .json path')
    if not video.is_file() or video.stat().st_size>250*1024**2:raise ValueError('Local video must be at most250MiB')
    if args.output.exists() or args.output.with_suffix('.mid').exists():raise ValueError('Output exists; choose a new path')
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries',
        'stream=width,height,avg_frame_rate:format=duration','-of','json',str(video)],timeout=30))
    stream=probe['streams'][0];num,den=map(int,stream['avg_frame_rate'].split('/'))
    meta={'width':stream['width'],'height':stream['height'],'fps':num/den,'duration':float(probe['format']['duration'])}
    if not (0<meta['duration']<=600 and 640<=meta['width']<=1920 and 360<=meta['height']<=1080 and 24000/1001<=meta['fps']<=60.01):
        raise ValueError('Unsupported duration, resolution or frame rate')
    geometry=asyncio.run(calibrate(video,meta['width'],meta['height'],allow_relative=True))
    notes,scanlines=extract(video,geometry,meta)
    audio_path=args.audio.resolve() if args.audio else video
    try:
        raw=subprocess.check_output(['ffmpeg','-nostdin','-v','error','-i',str(audio_path),'-t','600',
            '-ar','22050','-ac','1','-f','f32le','-'],timeout=120,stderr=subprocess.DEVNULL)
        audio=np.frombuffer(raw,dtype=np.float32)
    except subprocess.CalledProcessError:audio=np.array([],dtype=np.float32)
    outro=asyncio.run(verify_terminal_outro(video,geometry,meta,notes,audio))
    if outro:audio=audio[:round(outro['excludedRangeSeconds'][0]*22050)]
    coverage=audio_coverage(notes,audio)
    if outro:coverage['terminalOutro']=outro
    if 'activeBounds' in coverage:meta['audioActiveBounds']=coverage['activeBounds']
    geometry['layoutChecks']=asyncio.run(verify_layout(video,geometry,meta,notes))
    timing={'status':'unknown','metricalTempoStatus':'unknown','bpm':None,'encodingBpm':120}
    if len(audio):
        from tutorial_timing import estimate_timing
        timing={**estimate_timing(audio),'encodingBpm':120}
    if [k['midi_num'] for k in geometry['keys']]!=list(range(21,109)):
        evidence=acoustic_octave(notes,audio)
        geometry['octaveEvidence']=evidence
        for n in notes:n['midi']+=evidence['semitones']
        for k in geometry['keys']:k['midi_num']+=evidence['semitones']
    result={'status':'experimental-review-required','sourceSha256':hashlib.sha256(video.read_bytes()).hexdigest(),
        'sourceKind':'colored-keyboard-video','timingOwner':'selected-video','sourceRights':'unverified','containsMelody':None,
        'video':meta,'calibration':geometry,'scanlines':scanlines,'audioCoverage':coverage,'timingEvidence':timing,'notes':notes}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    save_midi(notes,args.output.with_suffix('.mid'))
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(f'Extracted {len(notes)} notes; experimental review required; no publication')

if __name__=='__main__':main()
