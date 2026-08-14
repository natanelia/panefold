const PROTOCOL_KINDS = Object.freeze([
  "drag",
  "splitter-resize",
  "floating-manipulation",
  "keyboard-move",
  "close",
  "suspend-resume",
  "surface-transfer",
  "surface-recovery",
  "persistence-worker",
  "plugin-load",
  "view-transition",
  "coordinator-election",
]);

const OBLIGATION_KINDS = Object.freeze([
  "adversarial",
  "interruption",
  "timeout",
  "recovery",
  "finalizer",
  "impossible-event",
]);

const EXPECTED_PROTOCOL_COUNTS = Object.freeze({
  drag: Object.freeze({
    states: 7,
    transitions: 24,
    guards: 10,
    obligations: 15,
    timeoutScenarios: 4,
  }),
  "splitter-resize": Object.freeze({
    states: 6,
    transitions: 23,
    guards: 8,
    obligations: 14,
    timeoutScenarios: 4,
  }),
  "floating-manipulation": Object.freeze({
    states: 6,
    transitions: 25,
    guards: 8,
    obligations: 13,
    timeoutScenarios: 4,
  }),
  "keyboard-move": Object.freeze({
    states: 5,
    transitions: 15,
    guards: 1,
    obligations: 12,
    timeoutScenarios: 3,
  }),
  close: Object.freeze({
    states: 6,
    transitions: 13,
    guards: 1,
    obligations: 11,
    timeoutScenarios: 1,
  }),
  "suspend-resume": Object.freeze({
    states: 6,
    transitions: 15,
    guards: 4,
    obligations: 12,
    timeoutScenarios: 2,
  }),
  "surface-transfer": Object.freeze({
    states: 14,
    transitions: 29,
    guards: 9,
    obligations: 17,
    timeoutScenarios: 9,
  }),
  "surface-recovery": Object.freeze({
    states: 7,
    transitions: 17,
    guards: 7,
    obligations: 9,
    timeoutScenarios: 1,
  }),
  "persistence-worker": Object.freeze({
    states: 8,
    transitions: 24,
    guards: 2,
    obligations: 11,
    timeoutScenarios: 1,
  }),
  "plugin-load": Object.freeze({
    states: 7,
    transitions: 20,
    guards: 0,
    obligations: 10,
    timeoutScenarios: 1,
  }),
  "view-transition": Object.freeze({
    states: 7,
    transitions: 34,
    guards: 1,
    obligations: 13,
    timeoutScenarios: 5,
  }),
  "coordinator-election": Object.freeze({
    states: 5,
    transitions: 19,
    guards: 13,
    obligations: 9,
    timeoutScenarios: 1,
  }),
});

const EXPECTED_TOTALS = Object.freeze({
  documentedStates: 84,
  machineStates: 84,
  reachableStates: 84,
  documentedTransitions: 258,
  machineTransitions: 258,
  coveredTransitions: 258,
  guardedTransitions: 64,
  coveredGuardPasses: 64,
  coveredGuardRejections: 64,
  obligations: 146,
  coveredObligations: 146,
  exploredSnapshots: 533,
  impossibleEventChecks: 7_837,
  uniqueTimeoutScenarios: 36,
  coveredTimeoutScenarios: 36,
  deadlinesScheduled: 84,
  deadlinesFired: 72,
  deadlinesCancelled: 12,
  pendingDeadlineHandles: 0,
});

