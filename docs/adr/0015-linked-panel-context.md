# ADR-0015: Application-owned panel context channels

Status: Proposed; experimental implementation.

## Context

Related panels need to follow the same entity, time position, or view target. Domain context is not workspace topology. Putting it in layout commands would mix domain history with layout undo and require the kernel to know application data types.

## Decision

Add `createPanelContextHub` to `@panefold/ecosystem`. Its generic channel schema defines application-owned value types and runtime type guards. Named link groups are independent of layout groups. A panel has one connection per hub, with explicit follow or locked mode.

The hub retains only the latest event for each channel and group. Events include a hub-local sequence, channel, source panel, group and immutable value. All following snapshots are installed before notification. Locked panels retain their snapshot and cannot publish. Unlocking catches up to current group state. An explicit group change adopts the destination context, even while locked. The final disconnect deletes the group.

Publishing validates bounded JSON input, copies and freezes it, and applies the channel guard. Expected failures return typed rejection receipts without changing context. Equivalent canonical JSON is ignored. Genuine source events can be passed as a publication cause; such reflected updates are ignored, including delayed echoes. The provenance set is weak and does not retain event history. Synchronous reentrant publication is rejected. Membership mutation during notification or validation is rejected, except for idempotent disposal and subscription cleanup.

Connections own membership. The React `usePanelContext` hook owns only a subscription through a structural external-store contract. It does not import the ecosystem implementation or register members during render. Applications must dispose connections when panels are removed and dispose the hub when the session ends. Request-scoped hubs and matching initial snapshots remain necessary for server rendering.

Group, panel, subscriber and payload limits are explicit. Subscriber exceptions cannot roll back publication or stop later subscribers. Error reporting exposes the panel ID, not retained exception objects. There is no retained queue, event history, transport, timer or global hub.

## Consequences

The semantic kernel, immutable workspace snapshots, 36-command inventory, ownership epochs, persistence schema and layout undo laws are unchanged. Context publication is not a workspace transaction. Focus or docking caused by a separate UI interaction can still commit a workspace command.

Applications retain ownership of domain documents, data access, authorization, context persistence and transport. The hub is a trusted same-realm extension, not a distributed event bus or a security boundary. Domain values should be small IDs or bounded context records. Large documents and credentials do not belong in these channels. Independent browsing should use another group or another hub.

The fixed-membership reference demo uses real workspace docking and sample road IDs. Its panels cannot close; an application with dynamic panels must connect and dispose memberships as its panel set changes. The fixture imports the source module directly because the demo's existing dependency set does not include the optional ecosystem package. The public API is exported from `@panefold/ecosystem`.

## Verification scope

Core tests cover typed channels, fan-out order, isolation, late joins, lock/unlock, group changes, payload ownership, validation failures, source-event echoes, reentrancy, listener failures, limits and disposal. A repeated lifecycle test checks that group, member and subscription counts return to zero.

React tests cover updates, StrictMode subscription cleanup, source replacement and server snapshots. Browser tests cover the linked fixture's sharing, lock/unlock and group controls. Test source is not executed evidence: use the recorded run status to identify what actually passed. These tests do not certify physical devices, assistive technologies, cross-document transfer, durable collaboration or production security.
