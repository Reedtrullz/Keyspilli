# Obtain the exact offline-tested Keyspilli plugin candidate

The plugin compatibility workflow retains two separate artifacts for the same
workflow commit:

- `keyspilli-plugin-compatibility-<commit>`: the diagnostic report, also retained
  when compatibility fails.
- `keyspilli-plugin-candidate-<commit>`: the candidate ZIP, its package manifest
  and the unchanged successful compatibility report. Uploaded only after the
  compatibility check and byte-for-byte candidate reconstruction both succeed.

The candidate artifact contains `keyspilli.zip`, `package-manifest.json` and
`compatibility.json`. The ZIP is the plugin payload; the surrounding GitHub
artifact ZIP is a transport envelope, not an installable plugin itself.

## Identity and evidence

`compatibility.json` records the tested checkout, actual implementation
fingerprint, runtime, packaged member hashes, extracted-helper checks and real
ordinary preparation in isolated catalogs. The retention command rebuilds with
the maintained deterministic packager and requires exact equality with the
report's complete package manifest, including the ZIP hash, member hashes and
checked references. Even a deliberately refreshed source inventory cannot hide
source drift from that comparison. Original and reconstructed archives therefore
have the same bytes, not merely the same human-readable version string.

Download from the successful run attached to the intended reviewed revision.
Keep all three files together. A diagnostic report from a failed run is not a
usable candidate. This identity comparison is not a signature or authentication
of arbitrary third-party JSON: use the report emitted by the same trusted CI
execution, and retain the workflow URL and revision in any handoff.

## Local reproduction

After the existing offline compatibility check has succeeded, run from the
checkout root:

```sh
python3 -B scripts/retain-keyspilli-plugin.py \
  --source plugins/keyspilli \
  --report /absolute/passed-compatibility.json \
  --destination /absolute/new-candidate-directory
```

The destination must be new, have an existing parent, and be outside the
canonical plugin source. The command never overwrites a destination. It checks
the report and complete package identity before creating the destination, then
reads back the three retained files. An interrupted or failed copy is not a
successful candidate; do not upload or adopt such a partial directory. The
compatibility report remains unchanged. Temporary rebuild output is removed.

The underlying packager also requires distinct archive/manifest paths outside
its source, with existing parent directories. Invalid destinations must not
pollute the canonical package or leave an archive after a missing-parent error.

## Adoption and acceptance stay separate

This workflow produces an offline-tested development candidate. It does not
bump the plugin version, create a release, modify the personal marketplace,
replace installed caches, deploy the app, publish music or alter acceptance
pins. Installation/adoption must use the existing authorized distribution flow;
a downloadable candidate is not evidence that the current chat loaded it.

The tests establish structural preparation and package compatibility. They do
not establish source identity, sampled-piano listening, physical-keyboard
playability, screen-reader acceptance, musical excellence or cheaper-model
reliability. Keep these boundaries when reporting a successful candidate.
