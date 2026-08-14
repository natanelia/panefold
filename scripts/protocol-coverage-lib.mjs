import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { URL } from "node:url";

import {
  PROTOCOL_ACTOR_CATALOG,
  PROTOCOL_COVERAGE_CONTRACT,
} from "../packages/protocol/dist/index.js";
import * as protocolXstate from "../packages/protocol-xstate/dist/index.js";

const requireFromProtocolPackage = createRequire(
  new URL("../packages/protocol-xstate/package.json", import.meta.url),
);
const { createActor } = requireFromProtocolPackage("xstate");
const MAX_SNAPSHOTS_PER_PROTOCOL_INPUT = 1_000;
const MAX_EXPLORED_SNAPSHOTS = 20_000;

const machineDefinitions = Object.freeze({
  drag: definition(protocolXstate.dragMachine, [{}], dragSamples()),
  "splitter-resize": definition(protocolXstate.resizeMachine, [{}], resizeSamples()),
  "floating-manipulation": definition(
    protocolXstate.floatingManipulationMachine,
    [{}],
    floatingSamples(),
  ),
  "keyboard-move": definition(protocolXstate.keyboardMoveMachine, [{}], keyboardSamples()),
  close: definition(protocolXstate.closeMachine, [{}], closeSamples()),
  "suspend-resume": definition(protocolXstate.suspendResumeMachine, [{}], suspendSamples()),
  "surface-transfer": definition(protocolXstate.surfaceTransferMachine, [{}], transferSamples(), {
    deadlineSamples: transferDeadlineSamples(),
  }),
  "surface-recovery": definition(
    protocolXstate.surfaceRecoveryMachine,
    [{ coordinatorEpoch: 1 }],
    recoverySamples(),
  ),
  "persistence-worker": definition(
    protocolXstate.persistenceWorkerMachine,
    [{ queueLimit: 0 }, { queueLimit: 2 }],
    persistenceSamples(),
    { deadlineInput: { queueLimit: 2 } },
  ),
  "plugin-load": definition(protocolXstate.pluginLoadMachine, [{}], pluginSamples()),
  "view-transition": definition(
    protocolXstate.viewTransitionMachine,
    [{}],
    viewTransitionSamples(),
  ),
  "coordinator-election": definition(
    protocolXstate.coordinatorElectionMachine,
    [{ epoch: 1 }],
    electionSamples(),
  ),
});

export function runProtocolCoverage() {
  const protocols = Object.entries(machineDefinitions).map(([kind, machineDefinition]) =>
    coverProtocol(kind, machineDefinition),
  );
  const totals = sumProtocolTotals(protocols);
  if (totals.exploredSnapshots > MAX_EXPLORED_SNAPSHOTS) {
    throw new Error(
      `Protocol coverage exceeded the ${String(MAX_EXPLORED_SNAPSHOTS)}-snapshot total budget`,
    );
  }
  return { protocols, totals };
}

export function canonicalMachineGraph(machine) {
  const rows = [];
  for (const [state, stateNode] of Object.entries(machine.root.states)) {
    for (const [eventType, transitions] of stateNode.transitions) {
      transitions.forEach((transition, branch) => {
        rows.push(canonicalTransitionRow(state, eventType, branch, transition));
      });
    }
    stateNode.always?.forEach((transition, branch) => {
      rows.push(canonicalTransitionRow(state, "(always)", branch, transition));
    });
  }
  return Object.freeze(rows);
}

function coverProtocol(kind, machineDefinition) {
  const { machine, inputs, samples } = machineDefinition;
  const contract = PROTOCOL_COVERAGE_CONTRACT[kind];
  if (contract === undefined) throw new Error(`Missing protocol coverage contract for ${kind}`);
  assertCatalogParity(kind, contract);

  const graph = inspectMachineGraph(kind, machine);
  const graphDigest = sha256(graph.rows.join("\n"));
  if (graphDigest !== contract.graphDigest) {
    throw new Error(
      `${kind} graph digest changed: expected ${contract.graphDigest}, received ${graphDigest}`,
    );
  }
  if (graph.rows.length !== contract.transitionCount) {
    throw new Error(`${kind} transition count changed`);
  }
  if (graph.guardedIds.size !== contract.guardedTransitionCount) {
    throw new Error(`${kind} guarded transition count changed`);
  }

  const coveredTransitions = new Set();
  const reachedStates = new Set();
  const guardPasses = new Set();
  const guardRejections = new Set();
  const consideredWitnesses = new Set();
  let exploredSnapshots = 0;
  let impossibleEventChecks = 0;

  for (const input of inputs) {
    const initial = createActor(machine, { input });
    initial.start();
    const firstSnapshot = initial.getPersistedSnapshot();
    reachedStates.add(stateValue(firstSnapshot.value));
    initial.stop();
    const queue = [firstSnapshot];
    const seen = new Set([snapshotKey(firstSnapshot)]);

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      if (queue.length > MAX_SNAPSHOTS_PER_PROTOCOL_INPUT) {
        throw new Error(
          `${kind} exceeded the ${String(MAX_SNAPSHOTS_PER_PROTOCOL_INPUT)}-snapshot per-input budget`,
        );
      }
      const snapshot = queue[cursor];
      exploredSnapshots += 1;
      for (const sample of samples) {
        const observation = executeSample(machine, input, snapshot, sample, graph);
        for (const id of observation.selectedTransitionIds) coveredTransitions.add(id);
        for (const state of observation.reachedStates) reachedStates.add(state);
        for (const id of observation.guardPasses) guardPasses.add(id);
        for (const id of observation.guardRejections) guardRejections.add(id);
        if (observation.witnessSelected) consideredWitnesses.add(sample.id);
        if (!observation.considered && observation.selectedTransitionIds.length === 0) {
          impossibleEventChecks += 1;
        }
        const key = snapshotKey(observation.snapshot);
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(observation.snapshot);
        }
      }
    }
  }

  const deadline = coverDeadline(kind, machineDefinition, contract, graph);
  const specialWitnesses = new Set([
    ...consideredWitnesses,
    ...deadline.coveredWitnesses,
    "scope:aborted",
    ...(impossibleEventChecks > 0 ? ["impossible:event-ignored"] : []),
  ]);
  const obligations = summarizeObligations(contract.obligations, specialWitnesses);
  const machineStateIds = Object.keys(machine.root.states);
  const missingStates = contract.states.filter((state) => !reachedStates.has(state));
  const unexpectedStates = machineStateIds.filter((state) => !contract.states.includes(state));
  const missingTransitions = graph.ids.filter((id) => !coveredTransitions.has(id));

  return Object.freeze({
    kind,
    states: exactCoverage(
      contract.states,
      machineStateIds,
      [...reachedStates],
      missingStates,
      unexpectedStates,
    ),
    transitions: exactCoverage(
      graph.ids,
      graph.ids,
      [...coveredTransitions],
      missingTransitions,
      [],
    ),
    guards: Object.freeze({
      documented: graph.guardedIds.size,
      pass: guardPasses.size,
      reject: guardRejections.size,
      missingPass: Object.freeze([...graph.guardedIds].filter((id) => !guardPasses.has(id))),
      missingReject: Object.freeze([...graph.guardedIds].filter((id) => !guardRejections.has(id))),
    }),
    obligations,
    exploredSnapshots,
    impossibleEventChecks,
    deadline: deadline.deadline,
    finalizer: deadline.finalizer,
  });
}

