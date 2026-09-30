# Marketing and launch

## Positioning

**Build tools. Not tab management.** Panefold is an experimental TypeScript workspace runtime for web applications that need dockable panels, resizable splits, layout history and explicit persistence.

The website leads with the developer's task: run a working workspace, bring a component, then make the interaction and appearance fit the product. It does not advertise an npm package, stable certification, customer logos, invented adoption statistics or unrestricted browser windows.

## The developer journey

The home page combines a product narrative, an explicitly labeled workspace illustration, an on-demand real workbench, an appearance sketch with exact renderer props, and a source-first quickstart. The sketch is not represented as the docking runtime. The full workbench starts only after a deliberate action on the landing page.

The documentation begins with practical guides for the mental model, React wiring, panel registration, commands, tab rails, styling, persistence and external windows. The API field guide distinguishes public library exports from reference application glue. Existing architecture, support, performance, conformance, decisions and normative specification remain available.

The smaller starter at `workbench/?fixture=starter` uses the actual model, runtime and renderer. It intentionally keeps state in memory and has no browser-window controller. The full workbench remains the durable-storage and controlled-popout reference fixture.

## Content and route ownership

Repository Markdown remains the source of truth. `apps/site/src/content/doc-catalog.json` owns titles, descriptions, sections, source paths and slugs. Both the browser registry and static route/sitemap generator consume it; new guides must not be added to only one of those surfaces.

Documentation links resolve against each Markdown source directory. Source links identify the checked-out commit in a built site. Full-text search loads the source documents on demand, not at homepage startup. Duplicate headings and code fences must not produce broken table-of-contents links. The original specification's fourteen figures and chapter hierarchy remain intact.

## Review and preview

The current trusted main-branch Pages pipeline continues to own deployment. It builds same-repository PR workbenches with read-only permissions. A preview-only demo build hook also packages the complete website under the existing artifact at `previews/pr-N/workbench/site/`. Production builds are unchanged, and the hook accepts only the exact expected PR path shape.

The nested website uses its own asset/router base and noindex metadata. Direct guide URLs must work on refresh. Production canonical URLs are retained. Existing preview pages identify the exact built commit and warn about origin-shared browser storage; reviewers should use a separate private browser session.

## Verification before launch

Run `pnpm check`, `pnpm test:e2e` and `pnpm test:site:e2e`. CI also runs application tests, document-source contracts and static catalog validation. Browser coverage includes developer navigation, full-text search, mobile overflow, the appearance controls, copied-code error handling, the real starter, metadata, source-backed benchmarks and normative figures. Screenshots of the desktop and mobile experience are retained in browser artifacts.

Automated accessibility results are engineering evidence, not WCAG certification. Physical device, assistive-technology, crash, workload and independent security gaps stay visible in the support and conformance references. Marketing wording must not turn an implemented primitive or a passing fixture into a broader certification claim.

## Analytics and privacy

The existing opt-in marketing analytics bridge remains separate from the workspace runtime. Documentation search and the starter do not add external services, trackers, cookies or hosted dependencies. Assets and fonts are served by the site itself.
