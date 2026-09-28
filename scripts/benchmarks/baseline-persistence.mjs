import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const baselineRef =
  process.env.PANEFOLD_BENCHMARK_BASE ?? "81b11b4fab78a8824243fd6b3a28e50131b997f0";
const root = fileURLToPath(new URL("../../", import.meta.url));
const source = execFileSync(
  "git",
  ["show", `${baselineRef}:packages/runtime/src/persistence-codec.ts`],
  { cwd: root, encoding: "utf8" },
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
});
const linked = outputText.replace(
  'from "@panefold/kernel"',
  `from "${new URL("../../packages/kernel/dist/index.js", import.meta.url).href}"`,
);
export const baselineCodec = await import(
  `data:text/javascript;base64,${Buffer.from(linked).toString("base64")}`
);
