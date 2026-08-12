# Panefold

Panefold is an experimental, deterministic workspace runtime for building IDEs, map tools,
operations consoles, and other panel-heavy web applications.

[Website](https://natanelia.github.io/panefold/) ·
[Live demo](https://natanelia.github.io/panefold/demo/) ·
[Documentation](https://natanelia.github.io/panefold/docs/) ·
[Source](https://github.com/natanelia/panefold)

This repository is an executable implementation companion to the
[Panefold system design](docs/spec/SYSTEM_DESIGN.md). Version `0.1.0` remains experimental: the
semantic model, 36-command reference kernel, geometry, runtime, adapters, and operational
primitives are implemented and tested in the repository, but the project does **not** claim stable
conformance, product certification, npm publication, or unrestricted browser-window behavior.

## What works today

- Immutable schema-v2 workspace snapshots with normalized panels, groups, layout nodes, surfaces,
  activation, focus memory, recoverable closes, bounded remote receipts, and typed versioned panel
  parameter/checkpoint registries with recoverable missing-provider placeholders.
- A zero-runtime-dependency model and pure reference kernel with all 36 semantic commands,
  canonicalization, invariants, typed rejection, patches, transaction receipts, batching, and
  bounded workspace undo/redo.
- An experimental optimized projection with derived indexes, bounded history, patch replay,
  a chunkable all-command differential campaign, and a reproducible lookup microbenchmark. A
  separate correctness-first reducer makes semantic decisions without calling the reference
  reducer and is compared as a complete-result oracle. It rebuilds Map/entity state per command,
  so it is not presented as the retained optimized production kernel; recorded runs also remain
  below the stable ten-million threshold.
- A logical-axis n-ary geometry solver with panel constraints, collapse state, exact integer
  conservation, overflow diagnostics, splitters, hit tests, and drop targets.
- A React projection that uses the geometry allocator, driver-isolated resize protocols,
  frame-coalesced previews, accessible tabs and splitters, focus recovery, stable panel hosts,
  lifecycle leases, and optional FLIP motion.
- A bounded synchronous runtime plus versioned persistence codecs, atomic snapshot/journal
  contracts, deterministic schema migration, last-known-good recovery, and an IndexedDB/Effect
  adapter tested with injected storage. Real browser crash and quota certification is still absent.
- Driver-neutral protocol contracts and a public twelve-actor XState catalog with scoped disposal,
  deterministic traces, revision-conflict handling, and prepared external-surface ownership. The
  injected same-origin browser adapter opens, bootstraps, observes, recovers, and closes a real
  Chromium popup fixture; Picture-in-Picture and unrestricted popouts are still not a certified
  product profile.
- Native experimental Vue, Svelte, Angular, and Web Components bindings over a shared immutable
  adapter contract. Current cross-framework evidence is a JSDOM contract harness, not real-browser
  framework certification.
- Experimental trusted plugins with scoped cleanup, a sandboxed-iframe isolation host, bounded
  devtools/reproductions, HMAC-authenticated single-writer remote coordination, and a reversible
  React single-region touch projection. These are deployable primitives, not a durable
  collaboration service, arbitrary-code security certification, or physical mobile certification.
- A public testkit with the eight normative workload manifests, all 17 representative panel
  fixtures, structural input-parity data, ownership exploration, lifecycle torture, and statistics.
- A machine-checkable 190-requirement register, 36-command parity check, capability/evidence
  inventories, trace matrix, and explicit accounting for all ten hard release gates.

Read [Command support](docs/COMMANDS.md), [Support matrix](docs/SUPPORT.md), and
[Conformance status](docs/CONFORMANCE.md) before adopting any package.

## Architecture

```mermaid
flowchart TB
  APP["Application"] --> ADAPTERS["React or framework adapter"]
  ADAPTERS --> RUNTIME["Runtime · selectors · transactions"]
  RUNTIME --> KERNEL["Pure semantic kernel"]
  KERNEL --> MODEL["Zero-dependency model"]
  ADAPTERS --> GEO["Pure geometry projection"]
  GEO --> MODEL
  ADAPTERS -. "temporary interaction" .-> PROTOCOL["Protocol · XState drivers"]
  ADAPTERS -. "visual explanation" .-> MOTION["Motion coordinator"]
  RUNTIME -. "fallible operational work" .-> OPS["Persistence · Effect · surfaces"]
  OPS --> MODEL
  CONF["Conformance inventories and reports"] -. audits .-> MODEL
  CONF -. audits .-> KERNEL
  CONF -. audits .-> ADAPTERS
```

Only the semantic kernel owns committed workspace state. Geometry is derived; interaction and
motion are temporary; frameworks project immutable snapshots; persistence and surfaces perform
fallible work through explicit contracts. See [Architecture](docs/ARCHITECTURE.md) and the accepted
[ADRs](docs/adr/).

## Workspace packages

The workspace contains the private root project, the demo application, and the following 19 library
packages. Every library below is version `0.1.0`, experimental, workspace-local, and unpublished to
npm.

| Package                      | Current responsibility                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `@panefold/model`            | Schema-v2 records, branded IDs, 36-command inventory, results, factories, JSON guards |
| `@panefold/kernel`           | Reference reduction, canonicalization, invariants, patches, hashes, history dispatch  |
| `@panefold/kernel-optimized` | Experimental indexes/projection, independent semantic oracle, differential campaigns  |
| `@panefold/geometry`         | Constraint aggregation, n-ary allocation, resolved rectangles, hit/drop testing       |
| `@panefold/runtime`          | Bounded dispatch, policies, selectors, persistence codecs, journals, durable runtime  |
| `@panefold/runtime-effect`   | Optional Effect wrappers and injected IndexedDB journal adapter                       |
| `@panefold/protocol`         | Driver-neutral protocol identities, scopes, clocks, and bounded traces                |
| `@panefold/protocol-xstate`  | Twelve bounded XState protocol actors with scoped identity and deterministic traces   |
| `@panefold/surfaces`         | Prepared ownership plus injected popup/PiP adapters, bootstrap, loss recovery         |
| `@panefold/motion`           | Scoped motion leases, channels, FLIP/View Transition fallback, load-aware planning    |
| `@panefold/adapter-contract` | Shared immutable source, selection, subscription, dispatch, and disposal contract     |
| `@panefold/react`            | React external-store binding, accessible renderer, stable hosts, geometry bridge      |
| `@panefold/vue`              | Vue shallow-ref binding and effect-scope disposal                                     |
| `@panefold/svelte`           | Svelte readable store and component lifecycle helper                                  |
| `@panefold/angular`          | Angular signal binding, provider, injection, and `DestroyRef` disposal                |
| `@panefold/web-components`   | SSR-safe custom-element factory and source/dispatch bridge                            |
| `@panefold/ecosystem`        | Plugin isolation, authenticated coordination, devtools, reproduction, mobile data     |
| `@panefold/testkit`          | Workload manifests, 17 panel fixtures, parity, ownership, lifecycle, and statistics   |
| `@panefold/conformance`      | Claims, proof classes, gates, reports, and third-party certification validation       |

`@panefold/demo` is the workspace application used for the Atlas reference fixture; it is not a
published package or a support certification.

## Run the demo

Requirements: Node.js 22 or newer and pnpm 11.

```bash
corepack enable
pnpm install
pnpm dev
```

Open the URL printed by Vite. Atlas exercises a compact map-operations workspace with tabs,
keyboard commands, splitters, stable content hosts, close/reopen, structural movement, undo/redo,
a mobile single-region projection, an optional 17-kind lifecycle lab, and a same-origin popup
fixture. It is an automated reference fixture, not evidence for every browser, input, framework,
workload, or deployment.

## Verify the repository

```bash
pnpm check
pnpm test:e2e
pnpm test:site:e2e
```

`pnpm check` runs formatting, dependency-boundary linting, source security checks, generated
requirement and conformance-data drift checks, package builds, conformance validation, a Node
performance smoke workload, strict TypeScript, tests, and the demo plus website production builds.
The two Playwright suites cover the declared Chromium reference fixture and the responsive
marketing/documentation experience. A green local or CI run is repository evidence only; it does
not replace manual assistive-technology work, physical 60/120 Hz traces, independent security
review, real crash testing, or third-party pilots.

## Kernel usage

```ts
import { commandId, createWorkspaceSnapshot, panelId } from "@panefold/model";
import { executeCommand } from "@panefold/kernel";

const initial = createWorkspaceSnapshot(/* normalized records */);
const result = executeCommand(initial, {
  id: commandId("command:select-map-canvas"),
  origin: "application",
  label: "Select map canvas",
  baseRevision: initial.revision,
  command: {
    type: "select-panel",
    panelId: panelId("map.canvas"),
  },
});

if (!result.ok) {
  console.error(result.error.code, result.error.remediation);
} else {
  console.log(result.next.revision, result.patches);
}
```

Expected failures are typed result values. A rejected command cannot advance revision or publish a
partial snapshot.

## Project status

All current packages and profiles are experimental. The repository does not claim stable WCAG 2.2
AA conformance, physical performance or heavy-content certification, unrestricted browser
popout/Picture-in-Picture or multi-screen support, a hosted durable collaboration product,
arbitrary-code isolation certification, physical mobile certification, or a completed independent
security review. Those boundaries are intentional and machine-readable in `conformance/`.

Engineering progress and missing exit evidence are separated in the [Roadmap](docs/ROADMAP.md).
The public site and launch contract lives in [Marketing and launch](docs/MARKETING.md). Architectural
changes require an ADR.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Report suspected vulnerabilities through the private flow
described in [SECURITY.md](SECURITY.md), not a public issue.

## License

[MIT](LICENSE)
