# Contributing

## Development

```bash
corepack enable
pnpm install
pnpm check
```

Use semantic commands for all canonical changes. Do not mutate snapshot records from adapters,
write pointer frames into framework state, attach unscoped listeners, or import browser/framework
packages into model, kernel, or geometry.

A behavior change should include:

- its command, capability, policy, error, focus, accessibility, motion, persistence, and recovery
  implications;
- a kernel law or an explanation that existing invariants are unchanged;
- unit/property tests and the relevant adapter or browser fixture;
- documentation and an ADR when an ownership boundary, invariant, transaction order, lifecycle, or
  protocol changes.

Run formatting and verification before opening a pull request. Never weaken a failed conformance
gate to make a change appear green.
