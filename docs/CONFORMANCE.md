# Conformance status

Panefold `0.1.0` is an **experimental executable implementation**. It does not claim stable
conformance to the [Panefold system design](spec/SYSTEM_DESIGN.md).

The current conformance report is intentionally blocked/unresolved rather than promoted to a pass:
all 36 commands, all 190 Appendix A requirements, and all ten hard gates are represented, but many
profile traces and release gates lack the required evidence. An experimental build may remain
usable while those gaps stay explicit; a stable build may not waive them.

## Machine-readable artifacts

| Artifact                                                | Purpose                                                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`manifest.json`](../conformance/manifest.json)         | Experimental profiles, features, limitations, and unsupported product claims                        |
| [`commands.json`](../conformance/commands.json)         | Status and boundaries for the exhaustive 36-command inventory                                       |
| [`capabilities.json`](../conformance/capabilities.json) | Classification, profile scope, evidence links, and limitations for public capabilities              |
| [`requirements.json`](../conformance/requirements.json) | Generated 190-row Appendix A register linked to the checked-in system design                        |
| [`evidence.json`](../conformance/evidence.json)         | Content-addressed repository artifacts plus explicit external blockers                              |
| [`traces.json`](../conformance/traces.json)             | One explicit status for every requirement/profile cell                                              |
| [`gates.json`](../conformance/gates.json)               | Verified, unresolved, or blocked state for each hard release gate                                   |
| [`@panefold/conformance`](../packages/conformance/)     | Closed manifest validation, parity checks, trace/gate auditing, and deterministic report generation |

The harness rejects malformed claim shapes, unknown or duplicate command records, unsupported
capabilities that carry support claims, bad evidence URIs/hashes, invented requirement IDs,
uncovered verified traces, and verified gates backed by unresolved evidence. It uses deterministic
UTF-16 ordering and an explicit report timestamp; it does not infer approval or time from the host.

Run the current checks with:

```bash
pnpm conformance:data:check
pnpm conformance:check
```

`conformance:check` fails structural/claim-invalid reports. A blocked or unresolved report is an
expected outcome for this experimental release and must remain visible.

## Repository evidence present

- Strict TypeScript, formatting, dependency-boundary, package-build, and test automation.
- Immutable model boundaries, reference-kernel laws, canonicalization, rejection atomicity, patch
  replay, bounded exploration, and workspace history tests.
- N-ary geometry constraint, overflow, rounding, exact-conservation, hit, and drop-target tests.
- Bounded runtime queue, reentrancy, subscriber isolation, selector, persistence codec, journal,
  migration, and injected IndexedDB tests.
- Deterministic protocol-machine tests for drag, resize, persistence, transfer, and election.
- React semantics, keyboard, focus, geometry, motion, stable-host, lifecycle-lease, and synthetic
  heavy-content fixtures.
- Shared JSDOM adapter-contract tests for Vue, Svelte, Angular, and Web Components, including
  lifecycle disposal and SSR-safe import behavior.
- Headless surface ownership/recovery and ecosystem primitive tests.
- Automated Chromium/Playwright and axe checks for the compact Atlas reference fixture.
- A Node performance smoke workload and a source/CSP sink scan.

Each item is narrow repository-local evidence. A content hash proves which source artifact was
recorded; it does not by itself prove an external assessment, a passing run on every target, or a
stable support claim.

## Hard release gates

| Gate            | Current state | Missing release evidence                                                                                                     |
| --------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Model integrity | Unresolved    | Required published ten-million-operation run and complete model report                                                       |
| Determinism     | Unresolved    | Independent optimized reducer and long-run differential results after every generated command                                |
| Atomicity       | Unresolved    | Complete fallible operational/failure matrix beyond local kernel and injected-driver tests                                   |
| Accessibility   | Blocked       | Manual NVDA, JAWS, VoiceOver, TalkBack, 400% zoom, forced-colors, and voice-control work on declared systems                 |
| Lifecycle       | Blocked       | Real editor, map/WebGL, grid, media, iframe, and microfrontend torture plus resource baselines                               |
| Performance     | Blocked       | Controlled physical 60 Hz and 120 Hz traces across mandatory workloads with raw data/confidence intervals                    |
| Recovery        | Blocked       | Real process, tab, window, quota/corruption, permission, and monitor-loss failure runs                                       |
| Security        | Blocked       | Independent threat model, protocol/dependency review, CSP/Trusted Types deployment evidence, provenance, and advisory review |
| Migration       | Unresolved    | Application-layout and panel-type migration corpus in addition to the tested kernel v1-to-v2 path                            |
| Public evidence | Unresolved    | Complete raw reports, compatibility records, and signed release approvals                                                    |

## Profiles and certification boundary

Two experimental profiles are declared:

- `compact-react-chromium-desktop` covers the compact Atlas React fixture in automated Chromium CI
  with mouse, keyboard, and programmatic inputs.
- `framework-adapter-contract-jsdom` covers programmatic immutable-store/lifecycle contracts for
  Vue, Svelte, Angular, and Web Components in JSDOM.

Neither profile is a stable browser/framework compatibility promise. Automated axe and semantic
tests are not manual assistive-technology certification. JSDOM is not browser-rendering evidence.
The Node smoke benchmark is not physical frame certification. Injected storage and headless surface
drivers are not real crash/popout recovery certification. Repository source checks are not an
independent security review.

Any future stable claim must pass every applicable `MUST`, all ten hard gates, and the complete
published profile matrix. Missing evidence narrows or blocks the claim; it is never treated as a
pass.
