# System-design implementation audit

Audit date: 2026-08-14

This is the durable cross-check between the 190 normative requirements in the
[system design](spec/SYSTEM_DESIGN.md), the generated conformance register, and the repository
implementation and tests. The result is **not** “190 requirements implemented.” Panefold remains an
experimental profile with open code, environment, manual, and future-scope work.

The machine authority remains `conformance/*.json`. This document makes the gaps reviewable and is
checked against those files by the conformance test suite.

## Result at a glance

| Profile                            | Verified | Unresolved | Blocked |     N/A |   Total |
| ---------------------------------- | -------: | ---------: | ------: | ------: | ------: |
| `compact-react-chromium-desktop`   |      107 |         58 |      22 |       3 |     190 |
| `framework-adapter-contract-jsdom` |        2 |         52 |      11 |     125 |     190 |
| **Both profiles**                  |  **109** |    **110** |  **33** | **128** | **380** |

| Proof class                | Verified | Unresolved | Blocked | N/A | Total |
| -------------------------- | -------: | ---------: | ------: | --: | ----: |
| A — code-verifiable        |       89 |         54 |       0 |   0 |   143 |
| B — environment-verifiable |       20 |         56 |       0 |   0 |    76 |
| C — manual/external        |        0 |          0 |      33 |   0 |    33 |
| D — future scope           |        0 |          0 |       0 | 128 |   128 |

`V` means verified for that exact experimental profile, `U` means unresolved, `B` means blocked on
manual or external evidence, and `N/A` means the profile does not publish that capability.

## Exact 190-requirement profile matrix

<!-- BEGIN REQUIREMENT STATUS MATRIX -->

