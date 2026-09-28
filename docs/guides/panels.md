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
