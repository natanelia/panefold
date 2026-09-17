# Panel drop previews

The React adapter uses VS Code's default side-by-side drop-target policy. A panel drag keeps a
large merge area in the center. The pointer must enter the outer 10% of the content width or
height to select a split. Outside that center, the left and right thirds select an inline split;
the middle third selects an upper or lower split. This makes corner selection deterministic,
instead of selecting the nearest edge.

Whole-container drags use a wider 30% inline band and a 10% block band. A center container drop
still **swaps containers** in Panefold; it does not merge their tabs. This change does not alter
semantic commands, persisted state, keyboard placement, or external-window ownership.

## Preview and commit

- Tab headers select the center action, not a split. Same-strip tab reordering keeps its existing
  insertion marker and priority. Content hit areas exclude visible horizontal or vertical headers.
  Compact floating-window headers are measured at their portal location.
- A rectangular, translucent overlay shows the **application planner's resulting rectangle**.
  A normal split is approximately half the target. The overlay does not paint the small pointer
  acquisition band. Constraints, source-group removal, splitters, and custom planners can change
  the final rectangle. Their planned geometry takes priority over an assumed 50% rectangle.
- The retained plan supplies both the preview and the exact command used at pointer release.
  Rejected targets, sole-panel self-drops, and hidden targets behind a foreground floating surface
  do not advertise another destination. Foreground surfaces occlude targets even when their own
  planner rejects the operation.
- The first preview appears without movement from a stale rectangle. Later target changes use a
  70 ms geometry transition. Reduced/off motion settings still apply. Cancellation and invalidation
  hide the preview and clear transition state.

Target geometry is measured at drag start, not on pointer frames. A scoped `ResizeObserver`
invalidates the drag when destination chrome changes. Pointer release also checks the cached
geometry synchronously, before committing. The existing revision, root geometry, scrolling, and
pointer-capture guards remain in place. Observer resources are released on completion,
cancellation, and unmount.

Applications can theme the overlay with `--pf-drop-background` and `--pf-drop-border`. Defaults
use the workspace accent. Forced-color mode uses the system highlight border.

## Source comparison and limits

The behavior was checked against these upstream sources on 17 September 2026:

- [VS Code `DropOverlay.positionOverlay`, title offset, validity, and drop handling](https://github.com/microsoft/vscode/blob/8c7b66b0e3d9364afd5a59a7a9843f191d169fa1/src/vs/workbench/browser/parts/editor/editorDropTarget.ts)
- [VS Code overlay styles and 70 ms movement transition](https://github.com/microsoft/vscode/blob/8c7b66b0e3d9364afd5a59a7a9843f191d169fa1/src/vs/workbench/browser/parts/editor/media/editordroptarget.css)

This is a behavior implementation, not a dependency on VS Code. It follows the default
side-by-side preference, mirrored through Panefold's logical coordinates in RTL. It does not add
VS Code's configurable downward split preference, copy/split modifier keys, native file drops, or
Shift-to-drop-text behavior. Unlike VS Code's content-only half overlay, Panefold retains the
exact planned group bounds so the preview remains an accurate commit prediction.

## Regression coverage

`drop-target.test.ts` checks the threshold boundaries, corners, content/header separation, and
15,000 sampled points against an independent normalized decision table. `drop-preview.test.ts`
checks scale, RTL, vertical/portaled headers, geometry invalidation, observer cleanup, and first
paint/re-entry. Candidate tests cover plan identity, invalid destinations, self-drops, floating
occlusion, and existing container swaps.

The browser suite compares the preview with the committed panel bounds on all four sides in
horizontal, vertical-tab, and RTL layouts. It also checks the larger merge region, tab headers,
corner selection, cancellation, undo, and the rectangular non-interactive overlay. These tests
are automated browser evidence, not a claim of manual usability or assistive-technology review.
