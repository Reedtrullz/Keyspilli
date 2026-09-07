"""Experimental local colored-keyboard extraction; not an enabled worker route.

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
    colors={'blue':blue,'green':green,'yellow':yellow}
    supported=blue|green|yellow
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


def validate_geometry(c,width,height):
    if [k['midi_num'] for k in c['keys']]!=list(range(21,109)):
        raise ValueError('An unambiguous complete 88-key keyboard is required')
    x,y,w,h=c['bounds'];edges=np.asarray(c['edges'])
    if not (0<=x<x+w<=width and 0<y<y+h<=height) or edges.shape!=(88,2):
        raise ValueError('Invalid keyboard bounds')
    if not np.isfinite(edges).all() or np.any(edges[:,0]>=edges[:,1]) or np.any(edges<0) or np.any(edges>w):
        raise ValueError('Invalid key edges')
    if np.any(np.diff(edges.mean(axis=1))<=0):raise ValueError('Keys are not ordered')


async def calibrate(video,width,height):
    import cv2
    from lumachords.keybed_detector import KeybedDetector
    from lumachords.image_input import ImagePreprocessor
    from lumachords.preferences import Preferences
    from lumachords.runtime_config import RuntimeConfig,AppMode,ProdMode,LogLevel
    cap=cv2.VideoCapture(str(video));candidates=[];attempts=[]
    try:
        for second in [0,1,2,4,8,12,16,24]:
            cap.set(cv2.CAP_PROP_POS_MSEC,second*1000);ok,frame=cap.read()
            if not ok:continue
            scale=1280/width
            frame=cv2.resize(frame,(1280,round(height*scale)))
            detector=KeybedDetector(Preferences(),RuntimeConfig(AppMode.HEADLESS,ProdMode.PROD,LogLevel.LOGLEVEL_NONE))
            detector.init_state()
            result=await detector.detect(await ImagePreprocessor.preprocess_for_keybed(frame))
            if result.evaluation_result is not None:
                attempts.append({'second':second,'reason':str(result.evaluation_result)});continue
            c={'bounds':[round(v/scale) for v in result.keybed_bounds],
               'keys':[{'midi_num':int(k['midi_num']),'color':k['color']} for k in result.all_keys_data],
               'edges':np.round(result.all_keys_edge/scale).astype(int).tolist()}
            try:validate_geometry(c,width,height)
            except ValueError as e:
                attempts.append({'second':second,'reason':str(e)});continue
            for prior_time,prior in candidates:
                centers=np.asarray(c['edges']).mean(axis=1);old=np.asarray(prior['edges']).mean(axis=1)
                tolerance=max(1,2/scale)
                if max(abs(a-b) for a,b in zip(c['bounds'],prior['bounds']))<=tolerance and np.max(abs(centers-old))<=tolerance:
                    return {**prior,'framesSeconds':[prior_time,second],'attempts':attempts}
            candidates.append((second,c))
    finally:cap.release()
    raise ValueError('No consistent full keyboard calibration: '+json.dumps(attempts))


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
    if not notes:raise ValueError('No supported blue/green/yellow key lights detected')
    return sorted(notes,key=lambda n:(n['startSec'],n['midi'])),scanlines


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
    args=parser.parse_args();video=args.video.resolve()
    if args.output.suffix!='.json':raise ValueError('Output must be a .json path')
    if not video.is_file() or video.stat().st_size>250*1024**2:raise ValueError('Local video must be at most250MiB')
    if args.output.exists() or args.output.with_suffix('.mid').exists():raise ValueError('Output exists; choose a new path')
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries',
        'stream=width,height,avg_frame_rate:format=duration','-of','json',str(video)],timeout=30))
    stream=probe['streams'][0];num,den=map(int,stream['avg_frame_rate'].split('/'))
    meta={'width':stream['width'],'height':stream['height'],'fps':num/den,'duration':float(probe['format']['duration'])}
    if not (0<meta['duration']<=600 and 640<=meta['width']<=1920 and 360<=meta['height']<=1080 and 25<=meta['fps']<=60.01):
        raise ValueError('Unsupported duration, resolution or frame rate')
    geometry=asyncio.run(calibrate(video,meta['width'],meta['height']))
    notes,scanlines=extract(video,geometry,meta)
    result={'status':'experimental-review-required','sourceSha256':hashlib.sha256(video.read_bytes()).hexdigest(),
        'sourceKind':'colored-keyboard-video','timingOwner':'selected-video','sourceRights':'unverified','containsMelody':None,
        'video':meta,'calibration':geometry,'scanlines':scanlines,'notes':notes}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    save_midi(notes,args.output.with_suffix('.mid'))
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(f'Extracted {len(notes)} notes; experimental review required; no publication')

if __name__=='__main__':main()