export const PROTOCOL_COVERAGE_SOURCE_DIGEST_PATHS = Object.freeze([
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  "packages/model/package.json",
  "packages/model/tsconfig.json",
  "packages/model/src/commands.ts",
  "packages/model/src/effects.ts",
  "packages/model/src/entities.ts",
  "packages/model/src/factories.ts",
  "packages/model/src/ids.ts",
  "packages/model/src/index.ts",
  "packages/model/src/json.ts",
  "packages/model/src/panel-registry.ts",
  "packages/model/src/results.ts",
  "packages/protocol/src/catalog.ts",
  "packages/protocol/src/coverage-contract.ts",
  "packages/protocol/src/index.ts",
  "packages/protocol/src/trace.ts",
  "packages/protocol/src/types.ts",
  "packages/protocol/package.json",
  "packages/protocol/tsconfig.json",
  "packages/protocol-xstate/src/close-machine.ts",
  "packages/protocol-xstate/src/drag-machine.ts",
  "packages/protocol-xstate/src/election-machine.ts",
  "packages/protocol-xstate/src/floating-machine.ts",
  "packages/protocol-xstate/src/keyboard-move-machine.ts",
  "packages/protocol-xstate/src/persistence-machine.ts",
  "packages/protocol-xstate/src/plugin-load-machine.ts",
  "packages/protocol-xstate/src/resize-machine.ts",
  "packages/protocol-xstate/src/scoped-actor.ts",
  "packages/protocol-xstate/src/surface-recovery-machine.ts",
  "packages/protocol-xstate/src/surface-transfer-machine.ts",
  "packages/protocol-xstate/src/suspend-machine.ts",
  "packages/protocol-xstate/src/view-transition-machine.ts",
  "packages/protocol-xstate/src/index.ts",
  "packages/protocol-xstate/package.json",
  "packages/protocol-xstate/test/machine-corrections.test.ts",
  "packages/protocol-xstate/test/protocol-coverage.test.ts",
  "packages/protocol-xstate/test/scoped-actor-deadline.test.ts",
  "scripts/protocol-coverage-lib.d.mts",
  "scripts/protocol-coverage-lib.mjs",
  "scripts/run-protocol-coverage.mjs",
  "scripts/verify-protocol-coverage.d.mts",
  "scripts/verify-protocol-coverage.mjs",
  "pnpm-lock.yaml",
]);

/**
 * Performs semantic validation of the checked-in TST-003 result. Repository
 * source hashes are verified separately by verify-repository-evidence.mjs.
 */
export function verifyProtocolCoverageResult(result) {
  const failures = [];
  if (!isRecord(result)) return ["Protocol coverage result must be a JSON object."];
  if (result.schemaVersion !== 1) failures.push("Protocol coverage schemaVersion must be 1.");
  if (result.kind !== "protocol-state-machine-coverage") {
    failures.push("Protocol coverage kind must be protocol-state-machine-coverage.");
  }
  if (result.status !== "passed") failures.push("Protocol coverage status must be passed.");
  if (result.scope !== "twelve-headless-appendix-c-protocol-actors") {
    failures.push("Protocol coverage scope must remain the twelve headless Appendix-C actors.");
  }
  if (typeof result.producedAt !== "string" || !isRfc3339(result.producedAt)) {
    failures.push("Protocol coverage producedAt must be an RFC 3339 timestamp.");
  }
  validateRunner(result.runner, failures);

  const protocols = Array.isArray(result.protocols) ? result.protocols : [];
  if (!Array.isArray(result.protocols))
    failures.push("Protocol coverage protocols must be an array.");
  const actualKinds = protocols
    .filter(isRecord)
    .map((protocol) => protocol.kind)
    .filter((kind) => typeof kind === "string");
  if (!sameStringSet(actualKinds, PROTOCOL_KINDS)) {
    failures.push("Protocol coverage must contain each of the 12 protocol kinds exactly once.");
  }
  if (new Set(actualKinds).size !== actualKinds.length) {
    failures.push("Protocol coverage protocol kinds must be unique.");
  }

  const sums = {
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
    if (!isRecord(protocol)) {
      failures.push("Every protocol coverage entry must be an object.");
      continue;
    }
    const label = typeof protocol.kind === "string" ? protocol.kind : "unknown-protocol";
    const expectedCounts = EXPECTED_PROTOCOL_COUNTS[label];
    if (expectedCounts === undefined) {
      failures.push(`${label} has no independent protocol coverage count contract.`);
    }
    validateExactCoverage(protocol.states, `${label} states`, sums, failures, {
      expected: "documentedStates",
      actual: "machineStates",
      covered: "reachableStates",
      requiredCount: expectedCounts?.states,
    });
    validateExactCoverage(protocol.transitions, `${label} transitions`, sums, failures, {
      expected: "documentedTransitions",
      actual: "machineTransitions",
      covered: "coveredTransitions",
      requiredCount: expectedCounts?.transitions,
    });
    validateGuardCoverage(protocol.guards, label, sums, failures, expectedCounts?.guards);
    validateObligations(
      protocol.obligations,
      label,
      sums,
      failures,
      expectedCounts?.obligations,
      expectedCounts?.timeoutScenarios,
    );
    validateDeadlines(protocol.deadline, label, sums, failures, expectedCounts?.timeoutScenarios);
    validateFinalizer(protocol.finalizer, label, failures);

    const exploredSnapshots = nonNegativeInteger(protocol.exploredSnapshots);
    if (exploredSnapshots === undefined || exploredSnapshots < 1) {
      failures.push(`${label} exploredSnapshots must be a positive integer.`);
    } else {
      sums.exploredSnapshots += exploredSnapshots;
    }
    const impossibleEventChecks = nonNegativeInteger(protocol.impossibleEventChecks);
    if (impossibleEventChecks === undefined || impossibleEventChecks < 1) {
      failures.push(`${label} must record at least one impossible-event check.`);
    } else {
      sums.impossibleEventChecks += impossibleEventChecks;
    }
  }

  const totals = result.totals;
  if (!isRecord(totals)) {
    failures.push("Protocol coverage totals must be an object.");
  } else {
    if (totals.protocols !== PROTOCOL_KINDS.length) {
      failures.push(`Protocol coverage totals.protocols must be ${String(PROTOCOL_KINDS.length)}.`);
    }
    for (const [key, expected] of Object.entries(sums)) {
      if (totals[key] !== expected) {
        failures.push(
          `Protocol coverage totals.${key} must equal the protocol sum ${String(expected)}.`,
        );
      }
    }
    for (const [key, expected] of Object.entries(EXPECTED_TOTALS)) {
      if (totals[key] !== expected) {
        failures.push(`Protocol coverage totals.${key} must equal ${String(expected)}.`);
      }
    }
  }

  validateSourceDigests(result.sourceDigests, failures);
  validateLimitations(result.limitations, failures);
  return failures;
}

