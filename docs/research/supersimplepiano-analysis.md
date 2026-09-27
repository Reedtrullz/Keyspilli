# Super Simple Piano — Complete Feature & Build Analysis

> Deep analysis of [supersimplepiano.com](https://www.supersimplepiano.com) (Super Simple Piano), researched 2026-08-09. Every feature, function, page type, data model, monetization mechanic, and growth loop relevant to building a similar product, plus a build blueprint.
>
> **Evidence base:** full-site crawl of all 44 sitemaps (~200K URLs), 30+ pages fetched and text-extracted (home, pricing, player, kid, songs, collections, practice, learn, how-to-play, tools ×13, blog ×6, help, contact, login, uploads, youtube, converts), client JS bundles inspected (player engine, playlists, layout), public song API probed, and the actual player UI exercised in a real browser (Playwright). Cloudflare edge protection eventually blocked further live probing; screenshots beyond that point are not included.

---

## 1. Product summary & positioning

**Tagline:** "Play Your Love Song in Hours" — "If you can sing it, you can play it."

Super Simple Piano is a browser-based piano-learning platform aimed at absolute beginners and kids. The core promise: instead of months of lessons, you pick a song, follow color-coded notes (each pitch has a fixed color), and play it the same day. It combines:

- A huge **catalog of simplified song arrangements** (marketing number: **22.3K+ songs**; sitemap shows **~146K player pages**, because each song exists in multiple difficulty arrangements and thousands of YouTube-converted/user-uploaded additions).
- An **interactive player** with 8 visual modes over the same audio (Synthesia-style falling notes, color-coded beginner notation, engraved sheet music, lead sheets, bar sheets, kid modes, karaoke).
- **Live practice grading** via Web MIDI keyboards, computer keyboard, or microphone pitch detection.
- A **YouTube → sheet music AI conversion** pipeline (paste a URL, get MIDI + MusicXML + playable arrangement in ~60–90 s).
- A **MIDI/MusicXML upload → interactive lesson** pipeline with PDF export.
- **13 free browser tools** (chord finder, transposer, BPM tap, circle of fifths, scale explorer, discovery tools…).
- **Structured piano courses** (40+ practice lessons), 173 theory pages, 100 how-to-play tutorials, 328 SEO blog posts, 359 curated collection pages.
- A **freemium + per-song purchase** monetization (Stripe) with free full-song playback as the hook.

Audience language on site: "built for absolute beginners and kids", "ages 4–12" for kid content, but testimonials explicitly include advanced players ("the only one on the market that gives you everything you need to learn — chords, notes, published key"). So the real audience is **self-taught adult beginners + parents/kids + singing hobbyists**, with an "advanced" SEO halo.

---

## 2. Business model & pricing

### Tiers (from /pricing, the download dialog, and the uploads FAQ)

| Tier | Price | Included |
|---|---|---|
| **Free** | $0 forever | Thousands of songs, full playback (no time caps), all practice modes, L/R/both-hand practice, **5 one-time YouTube conversions**, community support, uploads in browser (PDF export gated) |
| **Per-song purchases** | Simplify PDF **$1.99** / Sheet Music PDF **$2.99** / MIDI **$2.99** | "Yours to keep forever", no subscription, no account needed for checkout ("Secure checkout · instant download · no account needed") |
| **Premium** | **$9.99/month** | Everything in Free + unlimited Simplify PDF, Sheet Music PDF, and MIDI downloads + unlimited YouTube conversions + custom song requests ($2.99/song, Premium-only) + priority support |

### Monetization mechanics observed

- **Free playback is the acquisition engine**: every song plays fully, in all modes, with no time caps. Conversion happens at the *download* moment ("Download Sheet & MIDI" button → paywall dialog).
- **Paywall dialog** (live-verified): song title/artist/key header, three purchase buttons (Simplify $1.99, Classic $2.99, MIDI $2.99), a "Get the Sheet — $1.99" CTA, PDF preview thumbnails ("Tap to expand"), "Everything You Need to Play It — Every layout (Beginner · Simple · Lead Sheet) / Color-coded notes + classic notation included / Print-ready PDF in the published key (G)", "Secure checkout · instant download · no account needed", Premium upsell ("Downloading a few songs? Premium $9.99/mo"), and a "Compare all plans →" link.
- A **"Save this song's sheet music" interstitial dialog** appeared once on first song load ("Get PDF — $1.99") — i.e., a first-visit upsell beyond the button-triggered dialog.
- **YouTube conversions are the retention/upsell fuel**: free users get 5 one-time conversions, Premium unlimited. Conversions also generate catalog content (every conversion becomes a playable arrangement page).
- **Custom song requests** ($2.99/song, Premium-only) — a manual service premium.
- **Pricing copy claims**: "If you download 4+ songs a month, Premium pays for itself." "Cancel in one click from your account — you keep access until end of billing period." "No card required" for free.

### Copy inconsistencies (evidence of evolving/untested copy)

- Blog (`youtube-to-sheet-music`) says "upgrade to **Pro for 30/month**"; pricing page says **Premium $9.99/mo**.
- Help center says "**4 Practice Modes**"; pricing says "**All 5 practice modes**"; homepage says "Every song, **six ways to learn**"; the modes blog documents **8 modes**.
- Homepage stat block: "22.3K+ songs", "1.1K+ active learners/month", "129K+ plays this month", "1.5K+ songs favorited".

---

## 3. Site & catalog architecture

### Tech stack evidence

- **Next.js App Router** (React): `_next/static/chunks/app/...`, `__variable_*` font classes, `opengraph-image` route handlers, `manifest.json` (PWA manifest with `crossorigin=use-credentials`).
- **Cloudflare edge**: robots.txt includes Cloudflare Managed Content signals (`search=yes, ai-train=no, use=reference`); Cloudflare Bot Fight Mode blocked our browser after rapid crawling (HTTP 403); response `server` headers Cloudflare.
- **Stripe** payments: `/api/stripe/{checkout,verify-purchase,portal,end-trial,classic-checkout,pdf-checkout,midi-checkout}`.
- **Auth**: Google OAuth, Apple Sign-In, email+password with remember-me/forgot-password; routes `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`.
- **Analytics/telemetry**: `/api/v1/events` (client events like `player_mode_tab_clicked`, `player_karaoke_toggle_clicked`, `player_midi_purchased_return`, `youtube_midi_checkout_click`, `download_dialog_midi_clicked`); `/api/push/subscribe` (web push).
- **A/B testing in client JS**: keys `ab_sheet_mode`, `sheet_mode_default`, `ssp_mode_ab_`, `ssp_track_mode`, `track_mode_gate`, `track_mode_login_prompt`.
- **Engraving**: **Verovio** server-side rendering ("rendered server-side by Verovio so it always looks publisher-grade"), **Bravura** music font in PDFs.
- **Public song API** (no auth required): `/api/songs/{id}` (see §4).

### robots.txt strategy (interesting for replication)

- Explicitly **welcomes LLM/AI crawlers** (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-Web, PerplexityBot, Google-Extended) — commented: "Sessions from ChatGPT etc. show low bounce + high engagement (see GA referrals)."
- **Blocks SEO/scraper crawlers** (Ahrefs, Semrush, MJ12, DotBot, DataForSeo, etc.) — "they harvest the catalog."
- Disallows `/api/`, auth routes, and transient `/youtube/processing/`, `/youtube/result/`, `/converts` (job IDs leak).
- Cloudflare managed signals: `ai-train=no`, `use=reference`.

### URL inventory (from all 44 sitemap files, ~200K URLs)

| Pattern | Count | Purpose |
|---|---:|---|
| `/player/{id}` | ~146,117 | Song arrangement player pages (each difficulty level of each song = own ID) |
| `/kid/{id}` | ~37,874 | Kid-mode versions of arrangements |
| `/piano-accompaniment/{id}` | ~10,256 | Backing-track versions of arrangements |
| `/artist/{slug}` | ~4,353 | Artist pages (+ `/artist/{slug}/style/{x}` combos) |
| `/blog/{slug}` | ~328 | SEO articles |
| `/piano-songs/{easy,medium}/{genre}` | ~196 | Difficulty × genre list pages |
| `/learn/{keys,scales,chords,chord-progressions}/{slug}` | ~173 | Theory pages |
| `/how-to-play/{slug}` | ~100 | Step-by-step song tutorials |
| `/practice/{right-hand-melody,left-hand-chords,hands-together}/{n}` | ~44 | Structured course lessons |
| `/collections`, `/songs`, `/playlists`, `/tools` (13 tool pages), `/pricing`, `/help`, `/contact`, `/terms`, `/privacy`, `/uploads`, `/youtube`, `/converts`, `/kid-songs`, `/artists`, `/artists/letter/{x}`, `/songs/{genre}` | ~100 | Hub pages |

### Data model (live-probed `/api/songs/{id}`)

```json
{
  "id": "let-it-be-066783528990861726",
  "title": "Let It Be",
  "artist": "The Beatles",
  "category": "Rock",
  "difficulty": "beginner",
  "duration": "0:00",
  "key": "G",
  "tempo": "63 BPM",
  "thumbnail": "",
  "isFavorite": false,
  "progress": 0,
  "userId": null,
  "visibility": "public",
  "acquiredVia": null,
  "sourceYoutubeUrl": null,
  "contentType": "standard",
  "orgid": "110726",
  "hasSheetXml": true,
  "style": "easy-listening",
  "mood": "peaceful",
  "difficultyScore": 1.4,
  "bassPattern": "block",
  "sections": null
}
```

Key insights for a clone: songs are **arrangement records** (title+artist+key+tempo+difficulty+style+mood+bassPattern+difficultyScore), not just "songs"; `orgid` hints at multi-tenant/org data; `acquiredVia`/`sourceYoutubeUrl` track provenance (standard vs YouTube vs upload); `hasSheetXml` gates the engraved Sheet Music mode; `sections` (nullable) supports section markers for looping; `visibility` supports private uploads.

---

## 4. The player (the core product)

Live-verified in a real browser on `/player/let-it-be-066783528990861726`.

### Layout

- **Header row:** song title, artist, genre/key/difficulty/artist chips (deep links to `/songs/rock`, `/songs?key=G`, `/songs?difficulty=beginner`, `/artist/...`), "More controls" (⋯) menu, Back link, "Now playing" global bar.
- **Mode toolbar:** "View [current mode]" dropdown + "What do these modes mean?" link (→ `/blog/player-modes-explained`); **L / R / All** hand buttons; **Chord Keys** and **Metronome** pills.
- **Player chrome:** chord-name chips row (e.g. G, D, Em, C, D7 — the song's chords), Play button, **LOOP OFF** toggle + measure indicator (clickable), **− / BPM / +** practice-speed control ("Set practice speed"), **− / Key / +** transpose control ("Reset to song key"), hidden "Choose File" fallback (load a local file into the player).
- **Action row:** "Download Sheet & MIDI", "Karaoke Mode" toggle, "Play in Kid Mode" link (→ `/kid/{id}`), "Add to Favorites" heart, "Share".
- **Below the player:** "Same song, other levels" arrangement picker (Very Beginner / Beginner · playing / Very Easy / Easy / Medium / Advanced, each with descriptor and distinct URL+ID), lyrics (with inline chord symbols), teacher's notes, about/FAQ block, "More piano songs by [artist]", "More songs you might like" recommendations (API: `/api/recommendations?songId=`), breadcrumbs.

### The 8 view modes (same audio, different visualization)

1. **Beginner** — big colored note dots with letter names inside, lyrics under each note, chord symbols under each bar, right-hand melody only. "Like Lead Sheet but notes track pitch height." On-screen colored keyboard at the bottom = "press the color you see."
2. **Sheet Music** — engraved two-stave (grand staff) score rendered **server-side by Verovio**: full rhythm values, time signatures, dynamics, articulations, lyrics under melody, chord symbols above; colored note heads toggleable (Display button). *Only available when the song has a publisher-quality MusicXML source (`hasSheetXml`)* — YouTube-converted and user-uploaded songs don't get it.
3. **Bars Sheet** — both hands as horizontal colored bars on a simplified staff; **bar length = note duration** (no rhythm notation reading); red playhead sweeps left-to-right; lyrics between staves, chord symbols above. "Guitar Hero for piano."
4. **Simple Sheet** — single treble stave, right-hand melody only, colored note heads, lyrics below, chord symbols above. On-ramp to full notation.
5. **Lead Sheet** — lyrics on top, colored melody-note dots above each syllable, chord names below changes. No staff/rhythm. For singer-pianists; fake-book format.
6. **Fall Down** (`/player/{id}/topdown`) — Synthesia-style: colored note bars fall vertically onto the on-screen keyboard; bar length = duration; chord symbols on the left edge; lyrics scroll on the right. Most popular mode.
7. **Kid Simple** (in Kid Mode) — simplified treble staff, melody only, letter-name **or scale-degree labels** above each note (segmented **OFF / C / 1** toggle; "C" = letter names, "1" = scale degrees 1–7), bigger colorful keyboard showing only the octaves used.
8. **Kid Bar** (in Kid Mode) — Kid version of Bars Sheet: same gamified bars, labels printed inside every bar, both hands, no chord symbols, kid keyboard.

**Mode behavior:** switchable mid-playback via the View dropdown; **choice persisted across songs**; modes are deep-linkable routes (`/player/{id}/beginner`, `/leadsheet`, `/barsheet`, `/sheetmusic`, `/simplesheet`, `/topdown`) — each mode has its own shareable URL (help FAQ: "How do I share a specific mode with someone?").

### Player controls & settings

- **L / R / All** — isolate left hand (bass clef), right hand (treble/melody), or both. Works in Fall Down and Bars Sheet (and most modes; disabled in right-hand-only modes).
- **Chord Keys** — show chord name under each beat (C, G, Am, F…); "on by default" in Beginner.
- **Metronome** — click track, pairs with lowered BPM.
- **Practice speed** — BPM − / + with a "Set practice speed" button; slow down to **50%** and up (blog: 25%–150%). Persists per song.
- **Transpose** — key − / + with "Reset to song key"; transposes the whole arrangement (blog: "bump the key up or down a few semitones until the melody sits where your voice is comfortable"); persists.
- **Loop** — LOOP OFF toggle + measure indicator; A–B loop by clicking/dragging on the timeline ("click and drag on the timeline" / "Tap a measure number on the timeline to jump to a specific section").
- **Karaoke Mode** — lyrics light up in time with a bouncing ball; toggle button and mode in the View dropdown.
- **Wait mode** — practice pause: the player waits at each note until you play the correct key (JS: "Cancel waiting", `wait_mode_toggle`, `wait_mode_unlock`; blog: "Practice mode pauses the falling notes until you play the right key").
- **Settings dialog** (live-verified):
  - *Background Sound*: **Piano Background** ("Plays the LH notes as recorded") or **Chord Mode** ("Synthesizes chord on each chord change").
  - *Volume*: separate **Voice** and **Piano** sliders (defaults 100% / 40%).
- **Computer keyboard mapping** — play the on-screen keyboard with your computer keys (JS: "Computer keyboard active", "Use computer keyboard NEW" badge).
- **"Choose File"** — load your own MIDI/XML directly into the player.
- Click anywhere on player to pause; "Now playing" bar appears when a song is playing.

### Downloads & paywall (live-verified)

Dialog offers three artifacts per song:
- **Simplify PDF $1.99** — color-coded learner format, all layouts (Beginner · Simple · Lead Sheet) in one PDF; "Print-ready PDF in the published key (G)".
- **Classic $2.99** — full engraved score, both hands, traditional notation, dynamics/articulations ("Sheet Music PDF (engraved score)").
- **MIDI $2.99** — "Full arrangement as a standard MIDI file" (JS strings: "Works with keyboards, DAWs & backing tracks"; "Practice in any app · edit in any DAW").

Flow: select artifact → "Get the Sheet — $1.99" → Stripe checkout → instant download (JS: "Generating PDF… may take up to a minute", "Setting up your download...", "Opening your PDF…"; APIs `/api/stripe/pdf-checkout`, `/api/user/export-pdf`, `/api/user/download-midi`, `/api/user/classic-purchases?songId=`, `/api/user/pdf-purchases?songId=`, `/api/user/midi-status`, `/api/user/pdf-status`, `/api/playback/verify-pro`, `/api/playback/quota`). YouTube-converted songs get their own MIDI checkout flow (`youtube_midi_checkout_click`, `youtube_midi_download_click`).

### Live grading / practice mode (live-verified)

Accessed via ⋯ → Practice. Panel offers:
- **Connect MIDI keyboard** — Web MIDI; waits for device ("Waiting for MIDI keyboard…"); first-time permission prompt; auto-detect after allow; verified flag stored (`__ssp_midi_verified_`).
- **Use computer keyboard** (NEW badge) — practice without any hardware.
- **Microphone (🎤)** — pitch detection fallback for Safari/iOS/Firefox where Web MIDI is unavailable (per Web MIDI blog). "We listen through the microphone and grade what you play. Works with any acoustic or digital piano."

Grading behavior: "Press Play to start grading"; **wait/feedback mode** — player waits at each note until you press the right key ("Slow down and check finger placement before each note"); after a run you get feedback — JS strings: "Many notes were technically right but off the beat", "Most mistakes were missed notes (", "Accuracy dropped", "Practice will pay off."; API `/api/v1/performance-history?` stores history. Note detection also handles a one-octave keyboard: "Your keyboard fits a single octave. High or low, an [octave shift is available]".

**Web MIDI compatibility (2026, from their blog):** works on Chrome (Mac/Win/Linux), Edge, Opera, Chrome on Android; **does not work** on Safari (Mac/iPhone/iPad), Firefox, or any iOS browser (Apple WebKit refuses Web MIDI over fingerprinting concerns). This is why the mic option exists.

### Kid Mode (`/kid/{id}`)

Separate player route with its own chrome: **Game Mode**, **Simple**, **Karaoke** view buttons; **OFF / C / 1** segmented note-label toggle (no labels / letter names / scale degrees); **− / BPM / +** and **− / Key / +**; "Play in Full Modes" link back; "More Songs for Kids". SEO copy: "every note is colored by pitch (red C, orange D, yellow E, green F, blue G, purple A, pink B) and the lyrics sit directly under each note". Tips for parents: start at 50% tempo, use metronome, use labels, tap measure numbers to jump.

### Piano accompaniment (`/piano-accompaniment/{id}` and hubs)

- **Backing tracks for singers/instrumentalists**: "Toggle the vocal melody, transpose to your key, sing or play along."
- List page filters: All Keys (C–B), All Genres (Pop, Rock, Musical/Soundtrack, Jazz, R&B/Soul, Folk, Holiday/Christmas, Classical, Country, Christian/Gospel, Hip-Hop/Rap, Reggae, Traditional, Latin); sort by Popular/Title/Artist.
- Genre hub pages (e.g. `/piano-accompaniment/musical-theatre`) document features: **section markers + scrub bar**, **16-bar audition cuts** (loop bars 25–40), **transpose follows the backing**, **melody toggle as pitch reference**, **duet charts**, printable engraved PDF, slow-down.
- "Sing & Play" is the nav entry; 10K+ accompaniment pages in sitemap.

---

## 5. YouTube → Sheet Music pipeline

Landing page (`/youtube`), blog (`/blog/youtube-to-sheet-music`), robots, and JS reveal the full flow:

1. **Paste URL** — solo piano covers only ("no vocals or drums"), **under 5 minutes** (hard cap; longer videos rejected — "Trim the video to a 5-minute clip first, or run two conversions back-to-back").
2. **AI transcription** — "Our AI listens to the audio and transcribes the notes into a high-quality MIDI file." Typical conversion **60–90 s** with a progress indicator; processing/result routes are job-scoped (`/youtube/processing/{id}`, `/youtube/result/{id}`).
3. **Instant play** — lands in the player with falling notes, sheet music, all view modes.
4. **Export** — printable PDF, MIDI, MusicXML ("open them in any DAW or notation app").

### Accuracy expectations (their own copy)
- Works great: solo piano, <5 min, clean audio without heavy reverb, studio-quality uploads. Expected **85–95% note accuracy**.
- Works okay: piano with light strings/pads (piano line kept, rest filtered), live recordings with mic noise (accuracy drops 10–15%).
- Fails: full-band tracks (drums+bass+vocals+piano) — "the model can't isolate piano cleanly".

### Legal framing (their copy)
- "Personal practice from a YouTube cover is fair use. Republishing or selling the sheet music isn't." (Their characterization; see §11 for the independent legal read.)
- MusicXML export is pushed as the editing path (MuseScore) for fixing transcription errors.

### Account gating
- **Free: 5 one-time conversions** (no account needed for the first); **Premium: unlimited**. Conversion history at `/converts` ("My Youtube" — "YouTube videos you've converted into playable songs", sign-in required). Demo carousel shows real conversions (Bruno Mars – Risk It All, Yiruma – River Flows in You, Yann Tiersen – Amélie, Betacustic tutorials, Bluey theme…), each linking to a live player page — conversions become permanent catalog pages (`sourceYoutubeUrl` provenance field).

---

## 6. Upload pipeline (`/uploads`)

- **Formats:** `.mid`, `.midi`, `.musicxml`, `.mxl`, **up to 10 MB**; drag-and-drop or browse; "No signup needed for your first upload."
- **3-step wizard:** 1 Upload → 2 Details → 3 Preview & publish.
- **Instant playback:** parses and renders within 5–10 s; falling notes, sheet music, all five practice modes.
- **Practice features:** slow to 50%, A–B loop ("set an A–B loop around four measures"), one-hand isolation, "play along with a backing band".
- **Hand split:** "A MIDI with all notes mixed can be split into right-hand and left-hand tracks for piano practice (this is what we do automatically when you upload a MIDI)."
- **Export:** printable PDF (leadsheet format; gated — "$1.99 per song, free with practice score, or Pro/Premium for unlimited"), plus MIDI & MusicXML for MuseScore.
- **Privacy:** uploads private by default; **publish to community catalog** from "My Uploads" list; **Share button generates a shareable link even for private songs**.
- FAQ confirms: free signups get unlimited browser uploads; PDF export gated behind the standard download flow.

---

## 7. Free tools (`/tools` — 13, no signup)

**Flagship:** YouTube → Sheet Music; Upload MIDI/MusicXML; Find Songs by Chords (NEW).

**Discovery:** Songs by Chord Count (1 / 2 / 3 / 4 / 5 / 6+ chord buckets with descriptions — "1 chord: Drones & pedal-tone pieces", "3 chords: The classic I–V–IV songs", "4 chords: The pop axis"); Songs by Tempo (min/max BPM sliders + quick picks Ballad 50–70, Adagio 66–76, Andante 76–108, Moderato 108–120, Allegro 120–168, Presto 168–200); Songs by Mood (Happy/Sad/Romantic/Peaceful/Energetic/Playful/Dramatic/Melancholic); Bass Pattern Explorer (Block chords / Octave bumps / Oompah / Walking bass / Pedal tone, each with song examples); Find Similar Songs (match by shared chords + key).

**Theory:** Scale Explorer (any root × major/minor/dorian/mixolydian/pentatonic/blues/whole-tone, keyboard display + chord families in Roman numerals); Circle of Fifths (click a key → signature, relative minor, 7 diatonic chords); Key Signature Finder (forward from key, backward from signature, order of sharps/flats); Roman Numeral Analyzer (paste progression + key → numerals; example presets: Pop Axis I–V–vi–IV, Doo-Wop, ii–V–I jazz, Pachelbel canon, Hotel California, Andalusian).

**Utilities:** Chord Finder (any chord name, **108 chords**, keyboard diagram); Chord Progression Transposer (qualities preserved: m, maj7, m7, 7, sus4, sus2, dim, aug; from/to key selector; newlines for measures); BPM Tap (spacebar or button, **median-smoothed**, "most accurate after 8+ taps", reset).

Note: several "NEW" tools render "0 songs found" server-side — they're client-side search apps over the catalog; the value is the catalog + filters, not the shell.

---

## 8. Learning content

### Practice courses (`/practice`)

- **Right Hand Melody** — 12 lessons: 5-finger C position → skips, accidentals, chromatic runs, three major scales (C, G, F); single treble staff with fingering numbers.
- **Left Hand Chords** — 12 lessons: grand staff, treble holds sustained note, bass clef grows from single roots to full 3-note block chords; all common progressions in C, G, F.
- **Hands Together** — 16 lessons: treble melody + bass chords; single-root bass (L01–04) → full block chords (L05–16); finishes with two mini-songs.
- No login required; signup saves progress. Lessons embed the real player (e.g. "Loading song", "Next: Lesson 2: 5-Note Melody + Root Changes C/F/G").

### Learn/theory pages (`/learn/...`, 173 pages)

- **Key theory (12):** per major key — scale notes, key signature, diatonic chords.
- **Chord library (25):** per chord — notes, keyboard diagram, **songs that use it** (e.g. `/learn/chords/a` → A = A, C#, E + song list with key, BPM, chord count, difficulty).
- **Scales & modes (15):** natural/harmonic/melodic minors + Dorian/Phrygian/Lydian/Mixolydian/Locrian — notes, diatonic chords, key signature.
- **Chord progressions (12):** I–V–vi–IV, vi–IV–I–V, I–IV–V, ii–V–I, 12-bar blues, Doo-Wop, Pachelbel, Andalusian, Royal Road, House of the Rising Sun, I–vi–ii–V, I–IV–I–V — each with Roman-numeral analysis + songs.

### How-to-play tutorials (`/how-to-play/{slug}`, 100 pages)

Programmatic step template per song: "How to Play X by Y on Piano" — key/BPM/difficulty header, Step 1 learn the chords (list of chords + diagrams), Step 2 slow practice at 50% (~45 BPM), Step 3 medium tempo 75% hands together, Step 4 full tempo, practice tips (15–20 min daily, metronome, loop 1–2 bars 10×, record yourself), links to player modes, lead sheet, full sheet music, artist page.

### Blog (328 posts)

SEO machine with **programmatic post patterns**:
- Decade × key series ("50s-60s Piano Songs Key of A", "2010s-2020s Piano Songs Key of E♭").
- Chord-count guides ("3 or Fewer Chords Piano Guide", "4 Chord Songs Piano Guide", "5 to 6 Chords", "7 to 9 Chords", "10+ Chords").
- Listicles ("10 Easiest Piano Songs for Beginners"), seasonal ("Christmas"), tool guides (MIDI explainer, MusicXML→PDF, Web MIDI compatibility 2026, YouTube→sheet), mode explainers ("Every Piano Player Mode Explained", "What Do the Colored Notes Mean?", "3 Ways to View Sheet Music").
- Every post ends with conversion CTAs (Browse songs / Upload a file) and "Keep reading" cards. Some pages are thin shells (JS-rendered) — the blog is partly a catalog-crawl surface.

---

## 9. SEO & catalog surface

### Song library (`/songs`)

Title pattern: "Easy Piano Songs for Beginners — Browse Thousands of Songs". Filters: difficulty (All/Beginner/Easy/Medium/Advanced + More), genre, key, tempo, chord count, mood, style, bass pattern; sort: Popular, Title A–Z, Artist A–Z, Difficulty ↑/↓. Cards show key chip, title, artist, play-count ("· 1.5K"), difficulty, BPM. Paginated list pages at `/piano-songs/easy/{genre}` (744 songs for easy Christian/Gospel, 16 pages) with related-genre links.

### Artist pages (`/artist/{slug}`, 4.7K)

Rich page per artist: "371 piano arrangements", difficulty counts ("257 easy · 63 medium"), keys covered, BPM range, genre, most-popular songs (with per-mode links: Easy Notes / Lead Sheet / Sheet Music / Falling Notes / Bar Notation / Kid Mode), full catalog grid with "Play" + key/BPM/chord-count metadata, genre sub-lists, plus `{artist}/style/{genre}` combos. `/artists` hub: top 40 artists + A–Z letter index (27 letters).

### Collections hub (`/collections`, 359 pages)

Curated index organized by:
- **Difficulty (5):** Easy, Beginner, Medium, Hard, Advanced
- **Mood (8):** Romantic, Sad, Happy, Peaceful, Energetic, Melancholic, Dramatic, Playful
- **Key (8):** C, G, D, A, E, B♭, E♭, A♭ major
- **Occasion (5):** Wedding, Christmas, Valentine's Day, Mother's Day, Funeral & Memorial
- **Genre (14):** Pop, Rock, Country, Christian/Gospel, R&B/Soul, Musical/Soundtrack, Jazz, Holiday/Christmas, Traditional, Folk, Latin, Hip-Hop/Rap, Reggae, Vietnamese
- **Tempo (6):** Slow <70, Relaxed 70–89, Medium 90–109, Moderate 110–129, Upbeat 130–149, Fast 150+
- **Chord count (6):** 3 or fewer, exactly 4, 5–6, 7–9, 10+, with 7th chords
- **Style (8):** Ballad, Pop-Rock, Upbeat Pop, Jazz Standard, Vocal-Melodic, Easy Listening, Traditional, Classical/Dramatic
- **Bass pattern (8):** Octave Bass, Oom-pah, Pedal Bass, Block Chords, Walking Bass, Alberti Bass, Arpeggio Bass, Mixed Patterns ("a filter only we offer")
- **Combination sets:** Difficulty+Genre (18), Key+Difficulty (24), Style+Difficulty (12), Mood+Genre (12), Mood+Difficulty (11), Artist+Difficulty (40), Top 40 artists, A–Z index, Learn & theory section

This is the deepest long-tail SEO asset: every tag combination gets a color-coded song list page.

### Player SEO

Each player page has: unique title ("Let It Be by The Beatles (Beginner) — Piano Sheet Music"), meta description, FAQ block (What key? Is it easy? Can I play without reading sheet music? What chords? How long to learn? What else by this artist?), teacher's notes (generated per arrangement — 5-paragraph structure: chord set, left-hand pattern, hardest transition, hands-separate advice, theory payoff), related songs (same artist + recommendations), breadcrumbs, "people learned this" count (451), and dynamic OG image (`/player/{id}/opengraph-image`).

---

## 10. Community, accounts & engagement

- **Favorites** (`/api/user/favorites`, `/api/user/favorites?songId=`): heart on every song, profile page list.
- **Playlists** (`/api/playlists`): create with Name* + optional description + **Public/Private visibility**; login required; "Organize your favorite songs into playlists"; community browse — help center: "Browse public playlists from other users. **Like, remix, and share** collections with the community." Per-song "Add to playlist" in recommendations.
- **Progress tracking**: play count, completion status, progress percentage on profile (`/api/user/progress`, `/api/user/stats`); "Mark songs as complete"; progress saved across browser sessions for logged-in users.
- **Share**: song share button (generates link, mode-specific URLs); upload share links; playlist sharing.
- **Testimonials**: homepage review carousel (anonymous learner, Erika P. Advanced, Jez F. Adult intermediate) + 8 short quotes; "Share your experience — takes 20 seconds · no signup needed" survey CTA.
- **"Now playing" bar**: global mini-player persistent across pages (seen on homepage, songs, accompaniment pages).
- **Homepage merchandising:** Editor's Picks (with genre · play count, difficulty, BPM), "Pick your learning style" (six ways), Trending Songs This Week, Popular Artists (with song counts), How It Works (3 steps), stats band.

---

## 11. Backend/API surface (evidence for a clone's architecture)

Observed endpoints (client JS + probes):

- Songs/sheet: `/api/songs/`, `/api/v1/sheet/{id}`, `/api/recommendations?songId=`
- PDF/MIDI: `/api/v1/simplify-pdf/`, `/api/user/export-pdf`, `/api/user/download-midi?songId=`, `/api/user/pdf-status`, `/api/user/midi-status`, `/api/user/pdf-purchases`, `/api/user/classic-purchases`
- Playback entitlements: `/api/playback/quota`, `/api/playback/verify-pro`
- Stripe: `/api/stripe/{checkout,classic-checkout,pdf-checkout,midi-checkout,verify-purchase,portal,end-trial}`
- User: `/api/user/{tier,favorites,stats,progress}`
- Community: `/api/playlists`
- Grading: `/api/v1/performance-history?`
- Telemetry: `/api/v1/events`, `/api/push/subscribe`

Implied infra (from behavior, not verified): a MIDI/XML rendering core (Verovio WASM + server engraving), object storage for PDFs/MIDI/audio, a job queue for YouTube transcription (processing/result job pages), Stripe webhooks + purchase ledger per song, user progress store, edge caching for 200K static pages, and an A/B flag service (KV-style).

---

## 12. Growth & retention loops

1. **SEO flywheel:** 200K crawlable pages (arrangements × levels × modes × kid × accompaniment × artists × collections × learn × blog) → free traffic → free full playback → download/paywall → revenue.
2. **YouTube converter as acquisition:** free 5 conversions → new arrangements become catalog pages → backlinks/user-generated content; conversions are the "wow" demo (demo carousel with real results).
3. **Upload → community:** user uploads can publish to community catalog (crowdsourced content + retention).
4. **Playlists/community:** public playlists, like/remix/share = social graph + return visits.
5. **Progress & favorites:** play counts, completion %, performance history = habit loops + the "451 people have learned this" social proof.
6. **Content updates:** "growing weekly" collections, trending lists, editor's picks, testimonials, new arrangement levels.
7. **A/B testing + event telemetry** to optimize the funnel (sheet mode default, track mode gates, paywall dialogs).

---

## 13. Copy inconsistencies & product notes (helpful as a caution for clone)

- "Pro 30/month" (blog) vs "Premium $9.99/mo" (pricing).
- "4 Practice Modes" (help) vs "5" (pricing) vs "six ways" (homepage) vs 8 modes (modes blog).
- Tools pages server-render "0 songs found" for several discovery tools (client-side apps; fine, but shows SSR shells).
- Kid-mode and player-mode feature sets overlap but are described differently per page.

---

## 14. Legal & compliance landscape (independent read + panel)

The site sells arrangements of copyrighted songs (PDF/MIDI) and derives arrangements from YouTube covers. Key risk areas for anyone cloning this:

- **Mechanical licenses**: selling sheet-music/MIDI reproductions of copyrighted compositions typically requires mechanical/print rights (e.g. Harry Fox Agency / MLC / publisher licenses). The site's API shows no publisher/license fields; no licensing disclosure was found on crawled pages. This is the single biggest legal exposure and is unverifiable from public crawl — a clone must treat it as a gating question, not an afterthought.
- **YouTube ToS & derivative works**: downloading YouTube audio for transcription conflicts with YouTube ToS and raises derivative-work questions; the site frames it as "fair use for personal practice" in its blog — an aggressive characterization.
- **DMCA safe harbor**: 146K catalog pages with user content (uploads, conversions) imply a need for a DMCA/notice process, designated agent, and takedown workflow; no `/dmca` or `/copyright` page was found in the sitemap.
- **Privacy**: GDPR/CCPA exposure via auth, analytics events, push subscriptions, mic permission (audio grading) — consent banner behavior not verifiable in crawl.
- **Accessibility**: color-only note coding, motion-heavy falling notes, and 8 visual modes create WCAG 2.1 AA risks (color contrast, `prefers-reduced-motion`, keyboard navigation, canvas accessibility).
- **Kids content**: Kid Mode is aimed at ages 4–12 — COPPA/GDPR-K considerations if accounts track kids.

*Panel verdict: treat licensing as critical and unresolved; the public site gives no evidence one way or the other.*

---

## 15. Build blueprint for a similar project

### Difficulty ranking (panel + own read)

1. **Arrangement generation pipeline** — every catalog song needs quantized MIDI → hand-split → simplification rules → difficulty scoring → multiple level variants (very-beginner → advanced) → lyrics alignment → engraving (Verovio) → PDF/MIDI/MusicXML export. This is the moat and the hardest part.
2. **YouTube transcription pipeline** — audio download → stem separation → piano transcription (GPU model) → MIDI cleanup → hand-split → engraving, in <90 s, at scale, with copyright filtering.
3. **Interactive player** — 8 synchronized views over one timeline, 50–150% speed, transpose, loops, Web MIDI + mic grading, Verovio rendering, PWA behavior, cross-browser (including Safari's missing Web MIDI → mic fallback).
4. **SEO/catalog pipeline** — generating and statically rendering 200K+ pages (ISR/SSG + sitemap sharding), keeping them fast behind a CDN.

### MVP build order (solo team)

1. **Player core**: one mode (Fall Down) + one engraved mode (Verovio) + audio engine + keyboard input + tempo/transpose/loop. Validate the "play in hours" promise.
2. **Arrangement engine**: MIDI → hand-split → 2–3 difficulty levels → PDF/MIDI export.
3. **Catalog + SEO**: song/artist/collection pages, sitemaps, collections hub.
4. **YouTube pipeline** (async job queue) — the acquisition hook.
5. **Grading** (Web MIDI first, computer-keyboard second, mic later).
6. **Monetization** (Stripe, per-song downloads, subscription) — earlier than it feels: it validates demand.

### Kill list (don't build until revenue validates)

- Custom song request fulfillment workflow (manual ops).
- Kid "Game Mode" gamification and COPPA-sensitive kid accounts.
- Push notifications.
- Custom A/B framework (use a simple KV flag store).
- Mic grading for Safari as a launch feature (WASM pitch-detection fallback later).

### Suggested stack (grounded in observed evidence)

- Next.js App Router + Cloudflare (Pages/Workers) — matches observed deployment; ISR/SSG for the catalog.
- Verovio (WASM) for engraving; Bravura font; server-side engraving for Sheet Music mode.
- Web Audio for synthesis (two-track voice/piano balance, chord-mode synth); Web MIDI API + `navigator.mediaDevices.getUserMedia` pitch detection.
- Postgres for songs/arrangements/users/progress/purchases; object storage (R2/S3) for PDFs, MIDI, MusicXML; job queue for transcription (e.g. Workers Queues/BullMQ).
- Stripe Checkout + webhooks + per-user entitlement ledger.
- Auth: Google/Apple OAuth + email (their exact set), or passkeys-first.

### Data model to start with (derived from their API)

`songs` (title, artist, category, difficulty, key, tempo, style, mood, bassPattern, difficultyScore, visibility, acquiredVia, sourceYoutubeUrl, contentType, hasSheetXml, sections, orgId) + `users` + `favorites` + `playlists` (+ visibility) + `progress` (play count, completion, percentage) + `performance_history` + `purchases` (songId, artifact type, status, stripe refs) + `conversions` (youtube url, status, jobId) + `uploads` + `events`.

---

## 16. Anti panel summary (external second opinion)

- **Workflow:** `panel --mode ask`, prompt = this crawl's condensed inventory (~8K chars).
- **Lanes:** claude-3.5-sonnet and claude-opus-4-6 **both timed out** through the local Antigravity gateway (generation path unhealthy; `/v1/models` stayed responsive) after 2 attempts each. Retried with free lanes: **xai-oauth grok-build-0.1 failed (HTTP 402, credits exhausted)**; **openrouter nemotron-3-ultra-550b-a55b succeeded** (14.3K tokens total, judge = nemotron-ultra). Single-model panel — treat as one heuristic second opinion, not consensus.
- **Key panel findings I agree with and folded into §14–15:** licensing is the critical unknown; the arrangement-generation pipeline (not the player) is the real moat; YouTube ToS risk; accessibility risk in color/motion modes; teacher/org multi-tenancy hinted by `orgid`; A/B infra is lightweight; MVP order (player → arrangement engine → catalog → YouTube pipeline → grading → monetization).
- **Panel claims I did NOT adopt:** "~876K unique arrangements (146K songs × 6 levels)" — the 146K player pages *are* the arrangements (≈22.3K songs × levels + conversions + uploads), not a further multiplier; "no AudioWorklet/Tone.js bundles visible" is an absence-of-evidence claim (I only inspected a subset of chunks); "teacher dashboard behind auth" is speculative (`orgid` could be internal).
- **Unverifiable from public crawl:** actual licensing agreements, the transcription model used (Basic Pitch/Omnizart/custom), Cloudflare KV/D1/R2 wiring, A/B experiment definitions, GDPR/CCPA implementation, WCAG audit results, Content-ID handling.

---

## Appendix A — Full page-type inventory

| Surface | Count | Notes |
|---|---:|---|
| `/player/{id}` and `/player/{id}/{mode}` | ~146K | modes: beginner, leadsheet, barsheet, sheetmusic, simplesheet, topdown |
| `/kid/{id}` | ~38K | kid player |
| `/piano-accompaniment/{id}` + genre hubs | ~10K | backing tracks |
| `/artist/{slug}` (+ `/style/{x}`) | ~4.4K | artist SEO pages |
| `/blog/{slug}` | 328 | programmatic SEO |
| `/piano-songs/{easy,medium}/{genre}` | ~196 | paginated lists |
| `/learn/{keys,scales,chords,chord-progressions}/{slug}` | 173 | theory |
| `/how-to-play/{slug}` | 100 | tutorials |
| `/practice/*` | 44 | 12+12+16 lessons |
| `/collections` | 359 | curated combos |
| `/tools/*` | 13 | free tools |
| `/songs`, `/artists`, `/artists/letter/*`, `/songs/{genre}`, hubs | ~60 | library |
| Static: `/pricing`, `/help`, `/contact`, `/terms`, `/privacy`, `/uploads`, `/youtube`, `/converts`, `/kid-songs` | ~10 | |

## Appendix B — Observed API endpoints

```
/api/songs/{id}
/api/v1/sheet/{id}
/api/v1/simplify-pdf/{id}
/api/v1/performance-history?
/api/v1/events
/api/recommendations?songId=
/api/user/{tier,favorites,favorites?songId=,stats,progress,export-pdf,download-midi?songId=,pdf-status?songId=,midi-status?songId=,pdf-purchases?songId=,classic-purchases?songId=}
/api/playback/{quota,verify-pro}
/api/stripe/{checkout,classic-checkout,pdf-checkout,midi-checkout,verify-purchase,portal,end-trial}
/api/playlists
/api/push/subscribe
```

## Appendix C — Evidence files

Crawl artifacts (page extracts, JS bundles, API responses, sitemap index) were kept in `/tmp/ssp/` (temporary, cleaned by OS); the live browser session used `.playwright-cli/` inside the workspace. The analysis above is the synthesized record; key raw sources: homepage, pricing, tools, youtube, converts, uploads, help, collections, songs, practice, learn, kid-songs, piano-accompaniment, 13 tool pages, 6 blog posts (incl. player-modes-explained, web-midi-browser-compatibility-2026, musicxml-to-pdf, what-is-a-midi-file, youtube-to-sheet-music), login, artist, how-to-play, learn/chords, practice lesson, player page HTML + 7 JS chunks + live player snapshots, and `/api/songs/let-it-be-066783528990861726`.
