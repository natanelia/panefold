## Summary

<!-- What changed? Keep this concrete and user-visible where possible. -->

## Why

<!-- Which problem or issue does this solve, and why does it belong in Panefold's core? -->

## Architecture and boundaries

<!-- Describe effects on commands, invariants, ownership, transactions, lifecycle, persistence,
accessibility, motion, security, recovery, public APIs, and experimental support claims. State
"unchanged" where appropriate. Link an ADR for a boundary-level decision. -->

## Verification

<!-- List exact commands, targeted tests, browsers/environments, and any retained evidence. -->

- [ ] `pnpm check`
- [ ] Relevant unit/property tests
- [ ] `pnpm test:e2e` when workspace/browser behavior changes
- [ ] `pnpm test:site:e2e` when the site or documentation experience changes

## Checklist

- [ ] Snapshots remain immutable; rejected commands cannot publish partial state.
- [ ] New queues, histories, traces, retries, listeners, and resources are explicitly bounded and disposed.
- [ ] Success, rejection, stale input, interruption, recovery, and cleanup are tested where relevant.
- [ ] Public types, exports, docs, command/capability inventories, and generated evidence stay synchronized.
- [ ] No automated fixture is presented as manual, independent, physical-device, or product certification.
- [ ] No stable or npm-publication claim was introduced for the experimental source release.
- [ ] Security-sensitive details are not disclosed in this pull request.