function validateExactCoverage(value, label, sums, failures, keys) {
  if (!isRecord(value)) {
    failures.push(`${label} must be an object.`);
    return;
  }
  const expected = nonNegativeInteger(value.documented);
  const actual = nonNegativeInteger(value.machine);
  const covered = nonNegativeInteger(value.covered);
  if (expected === undefined || actual === undefined || covered === undefined) {
    failures.push(`${label} documented, machine, and covered counts must be integers.`);
    return;
  }
  sums[keys.expected] += expected;
  sums[keys.actual] += actual;
  sums[keys.covered] += covered;
  if (expected !== actual || expected !== covered) {
    failures.push(`${label} must have exact documented, machine, and covered parity.`);
  }
  if (keys.requiredCount !== undefined && expected !== keys.requiredCount) {
    failures.push(`${label}.documented must equal ${String(keys.requiredCount)}.`);
  }
  for (const listName of ["missing", "unexpected", "unreachable"]) {
    if (!Array.isArray(value[listName]) || value[listName].length !== 0) {
      failures.push(`${label}.${listName} must be an empty array.`);
    }
  }
}

function validateGuardCoverage(value, label, sums, failures, requiredCount) {
  if (!isRecord(value)) {
    failures.push(`${label} guards must be an object.`);
    return;
  }
  const documented = nonNegativeInteger(value.documented);
  const pass = nonNegativeInteger(value.pass);
  const reject = nonNegativeInteger(value.reject);
  if (documented === undefined || pass === undefined || reject === undefined) {
    failures.push(`${label} guard counts must be non-negative integers.`);
    return;
  }
  sums.guardedTransitions += documented;
  sums.coveredGuardPasses += pass;
  sums.coveredGuardRejections += reject;
  if (pass !== documented || reject !== documented) {
    failures.push(`${label} must observe both pass and rejection for every documented guard.`);
  }
  if (requiredCount !== undefined && documented !== requiredCount) {
    failures.push(`${label} guards.documented must equal ${String(requiredCount)}.`);
  }
  for (const listName of ["missingPass", "missingReject"]) {
    if (!Array.isArray(value[listName]) || value[listName].length !== 0) {
      failures.push(`${label} guards.${listName} must be an empty array.`);
    }
  }
}

