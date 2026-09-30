# Floating and browser windows

**Give tools room to breathe. Know which boundary they cross.** An in-page floating panel and a separate browser window look similar, but their operational contracts are different.

## Choose the simpler surface first

| Surface          | Where it lives               | Integration cost                                                   |
| ---------------- | ---------------------------- | ------------------------------------------------------------------ |
| Docked group     | Main layout tree             | Default workspace integration                                      |
| Floating surface | Same document                | Floating command factories, bounds and redock policy               |
| Browser popup    | Another same-origin document | Browser adapter, ownership handoff, bootstrap, styles and recovery |

Use an in-page float when you need a movable tool over the workspace. Use an external window when users actually need another browser window or screen. Do not turn on popouts merely because the panel can float.

## In-page floating

Set the panel's `floatable` capability and provide the relevant command factories. The adapter includes `floatPanel`, move/resize, raise, maximize, restore, minimize and redock operations. The reference commands encode product decisions such as activation and the redock destination.

A same-document move can preserve the live content host. Test the panel's own state and expensive resources; application behavior still matters.

## Controlled browser popouts

The React `onExternalPanelRequest` injection is invoked synchronously from the initiating pointer event so the browser can use transient user activation. Deferring `window.open` until after unrelated asynchronous work can trigger popup blocking.

The full example is [external-panels.ts](../../apps/demo/src/external-panels.ts). It integrates same-origin bootstrap, prepared ownership transfer, the live React host, appearance, window observation and recovery. It is reference application code, not a one-line public hook that makes every widget portable.

## Plan the return path

Handle popup blocking, bootstrap failure, timeout, closing the child, disposing the parent and recovering an orphaned surface. A restored layout should not automatically reopen browser windows without a fresh user gesture; the demo rehomes restored external surfaces into the main document.

Ensure styles and fonts are available in the child document. Treat a third-party canvas, editor or WebGL widget as a separate compatibility exercise. Moving a DOM host is not proof that every library supports a different document.

## What this does not promise

The current browser reference proves a controlled same-origin Chromium popup path. It does not certify arbitrary origins, unrestricted dragging beyond the browser, every popup policy, Picture-in-Picture, or every multi-screen setup.

Keep a usable fallback: leave the panel docked or float it in-page, explain the failure, and let the user try again. See the [external-surface decision](../adr/0006-prepared-external-surface-ownership.md) for the ownership model.
