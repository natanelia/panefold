# Meet Panefold

**Build tools. Not tab management.**

Your application already has the interesting part: an editor, a map, a data grid, a timeline. Panefold gives those parts a workspace. Users can move panels into tab groups, resize splits, float a tool, and return to a saved arrangement.

It is a TypeScript workspace runtime, not an application framework or a set of finished business widgets. You bring the content and the product rules. Panefold supplies a command-driven layout model and a React renderer; lower-level packages let you adopt less of the stack.

## Is this the right fit?

Use it for tools where people work with several things at once: developer environments, geospatial editors, analytics workbenches, creative tools, or operations consoles. A fixed dashboard or a simple two-column page usually does not need a workspace runtime.

Panefold is especially useful when “where did this panel go?” must have an explainable answer. Committed changes go through one semantic command path, rather than being scattered across component-local drag state.

## What you get—and what you own

| Panefold provides                                   | Your application provides                                      |
| --------------------------------------------------- | -------------------------------------------------------------- |
| Panels, tab groups, split topology, surfaces        | Domain components, data fetching, authentication               |
| Command execution, typed rejection, bounded history | Command factories, IDs, permissions, product policies          |
| React tabs, splitters, docking and floating chrome  | Panel registry, snapshot projection, theme and labels          |
| Versioned persistence and journal contracts         | Storage configuration, migration policy, panel checkpoints     |
| Controlled external-surface primitives              | Browser integration, popup UX, recovery and deployment testing |

The React integration is intentionally explicit. You wire a runtime, a projector and a command adapter; there is no hidden `createDockingApp()` that does all of that. The [starter](quickstart.md) shows the actual integration.

## Choose your next step

**See it:** open the [live workbench](/demo). Drag a tab to another group, split it at an edge, and try the appearance controls.

**Build it:** follow the [quickstart](quickstart.md), then learn the [mental model](mental-model.md) and [React integration](react.md).

**Make it yours:** register [your panels](panels.md), choose [tab rails](tabs.md), and apply [your theme](styling.md).

## Available from source, experimental by design

The current `0.1.0` packages are private workspace packages and **not published to npm**. Clone the repository to evaluate them. The source is MIT-licensed; do not confuse an open license with a stability or support guarantee.

React has the browser reference fixture. Vue, Svelte, Angular and Web Components bindings exist, but their current evidence is a JSDOM contract harness—not equivalent browser certification. Review the [support matrix](../SUPPORT.md) and [conformance evidence](../CONFORMANCE.md) before adoption.

The [performance report](../PERFORMANCE.md) preserves measured results, controls and limitations. No universal frame-rate promise is implied by the landing page or the live demo.
