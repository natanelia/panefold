import { useEffect, useRef, useState } from "react";
import { canonicalHash } from "@panefold/kernel";
import {
  getEntity,
  type CommittedTransaction,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { useWorkspaceSnapshot, useWorkspaceTransactions } from "@panefold/react";
import type { RuntimeDispatchReceipt, WorkspaceRuntime } from "@panefold/runtime";

import { Glyph } from "./demo-panels";
import { createRedactedReproduction } from "./reproduction";
import { initialWorkspaceSnapshot } from "./workspace-config";

type InspectorTab = "topology" | "transactions" | "focus";

export function WorkspaceInspector({
  runtime,
  onClose,
}: {
  readonly runtime: WorkspaceRuntime;
  readonly onClose: () => void;
}) {
  const snapshot = useWorkspaceSnapshot<
    WorkspaceSnapshot,
    WorkspaceCommand,
    RuntimeDispatchReceipt
  >();
  const transactions = useWorkspaceTransactions<
    WorkspaceSnapshot,
    WorkspaceCommand,
    RuntimeDispatchReceipt
  >() as readonly CommittedTransaction[];
  const [tab, setTab] = useState<InspectorTab>("topology");

  return (
    <aside className="demo-inspector" aria-label="Workspace inspector">
      <header>
        <div>
          <span className="demo-kicker">Developer tools</span>
          <strong>Workspace inspector</strong>
        </div>
        <button type="button" aria-label="Close workspace inspector" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="demo-inspector-tabs" role="tablist" aria-label="Inspector views">
        {(["topology", "transactions", "focus"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              setTab(value);
            }}
          >
            {value[0]?.toUpperCase()}
            {value.slice(1)}
          </button>
        ))}
      </div>
      <div className="demo-inspector-content">
        {tab === "topology" ? <TopologyInspector snapshot={snapshot} /> : null}
        {tab === "transactions" ? <TransactionInspector transactions={transactions} /> : null}
        {tab === "focus" ? <FocusInspector snapshot={snapshot} /> : null}
      </div>
      <footer>
        <button
          type="button"
          onClick={() => {
            void copyReproduction(runtime);
          }}
        >
          Copy redacted reproduction
        </button>
        <span>Observational only</span>
      </footer>
    </aside>
  );
}

