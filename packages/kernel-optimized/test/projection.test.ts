import { canonicalHash, executeCommand } from "@panefold/kernel";
import { commandId, revision, type CommandEnvelope } from "@panefold/model";
import { describe, expect, it } from "vitest";

import { OptimizedKernelProjection } from "../src/index";
import { fixtureIds, fixtureSnapshot } from "./fixtures";

describe("OptimizedKernelProjection", () => {
  it("delegates semantic application and incrementally retains untouched buckets", () => {
    const initial = fixtureSnapshot();
    const projection = OptimizedKernelProjection.create(initial, { bucketCount: 16 });
    const result = executeCommand(initial, {
      id: commandId("optimized:select"),
      origin: "application",
      label: "Select second panel",
      baseRevision: initial.revision,
      command: { type: "select-panel", panelId: fixtureIds.panels[1] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const next = projection.applyTransaction(result.transaction);
    const sharing = next.sharingFrom(projection);
    expect(canonicalHash(next.snapshot)).toBe(canonicalHash(result.next));
    expect(sharing.entities.panels).toBe(16);
    expect(sharing.entities.nodes).toBe(16);
    expect(sharing.entities.surfaces).toBe(16);
    expect(sharing.entities.groups).toBe(15);
    expect(sharing.indexes.panelGroup).toBe(16);
    expect(next.panel(fixtureIds.panels[0])).toBe(initial.panels.byId[fixtureIds.panels[0]]);
    expect(next.groupForPanel(fixtureIds.panels[1])).toBe(fixtureIds.groups[0]);
    expect(next.nodeForGroup(fixtureIds.groups[0])).toBe(fixtureIds.nodes[0]);
    expect(next.parentForNode(fixtureIds.nodes[0])).toBe(fixtureIds.nodes[2]);
    expect(next.surfaceForRoot(fixtureIds.nodes[2])).toBe(fixtureIds.surface);
    expect(next.history.last()?.commandType).toBe("select-panel");
  });

  it("updates membership indexes from the final canonical patch result", () => {
    const initial = fixtureSnapshot();
    const projection = OptimizedKernelProjection.create(initial, { bucketCount: 16 });
    const envelope: CommandEnvelope = {
      id: commandId("optimized:move"),
      origin: "application",
      label: "Move panel",
      baseRevision: initial.revision,
      command: {
        type: "move-panel",
        panelId: fixtureIds.panels[1],
        target: { groupId: fixtureIds.groups[1] },
      },
    };
    const result = executeCommand(initial, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const next = projection.applyTransaction(result.transaction);
    expect(next.groupForPanel(fixtureIds.panels[1])).toBe(fixtureIds.groups[1]);
    expect(canonicalHash(next.snapshot)).toBe(canonicalHash(result.next));

    const patchOnly = projection.applyPatches(result.patches, result.next.revision);
    expect(patchOnly.history.size).toBe(0);
    expect(canonicalHash(patchOnly.snapshot)).toBe(canonicalHash(result.next));
    expect(() =>
      patchOnly.applyPatches(result.patches, revision(result.next.revision + 1n)),
    ).toThrow(/precondition/);
  });

  it("indexes the final state when one patch batch touches an entity repeatedly", () => {
    const initial = fixtureSnapshot();
    const first = executeCommand(initial, {
      id: commandId("optimized:move-out"),
      origin: "application",
      label: "Move out",
      command: {
        type: "move-panel",
        panelId: fixtureIds.panels[1],
        target: { groupId: fixtureIds.groups[1] },
      },
    });
    if (!first.ok) throw new Error(first.error.message);
    const second = executeCommand(first.next, {
      id: commandId("optimized:move-back"),
      origin: "application",
      label: "Move back",
      command: {
        type: "move-panel",
        panelId: fixtureIds.panels[1],
        target: { groupId: fixtureIds.groups[0] },
      },
    });
    if (!second.ok) throw new Error(second.error.message);

    const projected = OptimizedKernelProjection.create(initial).applyPatches(
      [...first.patches, ...second.patches],
      second.next.revision,
    );
    expect(projected.groupForPanel(fixtureIds.panels[1])).toBe(fixtureIds.groups[0]);
    expect(canonicalHash(projected.snapshot)).toBe(canonicalHash(second.next));
  });

  it("retains completed history chunks without retaining command payloads", () => {
    let projection = OptimizedKernelProjection.create(fixtureSnapshot(), {
      historyLimit: 10,
      historyChunkSize: 2,
    });
    for (let step = 0; step < 4; step += 1) {
      const result = executeCommand(projection.snapshot, {
        id: commandId(`optimized:history:${step}`),
        origin: "application",
        label: "Select panel",
        baseRevision: projection.snapshot.revision,
        command: {
          type: "select-panel",
          panelId: fixtureIds.panels[step % fixtureIds.panels.length] ?? fixtureIds.panels[0],
        },
      });
      if (!result.ok) throw new Error(result.error.message);
      projection = projection.applyTransaction(result.transaction);
    }
    const firstChunk = projection.history.chunkIdentity(0);
    expect(projection.history.chunkCount).toBe(2);

    const result = executeCommand(projection.snapshot, {
      id: commandId("optimized:history:tail"),
      origin: "application",
      label: "Select panel",
      baseRevision: projection.snapshot.revision,
      command: { type: "select-panel", panelId: fixtureIds.panels[0] },
    });
    if (!result.ok) throw new Error(result.error.message);
    const next = projection.applyTransaction(result.transaction);
    expect(next.history.chunkIdentity(0)).toBe(firstChunk);
    expect(next.history.chunkCount).toBe(3);
    expect(Object.keys(next.history.last() ?? {})).not.toContain("command");
    expect(Object.keys(next.history.last() ?? {})).not.toContain("patches");
  });
});