function executeSample(machine, input, snapshot, sample, graph) {
  if (snapshot.status === "done" || snapshot.status === "stopped" || snapshot.status === "error") {
    return {
      snapshot,
      selectedTransitionIds: [],
      reachedStates: [stateValue(snapshot.value)],
      guardPasses: [],
      guardRejections: [],
      considered: false,
      witnessSelected: false,
    };
  }
  const selected = [];
  const actor = createActor(machine, {
    input,
    snapshot,
    inspect: (inspection) => {
      if (inspection.type === "@xstate.microstep") selected.push(...inspection._transitions);
    },
  });
  actor.start();
  const sourceState = stateValue(snapshot.value);
  actor.send(sample.event);
  const nextSnapshot = actor.getPersistedSnapshot();
  actor.stop();

  const selectedIds = selected.map((transition) => graph.idByTransition.get(transition));
  if (selectedIds.some((id) => id === undefined)) {
    throw new Error(`Coverage observed an unknown transition for ${machine.id}`);
  }
  const selectedTransitionIds = selectedIds;
  const sourceNode = machine.root.states[sourceState];
  const matching = sourceNode?.transitions.get(sample.event.type) ?? [];
  const selectedEventTransition = selected.find(
    (transition) => transition.source === sourceNode && transition.eventType === sample.event.type,
  );
  const selectedIndex =
    selectedEventTransition === undefined ? -1 : matching.indexOf(selectedEventTransition);
  const guardPasses = [];
  const guardRejections = [];
  for (let index = 0; index < matching.length; index += 1) {
    const transition = matching[index];
    if (transition.guard === undefined) continue;
    const id = graph.idByTransition.get(transition);
    if (id === undefined) throw new Error(`Missing guarded transition ID for ${machine.id}`);
    if (transition === selectedEventTransition) guardPasses.push(id);
    else if (selectedIndex === -1 || index < selectedIndex) guardRejections.push(id);
  }
  return {
    snapshot: nextSnapshot,
    selectedTransitionIds,
    reachedStates: selected.flatMap((transition) => [
      transition.source.key,
      ...(transition.target?.map((target) => target.key) ?? [transition.source.key]),
    ]),
    guardPasses,
    guardRejections,
    considered: matching.length > 0,
    witnessSelected: selectedEventTransition !== undefined,
  };
}

function coverDeadline(kind, machineDefinition, contract, graph) {
  const primary = contract.timeoutScenarios.map((scenario) =>
    runDeadlineScenario(kind, machineDefinition, scenario, graph),
  );
  const replay = contract.timeoutScenarios.map((scenario) =>
    runDeadlineScenario(kind, machineDefinition, scenario, graph),
  );
  const replayMatches = primary.map(
    (result, index) => JSON.stringify(result.outcome) === JSON.stringify(replay[index].outcome),
  );
  const coveredIds = contract.timeoutScenarios
    .filter(
      (scenario, index) => primary[index].covered && replay[index].covered && replayMatches[index],
    )
    .map((scenario) => scenario.id);
  const coveredIdSet = new Set(coveredIds);
  const cancelled = runCancelledDeadline(kind, machineDefinition, contract.timeoutScenarios[0]);
  const primaryScheduled = sumResults(primary, "scheduled");
  const primaryFired = sumResults(primary, "fired");
  const replayScheduled = sumResults(replay, "scheduled");
  const replayFired = sumResults(replay, "fired");
  const pendingHandles =
    sumResults(primary, "pending") + sumResults(replay, "pending") + cancelled.pending;
  return {
    coveredWitnesses: Object.freeze(coveredIds.map((id) => `deadline:${id}`)),
    deadline: Object.freeze({
      scenariosDocumented: contract.timeoutScenarios.length,
      scenariosCovered: coveredIds.length,
      missing: Object.freeze(
        contract.timeoutScenarios
          .filter((scenario) => !coveredIdSet.has(scenario.id))
          .map((scenario) => scenario.id),
      ),
      primaryScheduled,
      primaryFired,
      replayScheduled,
      replayFired,
      cancellationScheduled: cancelled.scheduled,
      cancellationCancelled: cancelled.cancelled,
      scheduled: primaryScheduled + replayScheduled + cancelled.scheduled,
      fired: primaryFired + replayFired + cancelled.fired,
      cancelled:
        sumResults(primary, "cancelled") + sumResults(replay, "cancelled") + cancelled.cancelled,
      pendingHandles,
      replayEquivalent: replayMatches.every(Boolean),
      transitioned: coveredIds.length === contract.timeoutScenarios.length,
    }),
    finalizer: Object.freeze({
      scopeAbortStopsOnce: cancelled.scopeAbortStopsOnce,
      lateEventIgnored: cancelled.lateEventIgnored,
    }),
  };
}

