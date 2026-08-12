import {
  applyPatches,
  applyTransaction,
  canonicalHash,
  canonicalSerialize,
  executeCommand,
  invertPatches,
} from "@panefold/kernel";
import {
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  WORKSPACE_COMMAND_TYPES,
  closedPanelId,
  commandId,
  groupId as createGroupId,
  nodeId as createNodeId,
  panelId as createPanelId,
  surfaceId as createSurfaceId,
  type CommandEnvelope,
  type GroupRecord,
  type KernelResult,
  type PanelId,
  type SurfaceRecord,
  type WorkspaceCommand,
  type WorkspaceCommandType,
  type WorkspaceSnapshot,
} from "@panefold/model";

import { PHASE_ONE_CANDIDATE_PROVENANCE } from "./candidate-provenance";
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

  /** Serializable xorshift state for deterministic campaign checkpoints. */
  get state(): number {
    return this.#state;
  }

  static fromState(state: number): SeededRandom {
    if (!Number.isSafeInteger(state) || state <= 0 || state > 0xffff_ffff) {
      throw new RangeError("random state must be a non-zero uint32");
    }
    const random = new SeededRandom(1);
    random.#state = state;
    return random;
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
  readonly generatorId?: string;
  readonly projection?: OptimizedProjectionOptions;
  /** Optional independently reducing implementation under test. */
  readonly candidate?: DifferentialKernelImplementation;
}

/** A pure candidate port used by the built-in independent semantic reducer. */
export interface DifferentialKernelImplementation {
  readonly id: string;
  readonly independent: boolean;
  /**
   * Built-in implementations bind this opaque provenance marker. External
   * callers cannot self-attest Phase-1 eligibility with `independent: true`.
   */
  readonly phaseOneProvenance?: symbol;
  execute(snapshot: WorkspaceSnapshot, envelope: CommandEnvelope): KernelResult;
}

export interface DifferentialDivergence {
  readonly step: number;
  readonly commandType: WorkspaceCommandType;
  readonly kind?: DifferentialDivergenceKind;
  readonly referenceHash: string;
  readonly replayHash: string;
  readonly projectionHash: string;
  readonly inverseHash?: string;
  readonly candidateHash?: string;
  readonly message?: string;
}

export type DifferentialDivergenceKind =
  | "patch-replay"
  | "inverse-patch-replay"
  | "optimized-projection"
  | "candidate-outcome"
  | "candidate-rejection"
  | "candidate-contract"
  | "candidate-state"
  | "candidate-exception";

