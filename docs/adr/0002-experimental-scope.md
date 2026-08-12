# ADR-0002: Publish the first slice as experimental

Status: Accepted

## Context

The end-state specification has 190 normative requirements, ten hard release gates, multiple
frameworks and browsers, manual assistive-technology tasks, multi-window ownership protocols, and
large reproducible performance workloads.

## Decision

Version 0.1 is an experimental vertical slice with an explicit support matrix. It implements the
pure kernel, core geometry, runtime, React reference projection, and a compact in-page demo. Missing
capabilities are labeled unsupported rather than approximated through unsafe shortcuts.

## Consequences

- The repository is useful and testable without making a false conformance claim.
- Public types may evolve before 1.0.
- Browser popouts, collaboration, dynamic plugins, other frameworks, and certification are deferred.
- Any future stable release must supply the complete evidence bundle for its published profile.

## Current implementation note

The original vertical slice has since gained native framework bindings, versioned panel/plugin
boundaries, authenticated single-writer coordination primitives, and a controlled same-origin
popup fixture. Those additions do not revise this decision: they remain experimental and are
classified narrowly in the support/conformance manifests. Unrestricted popout/PiP, durable
collaboration, arbitrary hostile-plugin certification, third-party framework certification, and a
stable release are still outside the published profile.