function runDeadlineScenario(kind, machineDefinition, scenario, graph) {
  const scheduler = new DeterministicScheduler();
  const parent = new globalThis.AbortController();
  const input = machineDefinition.deadlineInput ?? machineDefinition.inputs[0];
  const selected = [];
  const raw = createActor(machineDefinition.machine, {
    input,
    inspect: (inspection) => {
      if (inspection.type === "@xstate.microstep") selected.push(...inspection._transitions);
    },
  });
  const port = {
    start: () => raw.start(),
    stop: () => raw.stop(),
    send: (event) => raw.send(event),
    getSnapshot: () => raw.getSnapshot(),
  };
  const identity = {
    protocolId: `coverage:${kind}`,
    kind,
    baseRevision: 0,
    coordinatorEpoch: kind === "coordinator-election" ? 1 : undefined,
    transactionId: `coverage:${kind}:transaction`,
  };
  const deadlineSample = sampleById(machineDefinition.witnesses, scenario.eventWitness);
  const scoped = protocolXstate.createScopedProtocolActor({
    identity,
    actor: port,
    scheduler,
    parentSignal: parent.signal,
    traceLimit: 32,
  });
  scoped.start();
  let setupAccepted = true;
  for (const setupId of scenario.setupWitnesses) {
    setupAccepted =
      scoped.send({
        identity,
        event: sampleById(machineDefinition.witnesses, setupId).event,
      }) && setupAccepted;
  }
  const expectedTransition = expectedDeadlineTransition(
    machineDefinition.machine,
    scenario,
    deadlineSample.event,
  );
  const expectedTransitionId = graph.idByTransition.get(expectedTransition);
  if (expectedTransitionId === undefined) {
    throw new Error(`${kind}:${scenario.id} deadline transition is absent from the graph`);
  }
  const selectedBeforeDeadline = selected.length;
  const traceBefore = scoped.trace().length;
  const stateBeforeDeadline = stateValue(raw.getSnapshot().value);
  const scheduled = scoped.scheduleDeadline({ afterMs: 10, event: deadlineSample.event });
  scheduler.advanceTo(9);
  const stateAtMinusOne = stateValue(raw.getSnapshot().value);
  const traceAtMinusOne = scoped.trace().length;
  const selectedAtMinusOne = selected.length;
  scheduler.advanceTo(10);
  const traceAfter = scoped.trace().length;
  const stateAfterDeadline = stateValue(raw.getSnapshot().value);
  const deadlineSelections = selected.slice(selectedBeforeDeadline);
  const selectedTransitionIds = deadlineSelections.map((transition) => {
    const id = graph.idByTransition.get(transition);
    if (id === undefined) throw new Error(`${kind}:${scenario.id} selected an unknown transition`);
    return id;
  });
  const exactTransitionSelected = deadlineSelections.includes(expectedTransition);
  const lastTrace = scoped.trace().at(-1);
  const outcome = {
    scenarioId: scenario.id,
    sourceState: scenario.sourceState,
    expectedState: scenario.expectedState,
    expectedTransitionId,
    selectedTransitionIds,
    traceBefore,
    traceAtMinusOne,
    traceAfter,
    stateBeforeDeadline,
    stateAtMinusOne,
    stateAfterDeadline,
    scheduler: {
      scheduled: scheduler.scheduled,
      fired: scheduler.fired,
      cancelled: scheduler.cancelled,
      pending: scheduler.pending,
    },
  };
  const covered =
    setupAccepted &&
    scheduled &&
    stateBeforeDeadline === scenario.sourceState &&
    stateAtMinusOne === scenario.sourceState &&
    traceAtMinusOne === traceBefore &&
    selectedAtMinusOne === selectedBeforeDeadline &&
    scheduler.scheduled === 1 &&
    scheduler.fired === 1 &&
    scheduler.cancelled === 0 &&
    scheduler.pending === 0 &&
    exactTransitionSelected &&
    stateAfterDeadline === scenario.expectedState &&
    traceAfter === traceBefore + 1 &&
    lastTrace?.event === deadlineSample.event.type &&
    lastTrace.timestamp === 10;
  scoped.stop("coverage-complete");
  return {
    outcome,
    covered,
    scheduled: scheduler.scheduled,
    fired: scheduler.fired,
    cancelled: scheduler.cancelled,
    pending: scheduler.pending,
  };
}

