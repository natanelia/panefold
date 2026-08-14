# Conformance status

Panefold `0.1.0` is an **experimental executable implementation**. It does not claim stable
conformance to the [Panefold system design](spec/SYSTEM_DESIGN.md).

The current machine report is structurally valid and intentionally reports **blocked**: all 36
commands, all 190 Appendix A requirements, and all ten hard gates are present, but stable-release
evidence is incomplete. On the two published experimental profiles, the 380 trace cells currently
contain 109 verified, 110 unresolved, 33 blocked, and 128 not applicable results. A missing result
never becomes an implicit pass.

The trace-cell taxonomy above is distinct from the aggregate validator report, which currently
contains 42 blocked issues and 115 unresolved issues. Aggregate issues also include hard-gate and
evidence findings, so those counts are not trace-cell totals.

Because at least one hard gate remains open, the machine report applies a hard-gate multiplier of
zero and publishes a release-quality score of `0`. A strong isolated benchmark cannot compensate
for a failed release gate.

The requirement-by-requirement review, corrected overclaims, action-parity findings, and remaining
gaps are recorded in the [design audit](DESIGN_AUDIT.md).

## Evidence taxonomy

Every trace and evidence record declares one proof class:

| Class                      | Meaning                                                                                                | Current totals                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| A — code-verifiable        | Repository implementation, model/property proof, source contract, or deterministic code result         | 89 verified, 54 unresolved, 0 blocked, 0 N/A |
| B — environment-verifiable | Executed browser, framework, workload, recovery, or performance result with environment metadata       | 20 verified, 56 unresolved, 0 blocked, 0 N/A |
| C — manual/external        | Manual AT/physical evidence, independent review, adoption record, usability result, or signed approval | 0 verified, 0 unresolved, 33 blocked, 0 N/A  |
| D — future scope           | Capability the specific experimental profile does not publish                                          | 0 verified, 0 unresolved, 0 blocked, 128 N/A |

Evidence also distinguishes source, executed result, and attestation. A source hash proves exactly
which artifact was reviewed; it does not pretend that the test passed. A result records a bounded
execution and its limitations. A certification or release approval must be content-addressed,
timestamped, and signed by the declared issuer.

## Machine-readable artifacts

| Artifact                                                | Purpose                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`manifest.json`](../conformance/manifest.json)         | Experimental profiles, feature IDs, limitations, and unsupported product claims                  |
| [`commands.json`](../conformance/commands.json)         | Status and exact boundary for the exhaustive 36-command inventory                                |
| [`capabilities.json`](../conformance/capabilities.json) | Public capability classification, profile scope, evidence links, and limitations                 |
| [`requirements.json`](../conformance/requirements.json) | Generated 190-row Appendix A register linked to the checked-in system design                     |
| [`evidence.json`](../conformance/evidence.json)         | Content-addressed source/results plus explicit external blockers                                 |
| [`traces.json`](../conformance/traces.json)             | One status and proof class for every requirement/profile cell                                    |
| [`gates.json`](../conformance/gates.json)               | Exact requirement/profile/evidence-class scope for all ten release gates                         |
| [`results/`](../conformance/results/)                   | Checked-in Chromium, framework, exact protocol-state, motion, performance, and model-run results |
| [`@panefold/conformance`](../packages/conformance/)     | Closed validators, trace/gate audit, deterministic report, and certification contract            |

The validators reject malformed or duplicate claims, unsupported capabilities carrying support
evidence, bad URIs/hashes, hash drift, invented requirement/profile IDs, proof-class mismatch,
uncovered verified traces, and verified gates backed by open evidence. The public third-party
certification schema cannot mark a candidate certified without a signed, immutable approval.

Run the report with:

```bash
pnpm conformance:data:check
pnpm conformance:check
```

`conformance:check` exits non-zero only for invalid claims or a prohibited stable-release claim. A
blocked/unresolved report is the correct result for this experimental version and remains visible in
the command output.

## Executed results checked in

- The compact Chromium fixture covers semantics/axe, center docking, four-way container creation,
  working pointer/keyboard splitters, logical and icon-only tab rails, exact IndexedDB
  save/reload/restore evidence, live same-origin popup transfer/redock/loss recovery, LTR/RTL resize,
  motion preference, stable-host lifecycle, all 17 panel classes, forced colors, touch projection,
  same-strip reorder in horizontal LTR, horizontal RTL, and vertical rails, bounded LTR/RTL
  overflow autoscroll, one-action populated and empty panel-container removal, same-document
  floating move/resize/minimize/maximize/restore/redock with compact sole-panel chrome, movable
  minimized headers, stable live panel state, and raw splitter-frame capture. The checked-in result
  records 29/29 passing browser tasks.
