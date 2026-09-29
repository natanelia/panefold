# The touch playground

**Keep the workspace. Change the interaction.** The phone example starts with two readable panes, not a scaled desktop editor. It uses the same Panefold runtime, commands and React renderer.

Open the [touch playground](/workbench/?fixture=touch). Phones and touch devices open this example by default. The [Code example](/workbench/?fixture=code) remains available with its own saved layout.

## Move and split with a finger

Drag the grip beside a tab. Drop in the center of another pane to make tabs. Drop in its outer third to split above, below, or beside it. The shaded preview shows the planned result before you release.

Repeat the operation inside a child pane to make a nested split. Drag a divider to resize the panes. Empty source panes disappear when their last tab leaves.

For a larger grab area, select **Arrange**. The whole tab becomes a drag handle, and a separate grip lets you move a group. Select **Done** to return to normal tab scrolling. Outside Arrange mode, swipe the tab names to scroll without moving a panel.

## Place a panel without holding a drag

Select **Move**. Choose the panel, the destination pane and the position. Check the miniature layout, then select **Apply move**. Nothing changes until you apply. This path also reaches destination panes outside the visible screen.

Use **Undo** and **Redo** to reverse layout changes. These operations do not edit the note or checklist content.

## Keep content readable

The example starts with two full-width panes. Each pane keeps a minimum width of 176 CSS pixels and a minimum height of 208 CSS pixels. More complex layouts can extend beyond the screen instead of collapsing into thin columns.

Swipe the workspace to reach the rest of a large layout, or use **Panels** to reveal a panel. The Move sheet lists every destination. Rotating the device changes the available view; it does not replace the layout model.

These sizes are example policies, not global library defaults. Your application can choose different limits for its content. Use the same geometry policy for the actual layout and its drop preview.

## Save the right state

Layout saves to a separate IndexedDB workspace. The save label follows the durable controller's status. An unavailable database produces a visible error and an explicit temporary-session option; it does not delete the saved layout.

The note and checklist are demonstration content. They survive panel moves but reset on reload. A product should connect its content to its own document store.

## Adapt the example

Read [TouchPlayground.tsx](../../apps/demo/src/TouchPlayground.tsx), [playground-model.ts](../../apps/demo/src/playground-model.ts) and [playground-session.ts](../../apps/demo/src/playground-session.ts). These are application examples, not package exports.

The optional `dropBehavior.edgeBandRatio` sets the edge-drop band as a fraction of each pane. Values are bounded from zero to one third. The touch example uses one third; existing integrations retain their current default. `preferredSplitDirection` resolves corner overlap. The visible guides must agree with that policy.

Automated Chromium touch tests check interactions, minimum sizes, cancellation, undo and saved-layout restoration. They do not establish physical iPhone, Safari or assistive-technology certification. Read the [support matrix](../SUPPORT.md) before choosing a product support policy.

## The last docked panel

Keep one panel docked as a return destination for floating panels. The menu does not offer Float for the last docked panel. Reopen another panel from Panels to make floating available again.

Choosing As tab in the panel's current pane is not a move. Apply move stays disabled and does not add a history entry. Use the tab grip or the menu's before/after actions to reorder tabs.
