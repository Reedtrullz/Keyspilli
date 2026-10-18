# Tutorial extraction: two additional complete sources

The user reported “The extracted MIDI sounds pretty good!” for the Bohemian Rhapsody raw-MIDI audio, then authorized continued work. This is positive listening evidence for that exact candidate, not acceptance of all difficulties or the general route. The candidate audio/MIDI hashes are recorded in the adjacent JSON. Historical pending receipts remain unchanged.

The extractor remains unchanged at commit `8874d0d7d99a911f19c71ca4e1833a8c7ed85bfc`. No manual coordinates or new thresholds were introduced.

| New full video | Native extraction | Resized 640px diagnostic, events ending before59s |
|---|---|---|
| [Metallica — Nothing Else Matters, Sheet Music Boss](https://www.youtube.com/watch?v=Mg1TXgmEyBQ) | 1,989 notes;398.954s video;60fps; calibration4s/8s | 213/213 events exactly identical, including timing/duration |
| [In My Mind, TutorialsByHugo](https://www.youtube.com/watch?v=69AixNmvh9c) | 514 notes;189.774s video;60000/1001fps; calibration4s/8s | 143/143 notes retained by pitch/color and chronological occurrence;115 exact events; maximum onset difference16.684ms, duration difference33.367ms |

These are different complete songs, including a second creator and noninteger frame rate. Resizing is a robustness check, not independent musical truth. A first comparison by overall onset ordering failed because near-simultaneous chord notes changed order by a frame; comparison by pitch and chronological occurrence resolved the correspondence without modifying extraction. No missing or added events were found within this excerpt, not a claim about entire-song transcription accuracy.

Visual spot checks at60.1s and120.1s agree with the visible illuminated keys: Metallica E2/E3/B3 and E1/E2; In My Mind Gb4 and B2/Eb3/Eb4. The latter notation uses Cb enharmonically. These are sparse visual checks, not a full independent note reference or listening evaluation.

The existing MIDI variant/export pipeline passed structural validation at all five public levels for both songs. Six local Python regressions also passed. No application code changed, so the previous exact-extractor CI evidence remains applicable; no new CI claim is made here. Valid exports do not certify melody retention, difficulty quality or player integration. Very-beginner and beginner Metallica outputs end sooner than the raw extraction; beginner ending/role retention requires musical review before promotion.

Source and rendered-MIDI audio were normalized independently to the same -18LUFS target and added to http://127.0.0.1:8874/tutorial-recovery/review.html . FFprobe reads both rendered MP3s; the updated page is retrievable over HTTP. This turn did not verify browser playback or claim to listen to these new candidates. Source outros explain part of source-versus-MIDI duration differences; no time stretching is applied. Private media and event payloads remain under `output/tutorial-recovery/`, not in Git.

Source search initially returned formats without a combined stream; downloading separate video/audio with a bounded size and merging succeeded. No paid resources, model weights, production changes, catalog changes or holdout access occurred. Source redistribution rights remain unverified. The original20+6 holdout cohort remains untouched; these are development examples.

## Decision

Keep the route experimental and local. It now has positive user feedback on Queen and successful untuned extraction on two more full tutorials, but no new full-song independent accuracy certification. Do not make it the default worker route or deploy on the strength of note counts and serializer checks. Remaining gates are independent whole-song quality, simplified-level musical retention, source eligibility, and end-to-end import validation. Unsupported layouts must continue to reject rather than return convincing-looking guesses.
