# Keyspilli

Personal browser-based piano-learning app (private, single-user). Color-coded
interactive player with 4 view modes, a ~100-song catalog, MIDI uploads,
YouTube conversion, live practice grading, and free PDF/MIDI/MusicXML export.

## Quick start

```bash
npm install
npm run pipeline   # build catalog artifacts + sqlite db from data/seed-midi + catalog/manifest.json
npm run dev        # http://localhost:3000
```

## Docs

- Master plan: `docs/superpowers/plans/2026-08-09-keyspilli-mvp.md`
- Reference analysis: `supersimplepiano-analysis.md`
- Ops (deploy/backup): `docs/ops.md`
