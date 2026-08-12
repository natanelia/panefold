# Panefold marketing and launch system

Panefold is positioned as **workspace state you can reason about**: infrastructure for teams
building panel-heavy products whose layout, focus, history, rendering, persistence, and surface
behavior must remain coherent as complexity grows.

## Audience

1. Engineers building IDEs, map tools, operations consoles, creative tools, and data workbenches.
2. Technical product leaders deciding whether to build workspace infrastructure in-house.
3. Framework and accessibility contributors evaluating Panefold's architecture and evidence.

## Message hierarchy

1. **Outcome:** complex workspace state remains understandable and testable.
2. **Mechanism:** one immutable semantic model and one authoritative command kernel.
3. **Craft:** solver-backed geometry, stable hosts, semantic undo, accessible projections, bounded
   failure, and evidence-backed support claims.
4. **Proof:** a real interactive Atlas fixture, a reproducible interaction film, public tests, and
   repository-backed documentation.
5. **Boundary:** version 0.1 is experimental and does not claim stable conformance or product
   certification.

## Site architecture

- `/` — product narrative, animated workspace hero, feature proof, craftsmanship, interaction film,
  embedded live fixture, framework story, and calls to action.
- `/demo` — full-height Atlas fixture with an explicit session-memory notice.
- `/docs` — searchable documentation index.
- `/docs/:slug` — repository Markdown rendered with navigation, headings, tables, and copyable code.

The live fixture is built from `apps/demo`; the website does not recreate product interactions with
a marketing-only mock. Documentation imports the canonical repository Markdown at build time.

## Visual direction

The interface uses a precision-instrument vocabulary: ink surfaces, thin topology lines, restrained
cobalt and mint signals, Manrope typography, JetBrains Mono evidence labels, small radii, and motion
that explains state changes. It deliberately avoids stock artwork and generic decorative gradients.

## Reproducible assets

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium pnpm marketing:capture
pnpm build:site
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium pnpm marketing:social
```

The video is assembled from deterministic Playwright screenshots of Atlas and encoded to VP9 WebM.
The social card is rendered from the same Tailwind design system at exactly 1200×630.

## Measurement contract

The site does not ship a tracker. It emits privacy-neutral `panefold:marketing` browser events and,
when a host supplies `window.dataLayer`, mirrors named page-view and CTA events into that array. A
future analytics provider can consume the contract without coupling page components to a vendor.

Initial decisions to measure:

- landing → live-demo engagement;
- landing → GitHub engagement;
- documentation entry and most-read sections;
- live-demo → documentation continuation;
- repeat visits after a release.

## Launch checklist

- `pnpm check` and both Playwright suites pass.
- Landing, documentation, and demo are inspected at desktop and mobile viewports.
- Reduced-motion behavior is verified; the film does not autoplay for those users.
- Social metadata, canonical URL, manifest, robots, and sitemap resolve from the production base.
- GitHub Pages deploys from `main`; the public URL and nested routes are checked after deployment.
- Repository About text, homepage, and topics point to the site.
- Claims remain within `docs/SUPPORT.md` and `docs/CONFORMANCE.md`.
