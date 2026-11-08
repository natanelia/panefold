import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const baselineRef =
  process.env.PANEFOLD_BENCHMARK_BASE ?? "81b11b4fab78a8824243fd6b3a28e50131b997f0";
const urls = new Map();

// The pinned baseline predates resize plans. Compare every shared layout field
// and verify the new metadata separately; timed candidate solves still include
// the full cost of capturing their plans.
export function assertLayoutGeometry(candidate, baseline) {
  const splitters = candidate.splitters.map(({ resize, ...splitter }) => {
    assert.ok(resize, `Missing resize plan for ${splitter.id}`);
    const { plan, beforeIndex, afterIndex } = resize;
    assert.equal(plan.items[beforeIndex]?.key, splitter.beforeNodeId);
    assert.equal(plan.items[afterIndex]?.key, splitter.afterNodeId);
    for (const [index, item] of plan.items.entries()) {
      const rect = candidate.nodeRects[item.key];
      const size = splitter.axis === "inline" ? rect?.inlineSize : rect?.blockSize;
      assert.equal(plan.allocation.sizes[index], size ?? 0);
    }
    return splitter;
  });
  assert.deepEqual({ ...candidate, splitters }, baseline);
}

// Run the actual pinned pre-change TypeScript, not a hand-optimized imitation.
// Geometry has only local runtime imports; type-only model imports are erased.
export async function loadBaselineGeometry(name) {
  function moduleUrl(moduleName) {
    if (urls.has(moduleName)) return urls.get(moduleName);
    if (!/^[a-z-]+$/.test(moduleName)) throw new Error("Unexpected geometry module name");
    const source = execFileSync(
      "git",
      ["show", `${baselineRef}:packages/geometry/src/${moduleName}.ts`],
      { cwd: root, encoding: "utf8" },
    );
    let { outputText } = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    });
    outputText = outputText.replace(
      /from "\.\/([a-z-]+)\.js"/g,
      (_, dependency) => `from "${moduleUrl(dependency)}"`,
    );
    const url = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
    urls.set(moduleName, url);
    return url;
  }
  return import(moduleUrl(name));
}
