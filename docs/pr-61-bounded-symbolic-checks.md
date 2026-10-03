# PR-61: bounded symbolic checks

`packages/engrave/test/symbolic-metamorphic.test.ts` runs three fixed seeds with six synthetic notes each, plus overlap, repeated-unison, voice-switch and cross-staff tie regressions. It checks the source, a five-semitone transpose and a one-beat shift using both the project MusicXML parser and independently imported Verovio MIDI. Track permutation preserves notes, meter and tempo. MIDI format 2 and unsupported repeat/navigation syntax remain rejected.

The existing Verovio dependency is pinned to 6.3.0 (LGPL-3.0-or-later), including the matching checked-in browser assets. No new dependency was introduced. Version 4.5.1 compared a real-time onset against score-time tie state during MusicXML import; [6.3.0 uses score-time onsets consistently](https://github.com/rism-digital/verovio/blob/version-6.3.0/src/iomusxml.cpp). Two simultaneous cross-staff ties previously split one held note into two attacks. The former browser sanitizer removed notation ties and has been deleted.

Independent import also caught two writer defects: overlapping later attacks shared a sequential voice, and trailing forward-only space could shorten a sparse measure in the consumer. The writer now assigns stable separate overlap lanes, emits whole voice streams with balanced backups and uses explicit trailing rests. The sparse first measure followed by a shifted attack retains its full notated duration.

Verovio 6's [MIDI generation](https://github.com/rism-digital/verovio/blob/version-6.3.0/src/midifunctor.cpp) places note-offs exactly one tick before the notated end. The oracle reads the actual MIDI division and compares this exact playback transform; it does not loosen onset/duration tolerances or discard extra attacks. The eight bounded independent-consumer checks pass, including both cross-staff ties and all fixed-seed transforms.

These checks cover selected pitch/onset/duration, meter, tempo and track-order semantics in the writer's supported subset. They do not certify controllers, all formats, a real-world corpus, musical quality or keyboard playability.
