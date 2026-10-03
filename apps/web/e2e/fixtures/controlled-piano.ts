/** Synthetic PCM fixture, not a piano sample or a timbre-quality reference. */
export const SampleLoader = () => ({ load: async () => new Map<string, AudioBuffer>() });
export function SplendidGrandPiano(context: AudioContext, options: { destination: AudioNode }) {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate), data = buffer.getChannelData(0);
  for (let i=0;i<data.length;i++) data[i]=.3*Math.sin(2*Math.PI*440*i/context.sampleRate);
  let pedal = false;
  const voices = new Set<{ source: AudioBufferSourceNode; gain: GainNode; id?: string }>();
  return {
    ready: Promise.resolve(),
    setCC(controller: number,value: number) { if (controller===64) pedal=value>=64; },
    start(event: { note:number;time:number;duration?:number;velocity?:number;stopId?:string }) {
      const source=context.createBufferSource(), gain=context.createGain();
      source.buffer=buffer; source.loop=true; source.playbackRate.value=2**((event.note-69)/12);
      gain.gain.value=(event.velocity??80)/127; source.connect(gain); gain.connect(options.destination);
      const voice={source,gain,id:event.stopId}; voices.add(voice);
      source.onended=()=>{ voices.delete(voice); gain.disconnect(); };
      source.start(event.time);
      if (event.duration!==undefined) source.stop(event.time+event.duration+(pedal ? .2 : 0));
    },
    stop(event?: {stopId?:string}) {
      for (const voice of voices) if (!event?.stopId || voice.id===event.stopId) {
        if (event?.stopId && pedal) continue;
        try { voice.gain.gain.cancelScheduledValues(context.currentTime); voice.gain.gain.setTargetAtTime(0,context.currentTime,.005); voice.source.stop(context.currentTime+.025); } catch { /* a rendered voice may already have ended */ }
      }
    },
    dispose() { for (const voice of voices) { try { voice.source.stop(); } catch {} voice.gain.disconnect(); } voices.clear(); },
  };
}
