# Playground functionality audit

Audit date: 30 September 2026. Pull request: [#47](https://github.com/natanelia/panefold/pull/47).

## Scope and result

The functional source at `effda86c1aba3c0478beef1bb6b45bc9cac975d6` passed the full playground audit. The same source also passed the audit on the deployed preview. Each test used a new browser context. No failed tests, retries, or skipped tests were accepted in the feature audit.

The audit covers the controls exposed by the touch playground, the full Code example, and the embedded playground. It does not claim that every possible layout, browser, or physical device has been tested.

## Feature coverage

### Panels and live content

Open and select all four panels. Update Notes and its connected Preview. Change Checklist state. Display typed markup as text. Preserve Checklist component state through floating, minimizing, maximizing, docking, undo, and redo. Preserve note text through moves.

Tests: `audit-e2e/playground.spec.ts`, `audit-e2e/panel-state.spec.ts`, and `e2e/touch-playground-operations.spec.ts`.

### Moving, splitting, and resizing

Exercise every panel in all five Move-sheet positions: above, left, as a tab, right, and below. Check the preview, final location, undo, and redo. Disable an unchanged placement.

Use touch input to dock across groups, reorder tabs, move a whole group, create an edge split, and split a child pane again. Compare the drop preview with the committed geometry. Resize dividers and floating windows. Commit on release. Cancel without changing the layout. Keep touch scrolling separate from dragging.

Tests: `audit-e2e/playground.spec.ts`, `audit-e2e/recovery.spec.ts`, `e2e/touch-layout.spec.ts`, `e2e/touch-playground-ux.spec.ts`, and `e2e/touch-playground-operations.spec.ts`.

### Menus and floating windows

Reorder panels, move panels, split in each direction, choose a destination, merge groups, and remove a container without losing its panels.

Move, resize, maximize, restore, minimize, and dock floating windows. Move to a minimized floating destination. Restore and raise the destination. Dock a nested floating layout without flattening it. Keep window controls and tab names readable on narrow screens.

Tests: `audit-e2e/playground.spec.ts`, `audit-e2e/floating-chrome.spec.ts`, and `e2e/touch-playground-operations.spec.ts`.

### Closing, persistence, and recovery

Close every panel, reload the empty layout, reopen panels, and reload again. Do not offer an impossible Float action for the final docked panel. Reopening another panel enables floating again.

Save and restore layout and floating geometry. Report a storage failure. Retry saving or opening without clearing saved data. Keep controls available in explicitly temporary mode.

Tests: `audit-e2e/playground.spec.ts` and `audit-e2e/recovery.spec.ts`.

### Phone controls, keyboard access, and accessibility

Check portrait and landscape layouts, readable floating titles at 320px width, touch-sized controls, menu bounds, sheet close actions, focus restoration, tab keys, and keyboard resizing. Floating tab navigation must not move the window.

Run automated WCAG A/AA checks on the initial workspace, every sheet, and a floating panel. Keep keyboard-only paths in the feature tests.

Tests: `audit-e2e/floating-chrome.spec.ts`, `audit-e2e/playground.spec.ts`, and `audit-e2e/recovery.spec.ts`.

### Existing Code and site integration

Run the full Code workbench and renderer regression suites. These include RTL and vertical tabs, controlled browser popups, layout history, stable panel hosts, and the site iframe. Run the documentation and starter browser tests as well.

Tests: `e2e/`, `site-e2e/`, and `packages/react/test/`.

## Fixes protected by these tests

Floating controls now activate once at the touch-release boundary. Floating tab keys no longer move the window. The header keeps panel names visible beside window controls on narrow screens.

Panel-local state remains mounted through floating and docking. Selecting a minimized floating panel restores it. Moving into a minimized destination restores, places, and raises it in one transaction. Docking a nested float keeps its child panes and remains reversible.

Move previews use the destination surface and the same geometry rules as the committed layout. No-op moves are disabled. Short-screen menus stay in the visible viewport. Closing a sheet returns focus to its control. Closing the last panels does not prevent later reopening.

The source-bound evidence checks were retained. Browser and unit results were imported only after comparing their source hashes. The independent semantic campaign and protocol coverage were executed again for the changed TypeScript configuration. No old result was approved by changing its source hash alone.

## Executed evidence

[Feature and hosted audit run](https://github.com/natanelia/panefold/actions/runs/36711088095): **49 scenarios per profile**, on desktop Chromium, desktop Firefox, phone Chromium, and phone WebKit. This is **196 local-build checks plus 196 deployed-preview checks**, with no failures, skips, or retries. Each hosted report includes `hosted-revision.json`, which identifies the exact deployed source.

[Touch and integration review](https://github.com/natanelia/panefold/actions/runs/36711088102): **82 reference browser tests**, **584 library unit tests**, and **38 site browser tests** passed. The site suite has two existing duplicate mobile accessibility skips. These are separate from the feature audit, which has no skips.

[Evidence validation run](https://github.com/natanelia/panefold/actions/runs/36717852627) executed the independent 10,000-command comparison and protocol coverage, then passed the complete `pnpm check` and application checks before publishing the evidence. Consult the PR checks for the final branch verification.

## Reproduce

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm exec playwright test --config playwright.audit.config.ts --retries=0
pnpm test:e2e --retries=0
pnpm test:site:e2e --retries=0
pnpm check
```

Use a new browser context for each hosted test. The audit uses its own browser state. It does not change a user's existing saved workspace.

## Limits

Native touch drag tests use Chromium browser input through CDP, not synthetic DOM pointer events. WebKit and Firefox run the control, layout, lifecycle, recovery, and accessibility audit. This is not a claim that native touch dragging was tested on a physical iPhone or Android device.

The touch example has in-page floating windows. Its panels do not advertise browser popouts or Picture-in-Picture. The full Code example tests the controlled same-origin popup path separately. Sample note and checklist content resets on reload by design; layout persistence is a separate feature.

Automated accessibility checks do not establish complete accessibility compliance. The library remains experimental. These results are regression evidence, not a guarantee that no undiscovered bug exists.
