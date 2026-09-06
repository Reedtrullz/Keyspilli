# Private-alpha feedback guide

Use Keyspilli normally with symbolic files you are authorized to use. This is
not a listening assignment or test script.

## Open Keyspilli

1. Open `https://keys.reidar.tech` in the browser.
2. When the browser asks for credentials, use username `reidar` and the
   password stored in macOS Keychain Access under `keys.reidar.tech`.
3. Allow the browser to remember the login if desired, then use **Add a song**.

If the browser remembers a wrong password and does not ask again, quit the
browser completely, reopen it, and enter the Keychain credential. To recover
the password without developer tools, open **Keychain Access**, search for
`keys.reidar.tech`, open the Internet password entry, and choose **Show
password**; macOS will ask for owner authentication. The password is never
stored in this repository.

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
