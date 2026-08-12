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
pnpm test:site:e2e
```

`pnpm check` verifies formatting, package boundaries, security source checks, generated
requirements and conformance data, builds, conformance structure, a performance smoke workload,
strict TypeScript, tests, and the demo plus documentation/marketing build. Run both Playwright
suites when browser, demo, documentation, or site behavior changes.

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
- Same-realm trusted plugins, isolated-frame plugins, and application-owned renderers are distinct
  trust modes; follow [ADR-0007](docs/adr/0007-versioned-panel-and-plugin-boundaries.md).
- Remote transport cannot assign semantic revisions outside the single-writer boundary in
  [ADR-0008](docs/adr/0008-single-writer-remote-coordination.md).
- A structural invariant defect follows the fail-closed contract in
  [ADR-0009](docs/adr/0009-fail-closed-runtime.md).
- The independent semantic oracle stays separate from both the reference authority and retained
  projection; follow [ADR-0011](docs/adr/0011-independent-semantic-oracle.md).
- Bounded protocol actors and optional motion use explicit disposable scopes; follow
  [ADR-0012](docs/adr/0012-bounded-protocol-and-motion-lifecycles.md).

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

## Evidence artifacts

Follow [ADR-0010](docs/adr/0010-executable-evidence-taxonomy.md). Source bytes, executed results,
and signed attestations are different artifact roles. A new verified trace must identify the right
A/B/C verification class, exact profile and requirement IDs, an immutable URI, SHA-256 digest, and
RFC 3339 production time. Checked-in browser/workload results belong in `conformance/results/` and
must retain raw samples and environmental limits.

Third-party adapter/plugin work starts from the exported
`@panefold/conformance/certification-template`; `candidate` is non-certifying, while `certified`
requires content-addressed evidence and a signed approval. Do not copy a self-produced candidate
into the core release as external evidence.

## Evidence language

Repository tests can establish narrowly scoped automated evidence. They cannot self-certify:

- manual assistive-technology behavior;
- physical 60 Hz or 120 Hz performance;
- real process crash, quota/corruption, PiP permission, monitor, or cross-origin behavior beyond a
  checked-in automated fixture;
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