function TopologyInspector({ snapshot }: { readonly snapshot: WorkspaceSnapshot }) {
  const roots = snapshot.surfaces.ids
    .map((id) => getEntity(snapshot.surfaces, id))
    .filter((item) => item !== undefined);
  return (
    <div className="demo-inspector-section">
      <InspectorMetric label="Revision" value={snapshot.revision.toString()} />
      <InspectorMetric label="Canonical hash" value={canonicalHash(snapshot)} />
      <h3>Surface roots</h3>
      {roots.map((surface) => (
        <div key={surface.id} className="demo-inspector-card">
          <span className="demo-plane-badge plane-semantic">{surface.kind}</span>
          <strong>{surface.id}</strong>
          <code>root → {surface.rootNodeId}</code>
        </div>
      ))}
      <h3>Layout tree</h3>
      <ul className="demo-topology-tree">
        {snapshot.nodes.ids.map((id) => {
          const node = getEntity(snapshot.nodes, id);
          if (node === undefined) return null;
          return (
            <li key={id}>
              <span>{node.kind === "split" ? "◇" : "▣"}</span>
              <div>
                <strong>{node.id}</strong>
                <small>
                  {node.kind === "split"
                    ? `${node.axis} · ${node.weights.join(" / ")}`
                    : `group → ${node.groupId}`}
                </small>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TransactionInspector({
  transactions,
}: {
  readonly transactions: readonly CommittedTransaction[];
}) {
  return (
    <div className="demo-inspector-section">
      <InspectorMetric label="Committed" value={String(transactions.length)} />
      <h3>Latest transactions</h3>
      {transactions.length === 0 ? (
        <p className="demo-muted">
          Resize a pane, select a tab, or move a panel to see atomic transactions.
        </p>
      ) : (
        <ol className="demo-transaction-list">
          {[...transactions]
            .reverse()
            .slice(0, 20)
            .map((transaction) => (
              <li key={transaction.id}>
                <span className={`demo-origin origin-${transaction.origin}`}>
                  {transaction.origin}
                </span>
                <div>
                  <strong>{transaction.label}</strong>
                  <small>
                    rev {transaction.previousRevision.toString()} →{" "}
                    {transaction.revision.toString()} · {transaction.patches.length} patches
                  </small>
                </div>
              </li>
            ))}
        </ol>
      )}
    </div>
  );
}

function FocusInspector({ snapshot }: { readonly snapshot: WorkspaceSnapshot }) {
  const activePanel =
    snapshot.activation.activePanelId === undefined
      ? undefined
      : getEntity(snapshot.panels, snapshot.activation.activePanelId);
  return (
    <div className="demo-inspector-section">
      <h3>Semantic focus state</h3>
      <div className="demo-focus-flow">
        <span>Selected per group</span>
        <i>→</i>
        <span className="current">{activePanel?.title ?? "No active panel"}</span>
        <i>→</i>
        <span>DOM descendant</span>
      </div>
      <dl className="demo-inspector-dl">
        <div>
          <dt>Active panel</dt>
          <dd>{activePanel?.id ?? "—"}</dd>
        </div>
        <div>
          <dt>Active surface</dt>
          <dd>{snapshot.activation.activeSurfaceId ?? "—"}</dd>
        </div>
        <div>
          <dt>Focus fallback</dt>
          <dd>{snapshot.focusMemory.fallback}</dd>
        </div>
        <div>
          <dt>Restoration token</dt>
          <dd>{snapshot.focusMemory.restorationToken ?? "not supplied"}</dd>
        </div>
      </dl>
      <h3>Selected panels</h3>
      {snapshot.groups.ids.map((id) => {
        const group = getEntity(snapshot.groups, id);
        return group === undefined ? null : (
          <div key={id} className="demo-inspector-card">
            <strong>{group.region ?? group.id}</strong>
            <code>{group.selectedPanelId}</code>
          </div>
        );
      })}
    </div>
  );
}

function InspectorMetric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="demo-inspector-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function CommandPalette({
  runtime,
  snapshot,
  onClose,
}: {
  readonly runtime: WorkspaceRuntime;
  readonly snapshot: WorkspaceSnapshot;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const panels = snapshot.panels.ids
    .map((id) => getEntity(snapshot.panels, id))
    .filter((item) => item !== undefined);
  const matches = panels.filter((panel) =>
    (panel.title ?? panel.type).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div
      className="demo-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="demo-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Workspace command palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <label>
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Find a panel or command…"
          />
        </label>
        <div className="demo-command-results">
          <p>Panels</p>
          {matches.map((panel) => (
            <button
              key={panel.id}
              type="button"
              onClick={() => {
                runtime.dispatch(
                  { type: "select-panel", panelId: panel.id, activate: true },
                  { origin: "menu", label: `Selected ${panel.title ?? panel.type}` },
                );
                onClose();
              }}
            >
              <span className="demo-command-icon">
                <Glyph name={glyphForPanel(panel.type)} />
              </span>
              <span>
                <strong>{panel.title ?? panel.type}</strong>
                <small>Focus panel</small>
              </span>
              <kbd>Enter</kbd>
            </button>
          ))}
          <p>Workspace</p>
          <button
            type="button"
            disabled={!runtime.canUndo()}
            onClick={() => {
              runtime.undo();
              onClose();
            }}
          >
            <span className="demo-command-icon">↶</span>
            <span>
              <strong>Undo layout change</strong>
              <small>Restore the previous canonical arrangement</small>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              runtime.dispatch(
                { type: "restore-workspace", snapshot: initialWorkspaceSnapshot },
                { origin: "restore", label: "Restore map operations preset" },
              );
              onClose();
            }}
          >
            <span className="demo-command-icon">⌂</span>
            <span>
              <strong>Restore map operations preset</strong>
              <small>Return to the initial four-region layout</small>
            </span>
          </button>
        </div>
        <footer>
          <span>
            <kbd>Tab</kbd> Navigate
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </footer>
      </section>
    </div>
  );
}

function glyphForPanel(type: string): Parameters<typeof Glyph>[0]["name"] {
  if (type.includes("route")) return "route";
  if (type.includes("layers")) return "layers";
  if (type.includes("canvas")) return "map";
  if (type.includes("notes")) return "notes";
  if (type.includes("inspector")) return "inspect";
  if (type.includes("validation")) return "validate";
  if (type.includes("problems")) return "problems";
  return "timeline";
}

async function copyReproduction(runtime: WorkspaceRuntime) {
  const reproduction = createRedactedReproduction(runtime, document.dir || "ltr");
  await navigator.clipboard.writeText(JSON.stringify(reproduction, null, 2));
}
