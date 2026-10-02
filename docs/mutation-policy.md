# Private deployment mutation policy

The reverse proxy authenticates the private owner, removes client-supplied internal authentication headers and is the only public ingress. Same-origin metadata is a CSRF/browser contract, not owner identity. Keep `deploy/test/access-boundary.sh` passing.

| Route class | Application boundary | Body contract |
| --- | --- | --- |
| Catalog, artifact, health and job reads | Required private edge; no application bearer required | Read-only; favorites selection POST `/api/songs` accepts only `ids` (at most 5,000), 1 MiB actual bytes, 5 seconds |
| Upload, source handoff/confirmation, tutorial import/cancellation, play counter, metadata PATCH | `checkMutationAuth`: valid bearer or private same-origin browser; explicit Authorization takes precedence over transported token | JSON objects: 16 KiB actual UTF-8 bytes, 5-second deadline; symbolic upload: 10 MiB, 60 seconds |
| Catalog DELETE, maintenance YouTube queue and queued-job deletion/retry | Explicit application bearer, including the proxy's preserved transport header | JSON objects: 16 KiB, 5 seconds; no body on delete/retry |

Authenticate before reading a mutation body. JSON readers cancel oversize, timed-out and aborted streams; caller schemas accept only their documented types and never promote a supplied source candidate to provider authority. Unsupported/malformed requests must not reach publication or DB writes. Play counts are protected listening telemetry, not completed practice or anonymous public telemetry.

`apiAuthorization` preserves explicit-header precedence. A forged forwarding header is not an identity claim: the private ingress must replace it, and direct public access to the web service remains unsupported. Test both the application boundary and the deployment boundary; passing application tests alone does not prove the private ingress configuration.


Owner metadata PATCH supports title/artist/category through a bounded preview.
The browser supplies its exact expected publication revision; the shared writer
checks it again under the base lock. Legacy machine callers retain optional
revision compatibility. Key and tempo roles retain their existing validation
and are absent from this descriptive UI. Explicit invalid authorization rejects
a same-origin request rather than falling back to browser metadata.
