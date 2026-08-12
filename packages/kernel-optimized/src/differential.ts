import { applyTransaction, canonicalHash, executeCommand } from "@panefold/kernel";
import {
  WORKSPACE_COMMAND_TYPES,
  commandId,
  type CommandEnvelope,
  type WorkspaceCommand,
  type WorkspaceCommandType,
  type WorkspaceSnapshot,
} from "@panefold/model";

import { OptimizedKernelProjection, type OptimizedProjectionOptions } from "./projection";

export class SeededRandom {
  #state: number;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) throw new RangeError("seed must be a safe integer");
    this.#state = seed >>> 0 || 0x9e3779b9;
  }

  nextUint32(): number {
    let value = this.#state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.#state = value >>> 0;
    return this.#state;
  }

  integer(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError("maxExclusive must be a positive safe integer");
    }
    return this.nextUint32() % maxExclusive;
  }

  pick<Value>(values: readonly Value[]): Value | undefined {
    return values.length === 0 ? undefined : values[this.integer(values.length)];
  }
}

export interface DifferentialCommandContext {
  readonly step: number;
  readonly random: SeededRandom;
  readonly snapshot: WorkspaceSnapshot;
  readonly commandTypes: readonly WorkspaceCommandType[];
}

export type DifferentialCommandFactory = (context: DifferentialCommandContext) => WorkspaceCommand;

export interface DifferentialRunOptions {
  readonly initial: WorkspaceSnapshot;
  readonly seed: number;
  readonly steps: number;
  readonly generate?: DifferentialCommandFactory;
  readonly projection?: OptimizedProjectionOptions;
}

export interface DifferentialDivergence {
  readonly step: number;
  readonly commandType: WorkspaceCommandType;
  readonly referenceHash: string;
  readonly replayHash: string;
  readonly projectionHash: string;
}

export interface DifferentialRunReport {
  readonly seed: number;
  readonly steps: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly finalHash: string;
  readonly divergences: readonly DifferentialDivergence[];
  readonly projection: OptimizedKernelProjection;
}

function rotate<Value>(values: readonly Value[], offset: number): readonly Value[] {
  if (values.length === 0) return values;
  const normalized = offset % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

/**
 * Bounded deterministic generator for differential smoke tests. Rejections
 * are intentional coverage; the reference kernel alone decides validity.
 */
export const generateSeededWorkspaceCommand: DifferentialCommandFactory = ({
  random,
  snapshot,
}) => {
  const panels = snapshot.panels.ids;
  const groups = snapshot.groups.ids;
  const splitNodes = snapshot.nodes.ids.flatMap((id) => {
    const node = snapshot.nodes.byId[String(id)];
    return node?.kind === "split" ? [node] : [];
  });
  const candidates: WorkspaceCommand[] = [];

  const panelId = random.pick(panels);
  const groupId = random.pick(groups);
  if (panelId !== undefined) {
    candidates.push({ type: "select-panel", panelId });
    candidates.push({ type: "activate-panel", panelId, focus: "keep-focus" });
    if (groupId !== undefined) {
      candidates.push({ type: "move-panel", panelId, target: { groupId } });
    }
  }
  if (groupId !== undefined) {
    const group = snapshot.groups.byId[String(groupId)];
    if (group !== undefined && group.panelIds.length > 1) {
      candidates.push({
        type: "reorder-panels",
        groupId,
        panelIds: rotate(group.panelIds, 1),
      });
    }
  }
  const split = random.pick(splitNodes);
  if (split !== undefined) {
    candidates.push({ type: "equalize-split", splitNodeId: split.id });
    candidates.push({
      type: "resize-split",
      splitNodeId: split.id,
      weights: split.children.map(() => random.integer(900) + 100),
    });
    const childId = random.pick(split.children);
    if (childId !== undefined) {
      candidates.push(
        split.collapsedChildIds.includes(childId)
          ? { type: "restore-collapsed-child", splitNodeId: split.id, childNodeId: childId }
          : { type: "collapse-child", splitNodeId: split.id, childNodeId: childId },
      );
    }
  }
  return random.pick(candidates) ?? { type: "restore-workspace", snapshot };
};

/**
 * Runs semantic commands through the reference reducer, replays its committed
 * transaction through both the reference patch applier and this projection,
 * and records any hash divergence. The optimized package never reduces a
 * command itself.
 */
export function runDifferentialSequence(options: DifferentialRunOptions): DifferentialRunReport {
  if (!Number.isSafeInteger(options.steps) || options.steps < 0) {
    throw new RangeError("steps must be a non-negative safe integer");
  }
  const random = new SeededRandom(options.seed);
  const generate = options.generate ?? generateSeededWorkspaceCommand;
  let reference = options.initial;
  let projection = OptimizedKernelProjection.create(options.initial, options.projection);
  let accepted = 0;
  let rejected = 0;
  const divergences: DifferentialDivergence[] = [];

  for (let step = 0; step < options.steps; step += 1) {
    const command = generate({
      step,
      random,
      snapshot: reference,
      commandTypes: WORKSPACE_COMMAND_TYPES,
    });
    if (!WORKSPACE_COMMAND_TYPES.includes(command.type)) {
      throw new TypeError(`Differential generator returned an unknown command: ${command.type}`);
    }
    const envelope: CommandEnvelope = {
      id: commandId(`optimized-differential:${options.seed}:${step}`),
      origin: "application",
      label: `Differential ${command.type}`,
      baseRevision: reference.revision,
      command,
    };
    const result = executeCommand(reference, envelope);
    if (!result.ok) {
      rejected += 1;
      continue;
    }

    accepted += 1;
    const replay = applyTransaction(reference, result.transaction);
    projection = projection.applyTransaction(result.transaction);
    const referenceHash = canonicalHash(result.next);
    const replayHash = canonicalHash(replay);
    const projectionHash = canonicalHash(projection.snapshot);
    if (referenceHash !== replayHash || referenceHash !== projectionHash) {
      divergences.push(
        Object.freeze({
          step,
          commandType: command.type,
          referenceHash,
          replayHash,
          projectionHash,
        }),
      );
    }
    reference = result.next;
  }

  return Object.freeze({
    seed: options.seed,
    steps: options.steps,
    accepted,
    rejected,
    finalHash: canonicalHash(reference),
    divergences: Object.freeze(divergences),
    projection,
  });
}
