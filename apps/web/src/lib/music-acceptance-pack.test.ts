import { it, expect } from 'vitest';
import { buildMusicAcceptancePack, type AcceptanceFormsInput } from './music-acceptance-pack.js';

const forms = (): AcceptanceFormsInput => ({
  schemaVersion: 1,
  kind: 'keyspilli-music-acceptance-forms',
  pieces: Array.from({ length: 10 }, (_, index) => ({
    id: `piece-${index}`,
    title: `Piece ${index}`,
    sourceSha256: 'a'.repeat(64),
    arrangementSha256: 'b'.repeat(64),
    phraseSha256: 'c'.repeat(64),
    sourceAuthority: 'unknown' as const,
    clips: [
      { id: `piece-${index}-original`, mode: 'original' as const, status: 'captured' as const, captureSha256: 'd'.repeat(64), audioSha256: 'e'.repeat(64) },
      { id: `piece-${index}-chords`, mode: 'chords' as const, status: index === 0 ? 'silent-playback-diagnostic' as const : 'captured' as const, captureSha256: 'f'.repeat(64), audioSha256: '1'.repeat(64) },
    ],
    acceptance: { sourceRoles: null, recognizable: null, original: null, backingOnlyChords: null, qualifiedKeyboard: null },
  })),
  priorObservations: [{ legacy: 'preserved separately' }],
  providerCalls: 0,
});

it('creates a bounded no-autoplay acceptance pack with blank fields', () => {
  const pack = buildMusicAcceptancePack(forms());
  expect(pack.pieces).toHaveLength(10);
  expect(pack.observations).toHaveLength(20);
  expect(pack.autoplay).toBe(false);
  expect(pack.musicalAcceptance).toBe('not-established');
  expect(pack.observations.every((o) => o.reviewerRole === null && o.humanListening === null && o.timestamp === null)).toBe(true);
  expect(pack.observations[1]!.clipId).toContain('chords');
});

it('refuses stale hashes, incomplete pieces and prefilled acceptance', () => {
  const stale = forms(); stale.pieces[0]!.sourceSha256 = 'x'.repeat(64);
  expect(() => buildMusicAcceptancePack(stale)).toThrow(/identity/);
  const incomplete = forms(); incomplete.pieces[0]!.clips.pop();
  expect(() => buildMusicAcceptancePack(incomplete)).toThrow();
  const prefilled = forms(); prefilled.pieces[0]!.acceptance.recognizable = 'yes';
  expect(() => buildMusicAcceptancePack(prefilled)).toThrow(/blank/);
});
