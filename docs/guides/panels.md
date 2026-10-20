# Your first panel

**A panel is your component, with a little workspace vocabulary.** Register the renderer once, then create as many supported instances as your product needs.

## Register a component by type

This example uses the actual exported render-props and registry types. Add the registry entry to the `panels` object passed to your surface.

```tsx
import { useState } from "react";
import type { WorkspacePanelRegistry, WorkspacePanelRenderProps } from "@panefold/react";

function NotePanel({ panel }: WorkspacePanelRenderProps) {
  const [text, setText] = useState("");
  return (
    <textarea
      aria-label={panel.title}
      value={text}
      onChange={(event) => setText(event.target.value)}
    />
  );
}

const panels = {
  "example.note": { render: NotePanel, icon: <span aria-hidden="true">✎</span> },
} satisfies WorkspacePanelRegistry;
```

Use a meaningful panel title even with icon-only tabs. The icon supplements the accessible name; it does not replace it.

## Create an instance

A model `PanelRecord` supplies an ID, `type`, `typeVersion`, title, JSON parameters, capabilities, constraints and lifecycle policy. The starter shows a complete record and the group/node/surface records that make it visible.

The registry key must match `PanelRecord.type` exactly. Adding a renderer alone does not insert a panel into a group; adding a record alone does not create its React component.

## Choose honest capabilities

`closable`, `floatable`, `popout`, `pictureInPicture` and `singleton` express panel capabilities. Do not mark a panel popout-capable until its content and your external-window integration can support the transfer.

Constraints such as `hardMinInline`, `hardMinBlock`, `preferredInline`, `preferredBlock` and `resizeDelivery` describe what the content needs. Give a map or canvas enough space, then test the constrained layout instead of guessing from a screenshot.

## Hidden should not mean busy

The React host can remain mounted while its panel is suspended. Use `lifecycle === "suspended"` to pause rendering, polling, media and other expensive work. The supplied `lifecycleSignal` is aborted when the current lifecycle lease ends; connect cancellable work to it and also clean up your own resources.

Do not throw away unsaved document state just because the user selects another tab. Conversely, stable same-document hosts do not guarantee arbitrary third-party widgets will survive every cross-document transfer.

## Save domain data deliberately

The starter's note is component-local state: it survives ordinary same-document moves, but not a page reload. A real editor should save through your document model or a versioned checkpoint codec. Never put credentials, authorization headers or large live service objects into serializable panel parameters.

A useful acceptance test is to type an unsaved note, move it, float it, switch tabs and return. Test reload separately against your explicit document-saving policy.

## Link selections across panels

Use `createPanelContextHub` from `@panefold/ecosystem` to share small, typed context values. A map, table and inspector can follow the same entity ID. The application still owns the entities and their data.

Create a hub during session setup, not during React render. Each channel needs a pure runtime type guard. The hub validates bounded JSON data, copies it, and freezes it before delivery.

```ts
import { createPanelContextHub } from "@panefold/ecosystem";

type RoadId = `road-${number}`;
type Selection = { readonly entityId: RoadId } | null;

const hub = createPanelContextHub<{ selection: Selection }>({
  channels: {
    selection: (value): value is Selection =>
      value === null ||
      (typeof value === "object" &&
        "entityId" in value &&
        typeof value.entityId === "string" &&
        /^road-\d+$/u.test(value.entityId)),
  },
});
const map = hub.connect({ panelId: "map", groupId: "review" });
const inspector = hub.connect({ panelId: "inspector", groupId: "review" });

map.publish("selection", { entityId: "road-42" });
inspector.setMode("locked");
map.publish("selection", { entityId: "road-43" });
// The inspector still has road-42. Unlocking catches up to road-43.
inspector.setMode("follow");
```

Each panel has one membership per hub. Link groups are independent of layout groups: docking a panel does not change its link group. A late join receives that group's latest value for each channel. `setGroup` explicitly adopts the destination context, including when the panel is locked. A locked panel cannot publish. Publishing `null` clears a selection when the channel guard permits it.

The React hook observes a connection without owning it:

```tsx
import { usePanelContext } from "@panefold/react";
import type { PanelContextConnection } from "@panefold/ecosystem";

function RoadInspector({ connection }: {
  readonly connection: PanelContextConnection<{ selection: Selection }>;
}) {
  const snapshot = usePanelContext(connection);
  return <output>{snapshot.contexts.selection?.value?.entityId ?? "No selection"}</output>;
}
```

Keep the connection stable. The hook cleans up its subscription on unmount or source change. The application must call `connection.dispose()` when it removes a panel, and `hub.dispose()` when it ends the session. Removing the final member also removes that group's retained context. A hidden panel can remain connected without running expensive domain work. For server rendering, create a separate hub per request and provide matching server/client initial snapshots; the hook accepts an optional `getServerSnapshot` callback.

Events include `sourcePanelId`, `groupId`, `channel`, and a hub-local sequence. Pass the received event as `cause` when a widget reflects an incoming selection through its own change callback:

```ts
const received = inspector.getSnapshot().contexts.selection;
if (received !== undefined) {
  inspector.publish("selection", received.value, { cause: received });
  // Ignored as an echo, including after a newer selection has arrived.
}
```

Only genuine local user actions should publish without a cause. Synchronous publication from subscribers is rejected. Equivalent JSON values are also ignored. Inspect the returned `published`, `ignored`, or `rejected` result; errors do not change the context. Subscribers may read or unsubscribe during notification, but must defer other membership mutations. Subscriber failures are isolated and can be reported through the redacted `onSubscriberError` hook.

The defaults allow 32 channels, 64 groups, 256 panels and 64 subscriptions per panel. Payload limits apply separately. Group, member, subscription and payload limits can be set explicitly. No event history or unbounded notification queue is retained.

This is an experimental, same-realm extension. It does not dispatch layout commands, add layout undo entries, save documents, provide authorization, or synchronize browser tabs. Normal focus and docking operations still use workspace commands. The application owns persistence and any transport bridge.

Run the demo with `?fixture=linked`. It provides Map, Table and Inspector panels with group and lock controls. It shares sample road IDs, not a real map dataset. Reload resets the session.
