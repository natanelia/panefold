# Quickstart

**Start with something you can run, not an install command that does not work.** Panefold is currently source-only. These steps run the real packages in their own workspace.

## 1. Clone and run

Use Node.js 22 or newer and the repository's pinned pnpm version (`11.16.0`). Install that pnpm version through your normal package-manager setup; Corepack is one option where it is available.

```bash
git clone https://github.com/natanelia/panefold.git
cd panefold
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite. `pnpm dev` first builds the library packages, then starts the reference workbench. Do not run `npm install @panefold/react`: there is no published package to install.

## 2. Open the smaller starter

Append `?fixture=starter` to that local workbench URL. Or open the [hosted starter](/workbench/?fixture=starter).

The starter contains an editable note, a preview and an inspector. It uses the real runtime and React surface, not a picture of a docking layout. Switch tabs, type a note, drag it to another group, resize the split, and change the tab rail. Undo reverses layout changes, not edits inside the note.

The entry point is [docs-starter.tsx](../../apps/demo/src/docs-starter.tsx). It deliberately reuses `projectWorkspace` and `createDemoCommands` from [workspace-config.ts](../../apps/demo/src/workspace-config.ts). Those are **reference application helpers, not exports from `@panefold/react`**. Copy and adapt that glue when creating a separate application.

## 3. Make a visible change

In the starter, change a panel record's `title` and edit its registered component. The title becomes tab chrome; the component becomes panel content. Change `tabPresentation` to move the tab rail. Add a scoped CSS custom property to change the accent.

Read [your first panel](panels.md), [tabs](tabs.md), and [themes](styling.md) for the exact extension points.

## 4. Carry the integration into your app

Stay in the monorepo first. Its `workspace:*` dependencies resolve the unpublished packages and its build order creates the package declarations. For a separate repository, build and vendor the selected packages with all their workspace dependencies; the source tree is not a single-file npm dependency.

Keep these pieces together: a valid initial snapshot, a runtime, a projector, a command adapter, a registry and the renderer stylesheet. The [React guide](react.md) explains each boundary. The starter keeps layout in memory; the full workbench demonstrates durable IndexedDB restoration.

## 5. Check your changes

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:site:e2e
```

The browser suites require Playwright Chromium. Install it with `pnpm exec playwright install chromium` where needed. For the complete repository gate, use `pnpm check`.

For the website itself, run `pnpm dev:site`. A green test run is engineering evidence, not certification of every browser, screen reader, physical device or deployment.