| Requirement | Compact React / Chromium | Framework adapter / JSDOM |
| ----------- | ------------------------ | ------------------------- |
| `A11Y-001`  | B                        | N/A                       |
| `A11Y-002`  | U                        | N/A                       |
| `A11Y-003`  | V                        | N/A                       |
| `A11Y-004`  | B                        | N/A                       |
| `A11Y-005`  | U                        | N/A                       |
| `A11Y-006`  | U                        | N/A                       |
| `A11Y-007`  | B                        | N/A                       |
| `A11Y-008`  | B                        | N/A                       |
| `ACC-001`   | B                        | B                         |
| `ACC-002`   | B                        | B                         |
| `ACC-003`   | B                        | B                         |
| `API-001`   | V                        | U                         |
| `API-002`   | V                        | U                         |
| `API-003`   | V                        | U                         |
| `API-004`   | V                        | U                         |
| `API-005`   | U                        | U                         |
| `API-006`   | B                        | B                         |
| `API-007`   | B                        | B                         |
| `API-008`   | V                        | U                         |
| `ARC-001`   | V                        | U                         |
| `ARC-002`   | V                        | U                         |
| `ARC-003`   | V                        | U                         |
| `ARC-004`   | V                        | U                         |
| `ARC-005`   | V                        | U                         |
| `COL-001`   | U                        | N/A                       |
| `COL-002`   | N/A                      | N/A                       |
| `COL-003`   | V                        | N/A                       |
| `COL-004`   | V                        | N/A                       |
| `COL-005`   | V                        | N/A                       |
| `COL-006`   | V                        | N/A                       |
| `DOM-001`   | V                        | N/A                       |
| `DOM-002`   | V                        | N/A                       |
| `DOM-003`   | V                        | N/A                       |
| `DOM-004`   | V                        | N/A                       |
| `DOM-005`   | U                        | N/A                       |
| `EXP-001`   | B                        | N/A                       |
| `EXP-002`   | V                        | N/A                       |
| `EXP-003`   | U                        | N/A                       |
| `EXP-004`   | U                        | N/A                       |
| `EXP-005`   | B                        | N/A                       |
| `EXT-001`   | V                        | U                         |
| `EXT-002`   | V                        | U                         |
| `EXT-003`   | V                        | U                         |
| `EXT-004`   | V                        | U                         |
| `EXT-005`   | V                        | U                         |
| `EXT-006`   | B                        | B                         |
| `FOC-001`   | V                        | N/A                       |
| `FOC-002`   | U                        | N/A                       |
| `FOC-003`   | U                        | N/A                       |
| `FOC-004`   | U                        | N/A                       |
| `FOC-005`   | U                        | N/A                       |
| `FOC-006`   | U                        | N/A                       |
| `FWK-001`   | U                        | V                         |
| `FWK-002`   | U                        | U                         |
| `FWK-003`   | U                        | V                         |
| `FWK-004`   | U                        | U                         |
| `FWK-005`   | N/A                      | U                         |
| `FWK-006`   | B                        | B                         |
| `GOV-001`   | V                        | U                         |
| `GOV-002`   | V                        | U                         |
| `GOV-003`   | B                        | B                         |
| `GOV-004`   | V                        | U                         |
| `GOV-005`   | B                        | B                         |
| `GOV-006`   | V                        | U                         |
| `I18N-001`  | V                        | N/A                       |
| `I18N-002`  | V                        | N/A                       |
| `I18N-003`  | U                        | N/A                       |
| `INT-001`   | U                        | N/A                       |
| `INT-002`   | U                        | N/A                       |
| `INT-003`   | V                        | N/A                       |
| `INT-004`   | U                        | N/A                       |
| `INT-005`   | V                        | N/A                       |
| `INT-006`   | U                        | N/A                       |
| `INT-007`   | U                        | N/A                       |
| `LAY-001`   | V                        | N/A                       |
| `LAY-002`   | V                        | N/A                       |
| `LAY-003`   | V                        | N/A                       |
| `LAY-004`   | V                        | N/A                       |
| `LAY-005`   | V                        | N/A                       |
| `LAY-006`   | U                        | N/A                       |
| `LAY-007`   | V                        | N/A                       |
| `LIF-001`   | V                        | N/A                       |
| `LIF-002`   | U                        | N/A                       |
| `LIF-003`   | U                        | N/A                       |
| `LIF-004`   | U                        | N/A                       |
| `LIF-005`   | V                        | N/A                       |
| `LIF-006`   | V                        | N/A                       |
| `LIF-007`   | V                        | N/A                       |
| `MOD-001`   | V                        | N/A                       |
| `MOD-002`   | V                        | N/A                       |
| `MOD-003`   | V                        | N/A                       |
| `MOD-004`   | V                        | N/A                       |
| `MOD-005`   | V                        | N/A                       |
| `MOD-006`   | V                        | N/A                       |
| `MOT-001`   | B                        | N/A                       |
| `MOT-002`   | U                        | N/A                       |
| `MOT-003`   | V                        | N/A                       |
| `MOT-004`   | U                        | N/A                       |
| `MOT-005`   | U                        | N/A                       |
| `MOT-006`   | U                        | N/A                       |
| `MOT-007`   | V                        | N/A                       |
| `MOT-008`   | N/A                      | N/A                       |
| `MOT-009`   | U                        | N/A                       |
| `MOT-010`   | U                        | N/A                       |
| `OBS-001`   | U                        | U                         |
| `OBS-002`   | V                        | U                         |
| `OBS-003`   | V                        | U                         |
| `OBS-004`   | V                        | U                         |
| `OBS-005`   | U                        | U                         |
| `OBS-006`   | V                        | U                         |
| `PER-001`   | V                        | N/A                       |
| `PER-002`   | V                        | N/A                       |
| `PER-003`   | V                        | N/A                       |
| `PER-004`   | V                        | N/A                       |
| `PER-005`   | V                        | N/A                       |
| `PER-006`   | V                        | N/A                       |
| `PER-007`   | V                        | N/A                       |
| `PER-008`   | V                        | N/A                       |
| `PKG-001`   | V                        | N/A                       |
| `PKG-002`   | V                        | N/A                       |
| `PKG-003`   | V                        | N/A                       |
| `PKG-004`   | U                        | N/A                       |
| `PKG-005`   | V                        | N/A                       |
| `PRF-001`   | U                        | N/A                       |
| `PRF-002`   | V                        | N/A                       |
| `PRF-003`   | V                        | N/A                       |
| `PRF-004`   | U                        | N/A                       |
| `PRF-005`   | U                        | N/A                       |
| `PRF-006`   | U                        | N/A                       |
| `PRF-007`   | B                        | N/A                       |
| `QLT-001`   | V                        | U                         |
| `QLT-002`   | V                        | U                         |
| `QLT-003`   | U                        | U                         |
| `QLT-004`   | V                        | U                         |
| `QLT-005`   | B                        | B                         |
| `REN-001`   | V                        | N/A                       |
| `REN-002`   | U                        | N/A                       |
| `REN-003`   | V                        | N/A                       |
| `REN-004`   | V                        | N/A                       |
| `REN-005`   | V                        | N/A                       |
| `REN-006`   | V                        | N/A                       |
| `RSK-001`   | B                        | N/A                       |
| `RSK-002`   | U                        | N/A                       |
| `RSK-003`   | B                        | N/A                       |
| `RSK-004`   | B                        | N/A                       |
| `RSP-001`   | V                        | N/A                       |
| `RSP-002`   | U                        | N/A                       |
| `SCP-001`   | U                        | U                         |
| `SCP-002`   | V                        | U                         |
| `SCP-003`   | V                        | U                         |
| `SCP-004`   | V                        | U                         |
| `SEC-001`   | V                        | U                         |
| `SEC-002`   | V                        | U                         |
| `SEC-003`   | U                        | U                         |
| `SEC-004`   | V                        | U                         |
| `SEC-005`   | U                        | U                         |
| `SEC-006`   | V                        | U                         |
| `SEC-007`   | U                        | U                         |
| `SEC-008`   | V                        | U                         |
| `SUR-001`   | V                        | N/A                       |
| `SUR-002`   | V                        | N/A                       |
| `SUR-003`   | V                        | N/A                       |
| `SUR-004`   | V                        | N/A                       |
| `SUR-005`   | U                        | N/A                       |
| `SUR-006`   | U                        | N/A                       |
| `SUR-007`   | U                        | N/A                       |
| `SYS-001`   | V                        | N/A                       |
| `SYS-002`   | V                        | N/A                       |
| `SYS-003`   | V                        | N/A                       |
| `SYS-004`   | V                        | N/A                       |
| `SYS-005`   | V                        | N/A                       |
| `THM-001`   | U                        | N/A                       |
| `THM-002`   | U                        | N/A                       |
| `TST-001`   | U                        | U                         |
| `TST-002`   | V                        | U                         |
| `TST-003`   | V                        | N/A                       |
| `TST-004`   | V                        | U                         |
| `TST-005`   | U                        | U                         |
| `TST-006`   | U                        | U                         |
| `TST-007`   | B                        | B                         |
| `TST-008`   | U                        | U                         |
| `TST-009`   | U                        | U                         |
| `TXN-001`   | V                        | N/A                       |
| `TXN-002`   | V                        | N/A                       |
| `TXN-003`   | V                        | N/A                       |
| `TXN-004`   | V                        | N/A                       |
| `TXN-005`   | V                        | N/A                       |
| `TXN-006`   | V                        | N/A                       |
| `TXN-007`   | V                        | N/A                       |
| `TXN-008`   | V                        | N/A                       |