- The framework JSDOM contract passed 20/20 tests across Vue, Svelte, Angular, and Web Components.
- The compact headless protocol result matches the reviewed graphs for all 12 Appendix-C actors:
  84/84 states, 258/258 transition branches, both outcomes for 64/64 guarded branches, and 146/146
  adversarial/interruption/timeout/recovery/finalizer/impossible-event obligations. Its bounded
  traversal explored 533 snapshots and 7,837 impossible-event cases. Across 36 phase-specific
  timeout scenarios, a virtual FIFO scheduler performs 84 literal schedules: 72 firings across
  primary and byte-equivalent replay runs plus 12 cancelled twins, with zero pending handles. This
  is code evidence, not browser/OS/process failure certification or the per-panel final-authority
  matrix required by `TST-009`.
- Protocol/motion validation passed 86/86 focused tests plus 92/92 React integration tests. It
  covers the twelve-actor catalog, cancellation/revision conflicts, disposable motion leases,
  progressive View Transition fallback, and deterministic load degradation; these focused tests
  supplement rather than substitute for the exact graph result above.
- The independent semantic reducer matched the complete reference result for all 36 curated command
  variants, 6,000 generated test attempts, and a separate reproducible 10,000-attempt campaign
  (7,973 accepted, 2,027 typed rejections, zero divergence). It remains an oracle that rebuilds
  state per command, not the retained optimized production kernel.
- The earlier 50,000-attempt projection campaign completed with zero replay/projection divergence.
  It is below the ten-million stable threshold and its checked-in summary records the missing seed.
- The container interaction capture retained 179 frame deltas at 9.3 ms p95 and 9.4 ms p99, with
  two observed long tasks of 91 ms and 58 ms. The paired Node smoke run measured 50-panel reorder
  at 0.9273 ms p95 and 500-panel reorder at 5.0729 ms p95; the latter missed its 5 ms design target
  on that machine. These are experimental regression guards—not physical performance certification.

## Hard release gates

| Gate            | State      | Evidence still required                                                                                                      |
| --------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Model integrity | Unresolved | Publish the required ten-million-operation report                                                                            |
| Determinism     | Unresolved | Protocol graph/deadline coverage passes; the retained optimized-kernel campaign and ten-million stable threshold remain open |
| Atomicity       | Unresolved | Complete fallible persistence/surface operational matrix beyond local and injected-driver tests                              |
| Accessibility   | Blocked    | Manual NVDA, JAWS, VoiceOver, TalkBack, 400% zoom, forced-colors, and voice-control records on declared systems              |
| Lifecycle       | Blocked    | Third-party heavy-content torture plus heap/listener/observer/resource baselines                                             |
| Performance     | Blocked    | Controlled physical 60 Hz and 120 Hz traces with raw data and confidence intervals                                           |
| Recovery        | Blocked    | Real process/tab/window, IndexedDB quota/corruption, permission, monitor-loss, and upgrade runs                              |
| Security        | Blocked    | Independent threat/protocol/dependency/provenance review and deployed CSP/Trusted Types evidence                             |
| Migration       | Unresolved | Application-layout and panel-type migration corpus beyond the tested kernel and panel-codec paths                            |
| Public evidence | Unresolved | Remaining raw compatibility records, independent certifications, and signed release approval                                 |

## Published profile boundary

- `compact-react-chromium-desktop` is one React 19.2.8 / Playwright Chromium Darwin 25.6 arm64 fixture, with a
  390×844 touch-emulation subprofile and controlled same-origin popup. It is not a general browser,
  OS, mobile hardware, PiP, multi-screen, crash, security, or assistive-technology promise.
- `framework-adapter-contract-jsdom` is an immutable-store/lifecycle/SSR contract for Vue, Svelte,
  Angular, and Web Components. It does not publish the bounded protocol actors, so `TST-003` is N/A
  for that profile. JSDOM is not rendering, hydration, focus, accessibility, performance, or
  third-party adoption evidence.

Any future stable claim must close every applicable `MUST`, all ten hard gates, and the entire
published profile matrix. External evidence that this repository cannot ethically self-issue stays
blocked; the support claim remains experimental until that evidence exists.
