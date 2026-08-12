# ADR-0007: Versioned panel and plugin trust boundaries

Status: Accepted

## Context

Panels and extensions carry application-owned parameters, checkpoints, renderers, commands, and
persisted namespaces. Treating a TypeScript type or same-realm registration callback as validation
would allow malformed, excessive, future, or unavailable data to corrupt restore. Treating an
ordinary callback registry as a sandbox would be worse: JavaScript in the same realm has the same
ambient authority as its host.

## Decision

Panel types are declared through a typed, heterogeneous registry. Parameter and checkpoint codecs
have independent positive versions, iterative bounds, schema predicates, and exactly one migration
per version step. A missing provider produces a recoverable placeholder that retains the safe panel
descriptor instead of deleting placement or data.

Plugin manifests declare schema, plugin, engine, and protocol versions plus bounded capabilities,
panel types, commands, and persisted namespaces. Same-realm plugins are explicitly trusted. Their
resources belong to an abortable cleanup scope, and contribution conflicts resolve by stable
identifier order with diagnostics independent of registration order.

Untrusted code uses a separate sandboxed-iframe host. It never grants `allow-same-origin`; it uses an
explicit allowed origin and permission list, transfers one `MessagePort`, and accepts only bounded,
session-bound, monotonically sequenced, allowlisted messages. This is a narrow host primitive, not a
certification of arbitrary third-party code.

## Consequences

- Panel parameters and checkpoints remain statically inferable and runtime validated.
- Missing or failed extensions preserve recoverable workspace structure.
- Same-realm and isolated plugins cannot be confused in support or security claims.
- Applications still own renderer containment, hosting headers, permissions UX, key delivery,
  application authorization, and plugin provenance.
- Independent security review and third-party certification remain required for a stable plugin
  profile.