<!-- END REQUIREMENT STATUS MATRIX -->

## Corrected verification overclaims

The following 10 compact-profile rows had been marked verified by evidence that did not establish
the complete normative statement. They are now unresolved, with the exact reason also stored in
their generated trace rationale.

<!-- BEGIN CORRECTED OVERCLAIMS -->

| Requirement | Gap kind                                          | Why the earlier evidence was insufficient                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `A11Y-002`  | Partial implementation and proof binding          | The narrowed action registry matches the renderer routes it declares, but it omits structural operations from the complete Appendix G action set and is not generated from route-specific behavior tests.                                             |
| `INT-004`   | Partial implementation and proof binding          | The narrowed action registry matches the renderer routes it declares, but it omits structural pointer actions from the complete Appendix G matrix and is not generated from route-specific keyboard, menu or command-palette, and programmatic tests. |
| `A11Y-006`  | Implemented primitive; environment proof missing  | The pure motion adapter removes transforms, but the recorded browser task only checked preference projection.                                                                                                                                         |
| `FOC-002`   | Implemented intent; environment proof missing     | The renderer avoids deliberately stealing content focus, but no browser task clicks form, editor, and grid descendants and proves natural focus.                                                                                                      |
| `LIF-003`   | Implemented projection; environment proof missing | JSDOM asserts `hidden`, `inert`, and `aria-hidden`; no browser or assistive-technology traversal result establishes the full statement.                                                                                                               |
| `RSP-002`   | Partial environment proof                         | Touch emulation checks a compact region and 44 px target, not scrolling, safe areas, and no-hover operation together.                                                                                                                                 |
| `THM-002`   | Partial environment proof                         | Forced colors, reduced motion, and touch have checks; the large-text/zoom and focus-visibility visual matrix is absent.                                                                                                                               |
| `PKG-004`   | Documentation implementation gap                  | Manifests have export maps, but every package does not publish a compatibility policy and the lockfile is not an entry-point audit.                                                                                                                   |
| `SCP-001`   | Completeness proof gap                            | The capability inventory is curated and is not generated or cross-checked against every public export.                                                                                                                                                |
| `TST-009`   | Recovery coverage gap                             | Existing failure injection is bounded to persistence and surface cases; it does not prove a final location or placeholder for every panel in the complete recovery matrix.                                                                            |

