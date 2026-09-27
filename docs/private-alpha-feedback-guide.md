# Private-alpha feedback guide

Use Keyspilli normally with symbolic files you are authorized to use. This is
not a listening assignment or test script.

## Open Keyspilli

1. Open [Keyspilli](https://keys.reidar.tech). This is a private deployment, not a public demo.
2. Use the credentials supplied by the operator. If you do not have access, ask for an invitation.
3. Choose **Add a song** to upload MIDI, MusicXML or MXL. If the tutorial beta is enabled, a YouTube piano-tutorial option is also available.

If a saved login no longer works, update the browser's saved credentials or ask the operator to reset access. Never include credentials in a bug report.

If something gets in your way, send any convenient subset of:

- what you were trying to do;
- input type (`MIDI`, `MusicXML`, `MXL`, or piano tutorial) without attaching private source
  bytes unless you choose to;
- what happened and what you expected instead;
- the visible error text;
- whether retrying, removing the file, or refreshing changed the result;
- browser/device and an approximate time, if relevant.

Compact machine-readable form, when useful:

```json
{
  "action": "upload | discovery | player | export | other",
  "format": "midi | musicxml | mxl | tutorial | not-applicable",
  "outcome": "completed | blocked | confusing | slow",
  "visibleError": null,
  "recovery": null,
  "browserDevice": null,
  "approximateTime": null,
  "notes": null
}
```

Do not include passwords, API keys, cookies, bearer tokens, or private local
paths. For playback issues, the song title, level, mode, and passage timestamp help.
Ordinary usage feedback does not require a listening assignment or a musical
acceptance verdict.
