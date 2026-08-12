# Roadmap

The normative phase definitions come from the
[Panefold system design](spec/SYSTEM_DESIGN.md#27-delivery-roadmap-and-governance). A package or API
can exist before its phase exit gate is satisfied. The table therefore separates implemented
engineering from conformance evidence.

| Phase                           | Implemented experimental engineering                                                                                                                                                                                        | Missing exit evidence or product work                                                                                                                                | Gate state                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 0 — executable specification    | Schema-v2 model, 190-ID register, all 36 commands, reference reducer, invariants, canonicalization, patch replay, property tests, and bounded small-state exploration                                                       | Publish the required ten-million-operation model run, broader generated workloads, and reproducible model report                                                     | Unresolved                                |
| 1 — optimized kernel            | Persistent bucket map, derived indexes, bounded history, patch-based optimized projection, seeded differential smoke runner, and lookup microbenchmark                                                                      | Build an independently reducing optimized kernel and publish long-run differential results after every generated command                                             | Unresolved                                |
| 2 — geometry and basic DOM      | N-ary constraint solver, exact rounding, resolved rectangles, React geometry bridge, tabs, splitters, focus handling, keyboard menus/dialogs, and automated semantics                                                       | Complete the declared keyboard-only task matrix on real target systems and resolve remaining accessibility trace cells                                               | Unresolved                                |
| 3 — interaction and motion      | Driver-neutral protocols, XState drag/resize actors, frame-coalesced resize preview, snap/drop helpers, FLIP, interruption, and reduced/off motion behavior                                                                 | Publish physical 60 Hz and 120 Hz traces, full pointer/drag coverage, interruption fuzz reports, and raw traces                                                      | Blocked on physical evidence              |
| 4 — lifecycle and heavy content | Stable same-document hosts, explicit lifecycle policies, abortable lifecycle leases, cooperative suspension, and synthetic editor/map/grid/media/iframe/microfrontend fixtures                                              | Run real heavy-content lifecycle torture, heap/resource baselines, cross-document lifecycle work, and no-remount certification                                       | Blocked on real fixtures and traces       |
| 5 — operational runtime         | Versioned bounded codecs, schema-v1-to-v2 migration, checksummed envelopes, atomic journal contract, checkpoint ordering, last-known-good recovery, durable runtime policies, Effect wrappers, and injected IndexedDB tests | Certify real browser crash, quota, corruption, upgrade, application-layout, and panel-checkpoint migration behavior                                                  | Unresolved; real failure evidence blocked |
| 6 — external surfaces           | Capability intersection, prepared-transfer coordinator, exclusive ownership registry, epochs, rollback/compensation, loss recovery, and deterministic protocol tests                                                        | Build and certify browser-window/Picture-in-Picture adapters, origin/authentication deployment, popup/refresh/crash matrix, monitor loss, and formal ownership proof | Product profiles unsupported              |
| 7 — framework adapters          | Shared adapter contract plus native React, Vue, Svelte, Angular, and Web Components packages; JSDOM contract and SSR-import tests                                                                                           | Run the common suite in real supported framework/browser combinations, test strict/concurrent lifecycles, and obtain third-party compatibility evidence              | Experimental contract only                |
| 8 — ecosystem                   | Trusted in-process plugin registry, bounded/redacted devtools recorder, validated remote command intake, and mobile data projection                                                                                         | Untrusted isolation, durable collaboration/coordinator/conflict resolution, certified touch UI, extension pilots, and third-party certification metadata             | Product capabilities unsupported          |

## Dependency order

1. Preserve Phase 0 semantic laws and authoritative command parity.
2. Finish Phase 1's independent differential oracle before performance-driven kernel substitution.
3. Close Phase 2 accessibility and keyboard evidence before expanding pointer-only behavior.
4. Establish Phase 3 physical performance baselines before claiming interaction budgets.
5. Complete Phase 4 lifecycle torture before advertising heavy-content support.
6. Certify Phase 5 recovery before depending on durable state for Phase 6 or collaboration.
7. Complete Phase 6 ownership/security evidence before shipping any external-surface product profile.
8. Run Phase 7 shared certification before publishing framework support ranges.
9. Treat Phase 8 pilots as external evidence that cannot be manufactured by repository code.

No roadmap row changes the current release classification: every package and published profile is
experimental. Gate status is recorded in [`conformance/gates.json`](../conformance/gates.json), and
unsupported product claims are recorded in
[`conformance/manifest.json`](../conformance/manifest.json).