function validateObligations(
  value,
  label,
  sums,
  failures,
  requiredCount,
  requiredTimeoutScenarios,
) {
  if (!isRecord(value)) {
    failures.push(`${label} obligations must be an object.`);
    return;
  }
  const documented = nonNegativeInteger(value.documented);
  const covered = nonNegativeInteger(value.covered);
  if (documented === undefined || covered === undefined || documented !== covered) {
    failures.push(`${label} obligations must be fully covered.`);
  } else {
    sums.obligations += documented;
    sums.coveredObligations += covered;
  }
  if (!Array.isArray(value.missing) || value.missing.length !== 0) {
    failures.push(`${label} obligations.missing must be an empty array.`);
  }
  if (requiredCount !== undefined && documented !== requiredCount) {
    failures.push(`${label} obligations.documented must equal ${String(requiredCount)}.`);
  }
  const byKind = value.byKind;
  if (!isRecord(byKind)) {
    failures.push(`${label} obligations.byKind must be an object.`);
    return;
  }
  for (const kind of OBLIGATION_KINDS) {
    const counts = byKind[kind];
    if (!isRecord(counts)) {
      failures.push(`${label} must declare ${kind} obligations.`);
      continue;
    }
    const expected = nonNegativeInteger(counts.documented);
    const actual = nonNegativeInteger(counts.covered);
    if (expected === undefined || actual === undefined || expected < 1 || expected !== actual) {
      failures.push(`${label} ${kind} obligations must be non-empty and fully covered.`);
    }
    const requiredKindCount =
      kind === "adversarial"
        ? requiredCount === undefined || requiredTimeoutScenarios === undefined
          ? undefined
          : requiredCount - requiredTimeoutScenarios - 4
        : kind === "timeout"
          ? requiredTimeoutScenarios
          : 1;
    if (requiredCount !== undefined && expected !== requiredKindCount) {
      failures.push(
        `${label} ${kind} obligations.documented must equal ${String(requiredKindCount)}.`,
      );
    }
  }
  const byKindDocumented = OBLIGATION_KINDS.reduce((total, kind) => {
    const counts = byKind[kind];
    return (
      total +
      (isRecord(counts) && nonNegativeInteger(counts.documented) !== undefined
        ? counts.documented
        : 0)
    );
  }, 0);
  const byKindCovered = OBLIGATION_KINDS.reduce((total, kind) => {
    const counts = byKind[kind];
    return (
      total +
      (isRecord(counts) && nonNegativeInteger(counts.covered) !== undefined ? counts.covered : 0)
    );
  }, 0);
  if (documented !== undefined && documented !== byKindDocumented) {
    failures.push(`${label} obligations.documented must equal its by-kind sum.`);
  }
  if (covered !== undefined && covered !== byKindCovered) {
    failures.push(`${label} obligations.covered must equal its by-kind sum.`);
  }
}

function validateDeadlines(value, label, sums, failures, requiredTimeoutScenarios) {
  if (!isRecord(value)) {
    failures.push(`${label} deadline must be an object.`);
    return;
  }
  const scenariosDocumented = nonNegativeInteger(value.scenariosDocumented);
  const scenariosCovered = nonNegativeInteger(value.scenariosCovered);
  if (
    scenariosDocumented === undefined ||
    scenariosCovered === undefined ||
    scenariosDocumented !== scenariosCovered
  ) {
    failures.push(`${label} timeout scenarios must be fully covered.`);
  } else {
    sums.uniqueTimeoutScenarios += scenariosDocumented;
    sums.coveredTimeoutScenarios += scenariosCovered;
  }
  if (requiredTimeoutScenarios !== undefined && scenariosDocumented !== requiredTimeoutScenarios) {
    failures.push(
      `${label} deadline.scenariosDocumented must equal ${String(requiredTimeoutScenarios)}.`,
    );
  }
  if (!Array.isArray(value.missing) || value.missing.length !== 0) {
    failures.push(`${label} deadline.missing must be an empty array.`);
  }
  for (const key of ["scheduled", "fired", "cancelled", "pendingHandles"]) {
    const count = nonNegativeInteger(value[key]);
    if (count === undefined) {
      failures.push(`${label} deadline.${key} must be a non-negative integer.`);
      continue;
    }
    const sumKey = {
      scheduled: "deadlinesScheduled",
      fired: "deadlinesFired",
      cancelled: "deadlinesCancelled",
      pendingHandles: "pendingDeadlineHandles",
    }[key];
    sums[sumKey] += count;
  }
  const expectedScenarioCount = requiredTimeoutScenarios ?? 0;
  if (
    value.primaryScheduled !== expectedScenarioCount ||
    value.primaryFired !== expectedScenarioCount ||
    value.replayScheduled !== expectedScenarioCount ||
    value.replayFired !== expectedScenarioCount ||
    value.cancellationScheduled !== 1 ||
    value.cancellationCancelled !== 1 ||
    value.scheduled !== expectedScenarioCount * 2 + 1 ||
    value.fired !== expectedScenarioCount * 2 ||
    value.cancelled !== 1
  ) {
    failures.push(
      `${label} must prove every phase deadline in primary and replay runs plus one cancelled twin.`,
    );
  }
  if (value.pendingHandles !== 0) failures.push(`${label} must leave no pending deadline handle.`);
  if (value.replayEquivalent !== true) {
    failures.push(`${label} deadline replay must be byte-equivalent.`);
  }
  if (value.transitioned !== true) {
    failures.push(`${label} fired deadline must select a protocol transition.`);
  }
}

