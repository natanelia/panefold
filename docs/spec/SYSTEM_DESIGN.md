**Version:** Version 1.0

**Status:** Proposed normative architecture and conformance specification

**Prepared for:** Natan

**Date:** 7 August 2026

*Governing principle: commit truth immediately; animate the explanation.*

# **Document control**

**Table 1.** Document control

| **Field**               | **Value**                                                                                                          |
|-------------------------|--------------------------------------------------------------------------------------------------------------------|
| Document                | Panefold System Design                                                                                             |
| Subtitle                | Normative system design for panels, docking, floating windows, popouts, lifecycle, accessibility, and motion       |
| Version                 | Version 1.0                                                                                                        |
| Status                  | Proposed normative architecture and conformance specification                                                      |
| Prepared for            | Natan                                                                                                              |
| Prepared by             | OpenAI                                                                                                             |
| Date                    | 7 August 2026                                                                                                      |
| Primary audience        | Library maintainers, framework and platform engineers, accessibility specialists, QA, security, and product design |
| Normative scope         | Stable architecture, public contracts, invariants, lifecycle, motion, conformance, and release requirements        |
| Implementation language | TypeScript for the reference implementation; contracts are conceptually language-neutral                           |

**Table 2.** Revision history

| **Version** | **Date**      | **Status**           | **Summary**                                                                                               |
|-------------|---------------|----------------------|-----------------------------------------------------------------------------------------------------------|
| 0.1         | 7 August 2026 | Architecture draft   | Initial synthesis of kernel, Effect, XState, geometry, rendering, and DX.                                 |
| 0.2         | 7 August 2026 | Motion expansion     | Added entry, exit, attention, drag, resize, snap, detach, View Transition, and interruption architecture. |
| 1.0         | 7 August 2026 | Formal specification | Unified normative requirements, conformance gates, appendices, references, and delivery governance.       |

> **NORMATIVE STATUS** Uppercase MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are normative. Tables, algorithms, state machines, event ordering, release gates, and the requirement register are part of the specification. Illustrative code shows intended contract shape and may evolve without changing semantics.

## **How to read this specification**

Chapters 1-4 establish scope, quality, product outcomes, and architecture. Chapters 5-8 define the domain, packages, canonical state, and transaction algebra. Chapters 9-16 define layout, interaction, motion, rendering, lifecycle, focus, accessibility, and surfaces. Chapters 17-24 define persistence, distributed behavior, extensibility, APIs, framework integration, responsive presentation, performance, and security. Chapters 25-29 define observability, conformance, delivery, risks, and final acceptance. Appendices provide the consolidated requirements, catalogs, matrices, failure semantics, contribution rules, glossary, and references.

# **Contents**

The entries below are internal links to the corresponding chapters and appendices.

