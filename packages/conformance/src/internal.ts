import type { AuditResult, ConformanceDisposition, ConformanceIssue } from "./types";

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[.:_-][a-z0-9]+)*$/;
const REQUIREMENT_ID_PATTERN = /^[A-Z][A-Z0-9]{1,7}-[0-9]{3}$/;
const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const RFC_3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const MAX_RECORDS = 10_000;
export const MAX_STRING_LENGTH = 8_192;

/** Locale-independent lexicographic order over JavaScript UTF-16 code units. */
export function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function issue(
  code: string,
  disposition: ConformanceDisposition,
  path: string,
  message: string,
): ConformanceIssue {
  return { code, disposition, path, message };
}

export function result<Value>(
  value: Value | undefined,
  issues: readonly ConformanceIssue[],
): AuditResult<Value> {
  return {
    valid: value !== undefined && !issues.some((entry) => entry.disposition === "invalid"),
    value,
    issues: sortIssues(issues),
  };
}

export function sortIssues(issues: readonly ConformanceIssue[]): readonly ConformanceIssue[] {
  return [...issues].sort((left, right) => {
    const byPath = compareCodeUnits(left.path, right.path);
    if (byPath !== 0) return byPath;
    const byCode = compareCodeUnits(left.code, right.code);
    if (byCode !== 0) return byCode;
    const byDisposition = compareCodeUnits(left.disposition, right.disposition);
    if (byDisposition !== 0) return byDisposition;
    return compareCodeUnits(left.message, right.message);
  });
}

export function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => "value" in descriptor,
  );
}

export function unknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): readonly string[] {
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .sort();
}

export function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_STRING_LENGTH;
}

export function isIdentifier(value: unknown): value is string {
  return isBoundedString(value) && IDENTIFIER_PATTERN.test(value);
}

export function isRequirementId(value: unknown): value is string {
  return typeof value === "string" && REQUIREMENT_ID_PATTERN.test(value);
}

export function isSemver(value: unknown): value is string {
  return typeof value === "string" && value.length <= 256 && SEMVER_PATTERN.test(value);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function isRfc3339(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    RFC_3339_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function parseStringArray(
  value: unknown,
  path: string,
  issues: ConformanceIssue[],
  options: { readonly allowEmpty?: boolean; readonly identifier?: boolean } = {},
): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue("EXPECTED_STRING_ARRAY", "invalid", path, "Expected an array of strings."));
    return undefined;
  }
  if (value.length > MAX_RECORDS) {
    issues.push(
      issue(
        "ARRAY_LIMIT_EXCEEDED",
        "invalid",
        path,
        `Array exceeds the ${MAX_RECORDS.toString()} item validation limit.`,
      ),
    );
    return undefined;
  }
  if (value.length === 0 && options.allowEmpty === false) {
    issues.push(issue("EMPTY_ARRAY", "invalid", path, "At least one item is required."));
  }

  const parsed: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const entryPath = `${path}/${index.toString()}`;
    const valid = options.identifier === true ? isIdentifier(entry) : isBoundedString(entry);
    if (!valid) {
      issues.push(
        issue(
          options.identifier === true ? "INVALID_IDENTIFIER" : "INVALID_STRING",
          "invalid",
          entryPath,
          options.identifier === true
            ? "Expected a lowercase machine identifier."
            : "Expected a non-empty bounded string.",
        ),
      );
      return;
    }
    if (seen.has(entry)) {
      issues.push(issue("DUPLICATE_ITEM", "invalid", entryPath, `Duplicate item: ${entry}`));
      return;
    }
    seen.add(entry);
    parsed.push(entry);
  });
  return parsed;
}

export function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

export function countByDisposition(
  issues: readonly ConformanceIssue[],
): Readonly<Record<ConformanceDisposition, number>> {
  const counts: Record<ConformanceDisposition, number> = {
    invalid: 0,
    blocked: 0,
    unresolved: 0,
    warning: 0,
  };
  issues.forEach((entry) => {
    counts[entry.disposition] += 1;
  });
  return counts;
}