function validateFinalizer(value, label, failures) {
  if (!isRecord(value) || value.scopeAbortStopsOnce !== true || value.lateEventIgnored !== true) {
    failures.push(`${label} must prove exactly-once scope finalization and late-event rejection.`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function sameStringSet(actual, expected) {
  return actual.length === expected.length && actual.every((value) => expected.includes(value));
}

function validateRunner(value, failures) {
  if (!isRecord(value)) {
    failures.push("Protocol coverage runner must be an object.");
    return;
  }
  if (value.command !== "pnpm protocol:coverage:check") {
    failures.push("Protocol coverage runner command must be pnpm protocol:coverage:check.");
  }
  if (!Array.isArray(value.nodeMajorVersions) || value.nodeMajorVersions.join(",") !== "22,24") {
    failures.push("Protocol coverage runner must declare the Node 22 and 24 CI matrix.");
  }
  if (value.xstate !== "5.32.5") {
    failures.push("Protocol coverage runner must declare XState 5.32.5.");
  }
  if (value.traversal !== "bounded-breadth-first-v1") {
    failures.push("Protocol coverage runner must use bounded-breadth-first-v1 traversal.");
  }
  if (value.deterministicScheduler !== "virtual-fifo-v1") {
    failures.push("Protocol coverage runner must use the virtual-fifo-v1 scheduler.");
  }
  if (value.maxSnapshotsPerProtocolInput !== 1_000 || value.maxExploredSnapshots !== 20_000) {
    failures.push("Protocol coverage runner must publish the reviewed exploration budgets.");
  }
}

function validateSourceDigests(value, failures) {
  if (!isRecord(value)) {
    failures.push("Protocol coverage sourceDigests must be an object.");
    return;
  }
  const paths = Object.keys(value);
  if (!sameStringSet(paths, PROTOCOL_COVERAGE_SOURCE_DIGEST_PATHS)) {
    failures.push("Protocol coverage sourceDigests must bind the exact reviewed source set.");
  }
  for (const [path, digest] of Object.entries(value)) {
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
      failures.push(`Protocol coverage source digest for ${path} must be lowercase SHA-256.`);
    }
  }
}

function validateLimitations(value, failures) {
  if (
    !Array.isArray(value) ||
    value.length < 3 ||
    !value.every((item) => typeof item === "string")
  ) {
    failures.push("Protocol coverage must publish the three reviewed claim limitations.");
    return;
  }
  const text = value.join(" ").toLowerCase();
  if (
    !text.includes("browser") ||
    !text.includes("operating-system") ||
    !text.includes("process-crash")
  ) {
    failures.push(
      "Protocol coverage limitations must exclude browser, OS, and process-crash claims.",
    );
  }
  if (
    !text.includes("abstract") ||
    !text.includes("storage-media") ||
    !text.includes("distributed")
  ) {
    failures.push(
      "Protocol coverage limitations must bound abstract failure and infrastructure claims.",
    );
  }
  if (!text.includes("tst-009")) {
    failures.push("Protocol coverage limitations must keep TST-009 unresolved.");
  }
}

function isRfc3339(value) {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}