export interface DifferentialRunReport {
  readonly seed: number;
  readonly steps: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly finalHash: string;
  readonly divergences: readonly DifferentialDivergence[];
  readonly projection: OptimizedKernelProjection;
  readonly commandCounts?: Readonly<Partial<Record<WorkspaceCommandType, number>>>;
  readonly candidate?: Readonly<{ readonly id: string; readonly independent: boolean }>;
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
    const source = snapshot.groups.ids
      .map((id) => snapshot.groups.byId[String(id)])
      .find((group) => group?.panelIds.includes(panelId) === true);
    const targetGroups = groups.filter((id) => id !== source?.id);
    const targetGroupId = random.pick(targetGroups);
    if (source !== undefined && source.panelIds.length > 1 && targetGroupId !== undefined) {
      candidates.push({ type: "move-panel", panelId, target: { groupId: targetGroupId } });
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

function generatedId(kind: string, step: number): string {
  return `differential:${kind}:${String(step)}`;
}

function liveGroups(snapshot: WorkspaceSnapshot): readonly GroupRecord[] {
  return snapshot.groups.ids.flatMap((id) => {
    const group = snapshot.groups.byId[String(id)];
    return group === undefined ? [] : [group];
  });
}

function liveSurfaces(snapshot: WorkspaceSnapshot): readonly SurfaceRecord[] {
  return snapshot.surfaces.ids.flatMap((id) => {
    const surface = snapshot.surfaces.byId[String(id)];
    return surface === undefined ? [] : [surface];
  });
}

function groupForPanel(
  groups: readonly GroupRecord[],
  panelId: PanelId | undefined,
): GroupRecord | undefined {
  return panelId === undefined
    ? undefined
    : groups.find((group) => group.panelIds.includes(panelId));
}

/**
 * Deterministically attempts every public command discriminant. Commands with
 * unavailable prerequisites are intentionally rejected by the kernel, which
 * keeps rejection semantics inside the same differential oracle.
 */
export const generateCatalogWorkspaceCommand: DifferentialCommandFactory = (context) => {
  const { snapshot, step, random, commandTypes } = context;
  const commandType = commandTypes[step % commandTypes.length];
  if (commandType === undefined) throw new RangeError("Workspace command catalog is empty");
  const groups = liveGroups(snapshot);
  const surfaces = liveSurfaces(snapshot);
  const panels = snapshot.panels.ids;
  const panelId = random.pick(panels);
  const sourceGroup = groupForPanel(groups, panelId);
  const firstGroup = groups[0];
  const otherGroup = groups.find((group) => group.id !== sourceGroup?.id) ?? groups[1];
  const split = snapshot.nodes.ids
    .map((id) => snapshot.nodes.byId[String(id)])
    .find((node) => node?.kind === "split");
  const floating = surfaces.find((surface) => surface.kind === "floating");
  const external = surfaces.find(
    (surface) => surface.kind === "browser-window" || surface.kind === "document-pip",
  );
  const main = surfaces.find((surface) => surface.kind === "main") ?? surfaces[0];
  const targetGroupId =
    otherGroup?.id ?? firstGroup?.id ?? createGroupId(generatedId("missing-group", step));
  const selectedPanelId = panelId ?? createPanelId(generatedId("missing-panel", step));
  const newPanelId = createPanelId(generatedId("panel", step));
  const newGroupId = createGroupId(generatedId("group", step));
  const newGroupNodeId = createNodeId(generatedId("group-node", step));
  const newSplitNodeId = createNodeId(generatedId("split-node", step));
  const newSurfaceId = createSurfaceId(generatedId("surface", step));
  const selectedSurface = floating ?? external ?? main;
  const selectedSurfaceId =
    selectedSurface?.id ?? createSurfaceId(generatedId("missing-surface", step));
  const splitNodeId = split?.id ?? createNodeId(generatedId("missing-split", step));
  const splitChildId =
    random.pick(split?.children ?? []) ?? createNodeId(generatedId("missing-child", step));
  const closedTarget = (id: PanelId, suffix: string) => ({
    panelId: id,
    closedPanelId: closedPanelId(generatedId(`closed-${suffix}`, step)),
  });

  switch (commandType) {
    case "batch":
      return {
        type: commandType,
        commands: [{ type: "select-panel", panelId: selectedPanelId }],
      };
    case "open-panel":
      return {
        type: commandType,
        panel: {
          id: newPanelId,
          type: "differential.panel",
          typeVersion: 1,
          parameters: { seed: step },
          capabilities: DEFAULT_PANEL_CAPABILITIES,
          constraints: { hardMinInline: 48, hardMinBlock: 32 },
          lifecycle: DEFAULT_PANEL_LIFECYCLE,
        },
        placement: { groupId: targetGroupId },
      };
    case "duplicate-panel":
      return {
        type: commandType,
        panelId: selectedPanelId,
        duplicatePanelId: newPanelId,
        placement: { groupId: targetGroupId },
      };
    case "close-panels":
      return { type: commandType, targets: [closedTarget(selectedPanelId, "one")] };
    case "close-other-panels": {
      const group = sourceGroup ?? firstGroup;
      const exceptPanelId = group?.selectedPanelId ?? selectedPanelId;
      return {
        type: commandType,
        groupId: group?.id ?? targetGroupId,
        exceptPanelId,
        targets: (group?.panelIds ?? [])
          .filter((id) => id !== exceptPanelId)
          .map((id, index) => closedTarget(id, `other-${String(index)}`)),
      };
    }
    case "close-panels-to-right": {
      const group = sourceGroup ?? firstGroup;
      const anchor = group?.selectedPanelId ?? selectedPanelId;
      const anchorIndex = group?.panelIds.indexOf(anchor) ?? -1;
      return {
        type: commandType,
        groupId: group?.id ?? targetGroupId,
        panelId: anchor,
        targets: (group?.panelIds.slice(anchorIndex + 1) ?? []).map((id, index) =>
          closedTarget(id, `right-${String(index)}`),
        ),
      };
    }
    case "reopen-panel":
      return {
        type: commandType,
        closedPanelId:
          random.pick(snapshot.recoverableClosedPanels)?.id ??
          closedPanelId(generatedId("missing-closed", step)),
      };
    case "select-panel":
      return { type: commandType, panelId: selectedPanelId };
    case "activate-panel":
      return { type: commandType, panelId: selectedPanelId, focus: "keep-focus" };
    case "reorder-panels": {
      const group = sourceGroup ?? firstGroup;
      return {
        type: commandType,
        groupId: group?.id ?? targetGroupId,
        panelIds: rotate(group?.panelIds ?? [selectedPanelId], 1),
      };
    }
    case "move-panel":
      return { type: commandType, panelId: selectedPanelId, target: { groupId: targetGroupId } };
    case "move-group":
      return {
        type: commandType,
        groupId: sourceGroup?.id ?? firstGroup?.id ?? targetGroupId,
        targetGroupId,
        edge: "inline-end",
        splitNodeId: newSplitNodeId,
        ratio: 0.5,
      };
    case "split-group":
      return {
        type: commandType,
        targetGroupId: sourceGroup?.id ?? firstGroup?.id ?? targetGroupId,
        panelIds:
          sourceGroup?.panelIds.length && sourceGroup.panelIds.length > 1 ? [selectedPanelId] : [],
        newGroupId,
        newGroupNodeId,
        splitNodeId: newSplitNodeId,
        edge: "inline-end",
        ratio: 0.5,
      };
    case "merge-groups":
      return {
        type: commandType,
        sourceGroupId: sourceGroup?.id ?? firstGroup?.id ?? targetGroupId,
        target: { groupId: targetGroupId },
      };
    case "swap-groups":
      return {
        type: commandType,
        firstGroupId: sourceGroup?.id ?? firstGroup?.id ?? targetGroupId,
        secondGroupId: targetGroupId,
      };
    case "resize-split":
      return {
        type: commandType,
        splitNodeId,
        weights: split?.children.map(() => random.integer(900) + 100) ?? [1, 1],
      };
    case "equalize-split":
      return { type: commandType, splitNodeId };
    case "collapse-child":
      return { type: commandType, splitNodeId, childNodeId: splitChildId };
    case "restore-collapsed-child":
      return {
        type: commandType,
        splitNodeId,
        childNodeId: random.pick(split?.collapsedChildIds ?? []) ?? splitChildId,
      };
    case "create-floating-surface":
      return {
        type: commandType,
        groupId: sourceGroup?.id ?? firstGroup?.id ?? targetGroupId,
        surfaceId: newSurfaceId,
        bounds: { x: 20, y: 20, width: 480, height: 320 },
      };
    case "move-floating-surface":
      return { type: commandType, surfaceId: selectedSurfaceId, x: 30, y: 40 };
    case "resize-floating-surface":
      return {
        type: commandType,
        surfaceId: selectedSurfaceId,
        bounds: { x: 30, y: 40, width: 520, height: 360 },
      };
    case "raise-surface":
      return { type: commandType, surfaceId: selectedSurfaceId };
    case "maximize-surface":
      return { type: commandType, surfaceId: selectedSurfaceId };
    case "restore-surface":
      return { type: commandType, surfaceId: selectedSurfaceId };
    case "minimize-surface":
      return { type: commandType, surfaceId: selectedSurfaceId };
    case "transfer-to-browser-window":
      return {
        type: commandType,
        groupId: sourceGroup?.id ?? firstGroup?.id ?? targetGroupId,
        surfaceId: newSurfaceId,
        ownerEpoch: 1,
        preparedSurfaceToken: generatedId("prepared-surface", step),
      };
    case "redock-surface":
      return {
        type: commandType,
        surfaceId: selectedSurfaceId,
        target: { groupId: targetGroupId },
        ...(selectedSurface?.ownerEpoch === undefined
          ? {}
          : { expectedOwnerEpoch: selectedSurface.ownerEpoch }),
      };
    case "move-to-picture-in-picture":
      return {
        type: commandType,
        panelId: selectedPanelId,
        newGroupId,
        newGroupNodeId,
        surfaceId: newSurfaceId,
        ownerEpoch: 1,
        capabilityToken: generatedId("pip-capability", step),
        mode: "move",
      };
    case "apply-workspace-preset":
      return {
        type: commandType,
        presetId: generatedId("preset", step),
        snapshot,
        mode: "replace",
      };
    case "restore-workspace":
      return { type: commandType, snapshot };
    case "import-workspace":
      return { type: commandType, snapshot, mode: "replace", source: "differential-campaign" };
    case "undo-workspace-operation":
      return { type: commandType };
    case "redo-workspace-operation":
      return { type: commandType };
    case "apply-remote-transaction":
      return {
        type: commandType,
        transactionId: generatedId("remote-transaction", step),
        actorId: "differential-actor",
        surfaceId: selectedSurfaceId,
        ownerEpoch: selectedSurface?.ownerEpoch ?? 0,
        command: { type: "select-panel", panelId: selectedPanelId },
      };
    case "recover-orphaned-surface":
      return {
        type: commandType,
        surfaceId: external?.id ?? selectedSurfaceId,
        expectedOwnerEpoch: external?.ownerEpoch ?? selectedSurface?.ownerEpoch ?? 0,
        targetGroupId,
        edge: "inline-end",
        splitNodeId: newSplitNodeId,
        ratio: 0.5,
      };
  }
};

/** Mixes broad catalog coverage into the stable stateful workload. */
export const generateComprehensiveWorkspaceCommand: DifferentialCommandFactory = (context) =>
  context.step % 16 === 0
    ? generateCatalogWorkspaceCommand({ ...context, step: Math.floor(context.step / 16) })
    : generateSeededWorkspaceCommand(context);

export const MODEL_GENERATED_OPERATION_TARGET = 10_000_000;

export interface DifferentialCampaignOptions {
  readonly initial: WorkspaceSnapshot;
  readonly seed: number;
  readonly generate?: DifferentialCommandFactory;
  /** Stable identity for custom generator code included in evidence reports. */
  readonly generatorId?: string;
  readonly projection?: OptimizedProjectionOptions;
  readonly candidate?: DifferentialKernelImplementation;
  /** Bounds retained failure detail without hiding the total divergence count. */
  readonly maxStoredDivergences?: number;
}

export interface DifferentialCampaignReport {
  readonly schemaVersion: 1;
  readonly runner: "panefold-differential-campaign";
  readonly seed: number;
  readonly generatorId: string;
  readonly randomAlgorithm: "xorshift32";
  readonly randomState: number;
  readonly initialHash: string;
  readonly completedSteps: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly finalHash: string;
  readonly divergenceCount: number;
  readonly divergences: readonly DifferentialDivergence[];
  readonly commandCounts: Readonly<Partial<Record<WorkspaceCommandType, number>>>;
  readonly acceptedCommandCounts: Readonly<Partial<Record<WorkspaceCommandType, number>>>;
  readonly rejectedCommandCounts: Readonly<Partial<Record<WorkspaceCommandType, number>>>;
  readonly generatedCommandTypes: readonly WorkspaceCommandType[];
  readonly missingCommandTypes: readonly WorkspaceCommandType[];
  readonly implementation: {
    readonly reference: "@panefold/kernel.executeCommand";
    readonly candidateId: string;
    readonly independentCandidate: boolean;
  };
  readonly checks: {
    readonly invariantValidation: "every-attempt";
    readonly committedPatchReplay: number;
    readonly inversePatchReplay: number;
    readonly optimizedProjectionReplay: number;
    readonly candidateComparisons: number;
  };
  readonly thresholds: {
    readonly generatedOperationTarget: typeof MODEL_GENERATED_OPERATION_TARGET;
    readonly generatedOperationTargetMet: boolean;
  };
  /** This runner cannot satisfy Phase 1 without an independently reducing candidate. */
  readonly phaseOneDifferentialEligible: boolean;
  readonly status: "passed" | "diverged";
}

function validatedCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function candidateDescriptor(candidate: DifferentialKernelImplementation | undefined): {
  readonly id: string;
  readonly independent: boolean;
  readonly phaseOneEligible: boolean;
} {
  return candidate === undefined
    ? {
        id: "@panefold/kernel-optimized.patch-projection",
        independent: false,
        phaseOneEligible: false,
      }
    : {
        id: candidate.id,
        independent: candidate.independent,
        phaseOneEligible:
          candidate.independent && candidate.phaseOneProvenance === PHASE_ONE_CANDIDATE_PROVENANCE,
      };
}

/**
 * Stateful, chunkable differential campaign. Calling `runChunk` repeatedly
 * continues the same random stream and command sequence, allowing long runs
 * to yield between chunks without weakening per-command checks.
 */
export class DifferentialCampaign {
  readonly #seed: number;
  readonly #generatorId: string;
  readonly #initialHash: string;
  readonly #random: SeededRandom;
  readonly #generate: DifferentialCommandFactory;
  readonly #candidate: DifferentialKernelImplementation | undefined;
  readonly #maxStoredDivergences: number;
  readonly #commandCounts: Partial<Record<WorkspaceCommandType, number>> = {};
  readonly #acceptedCommandCounts: Partial<Record<WorkspaceCommandType, number>> = {};
  readonly #rejectedCommandCounts: Partial<Record<WorkspaceCommandType, number>> = {};
  readonly #divergences: DifferentialDivergence[] = [];
  #reference: WorkspaceSnapshot;
  #candidateSnapshot: WorkspaceSnapshot;
  #projection: OptimizedKernelProjection;
  #completedSteps = 0;
  #accepted = 0;
  #rejected = 0;
  #divergenceCount = 0;
  #committedPatchReplayChecks = 0;
  #inversePatchReplayChecks = 0;
  #optimizedProjectionReplayChecks = 0;
  #candidateComparisons = 0;

  public constructor(options: DifferentialCampaignOptions) {
    this.#seed = options.seed;
    this.#random = new SeededRandom(options.seed);
    this.#generate = options.generate ?? generateComprehensiveWorkspaceCommand;
    this.#generatorId =
      options.generatorId ??
      (options.generate === undefined
        ? "panefold.comprehensive-workspace.v1"
        : "custom-unspecified");
    if (this.#generatorId.trim().length === 0) {
      throw new TypeError("generatorId must be non-empty");
    }
    this.#initialHash = canonicalHash(options.initial);
    this.#candidate = options.candidate;
    this.#maxStoredDivergences = validatedCount(
      options.maxStoredDivergences ?? 32,
      "maxStoredDivergences",
    );
    this.#reference = options.initial;
    this.#candidateSnapshot = options.initial;
    this.#projection = OptimizedKernelProjection.create(options.initial, options.projection);
  }

  /** Stops at the first divergence so later commands cannot mask its cause. */
  public runChunk(steps: number): DifferentialCampaignReport {
    validatedCount(steps, "steps");
    for (let offset = 0; offset < steps && this.#divergenceCount === 0; offset += 1) {
      this.#runStep();
    }
    return this.report();
  }

  public report(): DifferentialCampaignReport {
    const generatedCommandTypes = WORKSPACE_COMMAND_TYPES.filter(
      (type) => (this.#commandCounts[type] ?? 0) > 0,
    );
    const missingCommandTypes = WORKSPACE_COMMAND_TYPES.filter(
      (type) => (this.#commandCounts[type] ?? 0) === 0,
    );
    const candidate = candidateDescriptor(this.#candidate);
    const passed = this.#divergenceCount === 0;
    return Object.freeze({
      schemaVersion: 1 as const,
      runner: "panefold-differential-campaign" as const,
      seed: this.#seed,
      generatorId: this.#generatorId,
      randomAlgorithm: "xorshift32" as const,
      randomState: this.#random.state,
      initialHash: this.#initialHash,
      completedSteps: this.#completedSteps,
      accepted: this.#accepted,
      rejected: this.#rejected,
      finalHash: canonicalHash(this.#reference),
      divergenceCount: this.#divergenceCount,
      divergences: Object.freeze([...this.#divergences]),
      commandCounts: Object.freeze({ ...this.#commandCounts }),
      acceptedCommandCounts: Object.freeze({ ...this.#acceptedCommandCounts }),
      rejectedCommandCounts: Object.freeze({ ...this.#rejectedCommandCounts }),
      generatedCommandTypes: Object.freeze(generatedCommandTypes),
      missingCommandTypes: Object.freeze(missingCommandTypes),
      implementation: Object.freeze({
        reference: "@panefold/kernel.executeCommand" as const,
        candidateId: candidate.id,
        independentCandidate: candidate.independent,
      }),
      checks: Object.freeze({
        invariantValidation: "every-attempt" as const,
        committedPatchReplay: this.#committedPatchReplayChecks,
        inversePatchReplay: this.#inversePatchReplayChecks,
        optimizedProjectionReplay: this.#optimizedProjectionReplayChecks,
        candidateComparisons: this.#candidateComparisons,
      }),
      thresholds: Object.freeze({
        generatedOperationTarget: MODEL_GENERATED_OPERATION_TARGET,
        generatedOperationTargetMet: this.#completedSteps >= MODEL_GENERATED_OPERATION_TARGET,
      }),
      phaseOneDifferentialEligible:
        passed &&
        candidate.phaseOneEligible &&
        this.#generatorId !== "custom-unspecified" &&
        this.#completedSteps >= MODEL_GENERATED_OPERATION_TARGET,
      status: passed ? ("passed" as const) : ("diverged" as const),
    });
  }

  public get snapshot(): WorkspaceSnapshot {
    return this.#reference;
  }

  public get projection(): OptimizedKernelProjection {
    return this.#projection;
  }

  public get randomState(): number {
    return this.#random.state;
  }

  #runStep(): void {
    const step = this.#completedSteps;
    const command = this.#generate({
      step,
      random: this.#random,
      snapshot: this.#reference,
      commandTypes: WORKSPACE_COMMAND_TYPES,
    });
    if (!WORKSPACE_COMMAND_TYPES.includes(command.type)) {
      throw new TypeError(`Differential generator returned an unknown command: ${command.type}`);
    }
    this.#commandCounts[command.type] = (this.#commandCounts[command.type] ?? 0) + 1;
    const envelope: CommandEnvelope = {
      id: commandId(`optimized-differential:${this.#seed}:${step}`),
      origin: "application",
      label: `Differential ${command.type}`,
      baseRevision: this.#reference.revision,
      command,
    };

    const referenceBefore = this.#reference;
    const result = executeCommand(referenceBefore, envelope);
    if (result.ok) {
      this.#accepted += 1;
      this.#acceptedCommandCounts[command.type] =
        (this.#acceptedCommandCounts[command.type] ?? 0) + 1;
    } else {
      this.#rejected += 1;
      this.#rejectedCommandCounts[command.type] =
        (this.#rejectedCommandCounts[command.type] ?? 0) + 1;
    }
    let candidateResult: KernelResult | undefined;
    if (this.#candidate !== undefined) {
      this.#candidateComparisons += 1;
      try {
        candidateResult = this.#candidate.execute(this.#candidateSnapshot, envelope);
      } catch (cause) {
        const hash = canonicalHash(referenceBefore);
        this.#recordDivergence({
          step,
          commandType: command.type,
          kind: "candidate-exception",
          referenceHash: hash,
          replayHash: hash,
          projectionHash: canonicalHash(this.#projection.snapshot),
          candidateHash: canonicalHash(this.#candidateSnapshot),
          message: cause instanceof Error ? cause.message : "Candidate reducer threw",
        });
      }
    }

    if (this.#divergenceCount > 0) {
      this.#completedSteps += 1;
      return;
    }
    if (candidateResult !== undefined && candidateResult.ok !== result.ok) {
      const hash = canonicalHash(result.ok ? result.next : referenceBefore);
      this.#recordDivergence({
        step,
        commandType: command.type,
        kind: "candidate-outcome",
        referenceHash: hash,
        replayHash: hash,
        projectionHash: canonicalHash(this.#projection.snapshot),
        candidateHash: canonicalHash(
          candidateResult.ok ? candidateResult.next : this.#candidateSnapshot,
        ),
        message: `Reference ${result.ok ? "accepted" : "rejected"}; candidate ${candidateResult.ok ? "accepted" : "rejected"}.`,
      });
    } else if (
      candidateResult !== undefined &&
      !candidateResult.ok &&
      !result.ok &&
      canonicalSerialize(candidateResult.error) !== canonicalSerialize(result.error)
    ) {
      const hash = canonicalHash(referenceBefore);
      this.#recordDivergence({
        step,
        commandType: command.type,
        kind: "candidate-rejection",
        referenceHash: hash,
        replayHash: hash,
        projectionHash: canonicalHash(this.#projection.snapshot),
        candidateHash: canonicalHash(this.#candidateSnapshot),
        message: `Reference and candidate rejection contracts differ (${result.error.code}/${candidateResult.error.code}).`,
      });
    }

    if (!result.ok) {
      this.#completedSteps += 1;
      return;
    }

    const replay = applyTransaction(referenceBefore, result.transaction);
    this.#committedPatchReplayChecks += 1;
    const inverse = applyPatches(
      result.next,
      invertPatches(result.patches),
      referenceBefore.revision,
    );
    this.#inversePatchReplayChecks += 1;
    this.#projection = this.#projection.applyTransaction(result.transaction);
    this.#optimizedProjectionReplayChecks += 1;
    const referenceHash = canonicalHash(result.next);
    const replayHash = canonicalHash(replay);
    const inverseHash = canonicalHash(inverse);
    const previousHash = canonicalHash(referenceBefore);
    const projectionHash = canonicalHash(this.#projection.snapshot);
    const candidateHash =
      candidateResult?.ok === true ? canonicalHash(candidateResult.next) : undefined;
    const referenceContract = canonicalSerialize({
      patches: result.patches,
      inverse: result.inverse,
      effects: result.effects,
      diagnostics: result.diagnostics,
      transaction: result.transaction,
    });
    const candidateContract =
      candidateResult?.ok === true
        ? canonicalSerialize({
            patches: candidateResult.patches,
            inverse: candidateResult.inverse,
            effects: candidateResult.effects,
            diagnostics: candidateResult.diagnostics,
            transaction: candidateResult.transaction,
          })
        : undefined;

    if (referenceHash !== replayHash) {
      this.#recordDivergence({
        step,
        commandType: command.type,
        kind: "patch-replay",
        referenceHash,
        replayHash,
        projectionHash,
        inverseHash,
        ...(candidateHash === undefined ? {} : { candidateHash }),
      });
    } else if (previousHash !== inverseHash) {
      this.#recordDivergence({
        step,
        commandType: command.type,
        kind: "inverse-patch-replay",
        referenceHash,
        replayHash,
        projectionHash,
        inverseHash,
        ...(candidateHash === undefined ? {} : { candidateHash }),
      });
    } else if (referenceHash !== projectionHash) {
      this.#recordDivergence({
        step,
        commandType: command.type,
        kind: "optimized-projection",
        referenceHash,
        replayHash,
        projectionHash,
        inverseHash,
        ...(candidateHash === undefined ? {} : { candidateHash }),
      });
    } else if (candidateHash !== undefined && referenceHash !== candidateHash) {
      this.#recordDivergence({
        step,
        commandType: command.type,
        kind: "candidate-state",
        referenceHash,
        replayHash,
        projectionHash,
        inverseHash,
        candidateHash,
      });
    } else if (candidateContract !== undefined && referenceContract !== candidateContract) {
      this.#recordDivergence({
        step,
        commandType: command.type,
        kind: "candidate-contract",
        referenceHash,
        replayHash,
        projectionHash,
        inverseHash,
        ...(candidateHash === undefined ? {} : { candidateHash }),
        message: "Reference and candidate transaction contracts differ.",
      });
    }

    this.#reference = result.next;
    if (candidateResult?.ok === true) this.#candidateSnapshot = candidateResult.next;
    this.#completedSteps += 1;
  }

  #recordDivergence(divergence: DifferentialDivergence): void {
    this.#divergenceCount += 1;
    if (this.#divergences.length < this.#maxStoredDivergences) {
      this.#divergences.push(Object.freeze(divergence));
    }
  }
}

export function createDifferentialCampaign(
  options: DifferentialCampaignOptions,
): DifferentialCampaign {
  return new DifferentialCampaign(options);
}

export interface RunLongDifferentialCampaignOptions extends DifferentialCampaignOptions {
  readonly steps: number;
  readonly chunkSize?: number;
  readonly onProgress?: (report: DifferentialCampaignReport) => void;
  readonly yieldControl?: () => Promise<void>;
}

/**
 * Runs a large campaign without monopolizing the event loop. Reports emitted
 * after each chunk are complete deterministic progress artifacts; the final
 * report is independent of chunk size.
 */
export async function runLongDifferentialCampaign(
  options: RunLongDifferentialCampaignOptions,
): Promise<DifferentialCampaignReport> {
  const steps = validatedCount(options.steps, "steps");
  const chunkSize = validatedCount(options.chunkSize ?? 10_000, "chunkSize");
  if (steps > 0 && chunkSize === 0) throw new RangeError("chunkSize must be positive");
  const campaign = createDifferentialCampaign(options);
  let report = campaign.report();
  while (report.completedSteps < steps && report.status === "passed") {
    const remaining = steps - report.completedSteps;
    report = campaign.runChunk(Math.min(chunkSize, remaining));
    options.onProgress?.(report);
    if (report.completedSteps < steps && report.status === "passed") {
      await (options.yieldControl ?? defaultYieldControl)();
    }
  }
  return report;
}

function defaultYieldControl(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Stable, content-addressable JSON for CI artifacts and release evidence. */
export function serializeDifferentialCampaignReport(report: DifferentialCampaignReport): string {
  return canonicalSerialize(report);
}

/**
 * Runs semantic commands through the reference reducer, replays its committed
 * transaction through both the reference patch applier and this projection,
 * and records any hash divergence. The optimized package never reduces a
 * command itself.
 */
export function runDifferentialSequence(options: DifferentialRunOptions): DifferentialRunReport {
  const campaign = createDifferentialCampaign(options);
  const report = campaign.runChunk(options.steps);
  const candidate = candidateDescriptor(options.candidate);
  return Object.freeze({
    seed: options.seed,
    steps: report.completedSteps,
    accepted: report.accepted,
    rejected: report.rejected,
    finalHash: report.finalHash,
    divergences: report.divergences,
    projection: campaign.projection,
    commandCounts: report.commandCounts,
    candidate: Object.freeze(candidate),
  });
}