<!-- END CORRECTED OVERCLAIMS -->

`TXN-004` remains verified, but its evidence was corrected: prepared-resource rollback is now tied
to the injected surface-transfer failure matrix, not to the unrelated in-page panel-drop planner.

`TXN-005` is now verified for the compact code profile. Accepted kernel transactions publish a
deterministic frozen effect envelope containing the exact transaction ID and revision tuple; the
runtime delivers it after commit and observers through an optional abortable port. Focused tests
cover sequential and concurrent duplicates, explicit retry of failed idempotent work, bounded
capacity, disposal, observer and handler failures, reentrant-command ordering, and fresh undo/redo
identities. The receipt ledger is deliberately process-local. Crash-durable or distributed
exactly-once application remains outside this result and is recorded in
[ADR-0014](adr/0014-post-commit-effect-delivery.md).

`TST-003` is now verified only for the compact profile's twelve headless Appendix-C actors. A
reviewed graph contract pins all states, ordered transition branches, guards, and named path
obligations before execution counts as evidence. The checked-in deterministic result reaches 84/84
states and 258/258 transitions, observes selection and rejection for all 64 guarded branches, covers
146/146 adversarial/interruption/timeout/recovery/finalizer/impossible-event obligations, explores
533 bounded snapshots, and performs 7,837 impossible-event checks. Its 36 phase-specific timeout
scenarios perform 84 literal virtual-FIFO schedules: 72 firings across primary and byte-equivalent
replay runs plus 12 cancelled twins, with zero pending handles. The framework adapter/JSDOM profile
publishes no protocol actors, so its `TST-003` cell is N/A rather than an unrelated unresolved
requirement. This result is not browser, OS, process-crash, distributed-host, physical-monitor, or
manual recovery evidence, and it does not promote `TST-009`.

## Structural action parity audit

`STRUCTURAL_ACTION_PARITY` previously mixed real renderer routes with aspirational core commands.
This audit narrowed it to routes exposed by the compact React reference profile and added the
previously omitted browser-window transfer. Its structural test still proves only the inventory's
shape; route-specific React and browser tests are the behavioral evidence. Consequently `A11Y-002`
and `INT-004` remain unresolved until every listed route is machine-bound to those tests and the
complete Appendix G action set is covered.

