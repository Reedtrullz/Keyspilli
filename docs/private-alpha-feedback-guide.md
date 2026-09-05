# Private-alpha feedback guide

Use Keyspilli normally with symbolic files you are authorized to use. This is
not a listening assignment or test script.

If something gets in your way, send any convenient subset of:

- what you were trying to do;
- file format (`MIDI`, `MusicXML`, or `MXL`) without attaching private source
  bytes unless you choose to;
- what happened and what you expected instead;
- the visible error text;
- whether retrying, removing the file, or refreshing changed the result;
- browser/device and an approximate time, if relevant.

Compact machine-readable form, when useful:

```json
{
  "action": "upload | discovery | player | export | other",
  "format": "midi | musicxml | mxl | not-applicable",
  "outcome": "completed | blocked | confusing | slow",
  "visibleError": null,
  "recovery": null,
  "browserDevice": null,
  "approximateTime": null,
  "notes": null
}
```

Do not include passwords, API keys, cookies, bearer tokens, or private local
paths. Musical quality is not an acceptance gate for this engineering phase,
and no listening report is requested.
