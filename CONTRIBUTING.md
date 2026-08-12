# Contributing

Panefold is an experimental implementation of the
[normative system design](docs/spec/SYSTEM_DESIGN.md). Contributions are welcome, but an impressive
demo is not evidence that a support or conformance gate has passed.

## Development

Requirements: Node.js 22 or newer and pnpm 11.

```bash
corepack enable
pnpm install
pnpm check
pnpm test:e2e
```

`pnpm check` verifies formatting, package boundaries, security source checks, generated
requirements and conformance data, builds, conformance structure, a performance smoke workload,
strict TypeScript, tests, and the demo build. Run the Playwright suite separately when browser
behavior changes.

All packages remain workspace-local and experimental. Do not add publishing instructions, stable
support ranges, or certification language without the corresponding release decision and evidence.

## Architectural rules

- The semantic kernel is the only owner of committed workspace state.
- All canonical changes enter through typed semantic commands; adapters never mutate snapshots.
- Model, kernel, and geometry stay headless. Do not import DOM, framework, Effect, XState, or motion
  implementations into those boundaries.
- Pointer frames, speculative geometry, protocol states, animations, and operational retries do not
  enter persisted semantic state.
- Fallible prepare work happens before semantic commit; post-commit effects cannot retroactively
  rewrite a committed transaction.
- Queues, histories, traces, journals, deduplication ledgers, and diagnostic retention must be
  explicitly bounded.
- Same-document stable-host behavior and lifecycle lease ordering follow
  [ADR-0004](docs/adr/0004-panel-lifecycle-contract.md).
- Cross-document ownership follows prepared transfer and cannot be approximated by an ordinary
  panel move.

See [Architecture](docs/ARCHITECTURE.md) and the [ADRs](docs/adr/) before changing an ownership,
invariant, transaction, lifecycle, persistence, or protocol boundary.

## Change requirements

A behavior change should cover:

- command, capability, policy, error, focus, accessibility, motion, persistence, and recovery
  consequences;
- the affected kernel law, or a clear explanation that existing invariants are unchanged;
- unit or property tests plus the relevant adapter, protocol, persistence, or browser fixture;
- deterministic IDs, clocks, schedulers, and randomness where replay is involved;
- documentation and an ADR for ownership, invariant, transaction-order, lifecycle, schema, or
  protocol decisions.

When changing the command catalog, update the discriminated union and `WORKSPACE_COMMAND_TYPES`
together, implement reference semantics, add rejection and replay tests, and keep
`conformance/commands.json` plus [Command support](docs/COMMANDS.md) in exact parity. Do not create a
second command inventory.

When changing the normative design, run:

```bash
pnpm requirements:generate
pnpm conformance:data:generate
pnpm conformance:check
```

Review generated diffs. Never hand-edit generated evidence hashes or mark an unresolved/blocked
item verified merely to make a check pass.

## Evidence language

Repository tests can establish narrowly scoped automated evidence. They cannot self-certify:

- manual assistive-technology behavior;
- physical 60 Hz or 120 Hz performance;
- real crash, quota, popup, permission, monitor, or cross-origin behavior;
- independent security review or absence of vulnerabilities;
- third-party framework, plugin, or adoption success.

Keep those items unresolved or blocked until reproducible external evidence exists. If a change
cannot meet a stable requirement, narrow the claim or retain the experimental classification.

## Pull-request checklist

- [ ] The change preserves immutable snapshots and rejection atomicity.
- [ ] New work is bounded, deterministic, and finalized on cancellation/disposal.
- [ ] Tests cover success, rejection, stale input, interruption, and cleanup where applicable.
- [ ] Public types and package exports are intentional and documented.
- [ ] Command, capability, support, and conformance inventories remain synchronized.
- [ ] No automated fixture is described as manual, external, or product certification.
- [ ] `pnpm check` passes; relevant Playwright work is also exercised.

Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
