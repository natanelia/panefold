# The mental model

**A workspace is data. The screen is a projection of it.** Keep this distinction and customization becomes much easier to reason about.

## Four things to know

| Concept     | Think of it as                                              | Example                                            |
| ----------- | ----------------------------------------------------------- | -------------------------------------------------- |
| Panel       | One content instance with a stable ID and a registered type | `notes` using `example.note`                       |
| Group       | An ordered list of tabs and one selected panel              | An editor group with two documents                 |
| Layout node | A group leaf or an inline/block split                       | A 70/30 editor-and-inspector arrangement           |
| Surface     | A host for a layout root                                    | The main workspace, a float, or an external window |

A panel's ID identifies the instance. Its type selects the renderer. Two different IDs can use the same registered component. Keep IDs stable across saves and restores; do not regenerate them during React renders.

## Follow a change

```text
User intent or application action
  → command factory
  → runtime dispatch
  → semantic kernel: validate and commit, or reject
  → new immutable snapshot
  → projector and geometry
  → React view
```

Pointer previews are temporary. The committed snapshot is authoritative. Persist the latter, not the DOM rectangles or an in-progress drag overlay.

## Selected is not the same as active

A group selects the panel visible in that group. Activation identifies the tool the user is working in across the workspace. Focus memory helps restore a sensible focus target after structural changes. Avoid keeping an unrelated “active tab” React state that disagrees with the runtime.

## Logical axes, physical screens

`inline` follows the writing direction; `block` follows the block flow. In a horizontal left-to-right layout, inline splits appear side by side and block splits appear stacked. `inline-start` changes physical side in right-to-left mode. Prefer logical edges over inventing separate left/right layouts.

## Keep three kinds of state separate

**Workspace state:** panel membership, ordering, splits, surfaces, activation and history. Change it with commands.

**View preferences:** tab presentation, theme and motion. Pass them to the renderer and save them in your own preference store as needed.

**Domain state:** editor text, map data, query results, selection and credentials. Your application owns this. A saved layout is not automatically a saved document.

For deeper authority boundaries and package dependencies, continue to [Architecture](../ARCHITECTURE.md). For a working projection and dispatch bridge, continue to [React integration](react.md).
