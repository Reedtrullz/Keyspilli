# Security maintenance

This is a private, single-owner deployment. The private reverse proxy and application mutation credentials are both required. Direct public access to the web/worker services is unsupported.

Report suspected vulnerabilities privately to the repository owner through your existing private contact channel. If GitHub private vulnerability reporting is enabled, use [Report a vulnerability](https://github.com/Reedtrullz/Keyspilli/security/advisories/new). Do not put exploit details, private source material, personal data or credentials in public issues. Include the commit/image SHA, affected route and a minimal reproduction with synthetic data; never send a real token or password.

The supported Node runtime is pinned in `.nvmrc` and CI. Use the npm lockfile and hashed Python requirements; the fixture-test closure intentionally excludes transcription model runtimes. Review dependency updates with typechecks, workspace tests, relevant browser/worker fixtures and the private-edge check. No automatic major upgrades or auto-merge. Shared Python pins must stay aligned between test and tutorial requirements.

Workflow checks have read-only repository permissions. Only image publication receives package-write permission. Production changes retain the production environment gate and exact-SHA health/rollback verification. Schema epoch 1 is additive; supported application releases read epochs 0–1 and migrate 0 atomically. An epoch above 1 must be handled by a compatible release or coherent backup restoration, never by changing `user_version` to bypass compatibility checks. Historical images predating schema enforcement are not safe rollback targets after a future incompatible migration.