| Declared command             | Renderer-backed routes found                                                     | Material discrepancy                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `select-panel`               | Pointer, keyboard, programmatic adapter                                          | No discrepancy for the declared routes.                                                                 |
| `activate-panel`             | Keyboard and programmatic adapter                                                | Pointer clicks select; they do not claim a distinct `activate-panel` route.                             |
| `reorder-panels`             | Pointer drag, keyboard neighbor step, menu neighbor action, programmatic adapter | Focused tests bind all four routes; the global parity requirements remain open because other rows fail. |
| `move-panel`                 | Pointer center drop, keyboard move dialog, menu target, programmatic adapter     | No command-palette route is claimed.                                                                    |
| `split-group`                | Pointer edge drop, keyboard move dialog, menu edge, programmatic drop plan       | No command-palette route is claimed.                                                                    |
| `resize-split`               | Pointer splitter, keyboard splitter, programmatic adapter                        | No discrepancy for the declared routes.                                                                 |
| `close-panels`               | Pointer close control, keyboard Delete/control activation, programmatic adapter  | No menu or command-palette route is claimed.                                                            |
| `create-floating-surface`    | Optional menu action and core/programmatic command                               | No direct pointer route is claimed.                                                                     |
| `move-floating-surface`      | Pointer titlebar drag, keyboard titlebar step, programmatic adapter              | Snap and tile routes are not claimed.                                                                   |
| `resize-floating-surface`    | Pointer edge/corner drag, keyboard corner step, programmatic adapter             | Product-specific panel constraints remain application policy.                                           |
| `raise-surface`              | Pointer activation, keyboard titlebar activation, programmatic adapter           | Platform window z-order is outside this in-page route.                                                  |
| `maximize-surface`           | Pointer/keyboard control and programmatic adapter                                | Uses the current in-page workspace viewport.                                                            |
| `restore-surface`            | Pointer/keyboard control and programmatic adapter                                | Restores minimized or maximized in-page state.                                                          |
| `minimize-surface`           | Pointer/keyboard control and programmatic adapter                                | Minimized presentation remains in-page rather than an OS taskbar.                                       |
| `redock-surface`             | Pointer/keyboard control and application-selected programmatic placement         | The application adapter owns the semantic target; external redock still uses ownership evidence.        |
| `transfer-to-browser-window` | Pointer outside release, keyboard/menu action, application programmatic command  | The controlled same-origin Atlas profile is narrower than the generic core command.                     |

Core-only move-group remains omitted instead of being presented as a renderer feature. The inventory
still does not cover all actions in Appendix G, such as reopen, merge, focus-next-group, switcher,
undo, and preset application. The durable remaining fix is a renderer-owned route inventory generated from public
capabilities and route-specific tests; corrected declaration strings alone are not sufficient.

## Genuine remaining gaps

### Repository-local code or deterministic proof

The compact profile has 12 unresolved code-verifiable rows:

`A11Y-002`, `COL-001`, `I18N-003`, `INT-002`, `INT-004`, `OBS-005`, `PKG-004`, `RSK-002`,
`SCP-001`, `SEC-007`, `TST-001`, and `TST-009`.

The most direct implementation work is the complete renderer route inventory/parity, locale-aware
shortcut formatting, package compatibility policies, generated public capability classification,
the ten-million-operation artifact required by `TST-001`, and the complete
final-authority/placeholder recovery matrix required by `TST-009`. The remaining
governance/security rows need the policies and artifacts named by their requirement, not a change of
status by assertion.

### Implemented or partial behavior awaiting environment evidence

The compact profile has 46 unresolved environment-verifiable rows:

`A11Y-005`, `A11Y-006`, `API-005`, `DOM-005`, `EXP-003`, `EXP-004`, `FOC-002`, `FOC-003`,
`FOC-004`, `FOC-005`, `FOC-006`, `FWK-001`, `FWK-002`, `FWK-003`, `FWK-004`, `INT-001`,
`INT-006`, `INT-007`, `LAY-006`, `LIF-002`, `LIF-003`, `LIF-004`, `MOT-002`, `MOT-004`,
`MOT-005`, `MOT-006`, `MOT-009`, `MOT-010`, `OBS-001`, `PRF-001`, `PRF-004`, `PRF-005`,
`PRF-006`, `QLT-003`, `REN-002`, `RSP-002`, `SEC-003`, `SEC-005`, `SUR-005`, `SUR-006`,
`SUR-007`, `THM-001`, `THM-002`, `TST-005`, `TST-006`, and `TST-008`.

