# Support matrix

Version: `0.1.0` (experimental)

This table describes implemented and tested claims, not aspirations.

| Area                                       | Status       | Current claim                                                                   |
| ------------------------------------------ | ------------ | ------------------------------------------------------------------------------- |
| Headless model and reference kernel        | Experimental | Node.js 22+, deterministic pure TypeScript                                      |
| Geometry                                   | Experimental | Tested headless n-ary solver; not wired into the React demo                     |
| React adapter                              | Experimental | React 19 compact fixture using CSS weight projection                            |
| Browser                                    | Experimental | Current Chromium desktop reference profile                                      |
| Main in-page surface                       | Experimental | Docked groups and splitters                                                     |
| In-page floating surface                   | Experimental | Headless kernel commands only; no reference DOM surface renderer yet            |
| Pointer                                    | Experimental | Tab and React-local splitter previews in the reference demo                     |
| Keyboard                                   | Experimental | Tabs, splitters, toolbar/commands, close/undo/redo                              |
| Accessibility                              | Experimental | Automated semantics plus documented keyboard smoke test; no certification claim |
| Motion                                     | Experimental | Productive/reduced/off profiles; semantic state never waits for motion          |
| RTL and localization                       | Experimental | Logical axes and an LTR/RTL demo toggle; UI strings are English-only            |
| Persistence                                | Unsupported  | Driver contracts only; durable IndexedDB journal is planned                     |
| Browser popouts / cross-document transfer  | Unsupported  | Planned prepared-transfer protocol                                              |
| Document Picture-in-Picture / multi-screen | Unsupported  | Planned capability-gated surfaces                                               |
| Collaboration / coordinator election       | Unsupported  | Planned after formal ownership verification                                     |
| Dynamic untrusted plugins                  | Unsupported  | Static panel registry only                                                      |
| Vue, Svelte, Angular, Web Components       | Unsupported  | Planned shared adapter contract                                                 |
| Mobile/touch product profile               | Unsupported  | Responsive projection is illustrative only                                      |
| Stable-host heavy-content certification    | Unsupported  | Architecture hook exists; torture evidence is pending                           |

Unsupported capabilities are omitted or visibly disabled. They are never silently presented as
best-effort behavior.