[**<u>Executive summary</u>**](#executive-summary)

[**<u>1. Scope, status, and normative language</u>**](#scope-status-and-normative-language)

[<u>1.1 In scope</u>](#in-scope)

[<u>1.2 Explicit non-goals</u>](#explicit-non-goals)

[<u>1.3 Normative vocabulary</u>](#normative-vocabulary)

[**<u>2. Definition of best and acceptance model</u>**](#definition-of-best-and-acceptance-model)

[<u>2.1 Quality function</u>](#quality-function)

[<u>2.2 Supported workload profiles</u>](#supported-workload-profiles)

[<u>2.3 Hard release gates</u>](#hard-release-gates)

[**<u>3. Product outcomes, personas, and experience principles</u>**](#product-outcomes-personas-and-experience-principles)

[<u>3.1 Representative users and tasks</u>](#representative-users-and-tasks)

[<u>3.2 Product constitution</u>](#product-constitution)

[**<u>4. Architecture and technology decisions</u>**](#architecture-and-technology-decisions)

[<u>4.1 Five-plane architecture</u>](#five-plane-architecture)

[<u>4.2 Responsibility split</u>](#responsibility-split)

[<u>4.3 Library selection</u>](#library-selection)

[**<u>5. Domain vocabulary and conceptual model</u>**](#domain-vocabulary-and-conceptual-model)

[<u>5.1 Core entities</u>](#core-entities)

[<u>5.2 State classes</u>](#state-classes)

[**<u>6. Package architecture and dependency governance</u>**](#package-architecture-and-dependency-governance)

[<u>6.1 Package map</u>](#package-map)

[<u>6.2 Dependency rules</u>](#dependency-rules)

[**<u>7. Canonical state model and invariants</u>**](#canonical-state-model-and-invariants)

[<u>7.1 Canonical data model</u>](#canonical-data-model)

[<u>7.2 Formal invariants</u>](#formal-invariants)

[<u>7.3 Runtime representation</u>](#runtime-representation)

[**<u>8. Command algebra, policies, and transaction semantics</u>**](#command-algebra-policies-and-transaction-semantics)

[<u>8.1 Semantic commands</u>](#semantic-commands)

[<u>8.2 Transaction pipeline</u>](#transaction-pipeline)

[<u>8.3 Policy system</u>](#policy-system)

[**<u>9. Layout topology and constraint solver</u>**](#layout-topology-and-constraint-solver)

[<u>9.1 N-ary topology</u>](#n-ary-topology)

[<u>9.2 Constraint model</u>](#constraint-model)

[<u>9.3 Solver algorithm</u>](#solver-algorithm)

[**<u>10. Interaction protocols</u>**](#interaction-protocols)

[<u>10.1 Pointer foundation</u>](#pointer-foundation)

[<u>10.2 Drag, drop, resize, and snap</u>](#drag-drop-resize-and-snap)

[<u>10.3 Keyboard structural interaction</u>](#keyboard-structural-interaction)

[**<u>11. Motion and transition architecture</u>**](#motion-and-transition-architecture)

[<u>11.1 Motion quality model</u>](#motion-quality-model)

[<u>11.2 Motion stack and pipelines</u>](#motion-stack-and-pipelines)

[<u>11.3 Operation-by-operation motion grammar</u>](#operation-by-operation-motion-grammar)

[<u>11.4 Interruption and reduced motion</u>](#interruption-and-reduced-motion)

[**<u>12. Rendering architecture and stable content hosts</u>**](#rendering-architecture-and-stable-content-hosts)

[<u>12.1 Three-layer renderer</u>](#three-layer-renderer)

[<u>12.2 Framework-independent projection</u>](#framework-independent-projection)

[**<u>13. Panel lifecycle and resource management</u>**](#panel-lifecycle-and-resource-management)

[<u>13.1 Lifecycle states and policies</u>](#lifecycle-states-and-policies)

[<u>13.2 Same-document and cross-document transfer</u>](#same-document-and-cross-document-transfer)

[**<u>14. Focus, selection, activation, and command scope</u>**](#focus-selection-activation-and-command-scope)

[<u>14.1 Focus model</u>](#focus-model)

[<u>14.2 Restoration rules</u>](#restoration-rules)

[**<u>15. Accessibility and input parity</u>**](#accessibility-and-input-parity)

[<u>15.1 Semantic patterns</u>](#semantic-patterns)

[<u>15.2 Announcements and assistive technology</u>](#announcements-and-assistive-technology)

[<u>15.3 Accessibility verification</u>](#accessibility-verification)

[**<u>16. Surface architecture</u>**](#surface-architecture)

[<u>16.1 Surface kinds and capabilities</u>](#surface-kinds-and-capabilities)

[<u>16.2 Floating and browser-window surfaces</u>](#floating-and-browser-window-surfaces)

[<u>16.3 Multi-screen and Picture-in-Picture</u>](#multi-screen-and-picture-in-picture)

[**<u>17. Persistence, migration, history, and recovery</u>**](#persistence-migration-history-and-recovery)

[<u>17.1 Versioned persistence</u>](#versioned-persistence)

[<u>17.2 Snapshot and journal</u>](#snapshot-and-journal)

[<u>17.3 Undo, restore, and missing content</u>](#undo-restore-and-missing-content)

[**<u>18. Collaboration and distributed coordination</u>**](#collaboration-and-distributed-coordination)

[<u>18.1 Personal versus shared layout</u>](#personal-versus-shared-layout)

[<u>18.2 Single-writer coordination</u>](#single-writer-coordination)

[**<u>19. Extensibility and plugin architecture</u>**](#extensibility-and-plugin-architecture)

[<u>19.1 Extension points</u>](#extension-points)

[<u>19.2 Capability negotiation and isolation</u>](#capability-negotiation-and-isolation)

[**<u>20. Public API and developer experience</u>**](#public-api-and-developer-experience)

[<u>20.1 Typed panel registry</u>](#typed-panel-registry)

[<u>20.2 Commands, queries, subscriptions, and effects</u>](#commands-queries-subscriptions-and-effects)

[<u>20.3 Error and diagnostic quality</u>](#error-and-diagnostic-quality)

[**<u>21. Framework adapter contracts</u>**](#framework-adapter-contracts)

[<u>21.1 Shared adapter contract</u>](#shared-adapter-contract)

[<u>21.2 React-specific contract</u>](#react-specific-contract)

[**<u>22. Responsive, touch, theming, and localization</u>**](#responsive-touch-theming-and-localization)

[<u>22.1 Responsive projection</u>](#responsive-projection)

[<u>22.2 Styling and design-system integration</u>](#styling-and-design-system-integration)

[<u>22.3 Localization and writing modes</u>](#localization-and-writing-modes)

[**<u>23. Performance architecture and budgets</u>**](#performance-architecture-and-budgets)

[<u>23.1 Hot-path rules</u>](#hot-path-rules)

[<u>23.2 Workloads and measurable budgets</u>](#workloads-and-measurable-budgets)

[**<u>24. Security, privacy, and supply-chain integrity</u>**](#security-privacy-and-supply-chain-integrity)

[<u>24.1 Threat model</u>](#threat-model)

[<u>24.2 Structural controls</u>](#structural-controls)

[**<u>25. Observability and developer tooling</u>**](#observability-and-developer-tooling)

[<u>25.1 Workspace inspector</u>](#workspace-inspector)

[<u>25.2 Reproduction artifacts and telemetry</u>](#reproduction-artifacts-and-telemetry)

[**<u>26. Verification, conformance, and release engineering</u>**](#verification-conformance-and-release-engineering)

[<u>26.1 Test strategy</u>](#test-strategy)

[<u>26.2 Conformance evidence</u>](#conformance-evidence)

[**<u>27. Delivery roadmap and governance</u>**](#delivery-roadmap-and-governance)

[<u>27.1 Phased implementation</u>](#phased-implementation)

[<u>27.2 Compatibility and deprecation policy</u>](#compatibility-and-deprecation-policy)

[**<u>28. Risks, trade-offs, and rejected alternatives</u>**](#risks-trade-offs-and-rejected-alternatives)

[<u>28.1 Principal risks</u>](#principal-risks)

[<u>28.2 Rejected architectural alternatives</u>](#rejected-architectural-alternatives)

[**<u>29. Final acceptance definition</u>**](#final-acceptance-definition)

[**<u>Appendix A. Normative requirement register</u>**](#appendix-a.-normative-requirement-register)

[**<u>Appendix B. Command catalog</u>**](#appendix-b.-command-catalog)

[**<u>Appendix C. Protocol state-machine catalog</u>**](#appendix-c.-protocol-state-machine-catalog)

[**<u>Appendix D. Event-ordering contract</u>**](#appendix-d.-event-ordering-contract)

[**<u>Appendix E. Motion matrix and tokens</u>**](#appendix-e.-motion-matrix-and-tokens)

[**<u>Appendix F. Benchmark and workload protocol</u>**](#appendix-f.-benchmark-and-workload-protocol)

[**<u>Appendix G. Accessibility action matrix</u>**](#appendix-g.-accessibility-action-matrix)

[**<u>Appendix H. Failure-mode and recovery catalog</u>**](#appendix-h.-failure-mode-and-recovery-catalog)

[**<u>Appendix I. Package and contribution rules</u>**](#appendix-i.-package-and-contribution-rules)

[**<u>Appendix J. Glossary and references</u>**](#appendix-j.-glossary-and-references)

# **Executive summary**

> *The system is a deterministic, recoverable, accessible workspace runtime for the web: a workspace operating kernel rather than a draggable component.*
>
> — Governing product definition

This specification defines the complete architecture for a panel, docking, floating-window, browser-popout, and multi-surface workspace library intended to become the strongest general-purpose foundation in its category. It treats layout correctness, panel identity, lifecycle preservation, input parity, motion, persistence, recovery, security, and integration ergonomics as one system rather than disconnected features.

The authoritative state is held by a pure synchronous TypeScript kernel. Effect provides typed operational effects, dependency provisioning, resource scopes, cancellation, persistence, retries, transport, and testable time. XState actors represent only bounded temporal protocols such as drag, resize, close, suspend, transfer, and recovery. A framework-independent geometry engine resolves n-ary split constraints. A dedicated motion plane explains committed changes through direct manipulation, solver-aware FLIP transitions, Motion DOM interpolation, CSS micro-transitions, and scoped View Transitions where their snapshot model is advantageous.

<img src="media/image1.png" title="Figure 1: Five-plane architecture and the authoritative-state boundary." style="width:6.7in;height:1.9241in" alt="Layered architecture diagram. Application and framework adapters sit above presentation. Protocol, spatial, and motion planes coordinate above a pure semantic kernel. Effect-based operational services sit beneath the kernel boundary. Only the semantic plane owns authoritative workspace state." />

**Figure 1.** Five-plane architecture and the authoritative-state boundary.

> **PRIMARY DECISION** Use a pure transactional kernel plus Effect runtime plus sparse XState protocol actors. Use requestAnimationFrame for direct manipulation, a solver-aware FLIP engine for structural continuity, Motion DOM as the reference interpolation driver, CSS for local micro-interactions, and scoped View Transitions as progressive enhancement.

**Table 3.** System responsibility boundaries

| **Concern**                               | **Authoritative owner** | **Non-owner constraints**                                               |
|-------------------------------------------|-------------------------|-------------------------------------------------------------------------|
| Panels, groups, splits, surfaces, history | Pure kernel             | DOM, frameworks, XState, and motion cannot mutate directly.             |
| Temporal interaction phases               | XState protocol actors  | Actors do not store the full layout graph.                              |
| Geometry and drop targets                 | Incremental solver      | Geometry is derived and is not canonical persistence.                   |
| Effects and resources                     | Effect runtime          | Effects never run inside the pure reducer.                              |
| Visual interpolation                      | Motion plane            | Motion never delays semantic truth or focus correctness.                |
| Panel content                             | Host application        | The library coordinates lifecycle without claiming arbitrary app state. |

The release claim “best” is intentionally falsifiable. It requires published workload profiles, geometric-mean quality scores, hard release gates, reference and optimized kernels that agree under differential testing, accessibility verification with assistive technologies, deterministic replay, resource-leak testing, performance traces at 60 Hz and 120 Hz, and non-destructive recovery from every documented failure path.

**Table 4.** Executive architecture requirements

| **ID**  | **Level** | **Normative requirement**                                                                                   | **Acceptance evidence**                          |
|---------|-----------|-------------------------------------------------------------------------------------------------------------|--------------------------------------------------|
| SYS-001 | MUST      | The semantic kernel is the sole authority for committed workspace state.                                    | Dependency graph review and mutation-path tests. |
| SYS-002 | MUST      | The system separates semantic, protocol, spatial, motion, and operational concerns through typed contracts. | Architecture conformance audit.                  |
| SYS-003 | MUST      | A successful semantic command remains correct when every optional animation is disabled or skipped.         | Motion-off conformance suite.                    |
| SYS-004 | MUST      | No supported failure mode silently loses a panel or its recoverable descriptor.                             | Failure-injection suite and recovery evidence.   |
| SYS-005 | SHOULD    | The ordinary integration surface hides Effect and XState unless an application opts into advanced APIs.     | DX task study and public API review.             |

# **1. Scope, status, and normative language**

This document is the normative architecture specification for the workspace runtime. It governs the headless kernel, geometry engine, interaction protocols, motion system, browser and multi-window adapters, persistence, framework integrations, extension model, testing, release engineering, and long-term compatibility.

## **1.1 In scope**

- Docked panels, tab groups, n-ary split trees, borders, side regions, in-page floating surfaces, browser-window popouts, and constrained Picture-in-Picture surfaces.

- Mouse, touch, pen, keyboard, assistive-technology, command-palette, menu, and programmatic structural operations.

- Panel lifecycle, focus restoration, stable same-document hosts, checkpoint-based cross-document transfer, persistence, migration, undo, recovery, and collaboration protocols.

- Framework-neutral core behavior with first-party React, Vue, Svelte, Angular, and Web Component adapters.

- Motion and transitions for entry, exit, drag, resize, snap, dock, detach, maximize, restore, attention, responsive projection, and surface handoff.

- Security, privacy, strict CSP, Trusted Types compatibility, untrusted persistence, plugin isolation, observability, and supply-chain controls.

## **1.2 Explicit non-goals**

The following are deliberate exclusions from the core architecture, although applications may build them above public contracts:

- Emulating unrestricted native operating-system windows; browser permission, popup, focus, and placement constraints remain authoritative.

- Serializing arbitrary application state automatically; panel types own typed checkpoints and migrations.

- Providing a full application shell, menu bar, command palette, document model, or design system as mandatory dependencies.

- Guaranteeing transparent live DOM transfer between independent browser documents.

- Using animation as a correctness mechanism or making visual completion a prerequisite for semantic state.

- Treating every plugin as trusted; isolation and capability negotiation are explicit.

## **1.3 Normative vocabulary**

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL are interpreted as described by RFC 2119 and RFC 8174 when they appear in uppercase. “Invariant” describes a condition that every committed canonical state must satisfy. “Conformance evidence” describes the reproducible artifact required to demonstrate a requirement rather than merely asserting it.

**Table 5.** Normative terminology

| **Term**             | **Meaning in this specification**                                                                |
|----------------------|--------------------------------------------------------------------------------------------------|
| MUST / SHALL         | Mandatory for a conforming implementation or supported profile.                                  |
| MUST NOT / SHALL NOT | Prohibited; violation is a release-blocking defect.                                              |
| SHOULD               | Expected unless a documented profile-specific exception has stronger evidence.                   |
| MAY                  | Optional capability that must still obey all applicable invariants when implemented.             |
| Supported            | Included in the published matrix and required to pass the complete applicable conformance suite. |
| Experimental         | Opt-in, separately versioned, and excluded from the stable compatibility promise.                |

**Table 6.** Scope and status requirements

| **ID**  | **Level** | **Normative requirement**                                                                     | **Acceptance evidence**                       |
|---------|-----------|-----------------------------------------------------------------------------------------------|-----------------------------------------------|
| SCP-001 | MUST      | Every public capability is classified as stable, experimental, deprecated, or unsupported.    | Generated API inventory and release manifest. |
| SCP-002 | MUST      | Supported claims identify browser, framework, input, accessibility, and workload profiles.    | Published support matrix.                     |
| SCP-003 | MUST NOT  | The core promises unrestricted native-window behavior that the web platform cannot guarantee. | Documentation and API terminology review.     |
| SCP-004 | MUST      | Application-owned panel state has an explicit codec, version, and migration boundary.         | Panel registry contract tests.                |

# **2. Definition of best and acceptance model**

## **2.1 Quality function**

“Best” is defined as the strongest robust outcome across the complete supported profile set, not the most features or the most attractive demonstration. For profile p, the quality score is the weighted geometric mean of developer experience, composability, performance, user experience, reliability, accessibility, security, lifecycle integrity, and operability. The robust system score is the minimum profile score.

**Quality model**

> Q_p = G_p × DX^0.15 × C^0.12 × P^0.13 × UX^0.15 × R^0.16  
> × A11Y^0.10 × LIFE^0.08 × SEC^0.06 × OPS^0.05  
>   
> Q_robust = min(Q_p for p in supported_profiles)  
>   
> G_p = 1 only when every hard gate passes; otherwise G_p = 0.

The geometric mean prevents excellence in one dimension from compensating for catastrophic weakness in another. The lower bound of a 95% confidence interval is used for empirical metrics. A profile with missing evidence is scored as non-conforming rather than silently omitted.

## **2.2 Supported workload profiles**

**Table 7.** Mandatory reference profiles

| **Profile**                 | **Representative composition**                               | **Primary risks**                                  |
|-----------------------------|--------------------------------------------------------------|----------------------------------------------------|
| Embedded dashboard          | 8 panels; 3 groups; one surface                              | Bundle overhead, nesting, host styling.            |
| Professional application    | 40 panels; 12 groups; 2 floats; 1 popout                     | Interaction latency, lifecycle, focus.             |
| IDE-scale                   | 120 panels; 35 groups; many hidden panels                    | Selector fan-out, memory, tab overflow.            |
| Large operational workspace | 500 descriptors; 100 groups; several windows                 | Incremental algorithms, coordination, restore.     |
| Heavy content               | WebGL map, editor, iframe, video, grid, canvas               | Remounting, resize cost, GPU and media continuity. |
| Accessibility stress        | Keyboard-only, screen reader, 400% zoom, forced colors, RTL  | Semantics, focus, target size, reflow.             |
| Mobile and touch            | Narrow viewport, coarse pointer, virtual keyboard            | Gesture conflict, projection, hit targets.         |
| Failure stress              | Corrupt data, blocked popups, missing plugins, surface crash | Data loss, ownership ambiguity, recovery.          |

## **2.3 Hard release gates**

**Table 8.** Non-negotiable release gates

| **Gate**        | **Minimum passing evidence**                                                                                |
|-----------------|-------------------------------------------------------------------------------------------------------------|
| Model integrity | Zero invalid committed states in exhaustive bounded exploration and at least 10 million generated commands. |
| Determinism     | Identical initial state, capabilities, policies, and command stream produce the same canonical hash.        |
| Atomicity       | Rejected or failed commands expose no partial mutation and do not advance revision.                         |
| Accessibility   | WCAG 2.2 AA, complete structural keyboard parity, and manual assistive-technology tasks.                    |
| Lifecycle       | Exactly-once disposal, stable identity, and no resource leakage under lifecycle torture.                    |
| Performance     | Published traces meet profile budgets at 60 Hz and 120 Hz.                                                  |
| Recovery        | No panel loss under persistence, migration, popup, surface, monitor, or plugin failures.                    |
| Security        | Boundary schemas, protocol authentication, strict CSP compatibility, and no known high-severity issue.      |
| Migration       | Every supported persisted schema has a tested migration or non-destructive recovery path.                   |
| Public evidence | Conformance harness, benchmark source, fixtures, traces, and known limitations are available.               |

**Table 9.** Quality and evidence requirements

| **ID**  | **Level** | **Normative requirement**                                                                              | **Acceptance evidence**                              |
|---------|-----------|--------------------------------------------------------------------------------------------------------|------------------------------------------------------|
| QLT-001 | MUST      | Quality is assessed across all published supported profiles, not a selected favorable benchmark.       | Automated scorecard with profile completeness check. |
| QLT-002 | MUST      | Any failed hard gate sets the release-quality score to zero.                                           | Release pipeline policy.                             |
| QLT-003 | MUST      | Benchmark results include hardware, browser, version, workload, sample count, and confidence interval. | Machine-readable benchmark manifest.                 |
| QLT-004 | MUST      | Known limitations and unsupported configurations are published with every stable release.              | Release notes audit.                                 |
| QLT-005 | SHOULD    | The robust overall quality score is at least 0.90 and no dimension is below 0.80.                      | Signed release scorecard.                            |

# **3. Product outcomes, personas, and experience principles**

## **3.1 Representative users and tasks**

The library targets products where workspace organization is part of core work: IDEs, map and simulation tools, data and observability consoles, media applications, operations centers, design systems, scientific tools, and enterprise applications. The design must serve both end users arranging work and engineers integrating high-cost content.

**Table 10.** Primary personas

| **Persona**                           | **Critical tasks**                                                      | **Success criteria**                                               |
|---------------------------------------|-------------------------------------------------------------------------|--------------------------------------------------------------------|
| Expert desktop user                   | Arrange, compare, float, pop out, save, restore, and switch rapidly.    | Fast direct manipulation, keyboard speed, predictable history.     |
| Keyboard or assistive-technology user | Perform every structural operation without precision dragging.          | Equivalent commands, stable focus, meaningful announcements.       |
| Touch user                            | Navigate a projected workspace and move content without hover.          | Large targets, gesture disambiguation, reversible sheets/drawers.  |
| Application engineer                  | Register panels, constraints, state, policies, commands, and themes.    | Typed APIs, explicit lifecycle, local reasoning, excellent errors. |
| Platform engineer                     | Integrate persistence, collaboration, security, telemetry, and plugins. | Replaceable ports, schemas, versioning, diagnostics.               |
| Panel author                          | Render editors, maps, iframes, grids, video, and microfrontends.        | Stable hosts, resize modes, checkpoints, resource scopes.          |
| QA and accessibility engineer         | Reproduce, inspect, fuzz, benchmark, and certify behavior.              | Deterministic artifacts, devtools, conformance matrices.           |

## **3.2 Product constitution**

> **1.** Correctness precedes visual polish. Invalid intermediate semantic state is never externally observable.
>
> **2.** Panel identity is stable and independent of its DOM node, framework component, group, or browser surface.
>
> **3.** Commands express intent. Coordinates and DOM events are resolved into semantic targets before mutation.
>
> **4.** One authoritative state exists. DOM position, React props, persistence, and popouts are projections or replicas.
>
> **5.** Lifecycle is public behavior. Hidden, detached, suspended, transferred, failed, and disposed are distinct.
>
> **6.** Every pointer manipulation has a semantic keyboard and programmatic alternative.
>
> **7.** Heavy content is normal. Editors, maps, iframes, grids, media, and microfrontends shape the architecture.
>
> **8.** Capabilities degrade progressively. Missing popup, screen, animation, or permission support cannot lose work.
>
> **9.** Responsive behavior is a projection, not destructive rewriting of the canonical desktop arrangement.
>
> **10.** Destructive structural actions are reversible; exceptional irreversibility is declared before execution.
>
> **11.** Extensions use public values, services, and ports rather than subclassing or private DOM access.
>
> **12.** Performance claims require reproducible traces; accessibility claims require manual task verification.
>
> **13.** Commit truth immediately; animate the explanation.
>
> **UX NORTH STAR** Users should always know what will happen, see exactly where content will land, retain control during motion, and recover from mistakes with one understandable action.

**Table 11.** Experience requirements

| **ID**  | **Level** | **Normative requirement**                                                                        | **Acceptance evidence**                       |
|---------|-----------|--------------------------------------------------------------------------------------------------|-----------------------------------------------|
| EXP-001 | MUST      | Every structural operation exposes a human-readable command label and deterministic outcome.     | Command registry audit and usability tasks.   |
| EXP-002 | MUST      | The visible drop preview is produced from the same solver and policy result used by commit.      | Preview-versus-commit property tests.         |
| EXP-003 | MUST      | Every completed direct-manipulation gesture creates at most one workspace-history entry.         | History conformance tests.                    |
| EXP-004 | MUST      | A failed or blocked external capability keeps content in a safe in-page location.                | Popup, permission, and surface failure tests. |
| EXP-005 | SHOULD    | A new consumer can render a typed panel workspace in under ten minutes using stable public APIs. | Timed DX study with unfamiliar engineers.     |

# **4. Architecture and technology decisions**

## **4.1 Five-plane architecture**

The architecture has five planes with one-way authority. The semantic plane owns truth; the protocol plane owns temporal interaction phases; the spatial plane owns derived geometry; the motion plane owns temporary visual interpolation; and the operational plane owns fallible effects and resource lifetime. Presentation and framework adapters consume these planes but do not redefine them.

<img src="media/image2.png" title="Figure 2: Separation of committed semantic state, ephemeral protocol state, and derived spatial state." style="width:6.5in;height:1.08708in" alt="Three-column state ownership diagram. Committed semantic state is persistent and undoable. Ephemeral protocol state contains pointer and interaction sessions. Derived spatial state contains rectangles, drop targets, occlusion, and projection. Arrows show that protocol and spatial state may read canonical state but cannot own it." />

**Figure 2.** Separation of committed semantic state, ephemeral protocol state, and derived spatial state.

## **4.2 Responsibility split**

**Table 12.** Architectural ownership matrix

| **Layer**         | **Responsibilities**                                                                | **Forbidden responsibilities**                            |
|-------------------|-------------------------------------------------------------------------------------|-----------------------------------------------------------|
| Pure kernel       | Commands, policies, canonicalization, invariants, history, patches, effect intents. | DOM, timers, storage, network, framework rendering.       |
| Effect runtime    | Services, Layers, Scope, cancellation, persistence, transport, retries, tracing.    | Per-pointer geometry and canonical layout context.        |
| XState protocols  | Temporal phases, guards, cancellation paths, protocol inspection.                   | Full entity tables and high-frequency coordinate streams. |
| Geometry engine   | Constraint solving, hit testing, target calculation, spatial navigation.            | Persistence and app-owned panel state.                    |
| Motion plane      | Direct manipulation projection, FLIP, presence, interruption, reduced motion.       | Semantic truth, focus timing, lifecycle authority.        |
| DOM renderer      | Chrome, ARIA, focus plumbing, host placement, overlay roots.                        | Application business state and external effects.          |
| Framework adapter | Idiomatic mounting, selectors, error boundaries, portals, SSR behavior.             | Workspace-wide state ownership or per-frame drag state.   |

## **4.3 Library selection**

Effect is selected for the operational plane because the problem requires typed service dependencies, scoped resource finalization, structured cancellation, schemas, retry and timeout policy, test clocks, and observable concurrency. The public convenience API runs programs through a managed runtime, while the kernel itself remains ordinary synchronous TypeScript and can run without Effect.

XState is selected for sparse, bounded state machines whose phases have temporal meaning: drag, resize, close guards, transfer, suspension, and recovery. Idle panels do not receive permanent actors. Pointer samples stay in latest-value cells consumed by one surface requestAnimationFrame scheduler rather than becoming actor events or Effect queue items.

Motion DOM is the reference interpolation driver for retargetable tweens and springs. The core motion contract remains driver-neutral. CSS transitions handle local visual states. View Transitions are progressive enhancement for discrete subtree or mode changes where snapshot choreography is more appropriate than live geometry. A GSAP Flip adapter may be offered for bespoke application-owned choreography but is not a core dependency.

> **DECISION CONSTRAINT** No selected library may leak into the canonical model, serialized schema, command algebra, or framework-neutral kernel API. Replacing a runtime or animation library must not require a data migration.

**Table 13.** Architecture decision requirements

| **ID**  | **Level** | **Normative requirement**                                                                                                   | **Acceptance evidence**                            |
|---------|-----------|-----------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------|
| ARC-001 | MUST      | The headless model and kernel have no DOM, framework, Effect-runtime, XState, or animation dependency.                      | Package graph and Node.js execution tests.         |
| ARC-002 | MUST      | XState actors exist only for active bounded protocols and are disposed when their owning scope closes.                      | Actor inventory and scope-leak tests.              |
| ARC-003 | MUST      | Effect wraps fallible operations without imposing fiber scheduling on ordinary synchronous kernel reads and commits.        | Hot-path trace and code review.                    |
| ARC-004 | MUST      | Motion drivers implement a stable internal port and do not appear in persisted data.                                        | Serialization schema audit.                        |
| ARC-005 | SHOULD    | The production runtime pins tested library versions and exposes compatibility through adapters rather than broad re-export. | Lockfile, package manifest, and API-surface audit. |

# **5. Domain vocabulary and conceptual model**

## **5.1 Core entities**

**Table 14.** Domain entity definitions

| **Entity**          | **Normative definition**                                                             | **Key properties**                                                                          |
|---------------------|--------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| Workspace           | Complete logical arrangement across every surface.                                   | Schema versions, revision, entities, activation, focus memory, history metadata.            |
| Panel               | Stable logical instance of application content.                                      | ID, type, versioned parameters, capabilities, constraints, lifecycle, checkpoint reference. |
| Tab                 | Selectable representation of a panel within a group.                                 | Order, ARIA state, close/action affordances; does not own content.                          |
| Group               | Ordered panel collection sharing a tab strip and content viewport.                   | Panel IDs, selected panel, region, chrome mode, capabilities.                               |
| Split               | N-ary node arranging children along a logical axis.                                  | Children, weights, constraints, canonical flattening.                                       |
| Surface             | Rendering destination owning one layout root.                                        | Kind, root, capabilities, geometry and screen hints.                                        |
| Geometry            | Resolved rectangles derived from topology and available space.                       | Not canonical except coarse floating restore hints.                                         |
| Interaction session | Temporary drag, resize, keyboard-move, snap, or transfer protocol state.             | Pointer or keyboard context, base revision, candidate target, scope.                        |
| Panel checkpoint    | Versioned application-owned state sufficient to reconstruct a panel where supported. | Codec, type version, storage reference, migration.                                          |
| Visual tombstone    | Inert runtime-only exit representation after semantic removal.                       | Motion ID, source rectangle, hard expiry, no focus or pointer access.                       |

A panel is never identified by a component instance or host element. A tab is not a panel. A group is not a surface. Floating in-page surfaces and browser windows share a capability-based surface abstraction but retain different platform constraints. These distinctions are reflected in IDs, schemas, lifecycle events, and commands.

## **5.2 State classes**

**Table 15.** State ownership classes

| **Class**                | **Examples**                                                                | **Persistence and history**                                  |
|--------------------------|-----------------------------------------------------------------------------|--------------------------------------------------------------|
| Committed semantic state | Topology, panel placement, selection, floating geometry, surface ownership. | Canonical, versioned, persisted, undoable where defined.     |
| Ephemeral protocol state | Pointer ID, drag threshold, prepared popup, close confirmation, autoscroll. | Never persisted; disposed with protocol Scope.               |
| Derived spatial state    | Rectangles, splitters, drop zones, spatial navigation, occlusion.           | Recomputed; cached by revision and viewport inputs.          |
| Runtime resource state   | DOM hosts, framework roots, observers, message ports, animation handles.    | Scoped; never serialized.                                    |
| Application panel state  | Editor buffer, map camera, form values, selected entities.                  | Application-owned checkpoint with explicit codec and policy. |

**TypeScript**

> type PanelId = string & { readonly \_\_brand: "PanelId" };  
> type GroupId = string & { readonly \_\_brand: "GroupId" };  
> type NodeId = string & { readonly \_\_brand: "NodeId" };  
> type SurfaceId = string & { readonly \_\_brand: "SurfaceId" };  
> type Revision = bigint & { readonly \_\_brand: "Revision" };

**Table 16.** Domain-model requirements

| **ID**  | **Level** | **Normative requirement**                                                                                         | **Acceptance evidence**               |
|---------|-----------|-------------------------------------------------------------------------------------------------------------------|---------------------------------------|
| DOM-001 | MUST      | Every panel, group, node, surface, transaction, and motion target has a stable explicit identifier.               | Schema and type audit.                |
| DOM-002 | MUST NOT  | A DOM node, framework instance, array position, or window handle serves as persistent identity.                   | Persistence-schema and adapter tests. |
| DOM-003 | MUST      | Derived geometry and runtime resources are excluded from canonical serialization except documented restore hints. | Round-trip and schema tests.          |
| DOM-004 | MUST      | Application panel state and workspace layout state have separate codecs, versions, and failure handling.          | Checkpoint integration tests.         |
| DOM-005 | MUST      | Visual tombstones are inert, aria-hidden, pointer-inactive, and hard-bounded in lifetime.                         | DOM accessibility and leak tests.     |

# **6. Package architecture and dependency governance**

## **6.1 Package map**

<img src="media/image3.png" title="Figure 3: Package boundaries and permitted dependency direction." style="width:6.8in;height:2.40236in" alt="Package architecture diagram showing model and kernel at the foundation, geometry and schema above them, Effect runtime and XState protocol adapters as separate packages, DOM and surface packages above contracts, and framework adapters, devtools, testkit, and conformance packages at the edges." />

**Figure 3.** Package boundaries and permitted dependency direction.

**Table 17.** Proposed package inventory

| **Package**                        | **Purpose**                                                                           | **Runtime dependency policy**                               |
|------------------------------------|---------------------------------------------------------------------------------------|-------------------------------------------------------------|
| @workspace/model                   | Branded IDs, immutable types, commands, errors, patches, capabilities.                | No dependencies.                                            |
| @workspace/kernel                  | Pure transaction planning, reduction, canonicalization, invariants, inverse commands. | Model only.                                                 |
| @workspace/geometry                | N-ary solver, hit testing, snap and target calculation, spatial navigation.           | Model primitives only; no DOM.                              |
| @workspace/schema-effect           | Boundary schemas, migrations, JSON Schema, generated values.                          | Effect Schema isolated here.                                |
| @workspace/runtime                 | Driver-neutral service and Scope contracts.                                           | Model and kernel contracts.                                 |
| @workspace/runtime-effect          | Effect services, Layers, storage, transport, resource supervision.                    | Effect plus runtime contracts.                              |
| @workspace/protocol                | Driver-neutral protocol types and events.                                             | Model only.                                                 |
| @workspace/protocol-xstate         | Sparse protocol actors and Effect bridge.                                             | XState plus protocol contracts.                             |
| @workspace/motion                  | Intent, planning, channels, interruption, tokens, driver contracts.                   | Model and geometry.                                         |
| @workspace/motion-motion           | Motion DOM driver.                                                                    | Motion package plus Motion.                                 |
| @workspace/motion-view-transitions | Scoped/document transition adapter.                                                   | Motion package and platform API.                            |
| @workspace/dom                     | Chrome, stable hosts, ARIA, focus, pointer sampler, overlays.                         | Contracts; optional motion drivers injected.                |
| @workspace/surfaces                | Main, embedded, float, popout, PiP, multi-screen adapters.                            | Runtime and DOM contracts.                                  |
| Framework adapters                 | Idiomatic mounting and fine-grained subscriptions.                                    | DOM package and framework peer.                             |
| @workspace/testkit / conformance   | Fixtures, generated tests, benchmarks, certification.                                 | May depend on public packages; never production dependency. |

## **6.2 Dependency rules**

- Dependencies point inward toward contracts and pure logic. Circular package dependencies are prohibited.

- Framework adapters do not import other framework adapters and do not introduce framework concepts into model types.

- Motion, XState, Effect, storage, collaboration, and devtools are optional at package and bundle boundaries.

- Every browser-facing utility accepts the relevant ownerDocument, ownerWindow, root, or surface context; ambient globals are not assumed.

- Public entry points are explicit. Internal file paths are not compatibility surfaces.

- Tree-shakable feature packages prevent simple embedded use from paying for popouts, collaboration, devtools, or advanced motion.

- The conformance package tests only public contracts unless a dedicated implementation certification hook is documented.

**Table 18.** Package-governance requirements

| **ID**  | **Level** | **Normative requirement**                                                                         | **Acceptance evidence**                  |
|---------|-----------|---------------------------------------------------------------------------------------------------|------------------------------------------|
| PKG-001 | MUST      | The package graph is acyclic and enforced in continuous integration.                              | Dependency-cruiser or equivalent report. |
| PKG-002 | MUST      | Headless packages import without evaluating browser globals.                                      | Node.js import matrix.                   |
| PKG-003 | MUST      | Optional platform and framework packages are not pulled through the default headless entry point. | Bundle graph and tree-shaking tests.     |
| PKG-004 | MUST      | Each package publishes a documented public entry-point map and compatibility policy.              | Package manifest audit.                  |
| PKG-005 | SHOULD    | The model and reference kernel have zero runtime dependencies.                                    | Package-lock inspection.                 |

# **7. Canonical state model and invariants**

## **7.1 Canonical data model**

**TypeScript**

> interface WorkspaceSnapshot {  
> readonly schemaVersion: number;  
> readonly applicationLayoutVersion: number;  
> readonly revision: Revision;  
>   
> readonly panels: EntityTable\<PanelRecord\>;  
> readonly groups: EntityTable\<GroupRecord\>;  
> readonly nodes: EntityTable\<LayoutNode\>;  
> readonly surfaces: EntityTable\<SurfaceRecord\>;  
>   
> readonly activation: ActivationState;  
> readonly focusMemory: FocusMemoryDescriptor;  
> readonly floatingOrder: readonly SurfaceId\[\];  
> readonly recoverableClosedPanels: readonly ClosedPanelRecord\[\];  
> readonly metadata: Readonly\<Record\<string, unknown\>\>;  
> }

The model is normalized and immutable at its public boundary. Each relationship has one authoritative representation. Group membership and tab order live in GroupRecord.panelIds; any panel-to-group index is derived. A layout node belongs to one surface root; parent maps are derived. Selected panel is local to a group, active panel is global command scope, and actual DOM focus is runtime state with serializable fallback hints.

## **7.2 Formal invariants**

> **1.** Every live panel belongs to exactly one group unless it is explicitly recorded in the recoverable-closed registry.
>
> **2.** A panel ID appears at most once in group membership; mirrors are distinct panel instances with distinct IDs.
>
> **3.** Every group is referenced by exactly one reachable group node.
>
> **4.** Every layout node is reachable from exactly one surface root, and layout graphs are acyclic.
>
> **5.** No dangling panel, group, child-node, root, surface, checkpoint, or semantic-region reference exists.
>
> **6.** Every non-placeholder group contains at least one panel, and its selected panel belongs to that group.
>
> **7.** Every split has at least two children after canonicalization.
>
> **8.** Split weights are finite, positive, deterministically normalized, and correspond one-to-one with children.
>
> **9.** Resolved child lengths plus splitter lengths equal the available length after deterministic rounding.
>
> **10.** Every floating surface appears exactly once in floating z-order.
>
> **11.** Every browser-window or remote surface has one current ownership epoch and one authoritative coordinator.
>
> **12.** Focused and active targets refer only to live, eligible entities; focus fallbacks are always resolvable.
>
> **13.** Disposed panels and closed scopes cannot receive layout or lifecycle events.
>
> **14.** Every successful mount has one eventual finalization; finalization is idempotent at the adapter boundary.
>
> **15.** Canonical serialization followed by restoration yields a semantically equivalent canonical state.
>
> **16.** Undo followed by redo yields a semantically equivalent state for reversible commands.
>
> **17.** Rejected transactions do not advance revision or emit committed patches.
>
> **18.** Replaying an accepted transaction log from the same canonical snapshot yields the same canonical hash.

Canonicalization flattens adjacent same-axis splits, removes single-child splits, removes empty non-persistent groups, normalizes weights, repairs eligible activation and focus references, resolves temporary IDs, and stabilizes serialized ordering. Canonicalization is deterministic and idempotent. Repairs caused by imported state are surfaced as diagnostics rather than silently hidden.

## **7.3 Runtime representation**

The serialized model remains ordinary versioned data. The optimized runtime may use stable integer handles, ID-to-handle maps, chunked copy-on-write tables, compact arrays for geometry, and revisioned derived indexes. These optimizations are private and must preserve public snapshot immutability.

**TypeScript**

> interface GeometryArena {  
> readonly x: Float64Array;  
> readonly y: Float64Array;  
> readonly width: Float64Array;  
> readonly height: Float64Array;  
> readonly flags: Uint32Array;  
> }
>
> **VERIFICATION STRATEGY** Maintain a deliberately simple reference kernel and a production optimized kernel. Run every generated command sequence against both and compare canonical hashes after each command. Performance work cannot change semantics.

**Table 19.** Canonical-model requirements

| **ID**  | **Level** | **Normative requirement**                                                                                       | **Acceptance evidence**                                   |
|---------|-----------|-----------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------|
| MOD-001 | MUST      | The canonical state satisfies all published invariants after every committed transaction.                       | Invariant checker in development, test, and import paths. |
| MOD-002 | MUST      | Canonicalization is deterministic and idempotent.                                                               | Property-based tests across generated states.             |
| MOD-003 | MUST      | Each relationship has exactly one authoritative representation in canonical state.                              | Schema and invariant review.                              |
| MOD-004 | MUST      | The optimized kernel is differentially tested against a reference implementation after every generated command. | Differential fuzz CI artifacts.                           |
| MOD-005 | MUST NOT  | NaN, infinity, negative dimensions, duplicate ownership, or cycles are accepted into a committed state.         | Malformed-input and command fuzz tests.                   |
| MOD-006 | SHOULD    | Unchanged public entity values preserve referential identity across revisions.                                  | Selector and structural-sharing tests.                    |

# **8. Command algebra, policies, and transaction semantics**

## **8.1 Semantic commands**

Commands describe intent through stable IDs and relational targets. Coordinates, DOM nodes, and transient array indexes are resolved before a command reaches the kernel. This permits deterministic replay, collaboration, keyboard parity, policy evaluation, and meaningful error messages.

**TypeScript**

> type WorkspaceCommand =  
> \| OpenPanel  
> \| ClosePanels  
> \| SelectPanel  
> \| ActivatePanel  
> \| ReorderPanels  
> \| MovePanel  
> \| MoveGroup  
> \| SplitGroup  
> \| MergeGroups  
> \| ResizeSplit  
> \| EqualizeSplit  
> \| CreateFloatingSurface  
> \| MoveFloatingSurface  
> \| ResizeFloatingSurface  
> \| MaximizeSurface  
> \| RestoreSurface  
> \| TransferToBrowserWindow  
> \| RedockSurface  
> \| ApplyWorkspacePreset  
> \| RestoreWorkspace  
> \| UndoWorkspaceOperation  
> \| RedoWorkspaceOperation;

Preferred targets are relational and resilient to delayed or concurrent execution:

- Before or after panel X rather than raw tab index 4.

- Inside group Y rather than DOM container element.

- At logical edge inline-end rather than screen-right.

- Beside semantic region inspector rather than unstable layout node generated by an earlier release.

- Into surface S with an explicit capability requirement.

## **8.2 Transaction pipeline**

<img src="media/image4.png" title="Figure 4: Prepare, commit, patch, effect, persist, and observe transaction pipeline." style="width:6.7in;height:0.49198in" alt="Flow diagram from command boundary validation through pure planning, canonicalization, invariant validation, external resource preparation, atomic semantic commit, renderer patches, post-commit effects, persistence, and telemetry." />

**Figure 4.** Prepare, commit, patch, effect, persist, and observe transaction pipeline.

**TypeScript**

> type KernelResult =  
> \| {  
> readonly ok: true;  
> readonly next: WorkspaceSnapshot;  
> readonly patches: readonly WorkspacePatch\[\];  
> readonly inverse?: WorkspaceCommand;  
> readonly effects: readonly EffectIntent\[\];  
> readonly diagnostics: readonly Diagnostic\[\];  
> }  
> \| {  
> readonly ok: false;  
> readonly error: CommandRejection;  
> };

The pure kernel performs decode-independent authorization, planning, reduction, canonicalization, invariant validation, inverse derivation, and patch production. External effects are returned as intents. The runtime classifies each intent as prepare-before-commit, idempotent post-commit, compensatable, or observational.

**Table 20.** External-effect classes

| **Effect class**       | **Examples**                                              | **Required semantics**                                   |
|------------------------|-----------------------------------------------------------|----------------------------------------------------------|
| Prepare                | Reserve popup; acquire ownership token; checkpoint panel. | Must succeed before commit; rollback finalizer required. |
| Post-commit idempotent | Journal append; collaboration publish; title update.      | Retryable with transaction ID; cannot invalidate commit. |
| Compensatable          | Destination window closes after ownership commit.         | Defined semantic recovery command and diagnostic.        |
| Observational          | Logging, metrics, tracing, inspection.                    | Never affects correctness and may be sampled or dropped. |

## **8.3 Policy system**

**TypeScript**

> type PolicyDecision\<C extends WorkspaceCommand\> =  
> \| { readonly kind: "allow"; readonly command: C }  
> \| { readonly kind: "deny"; readonly code: string; readonly reason: string }  
> \| { readonly kind: "transform"; readonly command: WorkspaceCommand; readonly reason: string };

Interaction-time policies are pure, synchronous, deterministic, and DOM-independent. Policy composition order is explicit. Drop targets are derived from allowed decisions so the UI does not advertise an operation that will certainly fail. Async authorization updates a synchronous capability before interaction or occurs in a separate prepared protocol; it never leaves the pointer hovering while a server decides target validity.

**Table 21.** Transaction and policy requirements

| **ID**  | **Level** | **Normative requirement**                                                                                    | **Acceptance evidence**                          |
|---------|-----------|--------------------------------------------------------------------------------------------------------------|--------------------------------------------------|
| TXN-001 | MUST      | All semantic mutation passes through the command transaction path.                                           | Mutation-path instrumentation and static review. |
| TXN-002 | MUST      | Subscribers never observe partially reduced or partially canonicalized state.                                | Reentrancy and callback tests.                   |
| TXN-003 | MUST      | Commands dispatched during commit notification are queued for a later transaction.                           | Reentrancy conformance tests.                    |
| TXN-004 | MUST      | Prepared external resources are rolled back when revalidation or commit fails.                               | Failure injection at every prepare step.         |
| TXN-005 | MUST      | Post-commit effects carry transaction ID and revision and are safe under duplicate delivery where retryable. | Idempotency tests.                               |
| TXN-006 | MUST      | Policy denial includes a stable code and user-actionable explanation.                                        | Error-contract snapshot tests.                   |
| TXN-007 | MUST      | The final commit revalidates policies and base revision after any asynchronous preparation.                  | Race-condition tests.                            |
| TXN-008 | SHOULD    | A completed gesture is represented by one semantic command or one explicit atomic batch.                     | Transaction-history review.                      |

# **9. Layout topology and constraint solver**

## **9.1 N-ary topology**

Docked layout is a forest of surface-rooted n-ary split trees whose leaves are panel groups. N-ary splits reduce wrapper depth, simplify equalization and insertion, preserve stable sibling relationships, and make constraint propagation proportional to the affected branch rather than an artifact of binary nesting.

**TypeScript**

> type LayoutNode =  
> \| {  
> readonly kind: "split";  
> readonly id: NodeId;  
> readonly axis: "inline" \| "block";  
> readonly children: readonly NodeId\[\];  
> readonly weights: readonly number\[\];  
> readonly constraints?: SplitConstraints;  
> }  
> \| {  
> readonly kind: "group";  
> readonly id: NodeId;  
> readonly groupId: GroupId;  
> };

- Logical axes and edges are used throughout the model; physical left/right/top/bottom are resolved from direction and writing mode.

- Adjacent splits with the same axis are flattened during canonicalization unless an explicit isolation boundary is present.

- A split with one remaining child is removed; an empty transient group is removed; a persistent placeholder group may remain by policy.

- Node IDs of unaffected nodes remain stable across canonicalization and local structural edits.

- Surface roots are independent trees; cross-surface movement is a semantic ownership operation, not tree reparenting alone.

## **9.2 Constraint model**

**TypeScript**

> interface PanelConstraints {  
> readonly hardMinInline?: number;  
> readonly hardMinBlock?: number;  
> readonly preferredMinInline?: number;  
> readonly preferredMinBlock?: number;  
> readonly preferredInline?: number;  
> readonly preferredBlock?: number;  
> readonly maxInline?: number;  
> readonly maxBlock?: number;  
> readonly grow?: number;  
> readonly shrink?: number;  
> readonly collapsible?: boolean;  
> readonly collapsePriority?: number;  
> readonly preferredAspectRatio?: number;  
> readonly resizeDelivery?: "live" \| "throttled" \| "deferred" \| "adaptive";  
> }

Hard minima describe the lowest usable dimension. Preferred minima describe a quality target that may be violated before hard minima. Preferred size is a reset and initial-allocation target. Maximum size prevents pathological expansion. A group derives hard minima from all panels that must remain structurally usable and uses the selected panel for preferred allocation unless application policy declares otherwise.

**Table 22.** Constraint-resolution policy

| **Constraint condition**    | **Required response**                                                                      |
|-----------------------------|--------------------------------------------------------------------------------------------|
| Normal                      | Allocate preferred/weighted sizes within min/max bounds.                                   |
| Preferred minima infeasible | Violate preferred minima using shrink priority; retain diagnostics if materially degraded. |
| Hard minima infeasible      | Collapse eligible children by priority, then enter explicit overflow mode.                 |
| Still infeasible            | Apply declared emergency policy; never emit negative sizes or inaccessible controls.       |
| Viewport or zoom change     | Re-solve from canonical weights and current CSS-pixel space.                               |
| Panel constraint change     | Invalidate the group, ancestor path, and affected sibling allocation only.                 |

## **9.3 Solver algorithm**

<img src="media/image5.png" title="Figure 5: Linear-time per-split constraint allocation and deterministic rounding." style="width:6.7in;height:0.81083in" alt="Solver flow diagram. N-ary topology and available size feed aggregated child constraints. Weighted water-filling freezes children at bounds. Infeasible hard minima invoke collapse and overflow policy. Largest-remainder rounding guarantees exact pixel conservation before resolved rectangles and diagnostics are emitted." />

**Figure 5.** Linear-time per-split constraint allocation and deterministic rounding.

> **1.** Subtract splitter dimensions from the available logical-axis length.
>
> **2.** Aggregate each child hard minimum, preferred target, maximum, grow factor, shrink factor, and collapse policy.
>
> **3.** Allocate preferred or weight-proportional lengths.
>
> **4.** Freeze children at hard minimum or maximum and redistribute remaining deficit or excess using water filling.
>
> **5.** When hard minima exceed available space, collapse eligible children by declared priority and re-solve.
>
> **6.** When still infeasible, enter explicit overflow or emergency policy and emit a structured diagnostic.
>
> **7.** Round fractional lengths using a deterministic largest-remainder method and a stable tie-breaker.
>
> **8.** Guarantee that rounded child lengths plus splitters equal available length exactly.
>
> **9.** Produce rectangles, splitter geometry, visibility information, and changed-entity patches only.

The ordinary time complexity is O(k) for a split with k children. A local resize touches the affected split and propagates constraints only along necessary ancestry. The solver is pure and can run against speculative snapshots to produce exact drop previews before a command commits.

**Table 23.** Layout and solver requirements

| **ID**  | **Level** | **Normative requirement**                                                                                          | **Acceptance evidence**                          |
|---------|-----------|--------------------------------------------------------------------------------------------------------------------|--------------------------------------------------|
| LAY-001 | MUST      | Docked layout uses n-ary splits and canonical flattening of adjacent same-axis nodes.                              | Topology and canonicalization tests.             |
| LAY-002 | MUST      | All semantic axes and edges are logical and writing-mode aware.                                                    | RTL and vertical-writing conformance.            |
| LAY-003 | MUST      | Resolved child pixels plus splitters exactly equal available pixels after rounding.                                | Property tests across fractional sizes and DPRs. |
| LAY-004 | MUST      | Infeasible constraints produce an explicit policy outcome and diagnostic, never negative or inaccessible geometry. | Adversarial constraint suite.                    |
| LAY-005 | MUST      | The speculative preview and committed result use the same constraint implementation.                               | Preview/commit equivalence tests.                |
| LAY-006 | SHOULD    | A local topology or constraint change invalidates only affected branches and surface indexes.                      | Incremental invalidation benchmark.              |
| LAY-007 | SHOULD    | Stable integer or fixed-point weights prevent cumulative resize drift.                                             | Long-sequence resize round-trip tests.           |

# **10. Interaction protocols**

## **10.1 Pointer foundation**

Pointer Events are the single pointer abstraction for mouse, touch, and pen. Same-document drag and resize use pointer capture. Gesture state is owned by an interaction Scope and a sparse XState actor. Raw pointer samples overwrite a latest-value cell and are consumed by one requestAnimationFrame scheduler per surface.

**Interaction pipeline**

> pointermove  
> -\> latestPointerSample.set(sample)  
> -\> requestSurfaceFrame()  
> -\> read latest sample  
> -\> query cached spatial index  
> -\> update preview DOM  
>   
> pointerup  
> -\> resolve semantic target  
> -\> submit one command  
> -\> commit or recover

- A device-specific movement threshold distinguishes click, scroll, and drag. Touch may use an explicit handle or long-press where scrolling conflicts.

- Escape, pointercancel, lostpointercapture, surface disposal, and protocol timeout all have explicit cancellation transitions.

- Text selection and iframe shields are enabled only inside an active interaction Scope and are always finalized.

- The final target is revalidated against current revision, policies, capabilities, and current geometry before commit.

- Pointer input is never required for an operation that changes workspace structure.

## **10.2 Drag, drop, resize, and snap**

<img src="media/image6.png" title="Figure 6: Bounded drag protocol state machine." style="width:6.6in;height:1.44705in" alt="State machine diagram from idle to armed, dragging, committing, settling, cancelling, and recovering. Cancellation is possible from active phases; re-grabbing a settling object transitions back to direct drag without a visual jump." />

**Figure 6.** Bounded drag protocol state machine.

**TypeScript**

> type DropIntent =  
> \| { kind: "insert-tab"; groupId: GroupId; before?: PanelId; after?: PanelId }  
> \| { kind: "split"; targetNodeId: NodeId; edge: LogicalEdge; ratio: number }  
> \| { kind: "swap"; targetGroupId: GroupId }  
> \| { kind: "float"; surfaceId: SurfaceId; rectangle: Rect }  
> \| { kind: "move-to-surface"; surfaceId: SurfaceId }  
> \| { kind: "cancel" };

At drag start, the renderer measures relevant chrome and builds a target index derived from policy-approved semantic targets. During movement, target hysteresis prevents flicker. The preview displays the exact final solver rectangle, labels the operation, and never advertises an invalid destination. Autoscroll is bounded, frame-scheduled, and cancelled with the drag Scope.

**Table 24.** Direct-manipulation semantics

| **Operation**        | **During direct manipulation**                                               | **On completion**                                       |
|----------------------|------------------------------------------------------------------------------|---------------------------------------------------------|
| Panel/group drag     | Pointer-direct translation or shell/snapshot strategy; no semantic mutation. | One move/split/float command; settle to exact geometry. |
| Tab reorder          | Dragged tab follows pointer; siblings transform; strip may autoscroll.       | One relational reorder command.                         |
| Splitter resize      | Boundary follows constrained pointer value; content delivery may throttle.   | One coalesced resize history entry.                     |
| Floating move/resize | Visual geometry updates directly with bounds and snap candidate guides.      | Commit clamped geometry; one history entry.             |
| Cancel               | Visual representation returns or disappears; source state remains canonical. | No semantic history entry.                              |

Snap acquisition uses separate acquire and release distances, velocity bias, entry direction, target priority, constraints, and a maximum magnetic offset. The user-controlled object remains pointer-direct; informational guides and candidate rectangles may animate. On release, a near-critical settle moves from the current visual rectangle to the solver result.

## **10.3 Keyboard structural interaction**

The command registry supplies keyboard, menu, palette, and assistive-technology routes. Default key bindings are platform-sensitive, rebindable, scoped, and conflict-aware. Workspace commands do not fire during IME composition and do not steal commands claimed by an embedded editor.

> **1.** Focus a panel tab or group chrome.
>
> **2.** Invoke Move panel or Move group.
>
> **3.** Expose and announce valid semantic destinations.
>
> **4.** Use arrow keys for spatial navigation and Tab to cycle destination classes.
>
> **5.** Use Enter to commit and Escape to cancel.
>
> **6.** Maintain a visible preview and announce the target without mutating canonical state.

- Focus next/previous group and spatially adjacent group.

- Select first/last/next/previous tab.

- Move panel before/after neighboring tabs.

- Resize splitter in small and large percentage steps.

- Float, redock, maximize, restore, pin, minimize, close, reopen, undo, and redo.

- Open panel switcher and workspace command palette.

**Table 25.** Interaction requirements

| **ID**  | **Level** | **Normative requirement**                                                                                                | **Acceptance evidence**           |
|---------|-----------|--------------------------------------------------------------------------------------------------------------------------|-----------------------------------|
| INT-001 | MUST      | Direct pointer manipulation writes visual state at most once per surface animation frame.                                | Frame-scheduler trace.            |
| INT-002 | MUST      | Raw pointer coordinates do not enter canonical state, persistence, or transaction history.                               | Schema and history audit.         |
| INT-003 | MUST      | Escape, pointer cancellation, capture loss, and scope disposal leave no residual interaction state.                      | Cancellation matrix.              |
| INT-004 | MUST      | Every structural pointer action has keyboard, menu or command-palette, and programmatic equivalents.                     | Generated action-coverage matrix. |
| INT-005 | MUST      | Drop previews are policy-valid, solver-exact, labeled, and reversible.                                                   | Usability and property tests.     |
| INT-006 | MUST      | Pointer resize is direct; content resize notifications may be live, throttled, deferred, or adaptive by declared policy. | Heavy-content fixture traces.     |
| INT-007 | SHOULD    | Target hysteresis prevents oscillation without creating a magnetic offset that impairs precision.                        | Pointer trajectory test corpus.   |

# **11. Motion and transition architecture**

> **MOTION CONSTITUTION** Commit truth immediately; animate the explanation. Motion may interpolate the visual projection of valid state but never owns semantic state, focus correctness, lifecycle authority, persistence, or collaboration ordering.

## **11.1 Motion quality model**

Motion quality is judged by continuity, responsiveness, interruptibility, performance, accessibility, and system consistency across every supported workload. A smooth but delayed drag is a failure. An attractive exit that leaves stale focus or resources is a failure. A skipped transition must leave the exact same valid result.

**Motion quality model**

> M_p = G_p × Continuity^0.22 × Responsiveness^0.22  
> × Interruptibility^0.17 × Performance^0.17  
> × Accessibility^0.15 × Consistency^0.07  
>   
> M_robust = min(M_p for p in supported_profiles)

**Table 26.** Motion hard gates

| **Motion gate**       | **Passing condition**                                                                                    |
|-----------------------|----------------------------------------------------------------------------------------------------------|
| Input latency         | Direct drag and resize update within one display frame; no spring follows the pointer.                   |
| Semantic timing       | State, focus, ARIA, history, and lifecycle do not wait for animation completion.                         |
| Interruption          | Re-grab, reverse, replace, or retarget produces no visible discontinuity beyond one CSS pixel.           |
| Final-state precision | Visual endpoint equals committed solver geometry exactly.                                                |
| Cleanup               | Cancel, skip, failure, surface disposal, and reduced-motion changes leave no residual styles or handles. |
| Accessibility         | Motion is non-essential, reduced alternatives exist, and repeating strobe effects are prohibited.        |
| Performance           | Motion remains within published 60 Hz and 120 Hz budgets under heavy-content workloads.                  |

## **11.2 Motion stack and pipelines**

<img src="media/image7.png" title="Figure 7: Separate direct-manipulation, solver-FLIP, and snapshot-transition pipelines." style="width:6.75in;height:3.01221in" alt="Three parallel pipelines. Direct manipulation samples pointer input and writes one frame. Structural transitions capture current geometry, commit final state, invert, and play. Snapshot transitions select a scope, commit DOM inside a View Transition callback, and animate browser-captured old and new states." />

**Figure 7.** Separate direct-manipulation, solver-FLIP, and snapshot-transition pipelines.

**Table 27.** Motion mechanism selection

| **Mechanism**           | **Primary use**                                                               | **Excluded use**                                                     |
|-------------------------|-------------------------------------------------------------------------------|----------------------------------------------------------------------|
| requestAnimationFrame   | Pointer drag, live resize, autoscroll, snap-preview tracking.                 | Presence choreography and long sequences.                            |
| Solver-aware FLIP       | Docking, reordering, equalize, maximize, restore, same-document detach.       | Unknown app DOM without stable geometry identity.                    |
| Motion DOM driver       | Retargetable tween/spring interpolation, presence, attention.                 | Gesture ownership and canonical state.                               |
| CSS transitions         | Hover, focus, active indicators, menus, lightweight local entry/exit.         | Multi-panel topology changes and lifecycle orchestration.            |
| Scoped View Transitions | Preset changes, responsive projections, DOM replacement, shared-origin entry. | Drag, live resize, rapid repeated interactions, cross-window flight. |
| GSAP Flip adapter       | Application-specific choreography over arbitrary DOM.                         | Mandatory core dependency.                                           |

<img src="media/image8.png" title="Figure 8: Independent transform and visual channels prevent ownership conflicts." style="width:5.8in;height:4.72593in" alt="Layered wrappers for layout FLIP, pointer gesture displacement, presence, clipping, and stable application content. Each channel owns different properties so simultaneous drag, layout, and attention effects do not overwrite one another." />

**Figure 8.** Independent transform and visual channels prevent ownership conflicts.

**TypeScript**

> type MotionChannel =  
> \| "layout"  
> \| "gesture"  
> \| "presence"  
> \| "clip"  
> \| "emphasis"  
> \| "scroll"  
> \| "surface";  
>   
> type InterruptionPolicy =  
> \| "retarget"  
> \| "replace"  
> \| "finish"  
> \| "queue"  
> \| "ignore";

Every animation has a stable motion target ID, channel, driver, interruption policy, priority, reduced-motion alternative, Scope owner, and cleanup contract. The kernel emits semantic patches; the motion planner decides which affected visual entities communicate the change most clearly within the current performance budget.

## **11.3 Operation-by-operation motion grammar**

**Table 28.** Normative motion grammar

| **Operation**    | **Semantic timing**                     | **Visual treatment**                                               | **Interruption**   |
|------------------|-----------------------------------------|--------------------------------------------------------------------|--------------------|
| Drag             | Commit on drop.                         | Pointer-direct host/shell/snapshot; short lift treatment.          | Immediate re-grab. |
| Drag cancel      | No mutation.                            | Return to source with short near-critical spring.                  | Re-grabbable.      |
| Snap candidate   | No mutation.                            | Guide and exact target preview animate; object remains direct.     | Replace/retarget.  |
| Drop settle      | Already committed.                      | Current visual rectangle to exact solver rectangle.                | Retarget/re-grab.  |
| Pointer resize   | Coalesced final command.                | Boundary follows pointer; no easing.                               | Immediate.         |
| Keyboard resize  | Commit each semantic step.              | Short retargetable transition.                                     | Retarget.          |
| Open             | Immediate commit and focus policy.      | Sibling FLIP plus short clip/fade shell entry.                     | Replace.           |
| Close            | Immediate removal and focus recovery.   | Inert tombstone exit plus sibling FLIP.                            | Replace.           |
| Tab selection    | Immediate selection.                    | Indicator glide; optional very brief content fade.                 | Replace.           |
| Dock/reorder     | Immediate commit after drop.            | Solver-aware FLIP for primary affected shells.                     | Retarget.          |
| Detach to float  | Commit when accepted.                   | Stable-host lift, source placeholder, float settle.                | Retarget.          |
| Maximize/restore | Immediate commit.                       | Shared-rectangle FLIP using live host.                             | Reverse/retarget.  |
| Workspace preset | Immediate or transition-wrapped commit. | Scoped View Transition; FLIP fallback.                             | Latest wins.       |
| Attention        | No structural mutation.                 | One restrained outline/tint pulse plus persistent status.          | Coalesce.          |
| Browser popout   | Commit after destination preparation.   | Source handoff exit and destination entry; no cross-screen flight. | Compensate.        |

Sensitive live content should not be uniformly scaled. The planner supports transform-content for lightweight UI, translate-and-clip for text, editors, maps, and grids, shell-crossfade when content should remain at final size, and View Transition snapshots when live-host interpolation is impractical.

Closing uses a visual tombstone after semantic removal. The tombstone is inert, aria-hidden, pointer-inactive, non-canonical, and hard-bounded. Focus has already moved to its deterministic successor. Repeated “flash” APIs are prohibited; applications request semantic attention and policy chooses a safe one-shot outline or tint pulse plus a persistent badge, text, or icon.

## **11.4 Interruption and reduced motion**

**Table 29.** Interruption policies

| **Policy** | **Semantics**                                                             | **Typical operations**                                   |
|------------|---------------------------------------------------------------------------|----------------------------------------------------------|
| Retarget   | Continue from sampled position and suitable velocity toward a new target. | Layout settle, snap preview, indicator, keyboard resize. |
| Replace    | Sample current value, cancel prior animation, start replacement.          | Presence, hover, focus, attention.                       |
| Finish     | Advance prior animation to endpoint before next operation.                | Rare capture prerequisites.                              |
| Queue      | Run later in deliberate order.                                            | Guided tours only; not normal workspace commands.        |
| Ignore     | Suppress lower-priority duplicate on an owned channel.                    | Repeated attention, decoration during drag.              |

**Table 30.** Motion profiles

| **Profile** | **Behavior**                                                                                                    |
|-------------|-----------------------------------------------------------------------------------------------------------------|
| Off         | No non-essential animation. Direct manipulation still moves because movement is the interaction.                |
| Reduced     | Avoid large translation, zoom, morphing, overshoot, and inertia; use immediate change or brief opacity/outline. |
| Productive  | Default short spatial continuity, near-critical springs, no decorative bounce.                                  |
| Expressive  | Richer entry and shared-element treatment while preserving all performance and accessibility gates.             |

Preference resolution combines system reduced-motion and reduced-transparency signals, application and workspace settings, operation essentiality, and current frame budget. An application may reduce motion further but may not silently override a user request to reduce it. Switching profiles during active animation cancels or retargets through the same cleanup contract.

**Table 31.** Motion-system requirements

| **ID**  | **Level** | **Normative requirement**                                                                               | **Acceptance evidence**                                  |
|---------|-----------|---------------------------------------------------------------------------------------------------------|----------------------------------------------------------|
| MOT-001 | MUST      | Direct drag and pointer resize have no delayed smoothing between input and controlled object.           | High-speed pointer trace and visual-latency measurement. |
| MOT-002 | MUST      | Semantic commit, focus, accessibility state, and lifecycle do not wait for motion completion.           | Mid-animation state assertions.                          |
| MOT-003 | MUST      | Every running animation belongs to a disposable Scope with finish, cancel, skip, and cleanup behavior.  | Scope closure and leak tests.                            |
| MOT-004 | MUST      | A re-grab samples current visual geometry and begins without a jump exceeding one CSS pixel.            | Interruption tests at sampled progress points.           |
| MOT-005 | MUST      | Closing content is semantically removed before an inert visual tombstone exits.                         | Focus, ARIA, and tombstone tests.                        |
| MOT-006 | MUST NOT  | The library ships a repeating strobe, full-panel luminance flash, or motion-only status indicator.      | Preset audit and automated flash analysis.               |
| MOT-007 | MUST      | View Transitions are optional progressive enhancement; skip or failure cannot prevent state change.     | Capability and skipTransition tests.                     |
| MOT-008 | MUST      | Cross-window transfer uses coordinated handoff rather than a claimed continuous cross-screen animation. | Popout UX and documentation review.                      |
| MOT-009 | MUST      | Layout, gesture, presence, clip, and emphasis channels cannot overwrite one another’s owned properties. | Style ownership conformance tests.                       |
| MOT-010 | SHOULD    | The planner degrades decoration before spatial continuity and never degrades direct input tracking.     | Load-adaptive motion benchmark.                          |

# **12. Rendering architecture and stable content hosts**

## **12.1 Three-layer renderer**

<img src="media/image9.png" title="Figure 9: Semantic chrome, stable content hosts, and overlays are independent presentation layers." style="width:5.8in;height:4.66829in" alt="Vertical rendering diagram. The overlay plane contains drag previews, snap guides, menus, shields, and live regions. The semantic chrome tree contains tabs, headers, splitters, and title bars. The stable content-host plane positions editors, maps, iframes, video, canvases, and forms while application roots mount inside stable hosts." />

**Figure 9.** Semantic chrome, stable content hosts, and overlays are independent presentation layers.

The semantic chrome tree follows logical layout and accessibility order. Stable content hosts may remain under a document-level content plane while being geometrically positioned over logical slots. The overlay plane owns temporary visual and interaction artifacts. This separation preserves heavyweight content during same-document moves without forcing every panel into an accessibility-hostile flattened DOM strategy.

**TypeScript**

> type HostStrategy =  
> \| "semantic"  
> \| "stable"  
> \| "isolated-root"  
> \| "iframe";

**Table 32.** Panel host strategies

| **Strategy**  | **Use**                                                        | **Trade-off**                                                    |
|---------------|----------------------------------------------------------------|------------------------------------------------------------------|
| Semantic      | Ordinary content follows logical DOM tree.                     | Best native structure; moves may remount/reparent.               |
| Stable        | Sensitive live content remains under stable document parent.   | Requires geometry positioning, clipping, and focus coordination. |
| Isolated root | Panel owns a dedicated framework or Web Component root.        | Clear failure boundary; context must be bridged explicitly.      |
| Iframe        | Security or runtime isolation, including cross-origin content. | Special focus, pointer-shield, sizing, and checkpoint behavior.  |

## **12.2 Framework-independent projection**

The DOM renderer consumes immutable snapshots, semantic patches, geometry patches, and motion plans. It does not execute framework component reconciliation for every geometry frame. Chrome subscribes by entity and selector; geometry writes CSS variables, transforms, or positioned host styles directly. An unrelated group activation cannot rerender every panel.

- Every overlay root and event listener is surface-scoped and uses ownerDocument/ownerWindow rather than ambient globals.

- ShadowRoot event paths, nested workspaces, design-system roots, and explicit stylesheet bootstrap are supported.

- A single surface frame scheduler batches DOM reads, geometry calculation, writes, and post-frame notifications.

- Iframes receive interaction shields when necessary; the system never depends on iframe content forwarding pointer events.

- Chrome and content error boundaries are independent. One panel renderer failure cannot corrupt the workspace shell.

- Server-side imports do not access document or window; hydration identifiers are deterministic.

**Table 33.** Rendering requirements

| **ID**  | **Level** | **Normative requirement**                                                                                             | **Acceptance evidence**                                          |
|---------|-----------|-----------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------|
| REN-001 | MUST      | Same-document movement in stable-host mode preserves the panel content host and does not remount content.             | Mount counter tests with editor, map, iframe, and form fixtures. |
| REN-002 | MUST      | Geometry-frame updates bypass framework-wide rendering and update only affected DOM projection.                       | Framework render-count traces.                                   |
| REN-003 | MUST      | Every browser-facing operation uses the relevant surface document and window.                                         | Multi-document and Shadow DOM tests.                             |
| REN-004 | MUST      | Overlay, shield, listener, observer, and host resources are finalized with their owning surface or interaction Scope. | Lifecycle leak tests.                                            |
| REN-005 | MUST      | Semantic chrome remains accessible even when content uses a stable flattened host plane.                              | Screen-reader and DOM-order tests.                               |
| REN-006 | SHOULD    | A panel or group renderer failure is isolated and replaced by a recoverable error surface.                            | Error-injection fixtures.                                        |

# **13. Panel lifecycle and resource management**

## **13.1 Lifecycle states and policies**

<img src="media/image10.png" title="Figure 10: Panel lifecycle state machine across mount, visibility, suspension, transfer, and disposal." style="width:6.8in;height:2.34475in" alt="Lifecycle state machine from registered to created, mounting, mounted hidden or visible, suspending and suspended, transferring and remounting, and disposing to disposed. Visibility is reversible; disposal is terminal." />

**Figure 10.** Panel lifecycle state machine across mount, visibility, suspension, transfer, and disposal.

**Table 34.** Lifecycle policies

| **Policy**         | **Hidden behavior**                                           | **Resource and state implications**                                                |
|--------------------|---------------------------------------------------------------|------------------------------------------------------------------------------------|
| keepAlive          | Content remains mounted and becomes inert when hidden.        | Preserves DOM/framework state; application pauses background work; highest memory. |
| detach             | Renderer unmounts while logical panel remains.                | Application state must survive independently; lower memory.                        |
| suspend            | Library requests checkpoint and releases expensive resources. | Resume reconstructs from typed checkpoint; suitable for many inactive panels.      |
| applicationManaged | Application controls rendering and resource lifecycle.        | Library supplies host, dimensions, visibility, transfer, and Scope signals.        |

Lifecycle callbacks document ordering, multiplicity, cancellation, revision, failure behavior, and allowed latency:

**TypeScript**

> interface PanelLifecycle {  
> onCreate(context: PanelContext): void;  
> onMount(host: HTMLElement, context: MountContext): Disposable;  
> onVisibilityChange(change: VisibilityChange): void;  
> onActivationChange(change: ActivationChange): void;  
> onDimensionsChange(change: DimensionsChange): void;  
>   
> onBeforeTransfer(request: TransferRequest):  
> Effect\<PanelCheckpoint, TransferError\>;  
> onAfterTransfer(result: TransferResult): void;  
>   
> onSuspend(request: SuspendRequest):  
> Effect\<PanelCheckpoint, SuspendError\>;  
> onResume(checkpoint: PanelCheckpoint):  
> Effect\<void, ResumeError\>;  
>   
> onDispose(reason: DisposeReason): void;  
> }

Visibility is structured, not one boolean. A panel may be selected, geometrically visible, occluded, in a background document, minimized, hidden by responsive projection, or suspended. Applications receive reasoned signals so maps, video, polling, observers, and rendering loops can adapt correctly.

## **13.2 Same-document and cross-document transfer**

Same-document transfer prefers stable-host preservation and needs no checkpoint when the renderer declares support. Cross-document transfer uses prepare, checkpoint, ownership commit, destination mount, readiness acknowledgment, source release, and compensation on failure. The system does not claim transparent DOM continuity across independent documents.

**Table 35.** Cross-document rendering modes

| **Mode**       | **Continuity**                                                    | **Isolation**              | **Requirements**                                                  |
|----------------|-------------------------------------------------------------------|----------------------------|-------------------------------------------------------------------|
| Portal-coupled | Can preserve framework context under same-origin opener coupling. | Lower failure isolation.   | Explicit stylesheet/CSP bootstrap and opener lifecycle.           |
| Remote         | Checkpoint and independently bootstrap destination renderer.      | Strong failure isolation.  | Serializable state, protocol authentication, version negotiation. |
| Mirrored       | Destination renders another view over shared app state.           | Independent view identity. | Distinct panel ID or declared mirror relationship.                |

**Table 36.** Lifecycle requirements

| **ID**  | **Level** | **Normative requirement**                                                                                           | **Acceptance evidence**                      |
|---------|-----------|---------------------------------------------------------------------------------------------------------------------|----------------------------------------------|
| LIF-001 | MUST      | The lifecycle state machine and callback ordering are public compatibility contracts.                               | Lifecycle specification and adapter tests.   |
| LIF-002 | MUST      | Every successful mount has exactly one eventual finalization; duplicate disposal is harmless at the boundary.       | Mount/dispose counter fuzzing.               |
| LIF-003 | MUST      | Hidden content is inert and excluded from accessibility traversal while preserving declared lifecycle state.        | DOM and assistive-technology tests.          |
| LIF-004 | MUST      | Cross-document transfer has an explicit checkpoint/remount or mirror contract.                                      | Surface transfer certification.              |
| LIF-005 | MUST      | Failed transfer retains or recovers the panel in a safe authoritative surface.                                      | Failure injection after every protocol step. |
| LIF-006 | MUST      | Lifecycle callbacks carry cancellation and revision context and cannot mutate canonical state directly.             | Type and runtime contract tests.             |
| LIF-007 | SHOULD    | Visibility reasons allow applications to pause expensive work without conflating selection and document visibility. | Heavy-content integration tests.             |

# **14. Focus, selection, activation, and command scope**

## **14.1 Focus model**

<img src="media/image11.png" title="Figure 11: Selected, active, focused, and frontmost are related but independent concepts." style="width:6.3in;height:1.04281in" alt="Focus model diagram. Group selection can influence workspace activation; actual DOM focus can activate content and belongs to a surface. A focus ledger records a weak element or restoration token and restores after moves or remounts." />

**Figure 11.** Selected, active, focused, and frontmost are related but independent concepts.

**Table 37.** Focus and activation concepts

| **Concept**                | **Scope**                  | **Meaning**                                                                  |
|----------------------------|----------------------------|------------------------------------------------------------------------------|
| Selected panel             | Per group                  | Panel whose content viewport is shown in that group.                         |
| Active panel               | Per workspace              | Target for application and workspace commands.                               |
| Focused element            | Per document               | Actual DOM keyboard focus target.                                            |
| Frontmost floating surface | Per workspace projection   | Highest relevant surface in floating z-order.                                |
| Focused surface            | Per browser context        | Surface whose document or subtree owns focus.                                |
| Selected panel set         | Optional interaction state | Explicit multi-selection for batch commands; not implicit from active panel. |

Clicking content activates its panel but does not replace the clicked element’s natural focus. Selecting a tab does not automatically focus panel content unless policy requests it. Programmatic activation specifies one of keep-focus, focus-tab, focus-panel-root, or restore-descendant. Ordinary floating tools never trap focus; only genuinely modal application surfaces do.

## **14.2 Restoration rules**

> **1.** Restore the remembered live descendant when safe and still eligible.
>
> **2.** Otherwise focus the panel root or selected tab according to the operation’s explicit focus policy.
>
> **3.** When closing a focused panel, choose next eligible tab, then previous tab, then nearest eligible group, then workspace root.
>
> **4.** When moving a focused stable host, preserve the focused descendant.
>
> **5.** When cross-document remounting, use a stable restoration token when supported; otherwise use the panel-level fallback.
>
> **6.** Never leave focus on document body solely because a structural operation moved or closed content.
>
> **7.** Focus restoration happens at semantic commit, not after visual settlement.

**TypeScript**

> interface PanelFocusMemory {  
> readonly lastElement?: WeakRef\<HTMLElement\>;  
> readonly restorationToken?: string;  
> readonly fallback: "panel-root" \| "selected-tab" \| "group-header";  
> }

**Table 38.** Focus requirements

| **ID**  | **Level** | **Normative requirement**                                                                        | **Acceptance evidence**              |
|---------|-----------|--------------------------------------------------------------------------------------------------|--------------------------------------|
| FOC-001 | MUST      | Selection, activation, DOM focus, and frontmost-surface state remain distinct in model and API.  | Type and behavior tests.             |
| FOC-002 | MUST      | Clicking an interactive descendant does not lose its natural focus merely to activate a panel.   | Form, editor, and grid fixtures.     |
| FOC-003 | MUST      | Every close, move, transfer, restore, and projection change has deterministic focus recovery.    | Operation-by-operation focus matrix. |
| FOC-004 | MUST      | Focus is correct immediately after semantic commit and does not wait for animation.              | Mid-animation focus assertions.      |
| FOC-005 | MUST NOT  | Ordinary floating panels use modal semantics or focus trapping.                                  | ARIA and keyboard tests.             |
| FOC-006 | SHOULD    | Panel renderers may provide stable restoration tokens for meaningful descendants across remount. | Adapter contract tests.              |

# **15. Accessibility and input parity**

## **15.1 Semantic patterns**

Accessibility is generated from the same commands, capabilities, focus policies, and semantic entities that drive pointer interaction. It is not a separate optional renderer. WCAG 2.2 AA is the baseline; WAI-ARIA Authoring Practices patterns guide tabs, splitters, dialogs, landmarks, and keyboard behavior where applicable.

**Table 39.** Accessibility semantic contract

| **Element**          | **Required semantics and behavior**                                                              |
|----------------------|--------------------------------------------------------------------------------------------------|
| Tab strip            | tablist, tab, tabpanel, aria-selected, aria-controls, roving tabindex, arrow/Home/End behavior.  |
| Splitter             | Focusable separator, orientation, name, value min/max/now, arrow and large-step resizing.        |
| Panel region         | Native section/heading first; named region only when useful as a landmark.                       |
| Floating tool        | Named non-modal region or application-specific semantic container; no automatic dialog role.     |
| Modal surface        | Dialog semantics, inert background, focus containment, explicit close and return-focus behavior. |
| Drag targets         | Equivalent keyboard move mode and command/menu alternatives; visible and announced destination.  |
| Hidden panel         | Inert, not focusable, excluded from accessibility tree according to lifecycle projection.        |
| Status and attention | Text/icon/persistent state plus restrained optional motion; never color or motion alone.         |

Automatic tab activation is used only when panel display is effectively immediate. Where selection may trigger expensive loading or disruptive content changes, focus navigation is manual and activation requires Enter or Space. Splitter steps are exposed in meaningful percentages or application-defined units, not only opaque pixels.

## **15.2 Announcements and assistive technology**

The announcer emits localized semantic outcomes, never raw geometry or internal protocol phases:

- Panel opened, closed, reopened, moved, floated, redocked, maximized, restored, or transferred.

- Destination group, semantic region, tab position, or surface.

- Final splitter value or collapsed/restored status.

- Constraint failure and available recovery action.

- Popup failure with confirmation that the panel remained safe.

- Undo or redo result.

Pointer operations announce only the final result unless the user explicitly enters keyboard move or resize mode. Keyboard navigation announces the current candidate at a controlled rate. The host may replace the announcer to integrate with an application-wide live-region strategy.

## **15.3 Accessibility verification**

**Table 40.** Accessibility test matrix

| **Mode**             | **Minimum manual coverage**                                                            |
|----------------------|----------------------------------------------------------------------------------------|
| Keyboard-only        | All structural actions, cancellation, focus order, menus, palette, undo, and recovery. |
| NVDA                 | Firefox and Chromium task suite.                                                       |
| JAWS                 | Chromium task suite.                                                                   |
| VoiceOver            | Safari on macOS and representative iOS projection tasks.                               |
| TalkBack             | Representative Android touch and keyboard tasks.                                       |
| Visual accessibility | 200% and 400% zoom, reflow, forced colors, contrast, focus visibility.                 |
| Motion/accessibility | Reduced motion, reduced transparency where supported, flashing analysis.               |
| Internationalization | RTL and at least one non-Latin locale; meaningful accessible names.                    |

**Table 41.** Accessibility requirements

| **ID**   | **Level** | **Normative requirement**                                                                                             | **Acceptance evidence**                                  |
|----------|-----------|-----------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------|
| A11Y-001 | MUST      | The stable release conforms to WCAG 2.2 AA for the declared supported profiles.                                       | Automated and manual accessibility report.               |
| A11Y-002 | MUST      | Every structural pointer operation has an equivalent keyboard and programmatic command.                               | Generated action parity matrix.                          |
| A11Y-003 | MUST      | Tabs and splitters implement the applicable WAI-ARIA interaction patterns.                                            | Semantic DOM and keyboard tests.                         |
| A11Y-004 | MUST      | Announcements describe final semantic outcomes and are localizable, replaceable, and rate-controlled.                 | Screen-reader task recordings and message catalog audit. |
| A11Y-005 | MUST      | Workspace controls remain operable at 400% zoom and in forced-colors mode.                                            | Visual and interaction regression suite.                 |
| A11Y-006 | MUST      | Reduced motion removes non-essential spatial movement and does not merely shorten every duration.                     | Reduced-motion snapshot and behavior tests.              |
| A11Y-007 | MUST NOT  | Color, motion, hover, or precision dragging is the sole means of communicating state or invoking a structural action. | UX and accessibility audit.                              |
| A11Y-008 | SHOULD    | Voice-control-friendly accessible names remain stable and specific across panels and actions.                         | Voice-control task review.                               |

# **16. Surface architecture**

## **16.1 Surface kinds and capabilities**

**TypeScript**

> interface SurfaceCapabilities {  
> readonly nestedLayout: boolean;  
> readonly floating: boolean;  
> readonly popout: boolean;  
> readonly alwaysOnTop: boolean;  
> readonly freePositioning: boolean;  
> readonly crossDocument: boolean;  
> readonly multiScreenPlacement: boolean;  
> }

**Table 42.** Surface kinds

| **Surface kind** | **Characteristics**                                                                      | **Typical use**                         |
|------------------|------------------------------------------------------------------------------------------|-----------------------------------------|
| Main             | Primary document root; full layout and application integration.                          | Ordinary workspace.                     |
| Embedded         | Constrained root inside a host region or nested workspace.                               | Dashboard widget, sidecar tool.         |
| Floating         | In-page surface with z-order, movement, resize, snap, maximize.                          | Tool windows and temporary comparisons. |
| Browser window   | Independent document with popup, focus, close, style, protocol, and monitor constraints. | Multi-monitor and detached workflows.   |
| Document PiP     | Restricted always-on-top document surface where supported.                               | Compact monitor, preview, controller.   |

Commands and UI are capability-driven. A panel declares allowed surface kinds and checkpoint support; a renderer declares stable-host and cross-document capabilities; an application policy may further restrict placement. The intersection determines whether float, popout, mirror, or Picture-in-Picture actions appear.

## **16.2 Floating and browser-window surfaces**

- Floating surfaces support titlebar drag, edge/corner resize, min/max constraints, minimum visible area, z-order, maximize/restore, minimize policy, snap, tile, cascade, and keyboard movement.

- Activation may raise a floating surface without stealing focus from the actual clicked descendant.

- Floating geometry is stored as CSS-pixel hints with anchors and prior non-maximized geometry; it is clamped on viewport, zoom, DPR, and safe-area changes.

- Browser windows are prepared under user activation before ownership commit. A blocked popup leaves the panel in place.

- Stylesheets, theme tokens, locale, direction, CSP nonce, protocol version, and renderer bootstrap are explicit surface inputs.

- Unexpected external-window closure produces a platform-originated recovery command rather than silent disposal.

<img src="media/image12.png" title="Figure 12: Prepared browser-window transfer with atomic ownership and compensation." style="width:6.8in;height:1.80069in" alt="Sequence diagram among source surface, coordinator, destination window, and panel lifecycle. The destination is prepared and bootstrapped before checkpoint and ownership commit. Destination readiness precedes source release. Failure before readiness retains or redocks the panel." />

**Figure 12.** Prepared browser-window transfer with atomic ownership and compensation.

## **16.3 Multi-screen and Picture-in-Picture**

The Window Management API is a progressive enhancement for discovering screens and choosing placement when supported and permitted. Ordinary operation cannot require that permission. The application explains the benefit before prompting, persists only coarse screen hints, and rehomes surfaces if a screen disappears or display scale changes.

Document Picture-in-Picture is modeled as a restricted capability surface, not a general popout replacement. It may be always-on-top but cannot promise free positioning or independent lifetime. It is suitable for focused previews, monitors, and controls. Capability detection and an in-page fallback are mandatory.

**Table 43.** Surface requirements

| **ID**  | **Level** | **Normative requirement**                                                                                   | **Acceptance evidence**                               |
|---------|-----------|-------------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| SUR-001 | MUST      | Every surface exposes explicit capabilities; commands and UI use capability intersection.                   | Capability matrix tests.                              |
| SUR-002 | MUST      | A browser-window destination is prepared and acknowledged before semantic ownership transfer.               | Blocked-popup and bootstrap-failure tests.            |
| SUR-003 | MUST      | Unexpected surface loss produces deterministic recovery without panel loss.                                 | Close, crash, refresh, and coordinator-failure tests. |
| SUR-004 | MUST      | Surface-specific DOM, style, locale, direction, and security context are explicit.                          | Multi-document rendering tests.                       |
| SUR-005 | MUST      | Restored geometry is clamped to available viewport and monitor configuration with a minimum visible region. | Monitor removal, zoom, and DPR tests.                 |
| SUR-006 | MUST NOT  | Multi-screen permission is required for normal single-screen functionality.                                 | Permission-denied conformance.                        |
| SUR-007 | MUST      | Picture-in-Picture is treated as a restricted optional surface and has an in-page fallback.                 | Capability and fallback tests.                        |

# **17. Persistence, migration, history, and recovery**

## **17.1 Versioned persistence**

Persistence is a versioned protocol rather than a raw JSON dump. The envelope separates kernel schema, application layout, surface protocol, and per-panel type versions because these evolve under different owners and compatibility policies.

**TypeScript**

> interface WorkspaceEnvelope {  
> readonly kernelSchemaVersion: number;  
> readonly applicationLayoutVersion: number;  
> readonly protocolVersion: number;  
> readonly panelTypeVersions: Readonly\<Record\<string, number\>\>;  
> readonly snapshotRevision: string;  
> readonly checksum: string;  
> readonly workspace: unknown;  
> }
>
> **1.** Parse the bounded outer envelope and reject excessive depth, size, count, or invalid primitive values.
>
> **2.** Validate the kernel source schema.
>
> **3.** Run pure kernel migrations one version at a time.
>
> **4.** Run application semantic-layout migrations using regions and placement intent.
>
> **5.** Run registered per-panel parameter and checkpoint migrations.
>
> **6.** Reconcile installed panel types and plugins.
>
> **7.** Create recoverable placeholders for unavailable types.
>
> **8.** Canonicalize and validate all invariants.
>
> **9.** Commit restoration atomically or retain the prior safe workspace.

Migrations never modify the stored source in place before the new envelope is fully validated. Unknown future major versions fail non-destructively. Safe extension namespaces may be preserved through migrations. Every migration emits a diagnostic summary and may be exercised in a worker for large imports.

## **17.2 Snapshot and journal**

<img src="media/image13.png" title="Figure 13: Crash-safe snapshot, transaction journal, checkpoint, and recovery flow." style="width:6.6in;height:0.54924in" alt="Persistence diagram. Canonical snapshots and compact semantic transaction journals are written atomically. Panel checkpoints are stored before references. Startup validates the latest snapshot and replays journal entries; checksum or migration failure falls back to the last-known-good snapshot with diagnostics." />

**Figure 13.** Crash-safe snapshot, transaction journal, checkpoint, and recovery flow.

**Table 44.** Persistence durability modes

| **Durability mode** | **Acknowledgment semantics**                                          | **Use**                            |
|---------------------|-----------------------------------------------------------------------|------------------------------------|
| Strict              | Command acknowledgment waits for durable journal append.              | High-value operational workspaces. |
| Balanced            | Semantic commit is immediate; bounded short batch writes the journal. | Default professional applications. |
| Session             | Periodic snapshot with best-effort journal.                           | Ephemeral or embedded workspaces.  |

IndexedDB is the default browser adapter. It stores canonical snapshots, compact semantic transaction entries, content-addressed or versioned panel checkpoints, last-known-good markers, and checksums. Snapshot compaction writes and verifies a new snapshot before pruning covered journal entries. Correctness never depends solely on beforeunload or page-visibility timing.

## **17.3 Undo, restore, and missing content**

**Table 45.** History and recovery semantics

| **Concern**                | **Required behavior**                                                                                |
|----------------------------|------------------------------------------------------------------------------------------------------|
| Workspace undo             | Separate command scope from editor/content undo; one completed gesture per entry.                    |
| Close undo                 | Recreate from descriptor/checkpoint when supported; otherwise classify irreversibility before close. |
| Popout restore             | Restore in-page or pending-external until a user gesture can reopen windows.                         |
| Missing panel type         | Preserve ID, type, title hint, parameters, checkpoint, and intended placement in placeholder.        |
| Corrupt latest state       | Fall back to last-known-good and expose exportable diagnostics.                                      |
| New application default    | Use semantic-region migration; do not reset the user layout.                                         |
| Monitor or viewport change | Re-clamp floating hints; preserve canonical docked weights.                                          |

**Table 46.** Persistence and recovery requirements

| **ID**  | **Level** | **Normative requirement**                                                                           | **Acceptance evidence**                  |
|---------|-----------|-----------------------------------------------------------------------------------------------------|------------------------------------------|
| PER-001 | MUST      | Persistence separates kernel, application-layout, protocol, and panel-type versions.                | Envelope schema and migration tests.     |
| PER-002 | MUST      | Every previously supported schema has a tested migration or explicit non-destructive recovery path. | Migration fixture corpus.                |
| PER-003 | MUST      | Snapshot and journal updates are atomic within the storage adapter’s transaction model.             | Crash and fault-injection tests.         |
| PER-004 | MUST      | Panel checkpoint data is durable before a canonical snapshot references it.                         | Write-order tests.                       |
| PER-005 | MUST      | A missing panel type is represented by a recoverable placeholder rather than silently deleted.      | Plugin removal and restore tests.        |
| PER-006 | MUST      | Workspace undo is separate from application content undo and has explicit command scope.            | Editor integration tests.                |
| PER-007 | MUST      | Restoring external-window intent never requires automatic popup creation and never loses the panel. | Session restore with popup restrictions. |
| PER-008 | SHOULD    | Canonical serialization has stable ordering suitable for hashing and semantic diffing.              | Hash stability tests.                    |

# **18. Collaboration and distributed coordination**

## **18.1 Personal versus shared layout**

The default collaboration model is shared content context with personal layout. Panel documents, selected entities, or analysis context may be shared while each user retains placement, size, visibility, and active-tab preferences. Shared structural layout is an explicit product mode for presentation, pair work, or operational control rooms.

**Table 47.** Collaboration modes

| **Mode**            | **Shared data**                                                | **Personal data**                                       |
|---------------------|----------------------------------------------------------------|---------------------------------------------------------|
| Personal layout     | Panel/document availability and application content.           | Topology, sizes, floats, active tabs, focus.            |
| Presentation follow | Presenter’s structural transaction stream and viewport intent. | Follower may temporarily opt out and later rejoin.      |
| Shared layout       | Authorized semantic transactions and ownership.                | Local focus, input modality, reduced-motion preference. |
| Mirrored monitoring | Shared application state and panel definitions.                | Independent view arrangement and surface placement.     |

Pointer previews, presence, and resize movement are ephemeral channels and are not written as durable layout transactions. Final semantic commands are replicated with actor, transaction, base revision, and relational anchors. Shared-layout mode exposes conflict and ownership policy rather than pretending every operation commutes.

## **18.2 Single-writer coordination**

Each workspace session has one ordering authority: an application server, SharedWorker, or leader-elected surface. The coordinator owns revision assignment, surface registry, panel ownership, epochs, heartbeats, and pending transfers. BroadcastChannel or message ports carry protocol packets but do not themselves provide ordering, authentication, or recovery semantics.

**TypeScript**

> interface SurfaceMessageEnvelope {  
> readonly protocolVersion: number;  
> readonly workspaceId: string;  
> readonly sessionNonce: string;  
> readonly senderSurfaceId: SurfaceId;  
> readonly coordinatorEpoch: number;  
> readonly baseRevision: string;  
> readonly transactionId: string;  
> readonly payload: unknown;  
> }

- Exactly one coordinator epoch is accepted at a time; stale leaders cannot commit.

- Duplicate transaction IDs are idempotent; reordered messages cannot create duplicate ownership.

- A panel has at most one authoritative owner. Mirrors are explicit distinct view instances.

- Active direct manipulation may obtain a short lease over affected entities; remote conflicts are queued, rejected, or reconciled by published policy.

- Relational tab anchors and semantic regions improve rebase behavior compared with raw indexes.

- Surface heartbeats identify orphaned ownership; recovery is deterministic and never silently discards content.

**Table 48.** Collaboration requirements

| **ID**  | **Level** | **Normative requirement**                                                                                     | **Acceptance evidence**                      |
|---------|-----------|---------------------------------------------------------------------------------------------------------------|----------------------------------------------|
| COL-001 | MUST      | Personal layout is the default collaboration mode unless the product explicitly enables shared layout.        | Configuration and UX review.                 |
| COL-002 | MUST      | Durable collaboration replicates semantic transactions, not pointer frames or raw DOM events.                 | Transport trace audit.                       |
| COL-003 | MUST      | Every protocol packet is versioned, schema-validated, session-bound, epoch-bound, and transaction-identified. | Protocol fuzzing.                            |
| COL-004 | MUST      | At most one authoritative owner exists for each panel instance.                                               | TLA+ or equivalent model-checking invariant. |
| COL-005 | MUST      | Coordinator loss, duplicate delivery, reordering, and stale epochs have defined recovery behavior.            | Distributed failure simulation.              |
| COL-006 | SHOULD    | Presence and preview traffic uses a separate lossy channel from durable transactions.                         | Transport architecture test.                 |

# **19. Extensibility and plugin architecture**

## **19.1 Extension points**

The stable plugin model permits contributions through typed values, services, and registries:

- Panel types, parameter/checkpoint schemas, renderers, constraints, lifecycle policy, and capabilities.

- Commands, menus, context actions, keymaps, command-palette entries, and accessibility labels.

- Placement, close, duplication, responsive, surface, and security policies.

- Surface adapters, snapping providers, layout presets, region migrations, and collaboration transports.

- Tab, group, splitter, floating titlebar, placeholder, error, and recovery chrome.

- Persistence metadata namespaces, migrations, diagnostics, telemetry enrichers, and test fixtures.

**TypeScript**

> interface WorkspacePluginManifest {  
> readonly id: string;  
> readonly version: string;  
> readonly engineRange: string;  
> readonly protocolVersion: number;  
> readonly panelTypes: readonly string\[\];  
> readonly commands: readonly string\[\];  
> readonly capabilities: readonly string\[\];  
> readonly persistedNamespaces: readonly string\[\];  
> }

Manifests and all data crossing plugin boundaries are schema-validated. Contribution ordering is deterministic and conflicts are explicit. Persisted plugin data is namespaced and versioned. No extension may bypass command validation, mutate canonical tables, depend on generated class names, or attach unscoped global resources.

## **19.2 Capability negotiation and isolation**

**TypeScript**

> interface RendererCapabilities {  
> readonly stableHost: boolean;  
> readonly crossDocumentCheckpoint: boolean;  
> readonly serverRendering: boolean;  
> readonly keepAlive: boolean;  
> readonly suspend: boolean;  
> readonly isolatedRoot: boolean;  
> }

The available action set is the intersection of panel, renderer, surface, application-policy, security, and platform capabilities. Unsupported actions do not appear or are shown disabled with a reason. Plugin panels may run in an isolated framework root, sandboxed iframe, or application-defined microfrontend boundary. Cross-origin messages, clipboard, file drop, screen access, and other sensitive capabilities are opt-in and allowlisted.

**Table 49.** Plugin failure handling

| **Plugin violation**                    | **Required response**                                                        |
|-----------------------------------------|------------------------------------------------------------------------------|
| Duplicate panel/command ID              | Reject registration with deterministic conflict report.                      |
| Unsupported engine or protocol version  | Do not load; render recoverable plugin placeholder where needed.             |
| Renderer throws                         | Contain at panel/group boundary and expose retry, export, and close actions. |
| Migration fails                         | Retain source data, create placeholder, and surface diagnostic.              |
| Unscoped resource or timeout            | Development diagnostics; production Scope closes on plugin unload.           |
| Excessive synchronous contribution work | Measure, warn, and disable or isolate according to application policy.       |

**Table 50.** Extension requirements

| **ID**  | **Level** | **Normative requirement**                                                                                     | **Acceptance evidence**             |
|---------|-----------|---------------------------------------------------------------------------------------------------------------|-------------------------------------|
| EXT-001 | MUST      | Extensions use documented registries, ports, policies, and contribution values rather than private internals. | Public extension conformance suite. |
| EXT-002 | MUST      | Plugin manifests, protocol messages, persisted namespaces, and panel data are versioned and schema-validated. | Boundary tests.                     |
| EXT-003 | MUST      | Plugin ordering and conflicts are deterministic and diagnosable.                                              | Registration-order tests.           |
| EXT-004 | MUST NOT  | A plugin mutates canonical state or attaches unscoped global listeners through a supported API.               | API and leak tests.                 |
| EXT-005 | MUST      | Unavailable or failed plugins do not erase persisted panels or placements.                                    | Restore and failure tests.          |
| EXT-006 | SHOULD    | Third-party adapters can run the public conformance suite and publish certification metadata.                 | Certification workflow.             |

# **20. Public API and developer experience**

## **20.1 Typed panel registry**

The ordinary consumer API is framework-idiomatic, schema-backed, and free of Effect or XState concepts. Panel definitions infer parameter and checkpoint types. Runtime schemas validate persisted, remote, and plugin data at trust boundaries. Stable IDs and explicit placement eliminate hidden registration order and DOM coupling.

**TypeScript**

> const panels = definePanels({  
> "map.canvas": definePanel({  
> parameters: Schema.Struct({ mapId: Schema.String }),  
> checkpoint: Schema.Struct({  
> longitude: Schema.Number,  
> latitude: Schema.Number,  
> zoom: Schema.Number,  
> }),  
> capabilities: {  
> closable: true,  
> floatable: true,  
> popout: true,  
> singleton: true,  
> },  
> constraints: {  
> hardMinInline: 320,  
> hardMinBlock: 240,  
> preferredInline: 900,  
> preferredBlock: 700,  
> },  
> lifecycle: {  
> hidden: "keepAlive",  
> sameDocumentMove: "preserve-host",  
> crossDocumentMove: "checkpoint-remount",  
> },  
> renderer: () =\> import("./MapPanel"),  
> }),  
> });

**TypeScript**

> const workspace = createWorkspace({  
> panels,  
> defaultLayout,  
> persistence: { key: "map-creator.workspace", durability: "balanced" },  
> history: { limit: 200 },  
> motion: {  
> profile: "productive",  
> respectSystemPreferences: true,  
> viewTransitions: "progressive",  
> },  
> });

A first useful workspace should require panel definitions, an initial layout or placement policy, and one surface component. Advanced applications can provide Effect Layers, custom transports, renderers, surface adapters, motion drivers, policies, and diagnostics without changing ordinary panel call sites.

## **20.2 Commands, queries, subscriptions, and effects**

The API separates four concepts rather than hiding them behind a generic event emitter:

**Table 51.** Public API classes

| **API class**     | **Purpose**                                                     | **Example**                                             |
|-------------------|-----------------------------------------------------------------|---------------------------------------------------------|
| Commands          | Request semantic change and return typed receipt or rejection.  | open, movePanel, batch, popout, undo.                   |
| Queries/selectors | Read current immutable state or derived value.                  | selectActivePanel, selectGroupTabs.                     |
| Subscriptions     | Observe fine-grained selector or committed transaction changes. | subscribe(selector), transactions.subscribe.            |
| Lifecycle/effects | Coordinate panel resources and fallible external work.          | onSuspend, SurfacePort.prepare, PersistencePort.append. |

**TypeScript**

> workspace.open("map.inspector", { featureId: "feature-42" });  
>   
> workspace.movePanel(panelId, {  
> kind: "region",  
> region: "inspector",  
> });  
>   
> workspace.batch("Prepare review workspace", tx =\> {  
> tx.open("map.inspector", { featureId: selectedFeatureId });  
> tx.open("map.canvas", { mapId: "comparison" });  
> tx.applyPreset("side-by-side-review");  
> });

Synchronous commands return synchronously when no preparation is required. Operations such as popout, guarded close, checkpoint, import, and collaboration authorization return a typed Promise-like result from the convenience API and an Effect program from the advanced API. Expected failures never escape as arbitrary rejected values.

**TypeScript**

> const result = await workspace.popout(groupId);  
>   
> if (!result.ok && result.error.code === "POPUP_BLOCKED") {  
> showPopupHelp(result.error.remediation);  
> }

Selectors record entity dependencies or use explicit equality. A transaction touching another group does not recompute or rerender the current group. The transaction stream remains one semantic entry per commit and contains origin, previous/new revision, patches, inverse, timing, and diagnostics.

## **20.3 Error and diagnostic quality**

**Diagnostic example**

> MOVE_PANEL_REJECTED  
>   
> Panel "map.inspector#2" cannot be placed in region "navigation".  
>   
> Reason:  
> The placement policy restricts this panel type to "inspector" and  
> "floating-tools".  
>   
> Suggested actions:  
> - Move to "inspector"  
> - Float the panel  
> - Keep the panel in its current group  
>   
> Revision: 1842  
> Command ID: tx_01J...

Every expected failure has a stable code, structured details, human explanation, remediation, transaction or protocol identity, and redaction policy. Development diagnostics may include topology and traces; production messages omit application data by default. Impossible defects are distinguished from expected operational errors.

**Table 52.** Public API and DX requirements

| **ID**  | **Level** | **Normative requirement**                                                                          | **Acceptance evidence**                 |
|---------|-----------|----------------------------------------------------------------------------------------------------|-----------------------------------------|
| API-001 | MUST      | Panel parameters and checkpoints are inferred statically and validated at trust boundaries.        | Type tests and runtime schema tests.    |
| API-002 | MUST      | Commands, queries, subscriptions, lifecycle, and operational effects are separate public concepts. | API surface review.                     |
| API-003 | MUST NOT  | Consumers mutate exposed entity objects or reconstruct truth from events alone.                    | Readonly types and documentation tests. |
| API-004 | MUST      | Expected asynchronous failures return typed result values with stable codes and remediation.       | Error contract snapshots.               |
| API-005 | MUST      | Selectors avoid unrelated recomputation and framework rerender.                                    | Dependency-tracking benchmarks.         |
| API-006 | SHOULD    | First useful workspace setup completes in under ten minutes for an unfamiliar engineer.            | Timed onboarding study.                 |
| API-007 | SHOULD    | Custom panel type setup completes in under fifteen minutes without reading internal source.        | Timed onboarding study.                 |
| API-008 | MUST      | Advanced Effect and protocol APIs are available without forcing them onto ordinary consumers.      | Entry-point and documentation audit.    |

# **21. Framework adapter contracts**

## **21.1 Shared adapter contract**

Every first-party adapter passes one behavior suite covering identity, lifecycle, selector granularity, same-document movement, cross-document transfer, error isolation, lazy loading, nested workspaces, SSR-safe imports, hydration, and development-mode behavior. Framework adapters are projections over the same external store and stable-host registry; they do not implement independent workspace semantics.

**Table 53.** Framework-neutral adapter contract

| **Contract area**    | **Required behavior**                                                                          |
|----------------------|------------------------------------------------------------------------------------------------|
| Identity             | Stable panel ID maps to stable framework key and host across unrelated updates.                |
| Subscriptions        | Only components whose selected data changed rerender.                                          |
| Lifecycle            | Mount, visibility, suspension, transfer, and disposal match core ordering exactly.             |
| Errors               | Panel renderer failure is isolated; workspace chrome remains operational.                      |
| Lazy loading         | Loading, failure, retry, cancellation, and placeholder behavior are typed and accessible.      |
| SSR/import           | Package import is browser-global free; hydration IDs and initial projection are deterministic. |
| Cross-document       | Mode and context continuity are explicit; no implicit portal promise.                          |
| Development behavior | Framework strict or development checks do not duplicate semantic ownership or leak resources.  |

## **21.2 React-specific contract**

- Use an external store integration compatible with concurrent rendering semantics, such as useSyncExternalStore.

- Do not place mutable workspace controllers or full snapshots into context values that change on every transaction.

- Panel content uses stable portal hosts where same-document continuity is requested.

- Geometry and drag frames update the DOM projection directly and cause zero React renders unless a panel explicitly subscribes to dimensions.

- Strict Mode duplicate development invocation cannot create duplicate panel ownership, listeners, checkpoints, or disposal.

- Suspense or lazy loading may affect panel content but cannot suspend the entire workspace shell or corrupt focus fallback.

- Error boundaries exist at panel or group granularity and expose retry, close, export, and diagnostic actions.

Vue, Svelte, Angular, and Web Component adapters follow their idiomatic reactive primitives but the same granularity and lifecycle rules. An adapter is not declared supported until the shared conformance suite passes for its supported framework-version range.

**Table 54.** Framework adapter requirements

| **ID**  | **Level** | **Normative requirement**                                                                    | **Acceptance evidence**               |
|---------|-----------|----------------------------------------------------------------------------------------------|---------------------------------------|
| FWK-001 | MUST      | Every supported framework adapter passes the same semantic and lifecycle contract suite.     | Adapter certification report.         |
| FWK-002 | MUST      | Geometry frames and pointer movement do not trigger workspace-wide framework reconciliation. | Framework profiler traces.            |
| FWK-003 | MUST      | Framework development modes do not duplicate ownership or leak resources.                    | Strict/development-mode tests.        |
| FWK-004 | MUST      | SSR-safe imports and deterministic hydration are documented for supported configurations.    | SSR import and hydration tests.       |
| FWK-005 | MUST      | Cross-document context preservation is explicit and capability-negotiated.                   | Portal-coupled and remote-mode tests. |
| FWK-006 | SHOULD    | Adapter-specific APIs remain idiomatic without changing core semantics.                      | Framework-user review.                |

# **22. Responsive, touch, theming, and localization**

## **22.1 Responsive projection**

Viewport adaptation is a reversible projection over canonical desktop state. Breakpoints may change which regions are presented, how groups are stacked, and whether floats become sheets, but they do not destructively rewrite topology. Expanding the viewport restores the canonical arrangement unless the user explicitly saves a separate named device-class layout.

**Table 55.** Responsive projections

| **Projection** | **Typical presentation**                                                           |
|----------------|------------------------------------------------------------------------------------|
| Desktop        | Full split tree, borders, floating surfaces, popouts, dense keyboard chrome.       |
| Tablet         | Selected two-pane arrangement, drawers for secondary regions, touch-sized handles. |
| Phone          | One active group, group switcher, full-screen panel or bottom-sheet tools.         |
| Embedded       | Host-constrained subset centered on a semantic region.                             |
| Presentation   | Reduced chrome, controlled shared layout, prominent primary content.               |

Touch behavior uses coarse-pointer target sizes, explicit handles where scrolling conflicts, safe-area insets, no hover dependency, and gesture cancellation when the virtual keyboard or viewport changes. Precision snap targets expand visually and semantically without falsifying the final solver result.

## **22.2 Styling and design-system integration**

- Headless or minimally styled core plus optional reference themes.

- CSS custom properties for dimensions, colors, typography, z-layers, and motion tokens.

- Stable data attributes and optional Web Component parts; generated class names are not contracts.

- Dedicated cascade layer and no global reset, box-sizing, typography, icon, or z-index assumptions.

- Forced-colors, high contrast, visible focus, reduced motion, reduced transparency, large text, touch density, and safe areas.

- Custom tab, group, splitter, float, overlay, placeholder, and error renderers through public contracts.

**CSS**

> @layer workspace {  
> \[data-workspace-tab\] {  
> min-block-size: var(--workspace-target-size);  
> transition:  
> background-color var(--workspace-motion-micro),  
> color var(--workspace-motion-micro),  
> border-color var(--workspace-motion-micro);  
> }  
> }

## **22.3 Localization and writing modes**

All labels, commands, announcements, errors, placeholders, recovery guidance, and shortcut descriptions come from a replaceable message catalog. Strings do not assume English word order. Panel-provided titles use bidi isolation. Logical axes drive layout and keyboard semantics. RTL changes spatial navigation, tab order where appropriate, edge labels, and placement descriptions without changing canonical meaning.

**Table 56.** Responsive, theme, and localization requirements

| **ID**   | **Level** | **Normative requirement**                                                                                      | **Acceptance evidence**     |
|----------|-----------|----------------------------------------------------------------------------------------------------------------|-----------------------------|
| RSP-001  | MUST      | Responsive adaptation is a reversible projection and does not mutate canonical layout implicitly.              | Viewport round-trip tests.  |
| RSP-002  | MUST      | Touch use does not depend on hover or precision pointing and respects scrolling and safe areas.                | Mobile/touch task suite.    |
| THM-001  | MUST      | The library imposes no global CSS reset, typography, icon set, or unscoped z-index policy.                     | CSS integration audit.      |
| THM-002  | MUST      | Themes support forced colors, focus visibility, reduced motion, large text, and touch targets.                 | Visual regression matrix.   |
| I18N-001 | MUST      | All user-visible library text is localizable and avoids English-specific concatenation.                        | Message catalog audit.      |
| I18N-002 | MUST      | Logical axes, RTL, and supported writing modes are reflected in layout, movement, resizing, and announcements. | RTL and writing-mode tests. |
| I18N-003 | SHOULD    | Platform shortcut names and numeric values are formatted through locale-aware services.                        | Locale snapshot tests.      |

# **23. Performance architecture and budgets**

## **23.1 Hot-path rules**

> **PERFORMANCE RULE** Committed semantic state is immutable; ephemeral per-frame state is mutable and scoped. Treating every pointer sample as immutable application state wastes allocations and renders. Treating committed state as mutable destroys replay, history, and conformance.

- One frame scheduler per surface batches read, solve/hit-test, write, and post-frame phases.

- Gesture state remains outside framework render loops; the latest pointer sample replaces older samples.

- Drop-target geometry is measured and indexed at interaction start, then invalidated only by relevant changes.

- Stable hosts prevent content remount during same-document moves.

- Selector subscriptions are entity- and field-granular; patches identify exact changed entities.

- Geometry uses compact arenas and revisioned caches in the optimized runtime.

- Hidden panels pause or release work according to lifecycle policy and application visibility signals.

- Worker use is reserved for large migration, import, auto-layout, reconciliation, or development verification where transfer cost is justified.

- will-change, snapshot layers, tombstones, and compositor promotion are temporary and cleaned after finish or cancel.

Animation degrades in a fixed order under budget pressure: remove decorative shadow interpolation, remove secondary descendants, animate group shells instead of all children, replace spatial motion with a brief fade, then skip non-essential animation. Direct input tracking is never degraded.

## **23.2 Workloads and measurable budgets**

**Table 57.** Initial performance budgets

| **Metric**                                            | **Target**                                          |
|-------------------------------------------------------|-----------------------------------------------------|
| Typical semantic command, 50-panel workspace          | p95 \<= 1 ms kernel time on reference hardware.     |
| Typical semantic command, 500-panel workspace         | p95 \<= 5 ms kernel time.                           |
| Pointer-to-preview                                    | Within one display refresh.                         |
| Workspace JavaScript during 120 Hz drag               | p95 \<= 2 ms per frame.                             |
| Framework renders caused by drag geometry             | 0\.                                                 |
| Same-document stable-host move remounts               | 0\.                                                 |
| Library-attributable dropped frames                   | \< 1% in reference interaction workload.            |
| Restore 100-panel semantic state                      | p95 \<= 50 ms.                                      |
| Restore 100-panel chrome to interactive               | p95 \<= 150 ms excluding application data.          |
| Normal structural operation long tasks                | 0 above 50 ms.                                      |
| Lifecycle torture retained listeners/observers/scopes | Return to baseline plus documented fixed allowance. |
| Re-grab visual discontinuity                          | \<= 1 CSS pixel.                                    |

**Table 58.** Algorithmic complexity goals

| **Complexity target**  | **Expected bound**                                                      |
|------------------------|-------------------------------------------------------------------------|
| Panel activation       | O(1) semantic lookup plus affected projection.                          |
| Tab reorder            | O(n) for group order; optimized structures optional for extreme groups. |
| Structural move        | O(affected depth and siblings).                                         |
| Split resize           | O(children in affected split).                                          |
| Constraint propagation | Incremental along affected ancestry.                                    |
| Serialization          | O(number of canonical entities).                                        |
| Drop hit testing       | Cached spatial lookup; no repeated full-DOM traversal.                  |
| Renderer work          | Proportional to emitted patches and affected motion entities.           |

Every performance claim records browser, OS, hardware, display rate, DPR, build mode, panel fixture, workload seed, sample count, warmup, trace, and confidence interval. Results use production builds and include memory, layout/style, paint/composite, render counts, open fibers/scopes, and bundle entry-point size.

**Table 59.** Performance requirements

| **ID**  | **Level** | **Normative requirement**                                                                                                          | **Acceptance evidence**              |
|---------|-----------|------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------|
| PRF-001 | MUST      | Pointer movement and layout animation do not enter framework-wide render loops.                                                    | Profiler traces for every adapter.   |
| PRF-002 | MUST      | Performance results are reproducible from published workloads and machine-readable manifests.                                      | Benchmark repository artifacts.      |
| PRF-003 | MUST      | The optimized implementation preserves reference-kernel semantics under differential testing.                                      | Fuzz and benchmark cross-check.      |
| PRF-004 | MUST      | No interaction, telemetry, persistence, or collaboration queue is unbounded.                                                       | Queue policy audit and stress tests. |
| PRF-005 | MUST      | Lifecycle torture returns library-owned listeners, observers, actors, fibers, scopes, hosts, and animations to baseline tolerance. | Heap and resource snapshots.         |
| PRF-006 | SHOULD    | Work scales with affected entities rather than total workspace size for ordinary local operations.                                 | Complexity benchmarks.               |
| PRF-007 | MUST      | Motion performance is verified at both 60 Hz and 120 Hz.                                                                           | Display-rate trace set.              |

# **24. Security, privacy, and supply-chain integrity**

## **24.1 Threat model**

The following inputs and contexts are untrusted by default:

- Persisted workspace envelopes and imported layout files.

- Panel parameters, checkpoints, titles, icons, and metadata.

- Cross-window, SharedWorker, BroadcastChannel, and collaboration messages.

- Plugin manifests, migrations, commands, renderers, and persisted namespaces.

- External drag-and-drop payloads, clipboard data, file handles, and URLs.

- Diagnostics or reproductions imported for replay.

- Cross-origin iframe messages and same-origin opener relationships.

Primary risks include prototype pollution, resource exhaustion, invalid geometry, duplicate ownership, stale protocol epochs, message spoofing, unsafe HTML injection, opener abuse, permission overreach, sensitive telemetry, plugin supply-chain compromise, and unbounded persistence or migration work.

## **24.2 Structural controls**

**Table 60.** Security controls

| **Control**         | **Required design**                                                                       |
|---------------------|-------------------------------------------------------------------------------------------|
| Boundary validation | Typed schemas with count, depth, string, metadata, and numeric bounds.                    |
| Identity/protocol   | Session nonce, workspace ID, sender surface, coordinator epoch, revision, transaction ID. |
| Serialization       | No functions, executable values, DOM references, window handles, or unsafe prototypes.    |
| HTML/CSS security   | No eval/Function or inline event handlers; Trusted Types and strict CSP compatible.       |
| Panel isolation     | Sandboxed iframe or isolated root options, allowlisted messages and permissions.          |
| Popout security     | Coupled and isolated modes explicit; opener and same-origin assumptions documented.       |
| Telemetry privacy   | Off by default; redacted identifiers and parameters unless application opts in.           |
| Permission privacy  | Explain multi-screen or related permission value before request; graceful denial.         |
| Resource protection | Bounded import, migration, queue, message, metadata, and checkpoint limits.               |
| Failure posture     | Preserve last valid snapshot and stop structural mutation after invariant defect.         |

Coupled same-origin popouts may use opener relationships and portals but carry greater shared-failure and data exposure risk. Isolated remote popouts prefer no opener and communicate through authenticated, validated messages at the cost of checkpoint/remount requirements. The application selects mode by content, security, and continuity policy.

Supply-chain practice includes minimal runtime dependencies, lockfile review, reproducible builds, provenance, SBOM, signed tags or releases where feasible, a private vulnerability channel, dependency review, no install-time scripts unless strictly necessary and audited, and a declared supported-version policy.

**Table 61.** Security and privacy requirements

| **ID**  | **Level** | **Normative requirement**                                                                                                      | **Acceptance evidence**        |
|---------|-----------|--------------------------------------------------------------------------------------------------------------------------------|--------------------------------|
| SEC-001 | MUST      | Every trust boundary validates a bounded schema and rejects malformed, excessive, NaN, infinite, or prototype-polluting input. | Security fuzz suite.           |
| SEC-002 | MUST      | Cross-surface messages are authenticated to the workspace session and validated against epoch and revision.                    | Protocol penetration tests.    |
| SEC-003 | MUST      | The stable build is compatible with strict CSP and Trusted Types without eval or unsafe HTML requirements.                     | CSP integration fixture.       |
| SEC-004 | MUST      | Telemetry and diagnostic exports redact panel titles, parameters, checkpoints, and application data by default.                | Privacy snapshot tests.        |
| SEC-005 | MUST      | Permission denial preserves normal functionality and content safety.                                                           | Permission-denied test matrix. |
| SEC-006 | MUST      | An invariant defect freezes structural mutation at the last valid snapshot and produces a redacted reproduction.               | Fault-injection recovery test. |
| SEC-007 | MUST      | Stable releases publish provenance, dependency inventory, security policy, and vulnerability response expectations.            | Release artifact audit.        |
| SEC-008 | SHOULD    | Runtime dependencies and privileged post-install behavior are minimized.                                                       | Supply-chain review.           |

# **25. Observability and developer tooling**

## **25.1 Workspace inspector**

A first-party inspector is part of the architecture, not an optional afterthought. Workspace failures frequently span model, protocol, geometry, focus, resource, and animation state; a generic console log cannot explain them. The inspector reads stable diagnostic ports and never mutates production state outside explicit debug commands.

**Table 62.** Workspace inspector views

| **Inspector view**   | **Required information**                                                                       |
|----------------------|------------------------------------------------------------------------------------------------|
| Canonical topology   | Surface roots, split tree, groups, panel ordering, regions, normalized weights.                |
| Ownership            | Panel-to-group, group-to-node, surface, coordinator epoch, transfer tokens.                    |
| Selection/focus      | Selected panel per group, active panel, actual focus owner, focus ledger fallback.             |
| Constraints/geometry | Hard/preferred/max constraints, resolved rectangles, dirty paths, overflow diagnostics.        |
| Transactions         | Command, origin, base/new revision, policy decisions, patches, inverse, timing, effects.       |
| Protocols            | Active XState actors, state, event history, guards, pending Effect actor, cancellation reason. |
| Resources            | Effect Scopes, fibers, listeners, observers, hosts, message ports, timers, animation handles.  |
| Persistence          | Schema versions, latest snapshot, journal tail, checkpoint references, migration diagnostics.  |
| Motion               | Motion target/channel, driver, progress, interruption policy, current/target visual geometry.  |
| Performance          | Frame phases, long tasks, render counts, layout/style/paint timing, queue depth.               |

Development builds may integrate XState inspection for actor lifecycle and microsteps and Effect tracing for spans, causes, scopes, and fibers. Stable production builds expose a lower-cost diagnostic stream behind an application opt-in. Instrumentation cannot change transaction ordering or create a correctness dependency.

## **25.2 Reproduction artifacts and telemetry**

**TypeScript**

> interface WorkspaceReproduction {  
> readonly engineVersion: string;  
> readonly capabilityProfile: unknown;  
> readonly initialSnapshot: unknown;  
> readonly commands: readonly unknown\[\];  
> readonly protocolEvents?: readonly unknown\[\];  
> readonly expectedHash?: string;  
> readonly actualHash?: string;  
> }

A reproduction export contains the minimum canonical snapshot, command stream, protocol events, capability profile, and hashes needed for deterministic replay. It excludes titles, parameters, checkpoints, document content, and application telemetry unless the user or application explicitly includes them. Fuzz failures automatically shrink to the smallest reproducing sequence.

**Table 63.** Telemetry and privacy policy

| **Telemetry class** | **Policy**                                                                                             |
|---------------------|--------------------------------------------------------------------------------------------------------|
| Correctness         | Invariant failures, rejected commands, recovery paths; high value, redacted, lossless where practical. |
| Performance         | Sampled timings, frames, long tasks, render counts, memory deltas; no panel content.                   |
| Usage               | Off by default; application-defined opt-in and aggregation.                                            |
| Accessibility       | Do not infer disability; collect only explicit test or product metrics under application policy.       |
| Protocol            | Version, failure code, step, surface kind; session identifiers rotated and redacted.                   |
| Diagnostics         | On-demand export rather than continuous upload by default.                                             |

**Table 64.** Observability requirements

| **ID**  | **Level** | **Normative requirement**                                                                                                                  | **Acceptance evidence**                   |
|---------|-----------|--------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------|
| OBS-001 | MUST      | The inspector can correlate a committed transaction across model, geometry, renderer, lifecycle, motion, persistence, and surface effects. | End-to-end trace fixture.                 |
| OBS-002 | MUST      | Diagnostic instrumentation is observational and cannot change command ordering or correctness.                                             | Instrumentation-on/off equivalence tests. |
| OBS-003 | MUST      | Reproduction exports are deterministic, bounded, versioned, and redacted by default.                                                       | Replay and privacy tests.                 |
| OBS-004 | MUST      | Expected errors and invariant defects are distinguishable in diagnostics and telemetry.                                                    | Error taxonomy audit.                     |
| OBS-005 | SHOULD    | Property-based failures shrink to a minimal command and event sequence suitable for issue attachment.                                      | Fuzz harness artifact.                    |
| OBS-006 | MUST      | Usage telemetry is disabled by default in the library.                                                                                     | Default configuration test.               |

# **26. Verification, conformance, and release engineering**

## **26.1 Test strategy**

<img src="media/image14.png" title="Figure 14: Layered conformance strategy from mathematical laws to human task verification." style="width:6.6in;height:7.08374in" alt="Conformance pyramid showing exhaustive bounded model exploration, property and differential testing, protocol path and deterministic-time tests, browser and framework contract tests, accessibility and performance suites, failure injection, and usability studies at the top." />

**Figure 14.** Layered conformance strategy from mathematical laws to human task verification.

**Table 65.** Verification stack

| **Layer**                      | **Coverage**                                                                                     |
|--------------------------------|--------------------------------------------------------------------------------------------------|
| Unit and law tests             | Commands, canonicalization, solver, schemas, policies, selectors, motion functions.              |
| Exhaustive bounded exploration | All valid small layouts and all command/target combinations.                                     |
| Property-based generation      | Long valid and near-valid sequences; shrinking; round trips; inverse laws.                       |
| Differential testing           | Reference versus optimized kernel after every command.                                           |
| Protocol path testing          | Reachable XState states, guards, interruptions, stale events, finalizers.                        |
| Deterministic time             | Long press, autoscroll, timeout, heartbeat, retry, persistence debounce, suspension.             |
| Distributed model checking     | Ownership uniqueness, stale epochs, duplicate/reordered messages, crash steps.                   |
| Browser interaction            | Pointer types, capture loss, iframes, Shadow DOM, zoom, DPR, popup, refresh, monitor loss.       |
| Framework contracts            | Identity, rerender granularity, lifecycle, strict mode, SSR, errors, transfer.                   |
| Accessibility                  | Automated semantics plus manual keyboard, screen-reader, zoom, contrast, motion tasks.           |
| Performance                    | Trace, frame, heap, DOM, listener, observer, actor, fiber, bundle, restore, transaction metrics. |
| Usability                      | Task success, mis-dock, undo, recovery, confidence, discoverability.                             |

The testkit includes representative panels: plain DOM form, uncontrolled form, code editor, WebGL map, canvas, data grid, video, same-origin iframe, cross-origin iframe, Web Component, microfrontend, async close guard, suspendable panel, corrupt checkpoint, throwing renderer, slow resize consumer, and missing plugin placeholder.

Motion uses a deterministic virtual driver that can sample start, arbitrary progress, interruption, retarget, completion, cancel, and skip. Tests assert exact final values, cleanup, focus correctness during motion, View Transition fallback, duplicate-name prevention, tombstone expiry, and re-grab continuity.

## **26.2 Conformance evidence**

**Table 66.** Required release evidence

| **Release artifact** | **Contents**                                                                                    |
|----------------------|-------------------------------------------------------------------------------------------------|
| Conformance manifest | Supported profiles, browsers, frameworks, inputs, surfaces, features, known limitations.        |
| Model report         | Explored state bounds, generated-command count, seeds, invariant and differential results.      |
| Accessibility report | Automated findings, manual task matrix, assistive technologies, exceptions.                     |
| Performance report   | Hardware, browser, build, traces, confidence intervals, regressions, bundle entries.            |
| Security report      | Dependency/provenance inventory, boundary fuzzing, CSP/Trusted Types fixtures, open advisories. |
| Migration report     | Source versions, fixtures, success/fallback behavior, data-preservation evidence.               |
| Recovery report      | Failure injection matrix and final authoritative location for each panel.                       |
| Compatibility report | API/schema/protocol changes, deprecations, adapter certifications.                              |

Continuous integration blocks release on any hard gate, unapproved public API change, schema/protocol mismatch, high-severity accessibility issue, statistically meaningful performance regression beyond tolerance, resource leak, migration gap, or known high/critical security vulnerability. Flaky tests are treated as defects in the conformance system rather than bypassed release gates.

**Table 67.** Verification and release requirements

| **ID**  | **Level** | **Normative requirement**                                                                                                               | **Acceptance evidence**          |
|---------|-----------|-----------------------------------------------------------------------------------------------------------------------------------------|----------------------------------|
| TST-001 | MUST      | The kernel passes exhaustive bounded exploration and at least ten million generated semantic operations before stable release.          | Model test report.               |
| TST-002 | MUST      | Reference and optimized kernels agree after every generated command.                                                                    | Differential report.             |
| TST-003 | MUST      | Every documented protocol transition, interruption, timeout, and recovery path is tested with deterministic time.                       | State-machine coverage report.   |
| TST-004 | MUST      | Multi-window ownership invariants are model-checked or equivalently exhaustively verified under message reordering and crash injection. | Formal model artifacts.          |
| TST-005 | MUST      | Every supported framework and browser profile passes the same applicable conformance suite.                                             | Certification matrix.            |
| TST-006 | MUST      | Performance CI detects statistically meaningful regressions and preserves raw traces.                                                   | Benchmark history.               |
| TST-007 | MUST      | Stable release requires manual accessibility evidence, not automated scanning alone.                                                    | Signed accessibility report.     |
| TST-008 | MUST      | Motion-off runs produce equivalent canonical state and focus outcomes.                                                                  | Differential motion conformance. |
| TST-009 | MUST      | Failure-injection tests establish the final authoritative location or placeholder for every panel.                                      | Recovery matrix.                 |

# **27. Delivery roadmap and governance**

## **27.1 Phased implementation**

**Table 68.** Implementation roadmap

| **Phase**                       | **Primary deliverables**                                                                 | **Exit evidence**                                      |
|---------------------------------|------------------------------------------------------------------------------------------|--------------------------------------------------------|
| 0\. Executable specification    | Vocabulary, schemas, invariants, commands, reference reducer, generators, workloads.     | Small-state exploration and canonical round trips.     |
| 1\. Optimized kernel            | Chunked tables, patches, indexes, history, differential oracle.                          | Millions of commands without divergence.               |
| 2\. Geometry and basic DOM      | N-ary solver, tabs, splitters, ARIA, focus, keyboard structure.                          | Complete keyboard-only workspace demo.                 |
| 3\. Interaction and motion      | Pointer protocols, exact preview, snap, FLIP, interruption, reduced motion.              | 60/120 Hz interaction traces and interruption fuzzing. |
| 4\. Lifecycle and heavy content | Stable hosts, iframe/editor/map fixtures, suspend, adaptive resize.                      | No remount and resource-leak evidence.                 |
| 5\. Effect operational runtime  | Services, Layers, Scopes, storage, migrations, typed errors, tracing.                    | Crash-safe persistence and deterministic-time tests.   |
| 6\. External surfaces           | Popout coordinator, ownership tokens, CSP bootstrap, recovery, multi-screen enhancement. | Failure injection and formal ownership proof.          |
| 7\. Framework adapters          | React, Vue, Svelte, Angular, Web Components.                                             | Shared contract certification.                         |
| 8\. Ecosystem                   | Plugins, devtools, collaboration, mobile projections, certification.                     | Third-party integration pilots.                        |

Each phase produces a usable vertical slice and conformance evidence. The first impressive demonstration is not a drag animation: it is a headless kernel executing millions of randomized operations without corruption. The second is a complete keyboard-accessible workspace. Visual richness follows a proven semantic and lifecycle foundation.

## **27.2 Compatibility and deprecation policy**

- Semantic versioning applies independently to public API, persisted schema, protocol, and experimental packages.

- Stable persisted schemas receive migrations for the declared support window; unsupported future data fails non-destructively.

- Deprecations include replacement guidance, diagnostics, codemods where practical, and at least one stable-major migration window.

- Experimental capabilities use separate entry points, explicit opt-in, and no implied persistence compatibility.

- Framework adapter support ranges and browser matrix are release artifacts, not informal documentation.

- Architecture decision records document changes to core ownership boundaries, invariants, transaction semantics, or lifecycle ordering.

- Conformance failures caused by a dependency upgrade block adoption of that dependency version.

Governance roles include kernel maintainers, accessibility approvers, security response owners, framework adapter owners, performance benchmark owners, and release managers. No single maintainer may waive a failed hard gate without an explicitly versioned experimental release that does not claim stable conformance.

**Table 69.** Governance requirements

| **ID**  | **Level** | **Normative requirement**                                                                                        | **Acceptance evidence**  |
|---------|-----------|------------------------------------------------------------------------------------------------------------------|--------------------------|
| GOV-001 | MUST      | Each implementation phase has objective exit evidence and does not rely on demo appearance.                      | Roadmap gate review.     |
| GOV-002 | MUST      | Public API, persisted schema, surface protocol, and experimental capabilities have explicit versioning policies. | Release policy audit.    |
| GOV-003 | MUST      | A failed conformance gate cannot be waived for a stable release without changing the support claim.              | Release approval record. |
| GOV-004 | MUST      | Core ownership, invariant, transaction, lifecycle, and protocol changes require architecture decision records.   | ADR repository audit.    |
| GOV-005 | SHOULD    | Deprecations provide diagnostics and mechanical migration support where feasible.                                | Deprecation review.      |
| GOV-006 | SHOULD    | Third-party adapters and plugins can publish machine-readable compatibility and conformance metadata.            | Certification manifest.  |

# **28. Risks, trade-offs, and rejected alternatives**

## **28.1 Principal risks**

**Table 70.** Risk register

| **Risk**                      | **Consequence**                                                           | **Mitigation and decision trigger**                                                             |
|-------------------------------|---------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Stable-host complexity        | Clipping, stacking, reading-order, and focus defects.                     | Keep semantic host mode; certify sensitive fixtures; restrict stable mode by capability.        |
| Hybrid stack complexity       | Effect, XState, geometry, and motion boundaries may confuse contributors. | Strict package ownership, examples, architecture tests, no leakage into ordinary API.           |
| View Transition variability   | Snapshot cost, interruption limits, browser differences.                  | Progressive enhancement, scoped use, exact FLIP fallback, capability and budget selection.      |
| Cross-window fragility        | Popup blocking, close/crash, styling, coordinator failure.                | Prepare-before-commit, ownership token, recovery region, formal protocol verification.          |
| Persistence evolution         | Old workspaces become unrestorable or semantically stale.                 | Independent version axes, fixture corpus, placeholders, last-known-good, no in-place migration. |
| Plugin ecosystem pressure     | Private API reliance or untrusted behavior.                               | Stable public ports, certification, schema boundaries, isolation, conflict diagnostics.         |
| Performance over-optimization | Semantic divergence or unreadable implementation.                         | Reference oracle, differential testing, measurable profile-driven optimization.                 |
| Animation overreach           | Latency, visual noise, accessibility failures.                            | Motion constitution, salience budget, reduced/off profiles, direct manipulation rule.           |
| Accessibility regression      | Pointer-first features ship without parity.                               | Command registry drives every input route; hard manual release gate.                            |
| Support-matrix sprawl         | Unmaintainable promises across browsers/frameworks.                       | Evidence-backed tiers, explicit ranges, no “best effort” stable support.                        |

The architecture deliberately accepts more up-front engineering than a component-library approach. The trade is justified only if the kernel, lifecycle, accessibility, recovery, and conformance assets remain reusable across frameworks and products. If the product scope is a single fixed dashboard with no extension or persistence needs, a smaller layout component may be more economical; that is outside this system’s definition of best.

## **28.2 Rejected architectural alternatives**

**Table 71.** Rejected alternatives and constrained exceptions

| **Alternative**                                  | **Why rejected as the foundation**                                                                          | **Permitted limited use**                                |
|--------------------------------------------------|-------------------------------------------------------------------------------------------------------------|----------------------------------------------------------|
| React state as workspace truth                   | Couples semantics to rendering, causes broad rerenders, weak replay and multi-window behavior.              | Local app-owned panel content only.                      |
| XState as complete layout database               | Arbitrary entity graph becomes machine context without temporal benefit; high event/actor overhead.         | Bounded active protocols.                                |
| Effect for every read and pointer frame          | Fiber/queue overhead and indirect hot path; obscures pure deterministic reduction.                          | Operational effects, scopes, transport, persistence.     |
| DOM as authoritative topology                    | Fragile identity, inaccessible replay, persistence and collaboration require reverse engineering.           | Measurement and projection only.                         |
| Binary split tree only                           | Deep wrappers, awkward equalization and insertion, unstable topology.                                       | Internal temporary form only if canonicalized to n-ary.  |
| Animation-library-owned gestures                 | Duplicates semantic target, policy, pointer-capture, keyboard, and recovery logic.                          | Interpolation after the workspace decides intent.        |
| View Transitions for every change                | Snapshot-oriented, limited concurrent interruption, wrong for direct manipulation and live content.         | Discrete scoped mode and DOM-replacement changes.        |
| Transparent DOM move across windows              | Browser documents, framework context, focus, styles, and resources do not provide that universal guarantee. | Explicit portal-coupled mode with constraints.           |
| Automatic serialization of arbitrary panel state | Unsafe, incomplete, unversioned, and misleading.                                                            | Panel-owned typed checkpoints.                           |
| Global event bus                                 | Weak typing, hidden ordering, reconstructive state, unbounded observers.                                    | Separate selectors, transaction stream, lifecycle hooks. |
| Feature-count definition of best                 | Rewards breadth while hiding corruption, inaccessibility, latency, and integration cost.                    | Feature inventory only after quality gates.              |

**Table 72.** Risk-management requirements

| **ID**  | **Level** | **Normative requirement**                                                                                    | **Acceptance evidence**       |
|---------|-----------|--------------------------------------------------------------------------------------------------------------|-------------------------------|
| RSK-001 | MUST      | Every principal architectural risk has a named mitigation, test, owner, and decision trigger.                | Risk register review.         |
| RSK-002 | MUST      | A limited use of a rejected alternative is documented at the boundary and cannot become canonical authority. | ADR and package audit.        |
| RSK-003 | MUST      | Complexity is justified by supported profile evidence rather than generalized abstraction ambition.          | Roadmap and adoption review.  |
| RSK-004 | SHOULD    | The project periodically removes extension points or modes that cannot be conformed or maintained.           | Annual support-matrix review. |

# **29. Final acceptance definition**

The implementation is accepted as the intended complete design only when every statement below is supported by reproducible evidence for the published stable profile set. This is the end-state definition, not a marketing checklist.

> **1.** The workspace cannot commit an invalid topology, duplicate panel ownership, dangling reference, invalid focus target, or non-finite geometry.
>
> **2.** Identical canonical state, capabilities, policies, and commands replay to the same canonical hash.
>
> **3.** Panel identity survives tab reorder, docking, floating, same-document movement, persistence, recovery, and supported transfer modes.
>
> **4.** Same-document stable-host movement preserves editors, maps, iframes, media, forms, and other declared sensitive content without remount.
>
> **5.** Cross-document movement uses an explicit prepared transfer and checkpoint/remount, portal-coupled, or mirrored contract.
>
> **6.** Every structural pointer operation has complete keyboard, menu or palette, and programmatic equivalence.
>
> **7.** Focus, activation, selection, and surface frontmost state are predictable and never conflated.
>
> **8.** Screen readers receive correct patterns, focus behavior, and concise localized semantic announcements.
>
> **9.** The interface remains operable at 400% zoom, in forced colors, with reduced motion, in RTL, and on touch.
>
> **10.** A blocked popup, failed migration, missing plugin, crashed surface, removed monitor, or corrupt latest snapshot cannot silently lose a panel.
>
> **11.** Responsive projection never destroys the canonical desktop arrangement.
>
> **12.** Workspace undo is atomic, user-readable, and separate from panel-content undo.
>
> **13.** Pointer drag and resize remain direct at 60 Hz and 120 Hz without framework render loops.
>
> **14.** Structural motion is interruptible, focus-independent, cleanup-safe, and exactly converges on solver geometry.
>
> **15.** No repeating flash or motion-only status ships; reduced/off profiles remain complete and understandable.
>
> **16.** The headless kernel is framework-, DOM-, Effect-runtime-, XState-, and animation-independent.
>
> **17.** Effect resources, XState actors, DOM hosts, listeners, observers, message ports, animations, and panel resources finalize exactly once.
>
> **18.** Public APIs are typed, discoverable, composable, diagnostic, and usable without internal-library expertise.
>
> **19.** Extensions can add panels, policies, commands, surfaces, renderers, motion drivers, storage, and collaboration without private mutation.
>
> **20.** Every stable release publishes conformance, accessibility, performance, migration, security, recovery, and compatibility evidence.
>
> **21.** Known limitations are explicit; unsupported behavior is never mislabeled as best effort support.
>
> *Build a workspace operating kernel, not a draggable framework component. Keep state, protocol, geometry, motion, effects, and application content distinct; join them through typed, testable contracts.*
>
> — Final architectural directive

**Table 73.** Final acceptance requirements

| **ID**  | **Level** | **Normative requirement**                                                                                             | **Acceptance evidence**                           |
|---------|-----------|-----------------------------------------------------------------------------------------------------------------------|---------------------------------------------------|
| ACC-001 | MUST      | All hard release gates and all MUST requirements in the normative register pass for every stable supported profile.   | Signed release conformance bundle.                |
| ACC-002 | MUST      | Any exception changes the published support claim or releases under an experimental label.                            | Release manifest and approval record.             |
| ACC-003 | MUST      | The implementation demonstrates useful superiority through robust outcomes, not feature count or visual polish alone. | Quality scorecard and comparative workload study. |

# **Appendix A. Normative requirement register**

This register consolidates every normative requirement stated in the body. Requirement IDs are stable within version 1.x of this specification. A release scorecard records Pass, Fail, Not Applicable with justification, or Experimental for every row. A stable supported profile cannot mark a MUST requirement Not Applicable unless the profile definition explicitly excludes the corresponding capability.

**Table 74.** Master normative register (190 requirements)

| **ID**   | **Level** | **Normative requirement**                                                                                                                  | **Acceptance evidence**                                          |
|----------|-----------|--------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------|
| A11Y-001 | MUST      | The stable release conforms to WCAG 2.2 AA for the declared supported profiles.                                                            | Automated and manual accessibility report.                       |
| A11Y-002 | MUST      | Every structural pointer operation has an equivalent keyboard and programmatic command.                                                    | Generated action parity matrix.                                  |
| A11Y-003 | MUST      | Tabs and splitters implement the applicable WAI-ARIA interaction patterns.                                                                 | Semantic DOM and keyboard tests.                                 |
| A11Y-004 | MUST      | Announcements describe final semantic outcomes and are localizable, replaceable, and rate-controlled.                                      | Screen-reader task recordings and message catalog audit.         |
| A11Y-005 | MUST      | Workspace controls remain operable at 400% zoom and in forced-colors mode.                                                                 | Visual and interaction regression suite.                         |
| A11Y-006 | MUST      | Reduced motion removes non-essential spatial movement and does not merely shorten every duration.                                          | Reduced-motion snapshot and behavior tests.                      |
| A11Y-007 | MUST NOT  | Color, motion, hover, or precision dragging is the sole means of communicating state or invoking a structural action.                      | UX and accessibility audit.                                      |
| A11Y-008 | SHOULD    | Voice-control-friendly accessible names remain stable and specific across panels and actions.                                              | Voice-control task review.                                       |
| ACC-001  | MUST      | All hard release gates and all MUST requirements in the normative register pass for every stable supported profile.                        | Signed release conformance bundle.                               |
| ACC-002  | MUST      | Any exception changes the published support claim or releases under an experimental label.                                                 | Release manifest and approval record.                            |
| ACC-003  | MUST      | The implementation demonstrates useful superiority through robust outcomes, not feature count or visual polish alone.                      | Quality scorecard and comparative workload study.                |
| API-001  | MUST      | Panel parameters and checkpoints are inferred statically and validated at trust boundaries.                                                | Type tests and runtime schema tests.                             |
| API-002  | MUST      | Commands, queries, subscriptions, lifecycle, and operational effects are separate public concepts.                                         | API surface review.                                              |
| API-003  | MUST NOT  | Consumers mutate exposed entity objects or reconstruct truth from events alone.                                                            | Readonly types and documentation tests.                          |
| API-004  | MUST      | Expected asynchronous failures return typed result values with stable codes and remediation.                                               | Error contract snapshots.                                        |
| API-005  | MUST      | Selectors avoid unrelated recomputation and framework rerender.                                                                            | Dependency-tracking benchmarks.                                  |
| API-006  | SHOULD    | First useful workspace setup completes in under ten minutes for an unfamiliar engineer.                                                    | Timed onboarding study.                                          |
| API-007  | SHOULD    | Custom panel type setup completes in under fifteen minutes without reading internal source.                                                | Timed onboarding study.                                          |
| API-008  | MUST      | Advanced Effect and protocol APIs are available without forcing them onto ordinary consumers.                                              | Entry-point and documentation audit.                             |
| ARC-001  | MUST      | The headless model and kernel have no DOM, framework, Effect-runtime, XState, or animation dependency.                                     | Package graph and Node.js execution tests.                       |
| ARC-002  | MUST      | XState actors exist only for active bounded protocols and are disposed when their owning scope closes.                                     | Actor inventory and scope-leak tests.                            |
| ARC-003  | MUST      | Effect wraps fallible operations without imposing fiber scheduling on ordinary synchronous kernel reads and commits.                       | Hot-path trace and code review.                                  |
| ARC-004  | MUST      | Motion drivers implement a stable internal port and do not appear in persisted data.                                                       | Serialization schema audit.                                      |
| ARC-005  | SHOULD    | The production runtime pins tested library versions and exposes compatibility through adapters rather than broad re-export.                | Lockfile, package manifest, and API-surface audit.               |
| COL-001  | MUST      | Personal layout is the default collaboration mode unless the product explicitly enables shared layout.                                     | Configuration and UX review.                                     |
| COL-002  | MUST      | Durable collaboration replicates semantic transactions, not pointer frames or raw DOM events.                                              | Transport trace audit.                                           |
| COL-003  | MUST      | Every protocol packet is versioned, schema-validated, session-bound, epoch-bound, and transaction-identified.                              | Protocol fuzzing.                                                |
| COL-004  | MUST      | At most one authoritative owner exists for each panel instance.                                                                            | TLA+ or equivalent model-checking invariant.                     |
| COL-005  | MUST      | Coordinator loss, duplicate delivery, reordering, and stale epochs have defined recovery behavior.                                         | Distributed failure simulation.                                  |
| COL-006  | SHOULD    | Presence and preview traffic uses a separate lossy channel from durable transactions.                                                      | Transport architecture test.                                     |
| DOM-001  | MUST      | Every panel, group, node, surface, transaction, and motion target has a stable explicit identifier.                                        | Schema and type audit.                                           |
| DOM-002  | MUST NOT  | A DOM node, framework instance, array position, or window handle serves as persistent identity.                                            | Persistence-schema and adapter tests.                            |
| DOM-003  | MUST      | Derived geometry and runtime resources are excluded from canonical serialization except documented restore hints.                          | Round-trip and schema tests.                                     |
| DOM-004  | MUST      | Application panel state and workspace layout state have separate codecs, versions, and failure handling.                                   | Checkpoint integration tests.                                    |
| DOM-005  | MUST      | Visual tombstones are inert, aria-hidden, pointer-inactive, and hard-bounded in lifetime.                                                  | DOM accessibility and leak tests.                                |
| EXP-001  | MUST      | Every structural operation exposes a human-readable command label and deterministic outcome.                                               | Command registry audit and usability tasks.                      |
| EXP-002  | MUST      | The visible drop preview is produced from the same solver and policy result used by commit.                                                | Preview-versus-commit property tests.                            |
| EXP-003  | MUST      | Every completed direct-manipulation gesture creates at most one workspace-history entry.                                                   | History conformance tests.                                       |
| EXP-004  | MUST      | A failed or blocked external capability keeps content in a safe in-page location.                                                          | Popup, permission, and surface failure tests.                    |
| EXP-005  | SHOULD    | A new consumer can render a typed panel workspace in under ten minutes using stable public APIs.                                           | Timed DX study with unfamiliar engineers.                        |
| EXT-001  | MUST      | Extensions use documented registries, ports, policies, and contribution values rather than private internals.                              | Public extension conformance suite.                              |
| EXT-002  | MUST      | Plugin manifests, protocol messages, persisted namespaces, and panel data are versioned and schema-validated.                              | Boundary tests.                                                  |
| EXT-003  | MUST      | Plugin ordering and conflicts are deterministic and diagnosable.                                                                           | Registration-order tests.                                        |
| EXT-004  | MUST NOT  | A plugin mutates canonical state or attaches unscoped global listeners through a supported API.                                            | API and leak tests.                                              |
| EXT-005  | MUST      | Unavailable or failed plugins do not erase persisted panels or placements.                                                                 | Restore and failure tests.                                       |
| EXT-006  | SHOULD    | Third-party adapters can run the public conformance suite and publish certification metadata.                                              | Certification workflow.                                          |
| FOC-001  | MUST      | Selection, activation, DOM focus, and frontmost-surface state remain distinct in model and API.                                            | Type and behavior tests.                                         |
| FOC-002  | MUST      | Clicking an interactive descendant does not lose its natural focus merely to activate a panel.                                             | Form, editor, and grid fixtures.                                 |
| FOC-003  | MUST      | Every close, move, transfer, restore, and projection change has deterministic focus recovery.                                              | Operation-by-operation focus matrix.                             |
| FOC-004  | MUST      | Focus is correct immediately after semantic commit and does not wait for animation.                                                        | Mid-animation focus assertions.                                  |
| FOC-005  | MUST NOT  | Ordinary floating panels use modal semantics or focus trapping.                                                                            | ARIA and keyboard tests.                                         |
| FOC-006  | SHOULD    | Panel renderers may provide stable restoration tokens for meaningful descendants across remount.                                           | Adapter contract tests.                                          |
| FWK-001  | MUST      | Every supported framework adapter passes the same semantic and lifecycle contract suite.                                                   | Adapter certification report.                                    |
| FWK-002  | MUST      | Geometry frames and pointer movement do not trigger workspace-wide framework reconciliation.                                               | Framework profiler traces.                                       |
| FWK-003  | MUST      | Framework development modes do not duplicate ownership or leak resources.                                                                  | Strict/development-mode tests.                                   |
| FWK-004  | MUST      | SSR-safe imports and deterministic hydration are documented for supported configurations.                                                  | SSR import and hydration tests.                                  |
| FWK-005  | MUST      | Cross-document context preservation is explicit and capability-negotiated.                                                                 | Portal-coupled and remote-mode tests.                            |
| FWK-006  | SHOULD    | Adapter-specific APIs remain idiomatic without changing core semantics.                                                                    | Framework-user review.                                           |
| GOV-001  | MUST      | Each implementation phase has objective exit evidence and does not rely on demo appearance.                                                | Roadmap gate review.                                             |
| GOV-002  | MUST      | Public API, persisted schema, surface protocol, and experimental capabilities have explicit versioning policies.                           | Release policy audit.                                            |
| GOV-003  | MUST      | A failed conformance gate cannot be waived for a stable release without changing the support claim.                                        | Release approval record.                                         |
| GOV-004  | MUST      | Core ownership, invariant, transaction, lifecycle, and protocol changes require architecture decision records.                             | ADR repository audit.                                            |
| GOV-005  | SHOULD    | Deprecations provide diagnostics and mechanical migration support where feasible.                                                          | Deprecation review.                                              |
| GOV-006  | SHOULD    | Third-party adapters and plugins can publish machine-readable compatibility and conformance metadata.                                      | Certification manifest.                                          |
| I18N-001 | MUST      | All user-visible library text is localizable and avoids English-specific concatenation.                                                    | Message catalog audit.                                           |
| I18N-002 | MUST      | Logical axes, RTL, and supported writing modes are reflected in layout, movement, resizing, and announcements.                             | RTL and writing-mode tests.                                      |
| I18N-003 | SHOULD    | Platform shortcut names and numeric values are formatted through locale-aware services.                                                    | Locale snapshot tests.                                           |
| INT-001  | MUST      | Direct pointer manipulation writes visual state at most once per surface animation frame.                                                  | Frame-scheduler trace.                                           |
| INT-002  | MUST      | Raw pointer coordinates do not enter canonical state, persistence, or transaction history.                                                 | Schema and history audit.                                        |
| INT-003  | MUST      | Escape, pointer cancellation, capture loss, and scope disposal leave no residual interaction state.                                        | Cancellation matrix.                                             |
| INT-004  | MUST      | Every structural pointer action has keyboard, menu or command-palette, and programmatic equivalents.                                       | Generated action-coverage matrix.                                |
| INT-005  | MUST      | Drop previews are policy-valid, solver-exact, labeled, and reversible.                                                                     | Usability and property tests.                                    |
| INT-006  | MUST      | Pointer resize is direct; content resize notifications may be live, throttled, deferred, or adaptive by declared policy.                   | Heavy-content fixture traces.                                    |
| INT-007  | SHOULD    | Target hysteresis prevents oscillation without creating a magnetic offset that impairs precision.                                          | Pointer trajectory test corpus.                                  |
| LAY-001  | MUST      | Docked layout uses n-ary splits and canonical flattening of adjacent same-axis nodes.                                                      | Topology and canonicalization tests.                             |
| LAY-002  | MUST      | All semantic axes and edges are logical and writing-mode aware.                                                                            | RTL and vertical-writing conformance.                            |
| LAY-003  | MUST      | Resolved child pixels plus splitters exactly equal available pixels after rounding.                                                        | Property tests across fractional sizes and DPRs.                 |
| LAY-004  | MUST      | Infeasible constraints produce an explicit policy outcome and diagnostic, never negative or inaccessible geometry.                         | Adversarial constraint suite.                                    |
| LAY-005  | MUST      | The speculative preview and committed result use the same constraint implementation.                                                       | Preview/commit equivalence tests.                                |
| LAY-006  | SHOULD    | A local topology or constraint change invalidates only affected branches and surface indexes.                                              | Incremental invalidation benchmark.                              |
| LAY-007  | SHOULD    | Stable integer or fixed-point weights prevent cumulative resize drift.                                                                     | Long-sequence resize round-trip tests.                           |
| LIF-001  | MUST      | The lifecycle state machine and callback ordering are public compatibility contracts.                                                      | Lifecycle specification and adapter tests.                       |
| LIF-002  | MUST      | Every successful mount has exactly one eventual finalization; duplicate disposal is harmless at the boundary.                              | Mount/dispose counter fuzzing.                                   |
| LIF-003  | MUST      | Hidden content is inert and excluded from accessibility traversal while preserving declared lifecycle state.                               | DOM and assistive-technology tests.                              |
| LIF-004  | MUST      | Cross-document transfer has an explicit checkpoint/remount or mirror contract.                                                             | Surface transfer certification.                                  |
| LIF-005  | MUST      | Failed transfer retains or recovers the panel in a safe authoritative surface.                                                             | Failure injection after every protocol step.                     |
| LIF-006  | MUST      | Lifecycle callbacks carry cancellation and revision context and cannot mutate canonical state directly.                                    | Type and runtime contract tests.                                 |
| LIF-007  | SHOULD    | Visibility reasons allow applications to pause expensive work without conflating selection and document visibility.                        | Heavy-content integration tests.                                 |
| MOD-001  | MUST      | The canonical state satisfies all published invariants after every committed transaction.                                                  | Invariant checker in development, test, and import paths.        |
| MOD-002  | MUST      | Canonicalization is deterministic and idempotent.                                                                                          | Property-based tests across generated states.                    |
| MOD-003  | MUST      | Each relationship has exactly one authoritative representation in canonical state.                                                         | Schema and invariant review.                                     |
| MOD-004  | MUST      | The optimized kernel is differentially tested against a reference implementation after every generated command.                            | Differential fuzz CI artifacts.                                  |
| MOD-005  | MUST NOT  | NaN, infinity, negative dimensions, duplicate ownership, or cycles are accepted into a committed state.                                    | Malformed-input and command fuzz tests.                          |
| MOD-006  | SHOULD    | Unchanged public entity values preserve referential identity across revisions.                                                             | Selector and structural-sharing tests.                           |
| MOT-001  | MUST      | Direct drag and pointer resize have no delayed smoothing between input and controlled object.                                              | High-speed pointer trace and visual-latency measurement.         |
| MOT-002  | MUST      | Semantic commit, focus, accessibility state, and lifecycle do not wait for motion completion.                                              | Mid-animation state assertions.                                  |
| MOT-003  | MUST      | Every running animation belongs to a disposable Scope with finish, cancel, skip, and cleanup behavior.                                     | Scope closure and leak tests.                                    |
| MOT-004  | MUST      | A re-grab samples current visual geometry and begins without a jump exceeding one CSS pixel.                                               | Interruption tests at sampled progress points.                   |
| MOT-005  | MUST      | Closing content is semantically removed before an inert visual tombstone exits.                                                            | Focus, ARIA, and tombstone tests.                                |
| MOT-006  | MUST NOT  | The library ships a repeating strobe, full-panel luminance flash, or motion-only status indicator.                                         | Preset audit and automated flash analysis.                       |
| MOT-007  | MUST      | View Transitions are optional progressive enhancement; skip or failure cannot prevent state change.                                        | Capability and skipTransition tests.                             |
| MOT-008  | MUST      | Cross-window transfer uses coordinated handoff rather than a claimed continuous cross-screen animation.                                    | Popout UX and documentation review.                              |
| MOT-009  | MUST      | Layout, gesture, presence, clip, and emphasis channels cannot overwrite one another’s owned properties.                                    | Style ownership conformance tests.                               |
| MOT-010  | SHOULD    | The planner degrades decoration before spatial continuity and never degrades direct input tracking.                                        | Load-adaptive motion benchmark.                                  |
| OBS-001  | MUST      | The inspector can correlate a committed transaction across model, geometry, renderer, lifecycle, motion, persistence, and surface effects. | End-to-end trace fixture.                                        |
| OBS-002  | MUST      | Diagnostic instrumentation is observational and cannot change command ordering or correctness.                                             | Instrumentation-on/off equivalence tests.                        |
| OBS-003  | MUST      | Reproduction exports are deterministic, bounded, versioned, and redacted by default.                                                       | Replay and privacy tests.                                        |
| OBS-004  | MUST      | Expected errors and invariant defects are distinguishable in diagnostics and telemetry.                                                    | Error taxonomy audit.                                            |
| OBS-005  | SHOULD    | Property-based failures shrink to a minimal command and event sequence suitable for issue attachment.                                      | Fuzz harness artifact.                                           |
| OBS-006  | MUST      | Usage telemetry is disabled by default in the library.                                                                                     | Default configuration test.                                      |
| PER-001  | MUST      | Persistence separates kernel, application-layout, protocol, and panel-type versions.                                                       | Envelope schema and migration tests.                             |
| PER-002  | MUST      | Every previously supported schema has a tested migration or explicit non-destructive recovery path.                                        | Migration fixture corpus.                                        |
| PER-003  | MUST      | Snapshot and journal updates are atomic within the storage adapter’s transaction model.                                                    | Crash and fault-injection tests.                                 |
| PER-004  | MUST      | Panel checkpoint data is durable before a canonical snapshot references it.                                                                | Write-order tests.                                               |
| PER-005  | MUST      | A missing panel type is represented by a recoverable placeholder rather than silently deleted.                                             | Plugin removal and restore tests.                                |
| PER-006  | MUST      | Workspace undo is separate from application content undo and has explicit command scope.                                                   | Editor integration tests.                                        |
| PER-007  | MUST      | Restoring external-window intent never requires automatic popup creation and never loses the panel.                                        | Session restore with popup restrictions.                         |
| PER-008  | SHOULD    | Canonical serialization has stable ordering suitable for hashing and semantic diffing.                                                     | Hash stability tests.                                            |
| PKG-001  | MUST      | The package graph is acyclic and enforced in continuous integration.                                                                       | Dependency-cruiser or equivalent report.                         |
| PKG-002  | MUST      | Headless packages import without evaluating browser globals.                                                                               | Node.js import matrix.                                           |
| PKG-003  | MUST      | Optional platform and framework packages are not pulled through the default headless entry point.                                          | Bundle graph and tree-shaking tests.                             |
| PKG-004  | MUST      | Each package publishes a documented public entry-point map and compatibility policy.                                                       | Package manifest audit.                                          |
| PKG-005  | SHOULD    | The model and reference kernel have zero runtime dependencies.                                                                             | Package-lock inspection.                                         |
| PRF-001  | MUST      | Pointer movement and layout animation do not enter framework-wide render loops.                                                            | Profiler traces for every adapter.                               |
| PRF-002  | MUST      | Performance results are reproducible from published workloads and machine-readable manifests.                                              | Benchmark repository artifacts.                                  |
| PRF-003  | MUST      | The optimized implementation preserves reference-kernel semantics under differential testing.                                              | Fuzz and benchmark cross-check.                                  |
| PRF-004  | MUST      | No interaction, telemetry, persistence, or collaboration queue is unbounded.                                                               | Queue policy audit and stress tests.                             |
| PRF-005  | MUST      | Lifecycle torture returns library-owned listeners, observers, actors, fibers, scopes, hosts, and animations to baseline tolerance.         | Heap and resource snapshots.                                     |
| PRF-006  | SHOULD    | Work scales with affected entities rather than total workspace size for ordinary local operations.                                         | Complexity benchmarks.                                           |
| PRF-007  | MUST      | Motion performance is verified at both 60 Hz and 120 Hz.                                                                                   | Display-rate trace set.                                          |
| QLT-001  | MUST      | Quality is assessed across all published supported profiles, not a selected favorable benchmark.                                           | Automated scorecard with profile completeness check.             |
| QLT-002  | MUST      | Any failed hard gate sets the release-quality score to zero.                                                                               | Release pipeline policy.                                         |
| QLT-003  | MUST      | Benchmark results include hardware, browser, version, workload, sample count, and confidence interval.                                     | Machine-readable benchmark manifest.                             |
| QLT-004  | MUST      | Known limitations and unsupported configurations are published with every stable release.                                                  | Release notes audit.                                             |
| QLT-005  | SHOULD    | The robust overall quality score is at least 0.90 and no dimension is below 0.80.                                                          | Signed release scorecard.                                        |
| REN-001  | MUST      | Same-document movement in stable-host mode preserves the panel content host and does not remount content.                                  | Mount counter tests with editor, map, iframe, and form fixtures. |
| REN-002  | MUST      | Geometry-frame updates bypass framework-wide rendering and update only affected DOM projection.                                            | Framework render-count traces.                                   |
| REN-003  | MUST      | Every browser-facing operation uses the relevant surface document and window.                                                              | Multi-document and Shadow DOM tests.                             |
| REN-004  | MUST      | Overlay, shield, listener, observer, and host resources are finalized with their owning surface or interaction Scope.                      | Lifecycle leak tests.                                            |
| REN-005  | MUST      | Semantic chrome remains accessible even when content uses a stable flattened host plane.                                                   | Screen-reader and DOM-order tests.                               |
| REN-006  | SHOULD    | A panel or group renderer failure is isolated and replaced by a recoverable error surface.                                                 | Error-injection fixtures.                                        |
| RSK-001  | MUST      | Every principal architectural risk has a named mitigation, test, owner, and decision trigger.                                              | Risk register review.                                            |
| RSK-002  | MUST      | A limited use of a rejected alternative is documented at the boundary and cannot become canonical authority.                               | ADR and package audit.                                           |
| RSK-003  | MUST      | Complexity is justified by supported profile evidence rather than generalized abstraction ambition.                                        | Roadmap and adoption review.                                     |
| RSK-004  | SHOULD    | The project periodically removes extension points or modes that cannot be conformed or maintained.                                         | Annual support-matrix review.                                    |
| RSP-001  | MUST      | Responsive adaptation is a reversible projection and does not mutate canonical layout implicitly.                                          | Viewport round-trip tests.                                       |
| RSP-002  | MUST      | Touch use does not depend on hover or precision pointing and respects scrolling and safe areas.                                            | Mobile/touch task suite.                                         |
| SCP-001  | MUST      | Every public capability is classified as stable, experimental, deprecated, or unsupported.                                                 | Generated API inventory and release manifest.                    |
| SCP-002  | MUST      | Supported claims identify browser, framework, input, accessibility, and workload profiles.                                                 | Published support matrix.                                        |
| SCP-003  | MUST NOT  | The core promises unrestricted native-window behavior that the web platform cannot guarantee.                                              | Documentation and API terminology review.                        |
| SCP-004  | MUST      | Application-owned panel state has an explicit codec, version, and migration boundary.                                                      | Panel registry contract tests.                                   |
| SEC-001  | MUST      | Every trust boundary validates a bounded schema and rejects malformed, excessive, NaN, infinite, or prototype-polluting input.             | Security fuzz suite.                                             |
| SEC-002  | MUST      | Cross-surface messages are authenticated to the workspace session and validated against epoch and revision.                                | Protocol penetration tests.                                      |
| SEC-003  | MUST      | The stable build is compatible with strict CSP and Trusted Types without eval or unsafe HTML requirements.                                 | CSP integration fixture.                                         |
| SEC-004  | MUST      | Telemetry and diagnostic exports redact panel titles, parameters, checkpoints, and application data by default.                            | Privacy snapshot tests.                                          |
| SEC-005  | MUST      | Permission denial preserves normal functionality and content safety.                                                                       | Permission-denied test matrix.                                   |
| SEC-006  | MUST      | An invariant defect freezes structural mutation at the last valid snapshot and produces a redacted reproduction.                           | Fault-injection recovery test.                                   |
| SEC-007  | MUST      | Stable releases publish provenance, dependency inventory, security policy, and vulnerability response expectations.                        | Release artifact audit.                                          |
| SEC-008  | SHOULD    | Runtime dependencies and privileged post-install behavior are minimized.                                                                   | Supply-chain review.                                             |
| SUR-001  | MUST      | Every surface exposes explicit capabilities; commands and UI use capability intersection.                                                  | Capability matrix tests.                                         |
| SUR-002  | MUST      | A browser-window destination is prepared and acknowledged before semantic ownership transfer.                                              | Blocked-popup and bootstrap-failure tests.                       |
| SUR-003  | MUST      | Unexpected surface loss produces deterministic recovery without panel loss.                                                                | Close, crash, refresh, and coordinator-failure tests.            |
| SUR-004  | MUST      | Surface-specific DOM, style, locale, direction, and security context are explicit.                                                         | Multi-document rendering tests.                                  |
| SUR-005  | MUST      | Restored geometry is clamped to available viewport and monitor configuration with a minimum visible region.                                | Monitor removal, zoom, and DPR tests.                            |
| SUR-006  | MUST NOT  | Multi-screen permission is required for normal single-screen functionality.                                                                | Permission-denied conformance.                                   |
| SUR-007  | MUST      | Picture-in-Picture is treated as a restricted optional surface and has an in-page fallback.                                                | Capability and fallback tests.                                   |
| SYS-001  | MUST      | The semantic kernel is the sole authority for committed workspace state.                                                                   | Dependency graph review and mutation-path tests.                 |
| SYS-002  | MUST      | The system separates semantic, protocol, spatial, motion, and operational concerns through typed contracts.                                | Architecture conformance audit.                                  |
| SYS-003  | MUST      | A successful semantic command remains correct when every optional animation is disabled or skipped.                                        | Motion-off conformance suite.                                    |
| SYS-004  | MUST      | No supported failure mode silently loses a panel or its recoverable descriptor.                                                            | Failure-injection suite and recovery evidence.                   |
| SYS-005  | SHOULD    | The ordinary integration surface hides Effect and XState unless an application opts into advanced APIs.                                    | DX task study and public API review.                             |
| THM-001  | MUST      | The library imposes no global CSS reset, typography, icon set, or unscoped z-index policy.                                                 | CSS integration audit.                                           |
| THM-002  | MUST      | Themes support forced colors, focus visibility, reduced motion, large text, and touch targets.                                             | Visual regression matrix.                                        |
| TST-001  | MUST      | The kernel passes exhaustive bounded exploration and at least ten million generated semantic operations before stable release.             | Model test report.                                               |
| TST-002  | MUST      | Reference and optimized kernels agree after every generated command.                                                                       | Differential report.                                             |
| TST-003  | MUST      | Every documented protocol transition, interruption, timeout, and recovery path is tested with deterministic time.                          | State-machine coverage report.                                   |
| TST-004  | MUST      | Multi-window ownership invariants are model-checked or equivalently exhaustively verified under message reordering and crash injection.    | Formal model artifacts.                                          |
| TST-005  | MUST      | Every supported framework and browser profile passes the same applicable conformance suite.                                                | Certification matrix.                                            |
| TST-006  | MUST      | Performance CI detects statistically meaningful regressions and preserves raw traces.                                                      | Benchmark history.                                               |
| TST-007  | MUST      | Stable release requires manual accessibility evidence, not automated scanning alone.                                                       | Signed accessibility report.                                     |
| TST-008  | MUST      | Motion-off runs produce equivalent canonical state and focus outcomes.                                                                     | Differential motion conformance.                                 |
| TST-009  | MUST      | Failure-injection tests establish the final authoritative location or placeholder for every panel.                                         | Recovery matrix.                                                 |
| TXN-001  | MUST      | All semantic mutation passes through the command transaction path.                                                                         | Mutation-path instrumentation and static review.                 |
| TXN-002  | MUST      | Subscribers never observe partially reduced or partially canonicalized state.                                                              | Reentrancy and callback tests.                                   |
| TXN-003  | MUST      | Commands dispatched during commit notification are queued for a later transaction.                                                         | Reentrancy conformance tests.                                    |
| TXN-004  | MUST      | Prepared external resources are rolled back when revalidation or commit fails.                                                             | Failure injection at every prepare step.                         |
| TXN-005  | MUST      | Post-commit effects carry transaction ID and revision and are safe under duplicate delivery where retryable.                               | Idempotency tests.                                               |
| TXN-006  | MUST      | Policy denial includes a stable code and user-actionable explanation.                                                                      | Error-contract snapshot tests.                                   |
| TXN-007  | MUST      | The final commit revalidates policies and base revision after any asynchronous preparation.                                                | Race-condition tests.                                            |
| TXN-008  | SHOULD    | A completed gesture is represented by one semantic command or one explicit atomic batch.                                                   | Transaction-history review.                                      |

# **Appendix B. Command catalog**

The catalog identifies the minimum semantic command vocabulary. Implementations may add namespaced commands through the extension model, but every structural mutation still passes through the same planning, policy, canonicalization, invariant, history, and effect-intent path.

**Table 75.** Core command vocabulary

| **Command**             | **Intent**                                                      | **Principal inputs**                                   | **Inverse / compensation**                       |
|-------------------------|-----------------------------------------------------------------|--------------------------------------------------------|--------------------------------------------------|
| OpenPanel               | Create or reveal a panel instance and place by semantic target. | Panel type/params; placement; activation/focus policy. | Close/revert when recreation is supported.       |
| ClosePanels             | Close one or more panels atomically.                            | Panel IDs; close reason; guard policy.                 | Reopen descriptors/checkpoints where reversible. |
| ReopenPanel             | Restore from recoverable-closed registry.                       | Closed record ID; placement fallback.                  | Close restored panel.                            |
| SelectPanel             | Select a panel inside its group.                                | Panel ID; activation policy.                           | Select previous panel.                           |
| ActivatePanel           | Set global command target without necessarily moving DOM focus. | Panel ID; focus policy.                                | Restore previous active panel.                   |
| ReorderPanels           | Change tab order within one group.                              | Panel IDs; before/after relational anchor.             | Inverse order operation.                         |
| MovePanel               | Move a panel among groups or surfaces.                          | Panel ID; semantic target; group-creation policy.      | Return to prior group and relation.              |
| MoveGroup               | Move a whole tab group.                                         | Group ID; target surface/split/tab relation.           | Return group to prior location.                  |
| SplitGroup              | Create a split around a group or panel.                         | Target node; logical edge; ratio; subject.             | Merge/remove created split.                      |
| MergeGroups             | Combine two compatible groups.                                  | Source and target group; insertion relation.           | Reconstruct source group and placement.          |
| SwapGroups              | Swap group positions.                                           | Two group IDs.                                         | Self-inverse.                                    |
| ResizeSplit             | Commit split allocation.                                        | Split ID; normalized weights or relational delta.      | Restore prior weights.                           |
| EqualizeSplit           | Equalize eligible children.                                     | Split ID; optional subset.                             | Restore prior weights.                           |
| CollapseChild           | Collapse an eligible child by policy.                           | Split/child ID; reason.                                | Restore prior allocation.                        |
| RestoreCollapsedChild   | Restore collapsed child.                                        | Split/child ID.                                        | Collapse again.                                  |
| CreateFloatingSurface   | Move subject to new in-page floating surface.                   | Subject; initial rectangle; z-order policy.            | Redock and remove surface.                       |
| MoveFloatingSurface     | Commit floating position.                                       | Surface ID; clamped rectangle/anchor.                  | Restore prior rectangle.                         |
| ResizeFloatingSurface   | Commit floating size and position.                              | Surface ID; rectangle; edge semantics.                 | Restore prior rectangle.                         |
| RaiseSurface            | Change in-page floating z-order.                                | Surface ID.                                            | Restore prior order.                             |
| MaximizeSurface         | Maximize within available surface.                              | Surface ID.                                            | Restore prior geometry.                          |
| RestoreSurface          | Restore pre-maximize geometry.                                  | Surface ID.                                            | Maximize again.                                  |
| MinimizeSurface         | Move surface into application-defined shelf/state.              | Surface ID; shelf policy.                              | Restore.                                         |
| TransferToBrowserWindow | Transfer ownership to prepared external surface.                | Subject; prepared surface token; checkpoint.           | Compensating redock if destination unavailable.  |
| RedockSurface           | Move external or floating content into docked topology.         | Surface ID; semantic target.                           | Recreate prior surface where possible.           |
| MoveToPictureInPicture  | Move or mirror eligible panel into restricted PiP surface.      | Panel ID; mode; capability token.                      | Return to source.                                |
| ApplyWorkspacePreset    | Apply named semantic arrangement.                               | Preset ID; merge/reset policy.                         | Restore prior snapshot or inverse batch.         |
| RestoreWorkspace        | Atomically replace with validated canonical state.              | Migrated envelope; restore policy.                     | Restore previous snapshot where retained.        |
| ImportWorkspace         | Validate and restore external envelope.                         | Untrusted data; merge/replace policy.                  | Previous snapshot.                               |
| UndoWorkspaceOperation  | Execute inverse of latest eligible history entry.               | Optional history entry ID.                             | Redo.                                            |
| RedoWorkspaceOperation  | Re-execute an undone entry.                                     | Optional history entry ID.                             | Undo.                                            |
| ApplyRemoteTransaction  | Apply coordinator-approved transaction.                         | Envelope; base revision; actor/epoch.                  | Protocol-specific inverse or later transaction.  |
| RecoverOrphanedSurface  | Resolve content after surface/coordinator loss.                 | Surface ID; ownership evidence; recovery region.       | Depends on recovery result.                      |

Commands declare origin (pointer, keyboard, menu, application, restore, remote, platform, recovery), command ID, base revision where relevant, and human-readable label. Batch commands are atomic and produce one history entry unless explicitly marked observational.

# **Appendix C. Protocol state-machine catalog**

**Table 76.** Protocol actor inventory

| **Protocol**            | **Principal states**                                                                                                            | **Required adversarial events**                                                        |
|-------------------------|---------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| Drag                    | idle, armed, dragging, committing, settling, cancelling, recovering                                                             | Threshold, valid target, pointer up, cancel, capture loss, revision conflict, re-grab. |
| Splitter resize         | idle, armed, resizing, committing, settling, cancelling                                                                         | Pointer/keyboard start, constraint result, end, cancel, adaptive delivery change.      |
| Floating move/resize    | idle, manipulating, snapping, committing, settling, recovering                                                                  | Bounds, snap acquisition/release, viewport change, re-grab.                            |
| Keyboard move           | idle, choosing-target, committing, announcing, cancelled                                                                        | Arrow navigation, target class cycle, Enter, Escape, target invalidation.              |
| Close                   | open, requested, checking-guard, committing-close, visual-retirement, disposed                                                  | Dirty guard allow/deny/timeout, checkpoint, close, undo preparation.                   |
| Suspend/resume          | mounted, suspend-requested, checkpointing, suspended, resuming, failed                                                          | Visibility/budget policy, checkpoint success/failure, cancellation, retry.             |
| Cross-document transfer | source-owned, preparing, bootstrapping, checkpointing, ownership-commit, destination-mount, ready, source-release, compensating | Popup blocked, protocol mismatch, close/crash at every step.                           |
| Surface recovery        | healthy, heartbeat-late, disconnected, orphaned, resolving, recovered, failed-safe                                              | Heartbeat timeout, epoch change, ownership proof, fallback placement.                  |
| Persistence worker      | idle, batching, writing-journal, checkpointing, compacting, degraded, recovering                                                | Queue threshold, storage failure, quota, checksum, retry, shutdown.                    |
| Plugin load             | unregistered, validating, loading, registering, active, failed, unloading                                                       | Manifest/version conflict, renderer failure, migration, scope close.                   |
| View transition         | eligible, capturing-old, committing, capturing-new, animating, skipped, completed                                               | New higher-priority command, unsupported, duplicate name, budget rejection.            |
| Coordinator election    | follower, candidate, leader, stale, stepping-down                                                                               | Heartbeat loss, epoch proposal, conflict, server authority.                            |

Actors are sparse: only active protocols exist. Actor stop interrupts any child Effect and closes its Scope. Late events carry transaction, actor, or revision identity and are ignored or reconciled rather than applied to a new protocol instance. Every machine defines terminal, cancellation, timeout, and impossible-event behavior.

# **Appendix D. Event-ordering contract**

The ordering below is normative for an ordinary synchronous semantic command:

> **1.** Receive command at the public boundary and attach command ID, origin, and current capability profile.
>
> **2.** Validate boundary data where input crossed a trust boundary.
>
> **3.** Read one current immutable snapshot and policy context.
>
> **4.** Evaluate synchronous policy and command preconditions.
>
> **5.** Plan pure reduction and derive any prepare-before-commit effect intents.
>
> **6.** Run required prepare effects outside the kernel; retain rollback finalizers.
>
> **7.** Re-read current revision and revalidate command, target, policy, and prepared capability.
>
> **8.** Run pure reduction, canonicalization, invariant validation, inverse derivation, and patch calculation.
>
> **9.** Atomically publish the new snapshot and revision.
>
> **10.** Synchronously notify the renderer patch channel and focus controller.
>
> **11.** Start or retarget the visual motion plan; motion observes already-committed state.
>
> **12.** Publish the committed transaction stream to non-blocking observers.
>
> **13.** Run idempotent or compensatable post-commit effects under the transaction Scope.
>
> **14.** Append persistence journal and publish collaboration transaction according to durability policy.
>
> **15.** Emit telemetry and diagnostics without affecting success.
>
> **16.** Close prepare resources that did not transfer ownership and finalize the transaction Scope.

The following ordering constraints are additionally normative:

**Table 77.** Special event-ordering rules

| **Situation**         | **Ordering rule**                                                                                                                                 |
|-----------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| Panel close           | Guard/checkpoint before commit; focus successor and semantic removal at commit; tombstone after commit; disposal according to lifecycle contract. |
| Same-document move    | Commit membership/topology; preserve stable host; patch chrome/geometry; focus remains; settle motion after commit.                               |
| External transfer     | Prepare destination; bootstrap; checkpoint; commit ownership; mount destination; acknowledge ready; release source.                               |
| Restore               | Decode/migrate/canonicalize/validate completely before replacing current workspace.                                                               |
| Undo                  | Resolve eligible entry; execute inverse through normal command pipeline; create redo entry after success.                                         |
| Subscriber dispatch   | Commands invoked by commit observers are queued after current notification completes.                                                             |
| Async result          | Result is accepted only when actor/protocol ID, base revision, and current state remain compatible.                                               |
| Surface close         | Mark protocol event; resolve ownership/recovery; close surface Scope; remove projection after authoritative state is safe.                        |
| Reduced-motion change | Sample current visual state; cancel/retarget; do not change semantic transaction history.                                                         |

# **Appendix E. Motion matrix and tokens**

Tokens are semantic defaults, not guarantees of one universal duration. The motion planner may shorten, remove, or simplify lower-salience effects based on user preference, content strategy, changed-entity count, and measured frame budget. Direct manipulation remains immediate.

**TypeScript**

> interface WorkspaceMotionTokens {  
> readonly duration: {  
> readonly instant: number;  
> readonly micro: number;  
> readonly fast: number;  
> readonly structural: number;  
> readonly surface: number;  
> readonly attention: number;  
> };  
> readonly spring: {  
> readonly settle: SpringToken;  
> readonly snap: SpringToken;  
> readonly indicator: SpringToken;  
> };  
> readonly distance: {  
> readonly entry: number;  
> readonly lift: number;  
> readonly snapMagnetMaximum: number;  
> };  
> }

**Table 78.** Reference productive-motion tokens

| **Token**                  | **Productive default**               | **Purpose**                                   |
|----------------------------|--------------------------------------|-----------------------------------------------|
| duration.instant           | 0 ms                                 | Motion-off and immediate state.               |
| duration.micro             | 90 ms                                | Hover, focus, local color/border changes.     |
| duration.fast              | 140 ms                               | Entry/exit shell and keyboard step.           |
| duration.structural        | 200 ms                               | Dock, reorder, equalize, maximize/restore.    |
| duration.surface           | 260 ms                               | Large surface mode or preset transition.      |
| duration.attention         | 600 ms one cycle                     | Safe restrained outline/tint pulse.           |
| spring.settle              | response ~210 ms; no overshoot       | Drop and floating settle.                     |
| spring.snap                | response ~170 ms; no overshoot       | Candidate guide and snap preview.             |
| spring.indicator           | response ~150 ms; \<= 0.02 overshoot | Tab indicator and small chrome.               |
| distance.entry             | 8 CSS px                             | Local shell entry; removed in reduced motion. |
| distance.lift              | 2 CSS px                             | Depth cue during drag.                        |
| distance.snapMagnetMaximum | 10 CSS px                            | Maximum informational magnetic offset.        |

**Table 79.** Content-aware motion strategy

| **Content type**       | **Preferred drag visual**                 | **Preferred structural transition**       | **Resize delivery**    |
|------------------------|-------------------------------------------|-------------------------------------------|------------------------|
| Plain UI/form          | Live host or shell.                       | Transform-content or translate-and-clip.  | Live.                  |
| Code editor            | Live stable host.                         | Translate-and-clip; avoid text scaling.   | Adaptive or throttled. |
| WebGL map/canvas       | Live stable host where possible.          | Translate-and-clip or shell-crossfade.    | Adaptive.              |
| Video/media            | Live host or snapshot depending platform. | Shell-crossfade; avoid scaling artifacts. | Deferred/adaptive.     |
| Same-origin iframe     | Stable host with shield.                  | Translate-and-clip.                       | Adaptive.              |
| Cross-origin iframe    | Shell or snapshot; shield required.       | Snapshot/shell-crossfade.                 | Deferred/adaptive.     |
| Large data grid        | Live host or shell.                       | Translate-and-clip.                       | Throttled/adaptive.    |
| Lightweight tab/chrome | Live element.                             | Transform reorder and indicator spring.   | Live.                  |

# **Appendix F. Benchmark and workload protocol**

Benchmarking is a reproducible conformance exercise. A result is invalid without its workload generator, capability profile, build flags, machine manifest, browser trace, sample count, and confidence interval. Reference content fixtures are versioned with the benchmark suite.

**Table 80.** Reference workload definitions

| **Workload**         | **Composition**                                                      | **Mandatory scenarios**                                                 |
|----------------------|----------------------------------------------------------------------|-------------------------------------------------------------------------|
| Compact              | 8 panels; 3 groups; main surface.                                    | Open, select, reorder, split, resize, close, undo, restore.             |
| Professional         | 40 panels; 12 groups; 2 floats; 1 popout.                            | Long drag, snap, float, popout, focus, persistence, animation.          |
| IDE-scale            | 120 panels; 35 groups; hidden/keep-alive mix.                        | Tab overflow, switcher, batch close, suspend/resume, preset.            |
| Large                | 500 descriptors; 100 groups; 12 floats; 4 external surfaces.         | Local mutation, serialization, recovery, collaboration, monitor change. |
| Heavy content        | Map, editor, grid, iframe, video, canvas, chart.                     | Move without remount, resize modes, visibility, maximize, transfer.     |
| Lifecycle torture    | 10,000 repeated create/move/hide/suspend/transfer/close cycles.      | Heap, listener, observer, scope, actor, host, animation baseline.       |
| Accessibility stress | 400% zoom, forced colors, RTL, reduced motion, keyboard-only.        | Full structural task suite.                                             |
| Failure stress       | Corrupt snapshot, quota, popup block, surface crash, plugin absence. | No panel loss and deterministic recovery.                               |

Each benchmark run records:

- Repository commit, package versions, production/development build, feature flags, and random seed.

- Operating system, CPU, memory, GPU, display refresh rate, viewport, DPR, browser name/version, and power mode.

- Panel fixture versions and whether content is live, throttled, deferred, suspended, or mocked.

- Warmup procedure, run count, outlier policy, median, p95, p99, confidence interval, and raw samples.

- Main-thread trace, animation frames, layout/style/paint/composite timing, framework render counts, heap snapshots, and bundle graph.

- Pass/fail thresholds and prior-release comparison on the same environment.

**Table 81.** Benchmark outputs

| **Scenario**         | **Measured outputs**                                                                               |
|----------------------|----------------------------------------------------------------------------------------------------|
| Semantic transaction | Kernel plan/reduce/canonicalize/validate/patch time; allocations; affected entities.               |
| Drag                 | Input-to-write latency, frame time, target-query time, layout reads, dropped frames, render count. |
| Resize               | Boundary latency, solver time, content notification cost, adaptive-mode changes.                   |
| Structural animation | Planning/setup time, frame cost, interruption continuity, cleanup.                                 |
| Restore              | Parse, decode, migration, canonicalization, storage reads, chrome interactive time.                |
| Popout               | Prepare/bootstrap/checkpoint/commit/mount/ready phases and failure recovery.                       |
| Memory torture       | Retained DOM, listeners, observers, actors, fibers, scopes, checkpoints, buffers.                  |
| Bundle               | Minified and compressed size per public entry point; dependency contribution.                      |

# **Appendix G. Accessibility action matrix**

The command registry is the single inventory for pointer UI, keyboard routes, menus, command palette, accessible names, announcements, help, and test generation. The matrix below defines minimum parity; applications may add more shortcuts but may not remove the semantic route.

**Table 82.** Input and announcement parity matrix

| **Action**              | **Pointer/touch**                     | **Keyboard**                                | **Non-pointer route**                   | **Announcement**                                   |
|-------------------------|---------------------------------------|---------------------------------------------|-----------------------------------------|----------------------------------------------------|
| Select tab              | Click/tap tab.                        | Arrow/Home/End; Enter/Space in manual mode. | Tab action/menu and SelectPanel API.    | Selected tab and title when needed.                |
| Close panel             | Close button/context action.          | Delete or configured close command.         | Menu/palette/ClosePanels API.           | Panel closed; focus successor.                     |
| Reopen panel            | History/reopen UI.                    | Workspace reopen command.                   | Palette/ReopenPanel API.                | Panel reopened and destination.                    |
| Reorder tab             | Drag within strip.                    | Move before/after command.                  | Context/palette/ReorderPanels API.      | New position in group.                             |
| Move panel              | Drag to exact target.                 | Keyboard move mode.                         | Menu/palette/MovePanel API.             | Destination group/region/surface.                  |
| Split                   | Drop on edge target.                  | Keyboard target edge.                       | Menu/palette/SplitGroup API.            | Created split and logical edge.                    |
| Merge/tab               | Drop on group center/tab strip.       | Keyboard target group.                      | Menu/palette/MergeGroups API.           | Panel added as tab.                                |
| Float/detach            | Drag outside dock or explicit button. | Float command.                              | Menu/palette/CreateFloatingSurface API. | Panel floated.                                     |
| Redock                  | Drag to dock target.                  | Redock command and target chooser.          | Menu/palette/RedockSurface API.         | Surface redocked and destination.                  |
| Pop out                 | Popout action.                        | Popout command.                             | Menu/palette/async API.                 | Opened externally or safely retained with error.   |
| Maximize/restore        | Titlebar control/double click.        | Maximize/restore command.                   | Menu/palette/API.                       | Surface maximized/restored.                        |
| Move floating surface   | Titlebar drag.                        | Move mode with arrow steps.                 | Menu/palette/API.                       | Final position if meaningful.                      |
| Resize floating surface | Edge/corner drag.                     | Resize mode with arrows/modifier.           | Menu/palette/API.                       | Final dimensions or percentage.                    |
| Resize splitter         | Drag splitter.                        | Arrow keys, large step, min/max.            | Menu/API.                               | Primary pane value or collapse status.             |
| Focus next group        | Click group/content.                  | F6 or configured group navigation.          | Palette/Focus API.                      | Usually no live announcement beyond focus.         |
| Panel switcher          | Switcher control.                     | Configured shortcut and typeahead.          | Palette/API.                            | Selection and result.                              |
| Undo layout             | History control.                      | Workspace-specific undo shortcut.           | Menu/palette/Undo API.                  | Operation label undone.                            |
| Apply preset            | Preset selector.                      | Palette/shortcut.                           | API.                                    | Preset name and completion/recovery.               |
| Request attention       | Application action.                   | Not a direct user requirement.              | Semantic API only.                      | Reason and persistent status; safe pulse optional. |

Target size, focus visibility, contrast, reflow, and motion alternatives are verified for every action. Screen reader task scripts assert the final focused element and semantic result, not only static role presence.

# **Appendix H. Failure-mode and recovery catalog**

**Table 83.** Failure and recovery catalog

| **Failure**                           | **Risk**                                      | **Required recovery**                                                               | **Evidence/diagnostic**                           |
|---------------------------------------|-----------------------------------------------|-------------------------------------------------------------------------------------|---------------------------------------------------|
| Command rejected by policy            | No commit.                                    | Keep visual/source state; explain reason and valid alternatives.                    | Command rejection diagnostic.                     |
| Revision conflict after async prepare | Prepared resource exists; state changed.      | Replan/revalidate or rollback prepared resource; no partial transfer.               | Conflict with base/current revision.              |
| Pointer capture lost                  | Interaction active.                           | Cancel or continue only under explicit safe policy; cleanup shield and preview.     | Protocol cancellation reason.                     |
| Iframe intercepts pointer             | Drag/resize may stall.                        | Surface-owned shield; no dependence on iframe forwarding.                           | Interaction diagnostic if bridge fails.           |
| Popup blocked                         | Destination absent.                           | Panel remains authoritative in source; show actionable guidance.                    | POPUP_BLOCKED.                                    |
| Destination bootstrap fails           | Prepared window unusable.                     | Close/rollback destination; retain source.                                          | Bootstrap error and protocol version.             |
| Checkpoint fails                      | Cannot reconstruct destination/suspend.       | Abort operation and retain live source.                                             | Panel-specific typed error.                       |
| Destination closes before ready       | Ownership not final.                          | Rollback and retain source.                                                         | Transfer-step diagnostic.                         |
| Destination closes after commit       | Panel owner lost.                             | Coordinator redocks to recovery region or placeholder.                              | Platform recovery transaction.                    |
| Source crashes mid-transfer           | Ambiguous source availability.                | Coordinator resolves transfer token and epoch; exactly one owner.                   | Formal protocol trace.                            |
| Coordinator disappears                | Ordering authority unavailable.               | Election/server fallback with new epoch; stale leader rejected.                     | Election diagnostic.                              |
| Monitor removed                       | Floating or popout geometry off-screen.       | Rehome/clamp to available screen; preserve coarse hint.                             | Screen-change recovery.                           |
| Viewport/zoom/DPR changes during drag | Cached targets stale.                         | Invalidate and rebuild relevant geometry; preserve visual continuity.               | Geometry invalidation trace.                      |
| Latest snapshot checksum fails        | Latest state untrusted.                       | Load last-known-good; retain corrupt artifact for opt-in export.                    | Recovery report.                                  |
| Migration fails                       | New canonical state unavailable.              | Do not overwrite source; create safe workspace/placeholder and diagnostics.         | Migration failure record.                         |
| Storage quota exceeded                | Journal/checkpoint cannot persist.            | Enter degraded mode, notify app/user, keep in-memory truth, offer export/cleanup.   | PERSISTENCE_QUOTA.                                |
| Missing panel/plugin type             | Renderer unavailable.                         | Preserve placeholder and original descriptor/placement.                             | Missing dependency details.                       |
| Panel renderer throws                 | Content unavailable.                          | Isolate error boundary; keep shell, retry/export/close actions.                     | Renderer stack redacted by policy.                |
| Lifecycle callback times out          | Operation cannot complete safely.             | Cancel, retain source or degrade according to declared policy.                      | Timeout and callback stage.                       |
| Invariant defect                      | Current implementation cannot be trusted.     | Freeze structural mutation, keep last valid snapshot, export reproduction, recover. | High-severity defect report.                      |
| Animation driver fails                | Visual explanation unavailable.               | Cleanup and reveal final committed projection immediately.                          | Motion failure; semantic command remains success. |
| View Transition skipped               | Snapshot transition absent.                   | Commit still applies; FLIP or immediate fallback as selected.                       | Optional diagnostic only.                         |
| Reduced-motion preference changes     | Current motion conflicts with new preference. | Sample, cancel/retarget, cleanup; semantic state unchanged.                         | Preference-change trace.                          |
| Remote duplicate transaction          | Already applied.                              | Idempotently acknowledge without second mutation.                                   | Duplicate transaction ID.                         |
| Remote stale epoch                    | Unauthorized ordering source.                 | Reject and request resynchronization.                                               | STALE_EPOCH.                                      |
| Concurrent tab-anchor removed         | Relational target stale.                      | Rebase to nearest declared fallback or reject visibly.                              | Rebase diagnostic.                                |
| Theme/CSP style load fails in popout  | Destination visually incomplete.              | Keep accessible base chrome or abort before ownership commit.                       | Surface bootstrap diagnostic.                     |
| Permission denied for multi-screen    | No enhanced placement.                        | Use current screen/in-page fallback; no data loss.                                  | Capability denial.                                |

Every failure-injection test records the final authoritative location or recoverable placeholder for each affected panel. A recovery is incomplete if state is valid but the user cannot understand what happened or how to proceed.

# **Appendix I. Package and contribution rules**

**Table 84.** Contribution constitution

| **Rule**                                                                         | **Rationale**                                        | **Enforcement**                               |
|----------------------------------------------------------------------------------|------------------------------------------------------|-----------------------------------------------|
| No inward layer imports browser/framework packages.                              | Preserves headless determinism and reuse.            | Package-boundary lint.                        |
| No circular package dependency.                                                  | Prevents hidden initialization and ownership cycles. | CI graph check.                               |
| No public deep import into internal files.                                       | Keeps compatibility surface intentional.             | Exports map and lint.                         |
| No ambient window/document in reusable browser code.                             | Supports popouts, Shadow DOM, SSR, tests.            | Static rule and multi-document tests.         |
| No canonical mutation outside kernel.                                            | Preserves invariants and history.                    | Readonly types, instrumentation, code review. |
| No unbounded queue or cache.                                                     | Prevents memory and latency collapse.                | Design review and stress tests.               |
| No unscoped listener, observer, actor, fiber, timer, animation, or port.         | Guarantees cleanup.                                  | Scope APIs and leak tests.                    |
| No pointer frame in Effect/XState semantic queue.                                | Protects hot-path latency.                           | Trace and architecture lint.                  |
| No geometry in framework component state unless panel-owned.                     | Avoids broad rerender.                               | Profiler tests.                               |
| No runtime-library type in persisted schema.                                     | Allows library replacement and migration isolation.  | Schema review.                                |
| No extension through private DOM/class names.                                    | Protects composability and upgrades.                 | Public extension suite.                       |
| Every public command has capability, policy, error, keyboard, and test coverage. | Prevents pointer-only or undocumented behavior.      | Generated registry report.                    |
| Every new persisted field has owner, version, migration, and redaction policy.   | Prevents irreversible schema growth.                 | Schema review checklist.                      |
| Every motion preset has reduced/off alternative and cleanup test.                | Protects accessibility and correctness.              | Motion conformance.                           |
| Every external effect is prepare, idempotent, compensatable, or observational.   | Makes failure semantics explicit.                    | Effect-intent exhaustive switch.              |
| Every supported adapter passes shared conformance before release.                | Prevents semantic drift.                             | Certification job.                            |
| Every performance optimization retains reference equivalence.                    | Prevents silent semantic regression.                 | Differential fuzzing.                         |
| Every architectural boundary change has an ADR.                                  | Preserves institutional understanding.               | Pull-request policy.                          |

A feature contribution is complete only when it includes:

- Domain terminology and command/capability impact.

- Kernel law, invariant, or proof that no invariant changes.

- Policy, failure, recovery, accessibility, focus, motion, persistence, and security behavior.

- Reference and optimized implementation impact.

- Unit, property, protocol, browser, framework, accessibility, and performance coverage as applicable.

- Documentation, examples, migration guidance, diagnostics, and release-manifest changes.

# **Appendix J. Glossary and references**

## **J.1 Glossary**

**Table 85.** Glossary

| **Term**                 | **Definition**                                                                                             |
|--------------------------|------------------------------------------------------------------------------------------------------------|
| Active panel             | Workspace-wide target for application and workspace commands; distinct from selection and DOM focus.       |
| Canonical state          | Deterministically normalized committed workspace data satisfying all invariants.                           |
| Checkpoint               | Versioned application-owned panel state sufficient for declared reconstruction or transfer.                |
| Command                  | Typed semantic request to change workspace state through the transaction pipeline.                         |
| Effect intent            | Description of fallible external work emitted by the pure kernel or runtime planner.                       |
| Ephemeral protocol state | Non-persisted state belonging to an active temporal interaction or transfer.                               |
| FLIP                     | First, Last, Invert, Play technique for animating between known geometries after DOM/state change.         |
| Focus ledger             | Runtime memory of a panel’s meaningful focus descendant and restoration fallback.                          |
| Group                    | Ordered collection of panels sharing a tab strip and content viewport.                                     |
| Hard minimum             | Size below which a panel or group cannot remain functionally usable.                                       |
| Invariant                | Condition that every committed canonical state must satisfy.                                               |
| Motion channel           | Exclusive visual-property ownership layer such as layout, gesture, presence, clip, or emphasis.            |
| Motion tombstone         | Inert temporary visual representation used after semantic removal for exit continuity.                     |
| N-ary split              | Split node with two or more ordered children along a logical axis.                                         |
| Panel                    | Stable logical application-content instance independent of framework or DOM identity.                      |
| Policy                   | Pure synchronous decision that allows, denies, or transforms a command.                                    |
| Prepared surface         | External or special rendering destination acquired before semantic ownership commit.                       |
| Projection               | Derived visual, responsive, accessibility, or spatial representation of canonical state.                   |
| Protocol actor           | Sparse bounded XState actor representing a temporal operation with phases and cancellation.                |
| Revision                 | Monotonic identifier for a committed canonical workspace snapshot.                                         |
| Semantic region          | Stable application-defined placement anchor such as navigation, primary-document, inspector, or output.    |
| Stable host              | Persistent same-document content container whose application subtree need not remount during movement.     |
| Surface                  | Rendering destination that owns one layout root and declares capabilities.                                 |
| Transaction              | Atomic command evaluation and commit producing a new revision, patches, inverse, effects, and diagnostics. |
| Visual geometry          | Current on-screen interpolated geometry, which may temporarily differ from committed target geometry.      |
| Workspace                | Complete logical arrangement of panels, groups, layout nodes, surfaces, activation, and metadata.          |

## **J.2 Normative and informative references**

**R1.** [<u>RFC 2119 - Key words for use in RFCs to Indicate Requirement Levels</u>](https://www.rfc-editor.org/rfc/rfc2119)

**R2.** [<u>RFC 8174 - Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words</u>](https://www.rfc-editor.org/rfc/rfc8174)

**R3.** [<u>W3C Web Content Accessibility Guidelines (WCAG) 2.2</u>](https://www.w3.org/TR/WCAG22/)

**R4.** [<u>WAI-ARIA Authoring Practices - Tabs Pattern</u>](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)

**R5.** [<u>WAI-ARIA Authoring Practices - Window Splitter Pattern</u>](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)

**R6.** [<u>WAI-ARIA Authoring Practices - Landmark Regions</u>](https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/)

**R7.** [<u>Pointer Events Level 3</u>](https://www.w3.org/TR/pointerevents3/)

**R8.** [<u>CSS View Transitions Module Level 1</u>](https://www.w3.org/TR/css-view-transitions-1/)

**R9.** [<u>CSS View Transitions Module Level 2</u>](https://www.w3.org/TR/css-view-transitions-2/)

**R10.** [<u>CSS Transitions Level 2</u>](https://www.w3.org/TR/css-transitions-2/)

**R11.** [<u>Media Queries Level 5</u>](https://www.w3.org/TR/mediaqueries-5/)

**R12.** [<u>Indexed Database API 3.0</u>](https://www.w3.org/TR/IndexedDB-3/)

**R13.** [<u>Page Visibility Level 2</u>](https://www.w3.org/TR/page-visibility-2/)

**R14.** [<u>Window Management</u>](https://www.w3.org/TR/window-management/)

**R15.** [<u>Document Picture-in-Picture</u>](https://wicg.github.io/document-picture-in-picture/)

**R16.** [<u>CSS Containment Module Level 2</u>](https://www.w3.org/TR/css-contain-2/)

**R17.** [<u>Resize Observer</u>](https://www.w3.org/TR/resize-observer/)

**R18.** [<u>Content Security Policy Level 3</u>](https://www.w3.org/TR/CSP3/)

**R19.** [<u>Trusted Types</u>](https://www.w3.org/TR/trusted-types/)

**R20.** [<u>WHATWG HTML - Shared workers</u>](https://html.spec.whatwg.org/multipage/workers.html#shared-workers-and-the-sharedworker-interface)

**R21.** [<u>WHATWG HTML - Broadcasting to other browsing contexts</u>](https://html.spec.whatwg.org/multipage/web-messaging.html#broadcasting-to-other-browsing-contexts)

**R22.** [<u>XState documentation - XState and actors</u>](https://stately.ai/docs/xstate)

**R23.** [<u>XState documentation - Invoked actors</u>](https://stately.ai/docs/invoke)

**R24.** [<u>XState documentation - Inspection</u>](https://stately.ai/docs/inspection)

**R25.** [<u>Effect documentation - Services and Layers</u>](https://effect.website/docs/requirements-management/services/)

**R26.** [<u>Effect documentation - Scope and resource management</u>](https://effect.website/docs/resource-management/scope/)

**R27.** [<u>Effect documentation - Schema</u>](https://effect.website/docs/schema/introduction/)

**R28.** [<u>Effect documentation - PubSub</u>](https://effect.website/docs/concurrency/pubsub/)

**R29.** [<u>Effect documentation - TestClock</u>](https://effect.website/docs/testing/testclock/)

**R30.** [<u>Motion documentation - Performance</u>](https://motion.dev/docs/performance)

**R31.** [<u>Motion documentation - View Transitions comparison</u>](https://motion.dev/docs/animate-view)

**R32.** [<u>GSAP documentation - Flip plugin</u>](https://gsap.com/docs/v3/Plugins/Flip/)

**R33.** [<u>WCAG Understanding - Three Flashes or Below Threshold</u>](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)

**R34.** [<u>WCAG Understanding - Animation from Interactions</u>](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)

## **J.3 Design provenance**

This specification synthesizes the product definition, architecture, motion model, and conformance criteria developed in the preceding design discussion. Standards and library references inform implementation choices; the normative requirements, responsibility boundaries, invariants, command algebra, failure semantics, and acceptance model are specific to this proposed workspace runtime.

**END OF SPECIFICATION**

Panefold System Design · Version 1.0 · 7 August 2026