These are not all missing code. Many have unit/JSDOM primitives but lack the exact browser,
framework, workload, recovery, visual, or performance run required by the design. A source hash is
not promoted to executed environment evidence.

### External/manual evidence and future scope

The 33 blocked cells require evidence the repository cannot self-issue: manual assistive-technology
and voice-control work, timed usability/DX studies, physical performance and resource traces,
independent security review, third-party pilots, and signed stable-release approval. No blocked row
was promoted by this audit. `COL-002`, `MOT-008`, and compact-profile `FWK-005`, plus the 125
adapter-profile rendering/product rows, remain explicitly outside the respective published profile.

## Tab-reorder design check

The same-strip implementation follows the intended architecture: the adapter supplies a relational
`beforePanelId`/`afterPanelId` command; pointer samples, measured rectangles, insertion indexes,
indicators, and sibling transforms stay in disposable renderer state; a successful gesture emits one
command; and pointer, keyboard-neighbor, menu, and programmatic routes share the command factory.
Focused tests cover unequal widths, RTL, vertical rails, a 500-tab O(n) index with logarithmic slot
lookup, one-dispatch pointer behavior, keyboard/menu routes, stable host identity, and no broad React
rerender during raw samples.

The checked-in Chromium run now exercises bounded overflow autoscroll in LTR and negative-scroll
RTL, retains the relational insertion target, and commits one revision without remounting panel
content. This closes that specific browser-evidence gap; it does not close the broader global action
parity rows or physical-device performance gate. The existing design decision is extended in
[ADR-0013](adr/0013-direct-placement-durable-demo.md); no new ADR is needed because reorder is a
direct-placement branch and does not change ownership, schema, transaction ordering, lifecycle, or
protocol authority.

## Performance truth

The implementation uses stable external-store projection, active-only protocol actors, one frame
scheduler for pointer visuals, precomputed reorder slots, binary slot lookup, constant-time cached
geometry translation during same-slot autoscroll, and local DOM style writes. Those are useful
design properties, not certification. The checked-in container capture retained 179 frame deltas
with p95 9.3 ms, p99 9.4 ms, maximum 58.2 ms, and two observed long tasks of 91 ms and 58 ms. On the
same Apple M1 Max machine, the Node smoke run measured 50-panel reorder at 0.9273 ms p95 and
500-panel reorder at 5.0729 ms p95, missing the latter's 5 ms design target. The 100/500/1,000-node
hit-test means were 4.622/21.389/44.874 microseconds, and 10,000 reference kernel operations had zero
invariant violations. These single-container regression guards are neither a statistically
separated history nor physical 60 Hz/120 Hz evidence. The performance hard gate therefore remains
blocked.

## Hard-gate status

<!-- BEGIN HARD GATE STATUS -->

| Gate            | State      | Genuine closing evidence                                                                                      |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| Model integrity | Unresolved | Ten-million-operation report.                                                                                 |
| Determinism     | Unresolved | Protocol graph/deadline coverage passes; retained optimized-kernel campaign and ten-million threshold remain. |
| Atomicity       | Unresolved | Complete fallible persistence/surface operational matrix.                                                     |
| Accessibility   | Blocked    | Signed real-system AT, zoom, forced-colors, and voice-control evidence.                                       |
| Lifecycle       | Blocked    | Third-party heavy-content torture and resource-leak traces.                                                   |
| Performance     | Blocked    | Controlled physical 60 Hz and 120 Hz traces with raw samples and intervals.                                   |
| Recovery        | Blocked    | Real process, tab, window, quota/corruption, permission, and monitor-loss runs.                               |
| Security        | Blocked    | Independent threat, protocol, dependency, provenance, and deployment review.                                  |
| Migration       | Unresolved | Application-layout and panel-type migration corpus for published versions.                                    |
| Public evidence | Unresolved | Remaining compatibility records, certifications, and signed approval.                                         |

<!-- END HARD GATE STATUS -->
