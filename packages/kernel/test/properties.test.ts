import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  commandId,
  getEntity,
  revision,
  type CommandEnvelope,
  type WorkspaceCommand,
} from "@panefold/model";
import {
  canonicalHash,
  canonicalizeWorkspace,
  executeCommand,
  normalizeWeights,
  validateWorkspace,
} from "../src/index";
import { fixtureSnapshot, ids } from "./fixtures";

describe("kernel laws", () => {
  it("normalizes every positive finite weight vector exactly", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), {
          minLength: 2,
          maxLength: 64,
        }),
        (weights) => {
          const normalized = normalizeWeights(weights);
          expect(normalized).toHaveLength(weights.length);
          expect(normalized.every((weight) => Number.isSafeInteger(weight) && weight > 0)).toBe(
            true,
          );
          expect(normalized.reduce((sum, weight) => sum + weight, 0)).toBe(1_000_000);
          expect(normalizeWeights(normalized)).toEqual(normalized);
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("keeps arbitrary valid select/reorder/resize sequences invariant-safe and replayable", () => {
    const operation = fc.oneof(
      fc.constantFrom("select-one", "select-two", "activate-three", "swap-tabs", "equalize"),
      fc.record({
        left: fc.integer({ min: 1, max: 999 }),
        right: fc.integer({ min: 1, max: 999 }),
      }),
    );
    fc.assert(
      fc.property(fc.array(operation, { minLength: 1, maxLength: 100 }), (operations) => {
        const run = () => {
          let snapshot = fixtureSnapshot();
          operations.forEach((item, index) => {
            let command: WorkspaceCommand;
            if (typeof item === "string") {
              switch (item) {
                case "select-one":
                  command = { type: "select-panel", panelId: ids.panels[0] };
                  break;
                case "select-two":
                  command = { type: "select-panel", panelId: ids.panels[1] };
                  break;
                case "activate-three":
                  command = {
                    type: "activate-panel",
                    panelId: ids.panels[2],
                    focus: "keep-focus",
                  };
                  break;
                case "swap-tabs": {
                  const current = getEntity(snapshot.groups, ids.groups[0]);
                  command = {
                    type: "reorder-panels",
                    groupId: ids.groups[0],
                    panelIds: [current?.panelIds[1] ?? ids.panels[1]],
                    beforePanelId: current?.panelIds[0] ?? ids.panels[0],
                  };
                  break;
                }
                case "equalize":
                  command = { type: "equalize-split", splitNodeId: ids.nodes[2] };
                  break;
              }
            } else {
              command = {
                type: "resize-split",
                splitNodeId: ids.nodes[2],
                weights: [item.left, item.right],
              };
            }
            const envelope: CommandEnvelope = {
              id: commandId(`generated:${index}`),
              origin: "application",
              label: command.type,
              baseRevision: snapshot.revision,
              command,
            };
            const result = executeCommand(snapshot, envelope);
            expect(result.ok).toBe(true);
            if (result.ok) snapshot = result.next;
            expect(validateWorkspace(snapshot)).toEqual([]);
          });
          return snapshot;
        };

        expect(canonicalHash(run())).toBe(canonicalHash(run()));
      }),
      { numRuns: 250 },
    );
  });

  it("canonicalization is deterministic and idempotent for arbitrary weights", () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: 1_000_000 })),
        ([left, right]) => {
          const base = fixtureSnapshot();
          const root = getEntity(base.nodes, ids.nodes[2]);
          if (root?.kind !== "split") return;
          const changed = {
            ...base,
            revision: revision(0),
            nodes: {
              ...base.nodes,
              byId: {
                ...base.nodes.byId,
                [root.id]: { ...root, weights: [left, right] },
              },
            },
          };
          const once = canonicalizeWorkspace(changed).snapshot;
          const twice = canonicalizeWorkspace(once).snapshot;
          expect(canonicalHash(twice)).toBe(canonicalHash(once));
          expect(validateWorkspace(once)).toEqual([]);
        },
      ),
      { numRuns: 500 },
    );
  });
});
