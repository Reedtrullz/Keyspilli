import {expect,it} from 'vitest';
import {resolveTimedNotes,resolveSourcePedalNotes,validatePlaybackData,type TimedNote} from './timeline.js';
import {PlaybackEngine,type AudioLike} from './engine.js';
import {DEFAULT_SETTINGS} from './prefs.js';
import type {SongData} from './types.js';
const data:SongData={notes:[{midi:60,start:0,dur:1,vel:80,hand:'R',sourceMidiChannel:2},{midi:60,start:.5,dur:2,vel:75,hand:'L',sourceMidiChannel:3},{midi:60,start:3,dur:.5,vel:90,hand:'R',sourceMidiChannel:2}],chords:[],key:'C',tempoBpm:60,timeSig:[4,4],measures:[{index:0,startBeat:0,endBeat:4}],sourcePedal:{version:1,endBeat:4,provenance:'midi-file',changes:[{beat:0,channel:2,value:127,source:'midi:0'},{beat:4,channel:2,value:0,source:'midi:0'}]}};
it('keeps grading holds separate from channel-scoped resonance, and reconstructs only source carries on seek/loop',()=>{
 const before=structuredClone(data),audioNotes=resolveSourcePedalNotes(data,1,0),targets=resolveTimedNotes(data,1,0);expect(audioNotes.map(n=>[n.durSec,n.soundingDurSec])).toEqual([[1,4],[2,2],[.5,1]]);expect(targets.map(n=>n.durSec)).toEqual([1,2,.5]);expect(data).toEqual(before);
 const calls:TimedNote[]=[];let cancelled=0;const audio:AudioLike={ensure(){},noteOn(n){calls.push(n);},noteOff(){},metronomeClick(){},cancelAll(){cancelled++;},setGains(){},dispose(){},sustainPedal:true};
 const engine=new PlaybackEngine(audio,audioNotes,4,data,DEFAULT_SETTINGS,[],targets);expect(audio.sustainPedal).toBe(false);engine.seek(2);engine.start();expect(calls.map(n=>[n.midi,n.startSec,n.durSec])).toEqual([[60,2,2],[60,2,.5]]);expect(engine.gradingNotes[0]!.durSec).toBe(1);
 engine.tick(.1);expect(calls).toHaveLength(2);engine.seek(3.7);expect(cancelled).toBe(1);expect(calls.slice(2).map(n=>n.durSec)).toEqual([expect.closeTo(.3),expect.closeTo(.3)]);
 engine.setLoop({startSec:2,endSec:3});engine.tick(1);expect(calls.at(-1)!.durSec).toBeLessThanOrEqual(1);engine.stop();const stopped=cancelled;engine.seek(4);engine.start();expect(cancelled).toBe(stopped);expect(calls.at(-1)!.startSec).toBeLessThan(4);
 engine.setSettings({...DEFAULT_SETTINGS,sustainPedal:true});expect(audio.sustainPedal).toBe(false);engine.setNotes(targets,4);expect(audio.sustainPedal).toBe(true);
 expect(validatePlaybackData({...data,sourcePedal:{...data.sourcePedal!,changes:[{...data.sourcePedal!.changes[0]!,beat:1}]}}).join(' ')).toContain('coincides');
});
