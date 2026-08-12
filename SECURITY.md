# Security policy

Panefold `0.1.0` is experimental. It has no stable security-support window and must not be used as a
security boundary for untrusted plugin code, unauthenticated remote commands, or cross-origin
surface messages.

## Reporting a vulnerability

Report suspected vulnerabilities privately through this repository's GitHub security-advisory
flow. Include the affected commit/version, a minimal reproduction, expected impact, relevant
deployment assumptions, and any proposed mitigation. Do not include production data, secrets,
credentials, private checkpoints, or personal information.

Please allow maintainers to reproduce and assess the report before public disclosure. Because this
is an experimental project, no response-time or patch-SLA commitment is currently offered.

## Implemented experimental controls

- Persistence decoding is versioned, checksummed, iterative, and bounded by bytes, depth, nodes,
  array length, object keys, and string length. It rejects non-finite values, cycles, sparse arrays,
  accessors, unsafe keys, and non-plain prototypes before kernel validation.
- Runtime command queues, history, journals, traces, remote deduplication, devtools retention, and
  diagnostic retention have explicit limits.
- Prepared surface contracts carry protocol versions, workspace/session context, capability
  checks, owner epochs, revision checks, cancellation, rollback, and recovery outcomes.
- The demo declares a CSP, and the repository source check rejects `eval`, `new Function`, common
  unsafe HTML sinks, React raw-HTML injection, and `document.write` in tracked source.
- Telemetry is off by default. Reproduction and devtools paths require bounded, caller-controlled
  redaction; the demo's reproduction export omits transaction labels and panel payloads.
- Persistence and operational failures are typed; storage failure does not replace the in-memory
  authoritative snapshot.

These controls are repository-local implementation evidence, not an independent audit or proof of
security.

## Explicitly uncertified or unsupported

- No independent threat model, penetration test, dependency/provenance assessment, or signed
  security report has been completed.
- Strict-CSP and Trusted Types deployment has not been certified across supported applications and
  browsers; the source scan and demo policy are narrower checks.
- The remote-command bridge validates and deduplicates caller-supplied envelopes, but provides no
  transport, authentication, authorization, durable coordinator, or conflict resolution.
- The prepared surface coordinator is a headless protocol primitive. Browser popouts, Document
  Picture-in-Picture, cross-origin messaging, and multi-screen placement have no supported product
  profile or real browser failure matrix.
- The plugin registry accepts trusted, in-process declarative plugins. Dynamic untrusted plugins
  and isolation/sandbox guarantees are unsupported.
- Real browser crash, IndexedDB quota/corruption, permission denial, window loss, and monitor-change
  recovery remain external evidence tasks.
- Workspace packages are not published to npm; no npm provenance, package signing, or release
  attestation is claimed.

Current security evidence and blockers are machine-readable in
[`conformance/evidence.json`](conformance/evidence.json) and
[`conformance/gates.json`](conformance/gates.json). Any future stable claim must include the
security artifacts required by the [system design](docs/spec/SYSTEM_DESIGN.md).
