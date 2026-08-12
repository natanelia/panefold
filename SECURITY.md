# Security policy

Panefold `0.1.0` is experimental. It has no stable security-support window. The repository now
contains bounded message authentication, an isolated-frame host, and a same-origin browser-surface
adapter, but none has received an independent security assessment. Do not treat the package as a
certified boundary for hostile code, production credentials, or cross-origin messages.

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
- An unexpected kernel exception or invariant rejection freezes structural mutation at the last
  valid snapshot. The retained incident record is bounded and excludes labels, titles, parameters,
  checkpoints, identifiers, messages, stacks, and application payloads.
- Prepared surface contracts carry protocol versions, workspace/session context, capability
  checks, owner epochs, revision checks, cancellation, rollback, and recovery outcomes.
- The injected browser-surface adapter validates same-origin bootstrap context, workspace/session
  identity, protocol version, destination identity, allowed stylesheet origins, and exactly-once
  disposal. Popup denial and destination loss preserve the source workspace in the automated
  fixture.
- `@panefold/ecosystem` supplies iterative bounded-value validation, HMAC-SHA-256 packet signing,
  a single-writer session/epoch/revision coordinator, and a sandboxed iframe host. The iframe omits
  `allow-same-origin`, transfers a dedicated `MessagePort`, and validates session, sequence, message
  type, payload bounds, target origin, and an explicit permissions allowlist.
- Plugin and panel manifests carry versions and bounded contribution namespaces. Panel parameter
  and checkpoint codecs reject invalid/future data, run one-step migrations, and preserve missing
  providers as recoverable placeholders.
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
- The HMAC authenticator and single-writer coordinator are composable protocol primitives. Panefold
  does not provision or rotate keys, choose a transport, authorize application commands, persist a
  coordinator, resolve domain conflicts, or claim durable distributed collaboration.
- The same-origin popup adapter has an automated Chromium fixture. Document Picture-in-Picture is
  dependency-injected but not exercised in a permission-capable browser; cross-origin deployment,
  opener policy, multi-screen placement, and OS/process crash recovery have no supported product
  profile.
- Trusted same-realm plugins and sandboxed iframe plugins are separate modes. The iframe host is an
  experimental isolation primitive, not proof that arbitrary third-party code is safe; browser
  sandbox escape resistance, hosting headers, capability UX, and penetration testing remain the
  deployer's and an independent assessor's work.
- Real browser crash, IndexedDB quota/corruption, permission denial, window loss, and monitor-change
  recovery remain external evidence tasks.
- Workspace packages are not published to npm; no npm provenance, package signing, or release
  attestation is claimed.

## Deployment responsibilities

Applications must supply cryptographically random per-session keys/nonces, secure key delivery and
rotation, authorization policy, exact allowed origins, CSP/Trusted Types headers, iframe content,
transport security, persistence access controls, and private-data redaction beyond Panefold's
structural defaults. Never put a reusable secret in a URL, checked-in configuration, panel
parameter, checkpoint, diagnostic, or client-visible static asset.

Current security evidence and blockers are machine-readable in
[`conformance/evidence.json`](conformance/evidence.json) and
[`conformance/gates.json`](conformance/gates.json). Any future stable claim must include the
security artifacts required by the [system design](docs/spec/SYSTEM_DESIGN.md).
