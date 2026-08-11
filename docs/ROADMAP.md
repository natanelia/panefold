# Roadmap

| Phase                           | Deliverable                                                          | Exit evidence                                     |
| ------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| 0 — executable specification    | Model, invariants, commands, reference kernel, generated laws        | Small-state exploration and canonical round trips |
| 1 — optimized kernel            | Chunked tables, incremental patches/indexes, differential oracle     | Millions of operations without divergence         |
| 2 — geometry and basic DOM      | Complete solver, tabs, splitters, focus, structural keyboard UI      | Keyboard-only reference task suite                |
| 3 — interaction and motion      | Drag, resize, snap, exact previews, FLIP, interruption               | 60/120 Hz traces and protocol fuzzing             |
| 4 — lifecycle and heavy content | Stable hosts, suspend, editor/map/grid/video/iframe fixtures         | Zero-remount and lifecycle-torture evidence       |
| 5 — Effect operational runtime  | IndexedDB journal, migrations, scopes, typed errors, tracing         | Crash-safe deterministic recovery                 |
| 6 — external surfaces           | Prepared popouts, authenticated ownership, recovery, PiP enhancement | Failure matrix and formal ownership proof         |
| 7 — framework adapters          | React, Vue, Svelte, Angular, Web Components                          | Shared adapter certification                      |
| 8 — ecosystem                   | Plugins, devtools, collaboration, mobile projections                 | Third-party pilots and certification metadata     |

Version 0.1 implements Phase 0, selected narrow slices of Phases 2–3, and an uncertified stable-host
experiment from Phase 4. Phase labels are evidence gates, not calendar promises.
