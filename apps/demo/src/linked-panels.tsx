import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { solveLayout } from "@panefold/geometry";
import {
  MAIN_SURFACE_CAPABILITIES,
  createWorkspaceSnapshot,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type PanelRecord,
  type WorkspaceSnapshot,
} from "@panefold/model";
import {
  WorkspaceRuntimeProvider,
  WorkspaceSurface,
  usePanelContext,
  type WorkspaceLayoutSolver,
  type WorkspacePanelRegistry,
  type WorkspacePanelRenderProps,
} from "@panefold/react";
import { createWorkspaceRuntime, type WorkspaceRuntime } from "@panefold/runtime";
// This source-only fixture consumes the same implementation exported by @panefold/ecosystem.
import {
  createPanelContextHub,
  type PanelContextConnection,
} from "../../../packages/ecosystem/src/panel-context";
import { createDemoCommands, projectWorkspace } from "./workspace-config";
import "./docs-starter.css";

type RoadId = "road-1" | "road-2" | "road-3";
interface LinkedContexts {
  readonly selection: { readonly roadId: RoadId } | null;
}
type Connections = ReadonlyMap<string, PanelContextConnection<LinkedContexts>>;
const roadIds: readonly RoadId[] = ["road-1", "road-2", "road-3"];
const descriptions = [
  { id: "linked-map", title: "Map" },
  { id: "linked-table", title: "Table" },
  { id: "linked-inspector", title: "Inspector" },
] as const;
const initialSnapshot = createWorkspaceSnapshot({
  applicationLayoutVersion: 1,
  panels: descriptions.map<PanelRecord>(({ id, title }) => ({
    id: panelId(id),
    type: "linked.selection",
    typeVersion: 1,
    title,
    parameters: {},
    capabilities: {
      closable: false,
      floatable: true,
      popout: false,
      pictureInPicture: false,
      singleton: true,
    },
    constraints: { hardMinInline: 160, hardMinBlock: 220 },
    lifecycle: {
      hidden: "suspend",
      sameDocumentMove: "preserve-host",
      crossDocumentMove: "unsupported",
    },
  })),
  groups: descriptions.map(({ id }) => ({
    id: groupId(`${id}-group`),
    panelIds: [panelId(id)],
    selectedPanelId: panelId(id),
    persistent: true,
  })),
  nodes: [
    {
      kind: "split",
      id: nodeId("linked-root"),
      axis: "inline",
      children: descriptions.map(({ id }) => nodeId(`${id}-node`)),
      weights: [400_000, 300_000, 300_000],
      collapsedChildIds: [],
    },
    ...descriptions.map(({ id }) => ({
      kind: "group" as const,
      id: nodeId(`${id}-node`),
      groupId: groupId(`${id}-group`),
    })),
  ],
  surfaces: [
    {
      id: surfaceId("main"),
      kind: "main",
      rootNodeId: nodeId("linked-root"),
      capabilities: MAIN_SURFACE_CAPABILITIES,
      maximized: false,
    },
  ],
  activation: { activePanelId: panelId("linked-map"), activeSurfaceId: surfaceId("main") },
  focusMemory: { panelId: panelId("linked-map"), fallback: "panel-root" },
});
const ConnectionsContext = createContext<Connections | null>(null);
const panels: WorkspacePanelRegistry = { "linked.selection": { render: LinkedPanel } };
const layoutSolver: WorkspaceLayoutSolver<WorkspaceSnapshot> = (snapshot, request) =>
  solveLayout(snapshot, nodeId(request.rootNodeId), request.bounds, {
    splitterSize: request.splitterSize,
    splitOverrides: request.splitOverrides,
  });

