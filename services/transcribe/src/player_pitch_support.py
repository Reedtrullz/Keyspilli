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


# Development placeholder until the finite K2 margin sweep is frozen.
DEFAULT_POLICY = PitchSupportPolicy(0.001, 0.001)


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
