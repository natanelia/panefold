import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";

const SHA_256 = /^[a-f0-9]{64}$/u;

export async function verifyRepositoryEvidence(evidence, options = {}) {
  const failures = [];
  const root = await realpath(options.root ?? process.cwd());
  const allowMissingResultSourceDigestIds = new Set(
    options.allowMissingResultSourceDigestIds ?? [],
  );
  for (const record of evidence) {
    if (record.status !== "verified" || !record.uri?.startsWith("repo://")) continue;
    const repositoryPath = record.uri.slice("repo://".length);
    const artifact = await readRepositoryArtifact(root, repositoryPath, record.id, failures);
    if (artifact === undefined) continue;
    const actual = digest(artifact.bytes);
    if (actual !== record.sha256) {
      failures.push(
        `Evidence digest mismatch for ${record.id}: expected ${String(record.sha256)}, received ${actual}.`,
      );
    }
    if (record.artifactRole !== "result") continue;
    await verifyResultSourceDigests({
      root,
      evidenceId: record.id,
      resultBytes: artifact.bytes,
      failures,
      allowMissing: allowMissingResultSourceDigestIds.has(record.id),
    });
  }
  return failures;
}

async function verifyResultSourceDigests({
  root,
  evidenceId,
  resultBytes,
  failures,
  allowMissing,
}) {
  let result;
  try {
    result = JSON.parse(resultBytes.toString("utf8"));
  } catch (error) {
    failures.push(
      `Evidence result is not valid JSON for ${evidenceId}: ${error instanceof Error ? error.message : String(error)}.`,
    );
    return;
  }
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    failures.push(`Evidence result for ${evidenceId} must be a JSON object.`);
    return;
  }
  if (!Object.hasOwn(result, "sourceDigests")) {
    if (!allowMissing) {
      failures.push(`Result sourceDigests for ${evidenceId} must be a non-empty JSON object.`);
    }
    return;
  }
  const sourceDigests = result.sourceDigests;
  if (sourceDigests === null || typeof sourceDigests !== "object" || Array.isArray(sourceDigests)) {
    failures.push(`Result sourceDigests for ${evidenceId} must be a non-empty JSON object.`);
    return;
  }
  if (Object.keys(sourceDigests).length === 0) {
    failures.push(`Result sourceDigests for ${evidenceId} must be a non-empty JSON object.`);
    return;
  }
  for (const [sourcePath, expected] of Object.entries(sourceDigests)) {
    if (typeof expected !== "string" || !SHA_256.test(expected)) {
      failures.push(
        `Result source digest for ${evidenceId} (${sourcePath}) must be a lowercase SHA-256 digest.`,
      );
      continue;
    }
    const source = await readRepositoryArtifact(root, sourcePath, evidenceId, failures, "source");
    if (source === undefined) continue;
    const actual = digest(source.bytes);
    if (actual !== expected) {
      failures.push(
        `Result source digest mismatch for ${evidenceId} (${sourcePath}): expected ${expected}, received ${actual}.`,
      );
    }
  }
}

async function readRepositoryArtifact(
  root,
  repositoryPath,
  evidenceId,
  failures,
  role = "artifact",
) {
  const candidate = resolve(root, repositoryPath);
  const unresolvedPathFromRoot = relative(root, candidate);
  if (escapesRoot(unresolvedPathFromRoot)) {
    failures.push(`Evidence ${role} escapes the repository for ${evidenceId}: ${repositoryPath}.`);
    return undefined;
  }
  let target;
  try {
    target = await realpath(candidate);
  } catch (error) {
    failures.push(
      `Evidence ${role} missing for ${evidenceId}: ${repositoryPath} (${error instanceof Error ? error.message : String(error)}).`,
    );
    return undefined;
  }
  const pathFromRoot = relative(root, target);
  if (escapesRoot(pathFromRoot)) {
    failures.push(`Evidence ${role} escapes the repository for ${evidenceId}: ${repositoryPath}.`);
    return undefined;
  }
  try {
    return { bytes: await readFile(target) };
  } catch (error) {
    failures.push(
      `Evidence ${role} is unreadable for ${evidenceId}: ${repositoryPath} (${error instanceof Error ? error.message : String(error)}).`,
    );
    return undefined;
  }
}

function escapesRoot(pathFromRoot) {
  return pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
