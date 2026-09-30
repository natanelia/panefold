# Themes and styling

**Make it feel native to your product.** Start with the renderer's CSS, then override a small set of scoped design tokens. You do not need to fork the component tree to change its appearance.

## Import the base styles

```ts
import "@panefold/react/styles.css";
// Optional: compact chrome for groups with only one panel.
import "@panefold/react/hide-single-tab-row.css";
```

The optional single-tab stylesheet also requires the `pf-hide-single-tab-row` class on the surface or an ancestor; importing it alone does not hide anything.

The base stylesheet uses a `workspace` cascade layer and low-specificity token defaults on `.pf-workspace`. Scope your overrides to the `className` you pass to `WorkspaceSurface`; avoid leaking workspace tokens onto every page.

## Start with a light theme

These variables exist in the current renderer stylesheet. Add this class to the surface itself:

```css
.product-workspace {
  --pf-bg: #f4f6f5;
  --pf-surface: #ffffff;
  --pf-surface-raised: #eef3f1;
  --pf-surface-soft: #e5eeea;
  --pf-border: #c9d8d0;
  --pf-border-strong: #8ca899;
  --pf-text: #172b23;
  --pf-text-muted: #4b6658;
  --pf-accent: #147d57;
  --pf-accent-soft: #d8f2e6;
  --pf-focus: #075d40;
  --pf-tab-size: 38px;
  --pf-tab-inline-size: 150px;
  --pf-target-size: 36px;
  color-scheme: light;
}
```

A theme must cover raised, soft, border, muted and focus states—not just the background. The complete source of available variables is [styles.css](../../packages/react/src/styles.css).

## Style content separately

Your panel components own their typography, padding and data visualization. The workspace owns the surrounding chrome. Keep the note editor's CSS scoped to the note editor, rather than targeting every `textarea` in the application.

The starter provides a small [application stylesheet](../../apps/demo/src/docs-starter.css) that illustrates the separation.

## Sizing, motion and direction

Use the `splitterSize` prop when changing solver geometry; changing only a CSS variable can make visual chrome disagree with hit testing. Use the logical tab-presentation prop rather than rotating a horizontal strip with CSS.

`motion` accepts `"off"`, `"reduced"` and `"productive"`. Begin with motion off when integrating heavy content; add transitions only after measuring the actual workload. Keep reduced-motion behavior and visible focus indicators intact.

`direction="rtl"` sets the workspace's logical direction. Test it with real labels and content, including floating controls and vertical rails.

## A practical theme checklist

Check text and focus contrast, hover and disabled states, empty groups, long names, error messages, drop indicators, all four tab rails, minimized floats and constrained widths. Automated accessibility checks are helpful, but they do not replace keyboard and assistive-technology testing.