function runCancelledDeadline(kind, machineDefinition, scenario) {
  if (scenario === undefined) throw new Error(`${kind} has no deadline scenario to cancel`);
  const scheduler = new DeterministicScheduler();
  const parent = new globalThis.AbortController();
  const input = machineDefinition.deadlineInput ?? machineDefinition.inputs[0];
  const raw = createActor(machineDefinition.machine, { input });
  let stopCount = 0;
  const port = {
    start: () => raw.start(),
    stop: () => {
      stopCount += 1;
      raw.stop();
    },
    send: (event) => raw.send(event),
    getSnapshot: () => raw.getSnapshot(),
  };
  const identity = {
    protocolId: `coverage:${kind}`,
    kind,
    baseRevision: 0,
    coordinatorEpoch: kind === "coordinator-election" ? 1 : undefined,
    transactionId: `coverage:${kind}:transaction`,
  };
  const deadlineSample = sampleById(machineDefinition.witnesses, scenario.eventWitness);
  const scoped = protocolXstate.createScopedProtocolActor({
    identity,
    actor: port,
    scheduler,
    parentSignal: parent.signal,
    traceLimit: 32,
  });
  scoped.start();
  let setupAccepted = true;
  for (const setupId of scenario.setupWitnesses) {
    setupAccepted =
      scoped.send({
        identity,
        event: sampleById(machineDefinition.witnesses, setupId).event,
      }) && setupAccepted;
  }
  const sourceReached = stateValue(raw.getSnapshot().value) === scenario.sourceState;
  const traceBefore = scoped.trace().length;
  const scheduled = scoped.scheduleDeadline({ afterMs: 10, event: deadlineSample.event });
  scheduler.advanceTo(9);
  parent.abort("coverage-scope-closed");
  scheduler.advanceTo(10);
  const lateEventIgnored = scoped.send({ identity, event: deadlineSample.event }) === false;
  scoped.stop("coverage-complete");
  return {
    scheduled: scheduler.scheduled,
    fired: scheduler.fired,
    cancelled: scheduler.cancelled,
    pending: scheduler.pending,
    scopeAbortStopsOnce:
      setupAccepted &&
      sourceReached &&
      scheduled &&
      scheduler.scheduled === 1 &&
      scheduler.fired === 0 &&
      scheduler.cancelled === 1 &&
      scheduler.pending === 0 &&
      scoped.trace().length === traceBefore &&
      stopCount === 1,
    lateEventIgnored,
  };
}

function expectedDeadlineTransition(machine, scenario, event) {
  const sourceNode = machine.root.states[scenario.sourceState];
  if (sourceNode === undefined) {
    throw new Error(
      `${machine.id}:${scenario.id} has unknown source state ${scenario.sourceState}`,
    );
  }
  const matching = sourceNode.transitions.get(event.type) ?? [];
  const expected = matching.filter((transition) => {
    const targets = transition.target?.map((target) => target.key) ?? [scenario.sourceState];
    return targets.includes(scenario.expectedState);
  });
  if (expected.length !== 1) {
    throw new Error(
      `${machine.id}:${scenario.id} expected one ${event.type} transition from ${scenario.sourceState} to ${scenario.expectedState}, found ${String(expected.length)}`,
    );
  }
  return expected[0];
}

function sumResults(results, key) {
  return results.reduce((total, result) => total + result[key], 0);
}

class DeterministicScheduler {
  #time = 0;
  #nextHandle = 0;
  #nextOrder = 0;
  #timers = new Map();
  scheduled = 0;
  fired = 0;
  cancelled = 0;

  now() {
    return this.#time;
  }

  setTimeout(callback, delayMs) {
    const handle = this.#nextHandle++;
    this.#timers.set(handle, {
      at: this.#time + delayMs,
      order: this.#nextOrder++,
      callback,
    });
    this.scheduled += 1;
    return handle;
  }

  clearTimeout(handle) {
    if (this.#timers.delete(handle)) {
      this.cancelled += 1;
    }
  }

  get pending() {
    return this.#timers.size;
  }

  advanceTo(time) {
    if (!Number.isSafeInteger(time) || time < this.#time) throw new RangeError("Invalid time");
    while (true) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= time)
        .sort((left, right) => left[1].at - right[1].at || left[1].order - right[1].order)[0];
      if (due === undefined) break;
      const [handle, timer] = due;
      this.#timers.delete(handle);
      this.#time = timer.at;
      this.fired += 1;
      timer.callback();
    }
    this.#time = time;
  }
}

function inspectMachineGraph(kind, machine) {
  const rows = canonicalMachineGraph(machine);
  const ids = [];
  const guardedIds = new Set();
  const idByTransition = new WeakMap();
  for (const [state, stateNode] of Object.entries(machine.root.states)) {
    for (const [eventType, transitions] of stateNode.transitions) {
      transitions.forEach((transition, branch) => {
        const id = transitionId(kind, state, eventType, branch);
        ids.push(id);
        idByTransition.set(transition, id);
        if (transition.guard !== undefined) guardedIds.add(id);
      });
    }
    stateNode.always?.forEach((transition, branch) => {
      const id = transitionId(kind, state, "(always)", branch);
      ids.push(id);
      idByTransition.set(transition, id);
      if (transition.guard !== undefined) guardedIds.add(id);
    });
  }
  return { rows, ids: Object.freeze(ids), guardedIds, idByTransition };
}

function summarizeObligations(documented, witnesses) {
  const rows = documented.map((obligation) => ({
    ...obligation,
    covered: witnesses.has(obligation.witness),
  }));
  const byKind = {};
  for (const kind of [
    "adversarial",
    "interruption",
    "timeout",
    "recovery",
    "finalizer",
    "impossible-event",
  ]) {
    const matching = rows.filter((row) => row.kind === kind);
    byKind[kind] = Object.freeze({
      documented: matching.length,
      covered: matching.filter((row) => row.covered).length,
    });
  }
  return Object.freeze({
    documented: rows.length,
    covered: rows.filter((row) => row.covered).length,
    missing: Object.freeze(rows.filter((row) => !row.covered).map((row) => row.id)),
    byKind: Object.freeze(byKind),
  });
}

function exactCoverage(documented, machine, covered, missing, unexpected) {
  return Object.freeze({
    documented: documented.length,
    machine: machine.length,
    covered: covered.length,
    missing: Object.freeze([...missing]),
    unexpected: Object.freeze([...unexpected]),
    unreachable: Object.freeze([...missing]),
  });
}

