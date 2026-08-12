# ADR-0006: Prepared transfer and exclusive external-surface ownership

Status: Accepted

## Context

Moving a panel into another document is a distributed protocol. Opening a window and then issuing a
normal move can lose the panel, create two authoritative hosts, or accept a stale coordinator after
the workspace changes.

## Decision

External transfer follows one ordered protocol: capability check, destination preparation,
bootstrap, panel checkpoint, revision revalidation, ownership commit, destination mount,
destination-ready acknowledgement, then source release. The prepared destination is opaque and
bound to a surface ID, protocol version, workspace session nonce, capability context, and owner
epoch.

A driver-neutral ownership registry permits exactly one state per panel: source-owned,
transferring, destination-pending-ready, or destination-owned. Failure before readiness rolls back
and compensates a committed ownership change under a fresh, bounded safety budget. The source is
reported as authoritative only after compensation is confirmed; otherwise the destination remains
pending and its resource is retained for recovery. Once the destination is ready it remains
authoritative even if source cleanup fails; cleanup is retried without rolling ownership back.
Surface loss recovers panels into an explicit safe surface under a newer coordinator epoch.

## Consequences

- Direct move, swap, float, PiP, or redock commands cannot bypass a cross-document boundary.
- Adapters own browser APIs, origin authentication, style/context transfer, and user-activation
  acquisition; the semantic kernel does not.
- Popout, Document PiP, and multi-screen support remain experimental protocol primitives until the
  browser failure matrix and security review are published.
- Dropped, duplicated, reordered, cancelled, and stale messages must remain part of the automated
  model and failure-injection suite.

## Current implementation note

An injected, SSR-safe adapter now exercises this ordering with headless failure injection and a real
same-origin Chromium popup, including prepare/ready, intentional close, and unexpected-loss
recovery. Document Picture-in-Picture remains capability-injected only; cross-origin deployment,
real process failure, multi-screen placement, monitor removal, and an independent security review
remain outside the published profile.
