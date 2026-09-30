# Tabs and tab rails

**Same panels. A different personality.** Put documents across the top, tools down the side, or give an inspector compact icon tabs—without rewriting the layout model.

## Set the presentation

Pass `tabPresentation` to `WorkspaceSurface`. This is the actual prop shape:

```tsx
tabPresentation={{
  placement: "inline-start",
  content: "icon-only",
}}
```

| Placement      | Horizontal LTR result |
| -------------- | --------------------- |
| `block-start`  | Tabs above content    |
| `block-end`    | Tabs below content    |
| `inline-start` | Tabs on the left      |
| `inline-end`   | Tabs on the right     |

Set `direction="rtl"` to use right-to-left layout. Logical start/end follow direction; “inline-start” is not an unconditional synonym for “left.”

`content` accepts `"icon-and-label"`, `"icon-only"`, or `"label-only"`. Icons come from the panel registry, and names come from the panel view. Try the interactive appearance preview on the [home page](/#customize) or use the starter controls.

## Customize per group

The prop also accepts a resolver. This wiring excerpt keeps document tabs readable while making an inspector compact:

```tsx
tabPresentation={(group) => ({
  placement: group.id === "inspector" ? "inline-start" : "block-start",
  content: group.id === "inspector" ? "icon-only" : "icon-and-label",
})}
```

Memoize reusable resolver functions when appropriate. Keep this view preference separate from semantic panel ordering and save it in your application preference store when it should survive reloads.

## Compact single-panel groups

The opt-in stylesheet `@panefold/react/hide-single-tab-row.css` removes redundant tab rows for one-panel groups while keeping the compact drag affordance. Import it after the base renderer stylesheet, then opt in by adding `pf-hide-single-tab-row` to the surface or an ancestor. For example, pass `className="product-workspace pf-hide-single-tab-row"` to `WorkspaceSurface`. Importing the stylesheet alone does not activate it. Test your theme against both ordinary groups and floating surfaces.

Do not hide all chrome with a broad CSS rule: that can remove the only discoverable way to move a panel or reach its actions.

## Preserve usability

Give icon-only tabs meaningful titles and visible focus states. Test long labels, many tabs, overflow, keyboard reordering and each rail in RTL. A narrow rail must not make content unusably small or reduce pointer targets just to look dense.

For color, spacing and tab dimensions, continue to [themes and styling](styling.md).
