# ADR-0011: Separate the independent semantic oracle from optimized projection

Status: Accepted

## Context

Differential testing is weak when both sides share the same reducer, canonicalizer, or patch
decisions. At the same time, calling a correctness-first implementation “optimized” would be
misleading if it rebuilds its indexes and entity tables for every command.

## Decision

The reference kernel remains the only production semantic authority. The optimized package keeps
two non-authoritative experiments behind distinct boundaries:

- the retained projection consumes committed reference patches to maintain copy-on-write buckets,
  indexes, and bounded history;
- an internal correctness-first reducer independently implements all 36 command discriminants,
  canonicalization, ordered patches, inverses, diagnostics, and rejection contracts using a local
  Map draft.

The independent reducer may share public model types and use the public workspace validator and
canonical serializer as output/specification oracles. Its semantic path must not call or fall back
to the reference reducer, canonicalizer, patch application, transaction replay, or topology
helpers. Differential comparison covers the complete accepted/rejected result after every attempt,
not only the resulting state hash.

The independent reducer is intentionally not exported from the package entry point. A private
provenance marker prevents caller-supplied `independent: true` metadata from satisfying the Phase 1
flag. Phase 1 remains incomplete until a retained stateful implementation demonstrates the required
performance and ten-million-command parity artifact.

## Consequences

- Semantic drift can be detected by a genuinely different decision path.
- The public package cannot accidentally promote an internal oracle into a production authority.
- Complete-result comparison catches patch, inverse, diagnostic, and rejection drift that a hash
  comparison would miss.
- Command semantics are implemented twice, increasing maintenance cost; the 36-case inventory and
  generated campaigns therefore remain mandatory.
- The current Map reducer is correctness evidence, not a performance claim.