function sumProtocolTotals(protocols) {
  const totals = {
    protocols: protocols.length,
    documentedStates: 0,
    machineStates: 0,
    reachableStates: 0,
    documentedTransitions: 0,
    machineTransitions: 0,
    coveredTransitions: 0,
    guardedTransitions: 0,
    coveredGuardPasses: 0,
    coveredGuardRejections: 0,
    obligations: 0,
    coveredObligations: 0,
    exploredSnapshots: 0,
    impossibleEventChecks: 0,
    uniqueTimeoutScenarios: 0,
    coveredTimeoutScenarios: 0,
    deadlinesScheduled: 0,
    deadlinesFired: 0,
    deadlinesCancelled: 0,
    pendingDeadlineHandles: 0,
  };
  for (const protocol of protocols) {
    totals.documentedStates += protocol.states.documented;
    totals.machineStates += protocol.states.machine;
    totals.reachableStates += protocol.states.covered;
    totals.documentedTransitions += protocol.transitions.documented;
    totals.machineTransitions += protocol.transitions.machine;
    totals.coveredTransitions += protocol.transitions.covered;
    totals.guardedTransitions += protocol.guards.documented;
    totals.coveredGuardPasses += protocol.guards.pass;
    totals.coveredGuardRejections += protocol.guards.reject;
    totals.obligations += protocol.obligations.documented;
    totals.coveredObligations += protocol.obligations.covered;
    totals.exploredSnapshots += protocol.exploredSnapshots;
    totals.impossibleEventChecks += protocol.impossibleEventChecks;
    totals.uniqueTimeoutScenarios += protocol.deadline.scenariosDocumented;
    totals.coveredTimeoutScenarios += protocol.deadline.scenariosCovered;
    totals.deadlinesScheduled += protocol.deadline.scheduled;
    totals.deadlinesFired += protocol.deadline.fired;
    totals.deadlinesCancelled += protocol.deadline.cancelled;
    totals.pendingDeadlineHandles += protocol.deadline.pendingHandles;
  }
  return Object.freeze(totals);
}

function assertCatalogParity(kind, contract) {
  const descriptor = PROTOCOL_ACTOR_CATALOG[kind];
  const documentedAdversarial = contract.obligations
    .filter((obligation) => obligation.kind === "adversarial")
    .map((obligation) => obligation.id);
  if (!sameSet(documentedAdversarial, descriptor.adversarialEvents)) {
    throw new Error(`${kind} adversarial obligations drifted from the public actor catalog`);
  }
  for (const state of descriptor.principalStates) {
    if (!contract.states.includes(state)) {
      throw new Error(`${kind} coverage contract omits principal state ${state}`);
    }
  }
}

function definition(machine, inputs, samples, options = {}) {
  const traversalSamples = Object.freeze([
    ...samples,
    sample("impossible:event-ignored", { type: "__PANEFOLD_IMPOSSIBLE__" }),
  ]);
  const witnesses = Object.freeze([...traversalSamples, ...(options.deadlineSamples ?? [])]);
  const witnessIds = witnesses.map((witness) => witness.id);
  if (new Set(witnessIds).size !== witnessIds.length) {
    throw new Error(`${machine.id} has duplicate protocol coverage witness IDs`);
  }
  return Object.freeze({
    machine,
    inputs: Object.freeze(inputs),
    samples: traversalSamples,
    witnesses,
    deadlineInput: options.deadlineInput,
  });
}

function sample(id, event) {
  return Object.freeze({ id, event: Object.freeze(event) });
}

function sampleById(samples, id) {
  const found = samples.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`Missing protocol coverage sample ${id}`);
  return found;
}

function canonicalTransitionRow(state, eventType, branch, transition) {
  const targets = transition.target?.map((target) => target.key).join("+") ?? state;
  const guard =
    typeof transition.guard === "string" ? transition.guard : (transition.guard?.type ?? "");
  return `${state}|${eventType}|${String(branch)}|${targets}|${guard}`;
}

function transitionId(kind, state, eventType, branch) {
  return `${kind}:${state}:${eventType}:${String(branch)}`;
}

function stateValue(value) {
  if (typeof value !== "string") throw new Error("Coverage runner expects flat protocol states");
  return value;
}

function snapshotKey(snapshot) {
  return JSON.stringify(normalizeSnapshot(snapshot));
}

