import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const sourcePath = "docs/spec/SYSTEM_DESIGN.md";
const outputPath = "conformance/requirements.json";
const source = await readFile(sourcePath, "utf8");
const appendixStart = source.indexOf("Master normative register (190 requirements)");
const appendixEnd = source.indexOf("# **Appendix B.", appendixStart);
if (appendixStart < 0 || appendixEnd < 0) {
  throw new Error("Could not locate Appendix A in the system design");
}

const requirementPattern =
  /^\|\s*([A-Z][A-Z0-9]{1,7}-[0-9]{3})\s*\|\s*(MUST NOT|MUST|SHOULD NOT|SHOULD)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/u;
const requirements = source
  .slice(appendixStart, appendixEnd)
  .split(/\r?\n/u)
  .flatMap((line) => {
    const match = requirementPattern.exec(line);
    if (match === null) return [];
    const [, id, level, statement, acceptanceEvidence] = match;
    return [
      {
        id,
        level,
        applicability: "profile-scoped",
        statement,
        acceptanceEvidence,
      },
    ];
  });

const unique = new Set(requirements.map((requirement) => requirement.id));
if (requirements.length !== 190 || unique.size !== 190) {
  throw new Error(
    `Expected 190 unique Appendix A requirements, found ${String(requirements.length)} rows and ${String(unique.size)} IDs`,
  );
}

const output = {
  schemaVersion: 1,
  source: {
    path: sourcePath,
    version: "1.0",
    date: "2026-08-07",
    declaredCount: 190,
    extractedCount: requirements.length,
    sha256: createHash("sha256").update(source).digest("hex"),
  },
  requirements,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`Generated ${String(requirements.length)} requirements in ${outputPath}.\n`);
