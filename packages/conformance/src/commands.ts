import {
  compareCodeUnits,
  isBoundedString,
  isIdentifier,
  isPlainRecord,
  issue,
  MAX_RECORDS,
  parseStringArray,
  sortIssues,
  sortedUnique,
  unknownKeys,
} from "./internal";
import type {
  CommandParityReport,
  CommandRegistryEntry,
  CommandSupportStatus,
  ConformanceIssue,
} from "./types";

const COMMAND_KEYS = new Set(["type", "status", "execution", "limitations"]);
const COMMAND_STATUSES: ReadonlySet<CommandSupportStatus> = new Set([
  "stable-implemented",
  "experimental-implemented",
  "deprecated-implemented",
  "unsupported",
]);

function parseCommandEntry(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): CommandRegistryEntry | undefined {
  if (!isPlainRecord(input)) {
    issues.push(
      issue("INVALID_COMMAND_ENTRY", "invalid", path, "Expected a plain command registry entry."),
    );
    return undefined;
  }
  unknownKeys(input, COMMAND_KEYS).forEach((key) => {
    issues.push(
      issue("UNKNOWN_COMMAND_FIELD", "invalid", `${path}/${key}`, `Unknown command field: ${key}`),
    );
  });

  const type = input.type;
  const status = input.status;
  const execution = input.execution;
  if (!isIdentifier(type)) {
    issues.push(issue("INVALID_COMMAND_TYPE", "invalid", `${path}/type`, "Invalid command type."));
  }
  if (typeof status !== "string" || !COMMAND_STATUSES.has(status as CommandSupportStatus)) {
    issues.push(
      issue(
        "INVALID_COMMAND_STATUS",
        "invalid",
        `${path}/status`,
        "Invalid command support status.",
      ),
    );
  }
  const limitations = parseStringArray(input.limitations, `${path}/limitations`, issues);
  const parsedExecution: string | null | undefined =
    status === "unsupported"
      ? execution === null
        ? null
        : undefined
      : isBoundedString(execution)
        ? execution
        : undefined;

  if (status === "unsupported") {
    if (execution !== null) {
      issues.push(
        issue(
          "UNSUPPORTED_COMMAND_HAS_EXECUTION",
          "invalid",
          `${path}/execution`,
          "Unsupported commands must use a null execution owner.",
        ),
      );
    }
    if (limitations !== undefined && limitations.length === 0) {
      issues.push(
        issue(
          "UNSUPPORTED_COMMAND_WITHOUT_REASON",
          "invalid",
          `${path}/limitations`,
          "Unsupported commands need at least one explicit limitation.",
        ),
      );
    }
  } else if (!isBoundedString(execution)) {
    issues.push(
      issue(
        "IMPLEMENTED_COMMAND_WITHOUT_EXECUTION",
        "invalid",
        `${path}/execution`,
        "Implemented commands must identify their execution owner.",
      ),
    );
  }

  if (
    !isIdentifier(type) ||
    typeof status !== "string" ||
    !COMMAND_STATUSES.has(status as CommandSupportStatus) ||
    limitations === undefined ||
    parsedExecution === undefined
  ) {
    return undefined;
  }

  return {
    type,
    status: status as CommandSupportStatus,
    execution: parsedExecution,
    limitations,
  };
}

/**
 * Compares documentation/status metadata with an authoritative runtime command inventory.
 * Pass `WORKSPACE_COMMAND_TYPES` from `@panefold/model` as `authoritativeCommandTypes`.
 */
export function auditCommandRegistry(
  authoritativeCommandTypes: readonly string[],
  registry: readonly unknown[],
): CommandParityReport {
  const issues: ConformanceIssue[] = [];
  if (authoritativeCommandTypes.length > MAX_RECORDS) {
    issues.push(
      issue(
        "COMMAND_INVENTORY_LIMIT_EXCEEDED",
        "invalid",
        "/commands/expected",
        `Command inventory exceeds ${MAX_RECORDS.toString()} entries.`,
      ),
    );
  }

  const expectedSeen = new Set<string>();
  const duplicateExpected: string[] = [];
  authoritativeCommandTypes.forEach((type, index) => {
    if (!isIdentifier(type)) {
      issues.push(
        issue(
          "INVALID_AUTHORITATIVE_COMMAND",
          "invalid",
          `/commands/expected/${index.toString()}`,
          "Authoritative command types must be lowercase machine identifiers.",
        ),
      );
      return;
    }
    if (expectedSeen.has(type)) duplicateExpected.push(type);
    expectedSeen.add(type);
  });
  sortedUnique(duplicateExpected).forEach((type) => {
    issues.push(
      issue(
        "DUPLICATE_AUTHORITATIVE_COMMAND",
        "invalid",
        "/commands/expected",
        `Authoritative command inventory contains a duplicate: ${type}`,
      ),
    );
  });

  const parsed: CommandRegistryEntry[] = [];
  const documentedSeen = new Set<string>();
  const duplicates: string[] = [];
  if (registry.length > MAX_RECORDS) {
    issues.push(
      issue(
        "COMMAND_REGISTRY_LIMIT_EXCEEDED",
        "invalid",
        "/commands/registry",
        `Command registry exceeds ${MAX_RECORDS.toString()} entries.`,
      ),
    );
  } else {
    registry.forEach((entry, index) => {
      const command = parseCommandEntry(entry, `/commands/registry/${index.toString()}`, issues);
      if (command === undefined) return;
      if (documentedSeen.has(command.type)) {
        duplicates.push(command.type);
        return;
      }
      documentedSeen.add(command.type);
      parsed.push(command);
    });
  }

  const expected = sortedUnique([...expectedSeen]);
  const documented = sortedUnique([...documentedSeen]);
  const missing = expected.filter((type) => !documentedSeen.has(type));
  const unknown = documented.filter((type) => !expectedSeen.has(type));
  const duplicate = sortedUnique(duplicates);

  if (missing.length > 0) {
    issues.push(
      issue(
        "COMMAND_DOCUMENTATION_INCOMPLETE",
        "unresolved",
        "/commands/registry",
        `${missing.length.toString()} authoritative command(s) lack status metadata: ${missing.join(", ")}`,
      ),
    );
  }
  unknown.forEach((type) => {
    issues.push(
      issue(
        "UNKNOWN_DOCUMENTED_COMMAND",
        "invalid",
        "/commands/registry",
        `Documented command is absent from the authoritative inventory: ${type}`,
      ),
    );
  });
  duplicate.forEach((type) => {
    issues.push(
      issue(
        "DUPLICATE_DOCUMENTED_COMMAND",
        "invalid",
        "/commands/registry",
        `Command is documented more than once: ${type}`,
      ),
    );
  });

  return {
    expected,
    documented,
    missing,
    unknown,
    duplicate,
    entries: parsed.sort((left, right) => compareCodeUnits(left.type, right.type)),
    issues: sortIssues(issues),
  };
}
