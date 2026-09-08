"""Conservative audio attack-pulse evidence and elapsed-time-safe MIDI encoding.

A regular attack pulse is not proof of meter or quarter-note BPM. Consumers must
retain metricalTempoStatus=unknown until the pulse interpretation is reviewed.
Only numpy is required; no model downloads or transcription services.
"""
import math
import numpy as np


def estimate_timing(audio, rate=22050):
    audio = np.asarray(audio)
    if audio.ndim != 1 or not 8000 <= rate <= 96000 or len(audio) > rate * 600 or not np.isfinite(audio).all():
        raise ValueError('Expected finite mono audio, 8–96kHz, at most 600 seconds')
    result = {'status': 'unknown', 'confidence': 0.0, 'bpm': None,
              'metricalTempoStatus': 'unknown', 'confidenceScope': 'attack-pulse-regularity',
              'method': 'audio-attack-pulse',
              'beatSeconds': [], 'tempoSegments': [], 'reason': 'insufficient audio attack evidence'}
    hop = round(rate * .01)
    count = len(audio) // hop
    if count < 100:
        return result
    frames = audio[:count * hop].reshape(count, hop)
    energy = np.sqrt(np.mean(frames.astype(float) ** 2, axis=1))
    flux = np.maximum(0, np.diff(energy, prepend=0))
    if energy.max() < 1e-5 or flux.max() < 1e-6:
        return result
    # ponytail: strong isolated attacks only; reject dense/ambiguous piano passages
    # rather than pretending an unconstrained beat tracker knows their meter.
    candidates = np.flatnonzero((flux > max(float(np.median(flux)) * 8, float(flux.max()) * .15)) &
                               (flux >= np.roll(flux, 1)) & (flux >= np.roll(flux, -1)))
    selected = []
    for i in candidates:
        if selected and (i - selected[-1]) * hop / rate < .18:
            if flux[i] > flux[selected[-1]]:
                selected[-1] = int(i)
        else:
            selected.append(int(i))
    beats = np.asarray(selected) * hop / rate
    if len(beats) < 12:
        return result
    intervals = np.diff(beats)
    median = float(np.median(intervals))
    if not .27 <= median <= 1.5 or np.any(intervals < .75 * median) or np.any(intervals > 1.3 * median):
        result['reason'] = 'irregular attacks or competing pulse subdivisions'
        return result
    # Slow local tempo variation is accepted only when sustained across windows.
    smooth = np.array([np.median(intervals[max(0, i-2):i+3]) for i in range(len(intervals))])
    residual = float(np.quantile(abs(intervals-smooth)/smooth, .9))
    if residual > .06 or np.max(abs(np.diff(smooth))/smooth[:-1]) > .08:
        result['reason'] = 'tempo variation is not locally supported'
        return result
    confidence = float(np.clip(1-residual/.12, 0, 1))
    variable = float(np.ptp(smooth))/median > .06
    segments = [{'startSec': 0.0, 'bpm': 60 / (float(smooth[0]) if variable else median)}]
    if variable:
        for i in range(1, len(smooth)):
            if abs(60 / smooth[i] - segments[-1]['bpm']) / segments[-1]['bpm'] > .015:
                segments.append({'startSec': float(beats[i]), 'bpm': float(60 / smooth[i])})
    return {**result, 'status': 'pulse-estimated', 'confidence': confidence,
            'pulseBpm': 60 / median, 'variableTempo': variable,
            'beatSeconds': beats.tolist(), 'tempoSegments': segments,
            'reason': 'Attack pulse supported; half/double-time and meter remain unverified'}


def tempo_events(timing, ppq=960):
    """Return absolute {tick, tempo} events. Unknown uses MIDI's encoding default.

    The 120 BPM default is an encoding clock only, never an estimated song tempo.
    Estimated attack intervals provisionally define quarter-note units.
    """
    if not isinstance(ppq, int) or not 1 <= ppq <= 32767:
        raise ValueError('Invalid PPQ')
    segments = timing.get('tempoSegments', []) if timing.get('status') == 'pulse-estimated' else []
    if not segments:
        return [{'tick': 0, 'tempo': 500000}]
    events = []
    previous = -1
    for segment in segments:
        sec, bpm = segment['startSec'], segment['bpm']
        if not math.isfinite(sec) or sec < 0 or sec <= previous or not math.isfinite(bpm) or not 4 <= bpm <= 1000:
            raise ValueError('Invalid tempo segment')
        if not events and sec != 0:
            raise ValueError('First tempo segment must start at zero')
        tick = seconds_to_tick(sec, events, ppq) if events else 0
        if events and tick <= events[-1]['tick']:
            raise ValueError('Tempo events collapse at MIDI tick resolution')
        events.append({'tick': tick, 'tempo': round(60_000_000 / bpm)})
        previous = sec
    return events


def seconds_to_tick(seconds, events, ppq=960):
    """Integrate the exact rounded MIDI tempo map, retaining elapsed note times."""
    if not math.isfinite(seconds) or seconds < 0 or not isinstance(ppq, int) or not 1 <= ppq <= 32767:
        raise ValueError('Invalid elapsed seconds or PPQ')
    previous = -1
    for event in events:
        if (not isinstance(event['tick'], int) or event['tick'] <= previous
                or not isinstance(event['tempo'], int) or not 1 <= event['tempo'] <= 0xffffff):
            raise ValueError('Invalid MIDI tempo event')
        previous = event['tick']
    elapsed, tick, tempo = 0.0, 0, 500000
    for event in events:
        boundary = elapsed + (event['tick'] - tick) * tempo / (ppq * 1_000_000)
        if boundary > seconds:
            break
        elapsed, tick, tempo = boundary, event['tick'], event['tempo']
    return round(tick + (seconds - elapsed) * ppq * 1_000_000 / tempo)