function LinkedPanel({ panel }: WorkspacePanelRenderProps) {
  const connections = useContext(ConnectionsContext);
  const connection = connections?.get(panel.id);
  if (connection === undefined) throw new Error("Linked panel connection is missing");
  return <LinkedPanelContent title={panel.title} connection={connection} />;
}
interface LinkedPanelContentProps {
  readonly title: string;
  readonly connection: PanelContextConnection<LinkedContexts>;
}
function LinkedPanelContent({ title, connection }: LinkedPanelContentProps) {
  const snapshot = usePanelContext(connection);
  const event = snapshot.contexts.selection;
  const [notice, setNotice] = useState("");
  return (
    <section className="starter-panel" aria-label={`${title} linked content`}>
      <h2>{title}</h2>
      <label>
        Link group
        <select
          aria-label={`${title} link group`}
          value={snapshot.groupId}
          onChange={(change) => connection.setGroup(change.target.value)}
        >
          <option value="review-a">Review A</option>
          <option value="review-b">Review B</option>
        </select>
      </label>
      <button
        type="button"
        aria-label={`${title} lock selection`}
        aria-pressed={snapshot.mode === "locked"}
        onClick={() => connection.setMode(snapshot.mode === "locked" ? "follow" : "locked")}
      >
        {snapshot.mode === "locked" ? "Follow group" : "Lock selection"}
      </button>
      <p>{snapshot.mode === "locked" ? "Selection is locked." : "Following this group."}</p>
      <label>
        Selected road
        <select
          aria-label={`${title} road`}
          value={event?.value?.roadId ?? ""}
          disabled={snapshot.mode === "locked"}
          onChange={(change) => {
            const selected = roadIds.find((id) => id === change.target.value);
            const result = connection.publish(
              "selection",
              selected === undefined ? null : { roadId: selected },
            );
            if (result.status === "rejected") {
              setNotice(`Selection not changed: ${result.reason}`);
            } else {
              setNotice("");
            }
          }}
        >
          <option value="">None</option>
          {roadIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <output aria-label={`${title} selected road`}>{event?.value?.roadId ?? "None"}</output>
      <p>Source: {event?.sourcePanelId ?? "No selection"}</p>
      <p role="status">{notice}</p>
    </section>
  );
}

interface Session {
  readonly runtime: WorkspaceRuntime;
  readonly connections: Connections;
}
function isSelection(value: unknown): value is LinkedContexts["selection"] {
  return (
    value === null ||
    (typeof value === "object" &&
      "roadId" in value &&
      roadIds.some((id) => id === value.roadId))
  );
}
export default function LinkedPanelsWorkspace() {
  const [session, setSession] = useState<Session>();
  useEffect(() => {
    const runtime = createWorkspaceRuntime({ initialSnapshot, historyLimit: 50 });
    const hub = createPanelContextHub<LinkedContexts>({ channels: { selection: isSelection } });
    const connections = new Map<string, PanelContextConnection<LinkedContexts>>(
      descriptions.map(({ id }) => [id, hub.connect({ panelId: id, groupId: "review-a" })]),
    );
    connections.get("linked-map")?.publish("selection", { roadId: "road-1" });
    setSession({ runtime, connections });
    return () => {
      hub.dispose();
      runtime.dispose();
    };
  }, []);
  return (
    <main className="starter-app">
      <div className="starter-container">
        <p className="starter-kicker">Experimental · Application-owned context</p>
        <h1>Linked panels</h1>
        <p className="starter-lead">
          Select a road in any panel. Lock the Inspector, then select another road. Follow the group
          to catch up, or choose a separate link group.
        </p>
        {session ? (
          <ConnectionsContext.Provider value={session.connections}>
            <WorkspaceRuntimeProvider runtime={session.runtime}>
              <LinkedSurface runtime={session.runtime} />
            </WorkspaceRuntimeProvider>
          </ConnectionsContext.Provider>
        ) : (
          <p role="status">Starting linked workspace…</p>
        )}
        <p className="starter-footnote">
          This fixture demonstrates shared IDs, not a map renderer. Context is in memory only.
          Context publication does not change layout history. Focus and docking still use workspace
          commands. Dock and float the panels with their Actions menus. Reload resets the session.
        </p>
      </div>
    </main>
  );
}
function LinkedSurface({ runtime }: { readonly runtime: WorkspaceRuntime }) {
  const commands = useMemo(() => createDemoCommands(runtime.getSnapshot), [runtime]);
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  return (
    <>
      <p>
        Layout revision: <output aria-label="Layout revision">{snapshot.revision.toString()}</output>
      </p>
      <WorkspaceSurface
        projector={projectWorkspace}
        commands={commands}
        panels={panels}
        layoutSolver={layoutSolver}
        className="starter-surface"
        workspaceLabel="Linked workspace"
        motion="off"
      />
    </>
  );
}
