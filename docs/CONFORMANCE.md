# Conformance status

Panefold `0.1.0` is an **experimental executable implementation**. It does not claim stable
conformance to the [Panefold system design](spec/SYSTEM_DESIGN.md).

The current machine report is structurally valid and intentionally reports **blocked**: all 36
commands, all 190 Appendix A requirements, and all ten hard gates are present, but stable-release
evidence is incomplete. On the two published experimental profiles, the 380 trace cells currently
contain 115 verified, 110 unresolved, 42 blocked, and 127 explicitly out-of-scope results. A missing
result never becomes an implicit pass.

## Evidence taxonomy

Every trace and evidence record declares one proof class:

| Class                      | Meaning                                                                                                | Current totals             |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------- |
| A — code-verifiable        | Repository implementation, model/property proof, source contract, or deterministic code result         | 93 verified, 51 unresolved |
| B — environment-verifiable | Executed browser, framework, workload, recovery, or performance result with environment metadata       | 22 verified, 54 unresolved |
| C — manual/external        | Manual AT/physical evidence, independent review, adoption record, usability result, or signed approval | 33 blocked                 |
| D — future scope           | Capability the specific experimental profile does not publish                                          | 127 not applicable         |

Evidence also distinguishes source, executed result, and attestation. A source hash proves exactly
which artifact was reviewed; it does not pretend that the test passed. A result records a bounded
execution and its limitations. A certification or release approval must be content-addressed,
timestamped, and signed by the declared issuer.

## Machine-readable artifacts

| Artifact                                                | Purpose                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`manifest.json`](../conformance/manifest.json)         | Experimental profiles, feature IDs, limitations, and unsupported product claims       |
| [`commands.json`](../conformance/commands.json)         | Status and exact boundary for the exhaustive 36-command inventory                     |
| [`capabilities.json`](../conformance/capabilities.json) | Public capability classification, profile scope, evidence links, and limitations      |
| [`requirements.json`](../conformance/requirements.json) | Generated 190-row Appendix A register linked to the checked-in system design          |
| [`evidence.json`](../conformance/evidence.json)         | Content-addressed source/results plus explicit external blockers                      |
| [`traces.json`](../conformance/traces.json)             | One status and proof class for every requirement/profile cell                         |
| [`gates.json`](../conformance/gates.json)               | Exact requirement/profile/evidence-class scope for all ten release gates              |
| [`results/`](../conformance/results/)                   | Checked-in Chromium, framework, protocol/motion, performance, and model-run results   |
| [`@panefold/conformance`](../packages/conformance/)     | Closed validators, trace/gate audit, deterministic report, and certification contract |

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

- The compact Chromium fixture passed 10/10 tasks: semantics/axe, LTR/RTL resize, motion preference,
  stable-host lifecycle, all 17 panel classes, forced colors, popup loss/recovery, touch projection,
  and raw splitter-frame capture.
- The framework JSDOM contract passed 20/20 tests across Vue, Svelte, Angular, and Web Components.
- Protocol/motion validation passed 49/49 focused tests plus 18/18 React integration tests. It
  covers the twelve-actor catalog, cancellation/revision conflicts, disposable motion leases,
  progressive View Transition fallback, and deterministic load degradation.
- The independent semantic reducer matched the complete reference result for all 36 curated command
  variants, 6,000 generated test attempts, and a separate reproducible 10,000-attempt campaign
  (8,895 accepted, 1,105 typed rejections, zero divergence). It remains an oracle that rebuilds
  state per command, not the retained optimized production kernel.
- The earlier 50,000-attempt projection campaign completed with zero replay/projection divergence.
  It is below the ten-million stable threshold and its checked-in summary records the missing seed.
- The container interaction capture retained 179 frame deltas, including its long task, as an
  experimental regression guard—not a physical performance certification.

## Hard release gates

| Gate            | State      | Evidence still required                                                                                                     |
| --------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| Model integrity | Unresolved | Publish the required ten-million-operation report                                                                           |
| Determinism     | Unresolved | Retained optimized-kernel campaign at the stable threshold; the independent semantic oracle is bounded correctness evidence |
| Atomicity       | Unresolved | Complete fallible persistence/surface operational matrix beyond local and injected-driver tests                             |
| Accessibility   | Blocked    | Manual NVDA, JAWS, VoiceOver, TalkBack, 400% zoom, forced-colors, and voice-control records on declared systems             |
| Lifecycle       | Blocked    | Third-party heavy-content torture plus heap/listener/observer/resource baselines                                            |
| Performance     | Blocked    | Controlled physical 60 Hz and 120 Hz traces with raw data and confidence intervals                                          |
| Recovery        | Blocked    | Real process/tab/window, IndexedDB quota/corruption, permission, monitor-loss, and upgrade runs                             |
| Security        | Blocked    | Independent threat/protocol/dependency/provenance review and deployed CSP/Trusted Types evidence                            |
| Migration       | Unresolved | Application-layout and panel-type migration corpus beyond the tested kernel and panel-codec paths                           |
| Public evidence | Unresolved | Remaining raw compatibility records, independent certifications, and signed release approval                                |

## Published profile boundary

- `compact-react-chromium-desktop` is one React 19.2.8 / Playwright Chromium Linux fixture, with a
  390×844 touch-emulation subprofile and controlled same-origin popup. It is not a general browser,
  OS, mobile hardware, PiP, multi-screen, crash, security, or assistive-technology promise.
- `framework-adapter-contract-jsdom` is an immutable-store/lifecycle/SSR contract for Vue, Svelte,
  Angular, and Web Components. JSDOM is not rendering, hydration, focus, accessibility, performance,
  or third-party adoption evidence.

Any future stable claim must close every applicable `MUST`, all ten hard gates, and the entire
published profile matrix. External evidence that this repository cannot ethically self-issue stays
blocked; the support claim remains experimental until that evidence exists.
