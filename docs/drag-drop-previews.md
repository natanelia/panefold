# Drag-and-drop behavior

The demo follows VS Code's editor/group docking rules while keeping Panefold's command-planned
previews, stable panel hosts, and atomic undo. Existing integrations retain center **swap** behavior
unless they opt into group merging.

## Pointer behavior

| Interaction              | Behavior                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel over content       | The outer 10% acquires an edge split. The rest merges into the group.                                                                                            |
| Whole group over content | A 30% band in the preferred split direction and 10% in the other direction acquires an edge.                                                                     |
| Corners                  | Resolve by thirds in the preferred direction, not nearest-edge distance.                                                                                         |
| Foreign tab header       | Before/after insertion based on tab midpoints; unused strip space appends. A thin marker replaces the content overlay.                                           |
| Same-group tab header    | Existing reorder slots, live neighbor movement, and overflow autoscroll remain available.                                                                        |
| Split modifier           | Alt on Windows/Linux, Shift on macOS, temporarily inverts the split setting. Key down/up updates a stationary pointer. Pointer samples repair missed key events. |
| Whole-group center       | The demo merges tabs and removes the source group in one existing semantic batch; library default remains swap.                                                  |
| Cancellation             | Escape, lost window focus, pointer cancellation, stale revision/geometry, and unmount dispose the session and its feedback.                                      |

Tab chrome is never an accidental split target. Horizontal, vertical, RTL, and compact floating
headers are measured in their actual locations. Foreground floating surfaces occlude underlying
destinations, including when their own planner rejects a drop. Sole-panel self-splits and rejected
plans are not advertised.

## Integrating the behavior

```tsx
<WorkspaceSurface
  {...workspaceProps}
  dropBehavior={{
    splitOnDragAndDrop: true,
    preferredSplitDirection: "right", // or "down"
    centerGroupDrop: "merge", // opt in; defaults to "swap"
  }}
/>
```

A group planner opting into merging must handle `request.target.kind === "merge"` and return the
resulting **target** group's rectangle. Edge/swap plans still return the resulting source group's
rectangle. The demo reuses `merge-groups` plus selection in one atomic batch; no model command or
persistence schema was added. Rejected group plans remain unavailable.

Precise foreign insertion has a separate `commands.planPanelTabDrop` capability. It receives a
center request with `beforePanelId` or `afterPanelId` and must honor that anchor. The demo passes
those identities through the existing kernel planner. Old `planPanelDrop` integrations retain their
center behavior rather than showing a marker for an insertion they may ignore. A rejected insertion
slot does **not** silently fall back to an append.

Each slot is planned once at drag start, including its exact command. Pointer frames select retained
plans without DOM measurement or command creation. Release validates tab geometry as well as the
existing revision and content-geometry guards. Scrolling a foreign strip invalidates that drag;
foreign-strip autoscroll is not yet implemented. Same-strip reorder autoscroll remains supported.

## Feedback and commit

The translucent rectangular overlay shows the application's resulting geometry, not the narrow
pointer acquisition zone. Most splits approximate half the target, but constraints, splitters,
source-group removal, and custom planning can change the result. The retained command that produced
that rectangle is the command dispatched at release.

The first preview does not animate from a stale rectangle. Later changes use 70 ms geometry
transitions, respecting reduced/off motion and forced colors. A compact label follows the pointer;
internal past-tense operation messages no longer clutter that label. Commit announcements and
external-window explanations remain available.

Theme hooks are `--pf-drop-background`, `--pf-drop-border`, and `--pf-drop-indicator`. The default
content tint is neutral, with an accent tab-insertion marker. Forced-color mode retains the system
highlight outline.

## Upstream comparison

Checked against VS Code commit
[`4c85043ed55698b4e3c8ad3a5030212ce1dd9d77`](https://github.com/microsoft/vscode/commit/4c85043ed55698b4e3c8ad3a5030212ce1dd9d77)
on 26 September 2026 (Singapore):

- [`editorDropTarget.ts`](https://github.com/microsoft/vscode/blob/4c85043ed55698b4e3c8ad3a5030212ce1dd9d77/src/vs/workbench/browser/parts/editor/editorDropTarget.ts): edge bands, preferred direction, modifiers, invalid self-drops, title offset, group merging.
- [`multiEditorTabsControl.ts`](https://github.com/microsoft/vscode/blob/4c85043ed55698b4e3c8ad3a5030212ce1dd9d77/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts): header insertion, end-of-strip drops, and scrolling.
- [`editordroptarget.css`](https://github.com/microsoft/vscode/blob/4c85043ed55698b4e3c8ad3a5030212ce1dd9d77/src/vs/workbench/browser/parts/editor/media/editordroptarget.css): rectangular non-interactive overlay and 70 ms movement.

This is not a dependency on VS Code or a claim of complete parity. Copy/duplicate modifiers,
multi-selected editor drags, native OS file drops, Shift-to-drop-text, delayed hover activation,
and auxiliary-window transfer follow different or unsupported contracts. Panefold's exact planned
**group** rectangle intentionally differs from VS Code's nominal half-**content** overlay. RTL
uses logical edges rather than hard-coded physical left/right. The macOS modifier test emulates
`navigator.platform`; it does not establish physical macOS browser coverage.

## Tests and recordings

The acquisition tests include the original 15,000-point default-direction oracle plus a
3,200-point downward-direction oracle. Insertion tests cover retained plan identity, rejection,
clipped markers, stale geometry, horizontal/vertical rails, and RTL. Browser tests exercise actual
pointer input, stationary key changes, group merging, host preservation, one-step undo, cancellation,
and preview/commit agreement within one CSS pixel.

[`capture-drag-comparison.mjs`](../scripts/capture-drag-comparison.mjs) records fresh browser contexts
from two built worktrees. It adds only a cursor ring and a revision/chapter caption. It does not
reconstruct or paint the workspace's feedback. GIF hashes, source commits, browser version, target
observations, and committed tab orders are saved in `docs/media/vscode-drag-provenance.json`.

```sh
git worktree add /tmp/panefold-before 877be5f4ee9aae5f76e0a72e2b05b3725b4eacbc
pnpm --dir /tmp/panefold-before install --frozen-lockfile
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
# Requires ffmpeg on PATH. Builds both worktrees unless --skip-build is supplied.
node scripts/capture-drag-comparison.mjs --before-dir /tmp/panefold-before
```

The recordings compare current `main` at the pinned baseline with this implementation, including
the unmerged preview work from PR #33. Automated Chromium results do not constitute manual
usability, assistive-technology, or cross-platform certification.
