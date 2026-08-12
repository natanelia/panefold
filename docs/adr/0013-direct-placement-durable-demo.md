# ADR-0013: Direct placement, durable opening, and controlled popouts

- **Status:** Accepted
- **Date:** 2026-08-12
- **Scope:** Geometry, kernel planning, React projection, durable runtime opening, and Atlas surface policy

## Context

Panefold already had semantic move/split/transfer commands, geometry primitives, a drag actor, a
journal, and a prepared-surface protocol. The reference renderer and Atlas fixture did not connect
those layers into an honest product path. Tabs could not be dragged between groups or to create a
group, popup UI moved a fabricated fixture instead of the panel, persistence wrote without restoring
before runtime creation, tab chrome was fixed, and pointer resizing exposed an allocation defect.

Connecting these features inside React with model-specific IDs or mutating topology from DOM events
would create a second workspace authority. Opening a popup after an awaited boundary would also lose
browser user activation. Restoring persisted state after mounting would expose two incompatible
initial truths.

## Decision

1. Geometry publishes deterministic, mutually exclusive center and logical-edge regions derived
   from the same resolved rectangles used for rendering.
2. The React adapter owns only a bounded drag session. It captures pointer identity and the starting
   projection revision, cancels on capture loss or revision change, and asks the application for an
   immutable command-and-preview plan for each valid candidate. It retains the selected candidate's
   exact command until release.
3. The application command adapter owns policy, semantic identity allocation, and exact preview
   projection. The pure `planPanelDropCommand` selects an existing command or atomic batch; Atlas
   pure-reduces that command against the captured snapshot and solves the resulting layout to return
   the committed group rectangle. React never constructs the model command union or substitutes a
   generic half-split preview.
4. Menu and keyboard split/move routes use the same request and planner as pointer interaction.
5. Tab placement and icon/label treatment are view-only logical presentation. Applications decide
   whether to persist that preference separately from canonical topology.
6. External release calls the application handler synchronously during pointer-up. React provides
   the stable panel host and a source-document parking element explicitly. The handler returns a
   committed/rejected outcome; popup preparation alone is never announced as semantic success.
7. Atlas publishes only a controlled same-origin, portal-coupled browser-window policy. It uses
   prepared transfer plus exclusive ownership, moves the same live React host, redocks on requested
   return, and dispatches orphan recovery on unexpected loss. It does not claim cross-origin,
   Picture-in-Picture, crash, or multi-monitor support.
8. `openDurableWorkspace` verifies and replays persisted data before constructing the runtime.
   Incomplete recovery fails closed without overwriting the journal. Status observers expose the
   exact last persisted revision and cannot influence writes.

## Consequences

- One completed in-page drop remains one semantic transaction and one undo entry even when it needs
  a batch. External ownership transitions are explicit barriers with no replayable history entry.
- Preview geometry, pointer coordinates, DOM hosts, popup handles, and view preferences never become
  canonical workspace ownership.
- Stable same-document identity can survive center/edge moves and the controlled popup round trip.
- A blocked popup or stale revision keeps the source authoritative and leaves no partial topology.
- Atlas can visibly prove canonical layout restoration while explicitly excluding panel-owned
  document data unless an application checkpoint codec supplies it.
- The public React, runtime, and surface contracts changed; focused unit tests, browser E2E, this ADR,
  support boundaries, and machine evidence must move together.

## Rejected alternatives

- **DOM-owned docking state:** rejected because DOM location is a projection and cannot provide
  deterministic undo, persistence, or cross-framework semantics.
- **React allocating model IDs:** rejected because it couples a renderer to one semantic schema and
  makes retries/replay application policy implicit.
- **Move then split as two dispatches:** rejected because a single gesture would expose an
  intermediate state and consume two history entries.
- **Open popup after an async planner:** rejected because transient user activation may expire.
- **Construct default runtime, then replace with stored snapshot:** rejected because subscribers can
  observe false initial state and revision/history semantics become ambiguous.
- **Claim the controlled popup as general popout support:** rejected because browser permissions,
  origins, renderer strategy, crashes, focus, PiP, and multi-screen behavior require separate
  profiles and evidence.
