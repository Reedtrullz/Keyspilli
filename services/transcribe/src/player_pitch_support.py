#!/usr/bin/env python3
"""Bounded audio-only support policy for Player history receipts."""

from dataclasses import dataclass
import hashlib
import json
import math


SUPPORT_METHOD = 'player-pitch-support-v1'


@dataclass(frozen=True)
class PitchSupportPolicy:
    removal_margin: float
    alternative_margin: float
    method_version: str = SUPPORT_METHOD

    def __post_init__(self):
        for name, value in (
            ('removal_margin', self.removal_margin),
            ('alternative_margin', self.alternative_margin),
        ):
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0 or value > 1:
                raise ValueError(f'invalid {name}')
        if not isinstance(self.method_version, str) or not self.method_version:
            raise ValueError('invalid method version')

    def as_dict(self):
        return {
            'removalMargin': float(self.removal_margin),
            'alternativeMargin': float(self.alternative_margin),
            'methodVersion': self.method_version,
        }

    def sha256(self):
        payload = json.dumps(self.as_dict(), sort_keys=True, separators=(',', ':')).encode('utf-8')
        return hashlib.sha256(payload).hexdigest()


# Selected from the bounded four-by-four development sweep in margin-sweep.json.
DEFAULT_POLICY = PitchSupportPolicy(0.002, 0.01)


def support_receipt(status, policy=DEFAULT_POLICY, removal_margin=None, alternative_margin=None):
    if status not in {'supported', 'ambiguous', 'not-computed'}:
        raise ValueError('unsupported support status')
    return {
        'schemaVersion': 1,
        'policySha256': policy.sha256(),
        'status': status,
        'minimumRemovalMargin': None if removal_margin is None else float(removal_margin),
        'minimumAlternativeMargin': None if alternative_margin is None else float(alternative_margin),
    }


def build_event_column(refs, event, samples, sample_rate):
    import numpy as np
    ref = refs[event['ref']]
    position = np.arange(samples) - event['frame']
    wave = np.column_stack([
        np.interp(position, np.arange(samples), ref[:, channel], left=0, right=0)
        for channel in range(ref.shape[1])
    ])
    if event.get('duration') is not None:
        ages = np.arange(samples, dtype=np.float64) / sample_rate
        wave *= np.clip(1 - (ages - event['frame'] / sample_rate - event['duration']) / .5, 0, 1)[:, None]
    return wave.ravel()


def refit_event_set(target, events, refs, sample_rate):
    import numpy as np
    from scipy.optimize import nnls
    target = np.asarray(target, dtype=np.float64)
    if not events:
        return np.zeros((target.size, 0), dtype=np.float64), np.zeros(0), float(np.linalg.norm(target))
    matrix = np.asarray([
        build_event_column(refs, event, target.shape[0], sample_rate)
        for event in events
    ]).T
    coefficients, error = nnls(matrix, target.ravel(), maxiter=1000)
    return matrix, coefficients, float(error)


def evaluate_pitch_support(target, events, refs, pins, policy):
    """Compare removal and bounded pitch substitutions against the same PCM."""
    import numpy as np
    if not isinstance(policy, PitchSupportPolicy):
        raise ValueError('support policy required')
    target = np.asarray(target, dtype=np.float64)
    target_norm = float(np.linalg.norm(target))
    if not events or not np.isfinite(target_norm) or target_norm <= 0:
        return support_receipt('not-computed', policy)
    try:
        _, _, base_error = refit_event_set(target, events, refs, 44100)
    except (ValueError, IndexError, RuntimeError):
        return support_receipt('ambiguous', policy, policy.removal_margin, policy.alternative_margin)
    if not np.isfinite(base_error):
        return support_receipt('ambiguous', policy, policy.removal_margin, policy.alternative_margin)
    ambiguous = False
    for index, event in enumerate(events):
        try:
            event_pin = pins[event['ref']]
            removed = events[:index] + events[index + 1:]
            _, _, removed_error = refit_event_set(target, removed, refs, 44100)
            removal_delta = (removed_error - base_error) / target_norm
            if not np.isfinite(removal_delta) or removal_delta < policy.removal_margin:
                ambiguous = True
            current_midi = event_pin.get('midi')
            candidates = []
            for candidate_index, candidate_pin in enumerate(pins):
                if candidate_index == event['ref'] or candidate_pin.get('midi') not in {
                    current_midi - 24, current_midi - 12, current_midi + 12, current_midi + 24,
                }:
                    continue
                if 'velocity' in event_pin and 'velocity' in candidate_pin and candidate_pin['velocity'] != event_pin['velocity']:
                    continue
                candidates.append((abs(candidate_pin['midi'] - current_midi), candidate_index))
            for _, candidate_index in sorted(candidates)[:4]:
                replacement = dict(event, ref=candidate_index)
                alternate = events[:index] + [replacement] + events[index + 1:]
                _, _, alternate_error = refit_event_set(target, alternate, refs, 44100)
                alternative_delta = (base_error - alternate_error) / target_norm
                if not np.isfinite(alternative_delta) or alternative_delta >= policy.alternative_margin:
                    ambiguous = True
        except (KeyError, TypeError, ValueError, IndexError):
            ambiguous = True
    status = 'ambiguous' if ambiguous else 'supported'
    return support_receipt(status, policy, policy.removal_margin, policy.alternative_margin)