function normalizeSnapshot(snapshot) {
  return {
    status: snapshot.status,
    value: snapshot.value,
    context: snapshot.context,
  };
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function dragSamples() {
  return [
    sample("drag:pointer-down", {
      type: "POINTER_DOWN",
      pointerId: 1,
      position: point(0, 0),
      baseRevision: 1,
    }),
    sample("drag:pointer-move-threshold", {
      type: "POINTER_MOVE",
      pointerId: 1,
      position: point(10, 0),
    }),
    sample("drag:pointer-move-below", {
      type: "POINTER_MOVE",
      pointerId: 1,
      position: point(1, 0),
    }),
    sample("drag:pointer-move-wrong", {
      type: "POINTER_MOVE",
      pointerId: 2,
      position: point(10, 0),
    }),
    sample("drag:set-candidate", {
      type: "SET_CANDIDATE",
      candidate: { id: "target:a", label: "A" },
    }),
    sample("drag:clear-candidate", { type: "SET_CANDIDATE", candidate: undefined }),
    sample("drag:pointer-up", { type: "POINTER_UP", pointerId: 1 }),
    sample("drag:pointer-up-wrong", { type: "POINTER_UP", pointerId: 2 }),
    sample("drag:pointer-cancel", { type: "POINTER_CANCEL", pointerId: 1 }),
    sample("drag:pointer-cancel-wrong", { type: "POINTER_CANCEL", pointerId: 2 }),
    sample("drag:capture-lost", { type: "CAPTURE_LOST", pointerId: 1 }),
    sample("drag:capture-lost-wrong", { type: "CAPTURE_LOST", pointerId: 2 }),
    sample("drag:cancel", { type: "CANCEL" }),
    sample("drag:commit-ok", { type: "COMMIT_OK" }),
    sample("drag:commit-error", { type: "COMMIT_ERROR", message: "failed" }),
    sample("drag:revision-conflict", { type: "REVISION_CONFLICT" }),
    sample("drag:settled", { type: "SETTLED" }),
    sample("drag:regrab", { type: "REGRAB", pointerId: 1, position: point(2, 2), baseRevision: 2 }),
    sample("drag:returned", { type: "RETURNED" }),
    sample("drag:recovered", { type: "RECOVERED" }),
  ];
}

function resizeSamples() {
  const position = { inline: 10, block: 0 };
  return [
    sample("resize:pointer-start", {
      type: "POINTER_START",
      pointerId: 1,
      position,
      baseRevision: 1,
    }),
    sample("resize:keyboard-start", { type: "KEYBOARD_START", position, baseRevision: 1 }),
    sample("resize:pointer-move", {
      type: "POINTER_MOVE",
      pointerId: 1,
      position: { inline: 12, block: 0 },
    }),
    sample("resize:pointer-move-wrong", { type: "POINTER_MOVE", pointerId: 2, position }),
    sample("resize:pointer-end", { type: "POINTER_END", pointerId: 1 }),
    sample("resize:pointer-end-wrong", { type: "POINTER_END", pointerId: 2 }),
    sample("resize:pointer-cancel", { type: "POINTER_CANCEL", pointerId: 1 }),
    sample("resize:pointer-cancel-wrong", { type: "POINTER_CANCEL", pointerId: 2 }),
    sample("resize:capture-lost", { type: "CAPTURE_LOST", pointerId: 1 }),
    sample("resize:capture-lost-wrong", { type: "CAPTURE_LOST", pointerId: 2 }),
    sample("resize:keyboard-step", { type: "KEYBOARD_STEP", position: { inline: 14, block: 0 } }),
    sample("resize:constraint-result", {
      type: "CONSTRAINT_RESULT",
      position: { inline: 13, block: 0 },
    }),
    sample("resize:delivery-adaptive", { type: "DELIVERY_POLICY_CHANGED", policy: "adaptive" }),
    sample("resize:commit", { type: "COMMIT" }),
    sample("resize:commit-ok", { type: "COMMIT_OK" }),
    sample("resize:commit-error", { type: "COMMIT_ERROR", message: "failed" }),
    sample("resize:revision-conflict", { type: "REVISION_CONFLICT" }),
    sample("resize:settled", { type: "SETTLED" }),
    sample("resize:cancel", { type: "CANCEL" }),
    sample("resize:returned", { type: "RETURNED" }),
  ];
}

function floatingSamples() {
  const position = rectangle(0, 0, 100, 80);
  return [
    sample("floating:start", {
      type: "START",
      mode: "move",
      pointerId: 1,
      position,
      baseRevision: 1,
    }),
    sample("floating:move", { type: "MOVE", pointerId: 1, position: rectangle(5, 5, 100, 80) }),
    sample("floating:invalid-move", {
      type: "MOVE",
      pointerId: 1,
      position: rectangle(5, 5, -1, 80),
    }),
    sample("floating:wrong-move", { type: "MOVE", pointerId: 2, position }),
    sample("floating:snap-acquired", {
      type: "SNAP_ACQUIRED",
      candidate: { id: "snap:a", position },
    }),
    sample("floating:snap-released", { type: "SNAP_RELEASED" }),
    sample("floating:viewport-changed", { type: "VIEWPORT_CHANGED", version: 2 }),
    sample("floating:viewport-stale", { type: "VIEWPORT_CHANGED", version: -1 }),
    sample("floating:pointer-end", { type: "POINTER_END", pointerId: 1 }),
    sample("floating:pointer-end-wrong", { type: "POINTER_END", pointerId: 2 }),
    sample("floating:pointer-cancel", { type: "POINTER_CANCEL", pointerId: 1 }),
    sample("floating:pointer-cancel-wrong", { type: "POINTER_CANCEL", pointerId: 2 }),
    sample("floating:capture-lost", { type: "CAPTURE_LOST", pointerId: 1 }),
    sample("floating:capture-lost-wrong", { type: "CAPTURE_LOST", pointerId: 2 }),
    sample("floating:commit-ok", { type: "COMMIT_OK" }),
    sample("floating:commit-error", { type: "COMMIT_ERROR", message: "failed" }),
    sample("floating:revision-conflict", { type: "REVISION_CONFLICT" }),
    sample("floating:settled", { type: "SETTLED" }),
    sample("floating:cancel", { type: "CANCEL" }),
    sample("floating:recovered", { type: "RECOVERED" }),
    sample("floating:regrab", {
      type: "REGRAB",
      mode: "resize",
      pointerId: 1,
      position,
      baseRevision: 2,
    }),
  ];
}

function keyboardSamples() {
  const target = { id: "group:a", label: "Group A", targetClass: "group" };
  return [
    sample("keyboard:start", { type: "START", baseRevision: 1, target }),
    sample("keyboard:navigate", { type: "NAVIGATE", target: { ...target, id: "group:b" } }),
    sample("keyboard:cycle", {
      type: "CYCLE_TARGET_CLASS",
      target: { id: "surface:a", label: "Surface", targetClass: "surface" },
    }),
    sample("keyboard:target-invalidated", { type: "TARGET_INVALIDATED" }),
    sample("keyboard:target-fallback", { type: "TARGET_INVALIDATED", fallback: target }),
    sample("keyboard:commit", { type: "COMMIT" }),
    sample("keyboard:commit-ok", { type: "COMMIT_OK", announcement: "Moved" }),
    sample("keyboard:commit-error", { type: "COMMIT_ERROR", message: "failed" }),
    sample("keyboard:revision-conflict", { type: "REVISION_CONFLICT" }),
    sample("keyboard:announced", { type: "ANNOUNCED" }),
    sample("keyboard:cancel", { type: "CANCEL" }),
    sample("keyboard:reset", { type: "RESET" }),
    sample("keyboard:restart", { type: "START", baseRevision: 2, target }),
  ];
}

function closeSamples() {
  return [
    sample("close:request", { type: "REQUEST", requestId: "close:a", dirty: true }),
    sample("close:request-checkpoint", {
      type: "REQUEST",
      requestId: "close:b",
      dirty: true,
      checkpointRequired: true,
    }),
    sample("close:request-undo", {
      type: "REQUEST",
      requestId: "close:c",
      dirty: true,
      undoPreparationRequired: true,
    }),
    sample("close:request-both", {
      type: "REQUEST",
      requestId: "close:d",
      dirty: true,
      checkpointRequired: true,
      undoPreparationRequired: true,
    }),
    sample("close:check-guard", { type: "CHECK_GUARD" }),
    sample("close:guard-allowed", { type: "GUARD_ALLOWED" }),
    sample("close:guard-denied", { type: "GUARD_DENIED" }),
    sample("close:guard-timeout", { type: "GUARD_TIMEOUT" }),
    sample("close:checkpointed", { type: "CHECKPOINTED" }),
    sample("close:undo-prepared", { type: "UNDO_PREPARED" }),
    sample("close:commit", { type: "COMMIT" }),
    sample("close:commit-failed", { type: "COMMIT_FAILED" }),
    sample("close:cancel", { type: "CANCEL" }),
    sample("close:visual-finished", { type: "VISUAL_FINISHED" }),
  ];
}

function suspendSamples() {
  return [
    sample("suspend:visibility", {
      type: "REQUEST_SUSPEND",
      reason: "visibility",
      checkpointRequired: false,
    }),
    sample("suspend:budget", {
      type: "REQUEST_SUSPEND",
      reason: "budget",
      checkpointRequired: true,
    }),
    sample("suspend:begin-checkpoint", { type: "BEGIN_CHECKPOINT" }),
    sample("suspend:ready", { type: "SUSPEND_READY" }),
    sample("suspend:checkpointed", { type: "CHECKPOINTED" }),
    sample("suspend:checkpoint-failed", { type: "CHECKPOINT_FAILED", message: "deadline" }),
    sample("suspend:request-resume", { type: "REQUEST_RESUME" }),
    sample("suspend:resumed", { type: "RESUMED" }),
    sample("suspend:resume-failed", { type: "RESUME_FAILED", message: "failed" }),
    sample("suspend:cancel", { type: "CANCEL" }),
    sample("suspend:resume-cancel", { type: "CANCEL" }),
    sample("suspend:retry-suspend", { type: "RETRY_SUSPEND" }),
    sample("suspend:retry-resume", { type: "RETRY_RESUME" }),
  ];
}

function transferSamples() {
  const failure = (id, stage, cause) => sample(id, { type: "FAILED", stage, cause, message: id });
  return [
    sample("transfer:start", { type: "START", token: "transfer:a" }),
    sample("transfer:prepared", { type: "PREPARED" }),
    sample("transfer:bootstrapped", { type: "BOOTSTRAPPED" }),
    sample("transfer:checkpointed", { type: "CHECKPOINTED" }),
    sample("transfer:revalidated", { type: "REVALIDATED" }),
    sample("transfer:ownership-committed", { type: "OWNERSHIP_COMMITTED" }),
    sample("transfer:destination-mounted", { type: "DESTINATION_MOUNTED" }),
    sample("transfer:destination-ready", { type: "DESTINATION_READY" }),
    sample("transfer:source-released", { type: "SOURCE_RELEASED" }),
    sample("transfer:retry-source-release", { type: "RETRY_SOURCE_RELEASE" }),
    failure("transfer:popup-blocked", "prepare", "popup-blocked"),
    failure("transfer:protocol-mismatch", "bootstrap", "protocol-mismatch"),
    failure("transfer:checkpoint-failed", "checkpoint", "checkpoint-failed"),
    failure("transfer:revision-conflict", "revalidate", "revision-conflict"),
    failure("transfer:ownership-failed", "ownership-commit", "operation-failed"),
    failure("transfer:destination-closed", "destination-mount", "destination-closed"),
    failure("transfer:destination-ready-failed", "destination-ready", "destination-closed"),
    failure("transfer:source-crashed", "source-release", "source-crashed"),
    failure("transfer:timeout", "prepare", "timed-out"),
    sample("transfer:cancel", { type: "CANCEL" }),
    sample("transfer:compensated", { type: "COMPENSATED" }),
    sample("transfer:compensation-failed", { type: "COMPENSATION_FAILED" }),
  ];
}

function transferDeadlineSamples() {
  const timeout = (id, stage) =>
    sample(id, { type: "FAILED", stage, cause: "timed-out", message: `${id}:timed-out` });
  return [
    timeout("transfer:deadline:preparing", "prepare"),
    timeout("transfer:deadline:bootstrapping", "bootstrap"),
    timeout("transfer:deadline:checkpointing", "checkpoint"),
    timeout("transfer:deadline:revalidating", "revalidate"),
    timeout("transfer:deadline:ownership-commit", "ownership-commit"),
    timeout("transfer:deadline:destination-mount", "destination-mount"),
    timeout("transfer:deadline:ready", "destination-ready"),
    timeout("transfer:deadline:source-release", "source-release"),
  ];
}

function recoverySamples() {
  return [
    sample("recovery:heartbeat-late", { type: "HEARTBEAT_LATE" }),
    sample("recovery:heartbeat-received", { type: "HEARTBEAT_RECEIVED" }),
    sample("recovery:disconnected", { type: "DISCONNECTED" }),
    sample("recovery:new-epoch", { type: "EPOCH_CHANGED", epoch: 2 }),
    sample("recovery:stale-epoch", { type: "EPOCH_CHANGED", epoch: 0 }),
    sample("recovery:orphan-confirmed", { type: "ORPHAN_CONFIRMED" }),
    sample("recovery:begin", { type: "BEGIN_RESOLUTION" }),
    sample("recovery:owner-proof", { type: "OWNER_RECOVERED", ownershipProof: "proof" }),
    sample("recovery:empty-proof", { type: "OWNER_RECOVERED", ownershipProof: "" }),
    sample("recovery:fallback", { type: "FALLBACK_PLACED", placement: "region:recovery" }),
    sample("recovery:empty-fallback", { type: "FALLBACK_PLACED", placement: "" }),
    sample("recovery:resolution-failed", { type: "RESOLUTION_FAILED", message: "failed" }),
    sample("recovery:reset", { type: "RESET" }),
  ];
}

function persistenceSamples() {
  return [
    sample("persistence:enqueue", { type: "ENQUEUE" }),
    sample("persistence:flush", { type: "FLUSH" }),
    sample("persistence:journal-written", { type: "JOURNAL_WRITTEN" }),
    sample("persistence:snapshot-due", { type: "SNAPSHOT_DUE" }),
    sample("persistence:snapshot-written", { type: "SNAPSHOT_WRITTEN" }),
    sample("persistence:compact", { type: "COMPACT" }),
    sample("persistence:compacted", { type: "COMPACTED" }),
    sample("persistence:storage-error", {
      type: "STORAGE_ERROR",
      kind: "storage",
      message: "storage",
    }),
    sample("persistence:quota-error", { type: "STORAGE_ERROR", kind: "quota", message: "quota" }),
    sample("persistence:checksum-error", {
      type: "STORAGE_ERROR",
      kind: "checksum",
      message: "checksum",
    }),
    sample("persistence:timeout", { type: "STORAGE_ERROR", kind: "storage", message: "timed-out" }),
    sample("persistence:retry", { type: "RETRY" }),
    sample("persistence:recovered", { type: "RECOVERED" }),
    sample("persistence:stop", { type: "STOP" }),
  ];
}

function pluginSamples() {
  return [
    sample("plugin:register", { type: "REGISTER", pluginId: "plugin:a", version: "1.0.0" }),
    sample("plugin:validated", { type: "VALIDATED" }),
    sample("plugin:loaded", { type: "LOADED" }),
    sample("plugin:registered", { type: "REGISTERED" }),
    sample("plugin:unload", { type: "UNLOAD" }),
    sample("plugin:unloaded", { type: "UNLOADED" }),
    sample("plugin:retry", { type: "RETRY" }),
    sample("plugin:scope-closed", { type: "SCOPE_CLOSED" }),
    sample("plugin:manifest-conflict", { type: "MANIFEST_CONFLICT", message: "manifest" }),
    sample("plugin:version-conflict", { type: "VERSION_CONFLICT", message: "version" }),
    sample("plugin:load-failed", { type: "LOAD_FAILED", message: "load" }),
    sample("plugin:registration-failed", { type: "REGISTRATION_FAILED", message: "registration" }),
    sample("plugin:renderer-failed", { type: "RENDERER_FAILED", message: "renderer" }),
    sample("plugin:migration-failed", { type: "MIGRATION_FAILED", message: "migration" }),
    sample("plugin:timeout", { type: "LOAD_FAILED", message: "timed-out" }),
  ];
}

function viewTransitionSamples() {
  return [
    sample("view:start", { type: "START" }),
    sample("view:old-captured", { type: "OLD_CAPTURED" }),
    sample("view:committed", { type: "COMMITTED" }),
    sample("view:new-captured", { type: "NEW_CAPTURED" }),
    sample("view:finished", { type: "FINISHED" }),
    sample("view:skip", { type: "SKIP", reason: "explicit-skip" }),
    sample("view:higher-priority", { type: "HIGHER_PRIORITY_COMMAND" }),
    sample("view:unsupported", { type: "UNSUPPORTED" }),
    sample("view:duplicate-name", { type: "DUPLICATE_NAME" }),
    sample("view:budget-rejected", { type: "BUDGET_REJECTED" }),
    sample("view:capture-failed", { type: "CAPTURE_FAILED" }),
    sample("view:timed-out", { type: "TIMED_OUT" }),
    sample("view:driver-failed", { type: "DRIVER_FAILED" }),
    sample("view:fallback-committed", { type: "FALLBACK_COMMITTED" }),
    sample("view:complete-skip", { type: "COMPLETE_SKIP" }),
  ];
}

function electionSamples() {
  return [
    sample("election:heartbeat-current", { type: "HEARTBEAT", epoch: 1 }),
    sample("election:heartbeat-stale", { type: "HEARTBEAT", epoch: 0 }),
    sample("election:timeout", { type: "TIMEOUT" }),
    sample("election:propose", { type: "PROPOSE", epoch: 2 }),
    sample("election:propose-stale", { type: "PROPOSE", epoch: 1 }),
    sample("election:won", { type: "WON", epoch: 2 }),
    sample("election:won-stale", { type: "WON", epoch: 1 }),
    sample("election:higher", { type: "HIGHER_EPOCH", epoch: 2 }),
    sample("election:higher-newer", { type: "HIGHER_EPOCH", epoch: 3 }),
    sample("election:higher-stale", { type: "HIGHER_EPOCH", epoch: 0 }),
    sample("election:conflict", { type: "CONFLICT", epoch: 2 }),
    sample("election:conflict-stale", { type: "CONFLICT", epoch: 0 }),
    sample("election:server-authority", { type: "SERVER_AUTHORITY", epoch: 2 }),
    sample("election:server-authority-stale", { type: "SERVER_AUTHORITY", epoch: 0 }),
    sample("election:step-down", { type: "STEP_DOWN" }),
    sample("election:stop", { type: "STOP" }),
  ];
}

function point(x, y) {
  return { x, y };
}

function rectangle(x, y, width, height) {
  return { x, y, width, height };
}
