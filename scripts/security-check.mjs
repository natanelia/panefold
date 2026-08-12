import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import process from "node:process";

const sourceRoots = ["packages", "apps"];
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const forbidden = [
  ["dynamic eval", /\beval\s*\(/u],
  ["Function constructor", /\bnew\s+Function\b/u],
  ["HTML string sink", /\.(?:innerHTML|outerHTML)\s*=/u],
  ["React raw HTML sink", /\bdangerouslySetInnerHTML\b/u],
  ["document.write sink", /\bdocument\.write\s*\(/u],
];

const failures = [];
for (const root of sourceRoots) {
  for (const file of await files(root)) {
    if (!sourceExtensions.has(extname(file))) continue;
    const source = await readFile(file, "utf8");
    for (const [label, pattern] of forbidden) {
      if (pattern.test(source)) failures.push(`${relative(".", file)}: forbidden ${label}`);
    }
  }
}

const demoHtml = await readFile("apps/demo/index.html", "utf8");
for (const directive of ["script-src 'self'", "object-src 'none'", "base-uri 'self'"]) {
  if (!demoHtml.includes(directive)) failures.push(`apps/demo/index.html: CSP lacks ${directive}`);
}

const siteHtml = await readFile("apps/site/index.html", "utf8");
for (const directive of [
  "default-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
]) {
  if (!siteHtml.includes(directive)) failures.push(`apps/site/index.html: CSP lacks ${directive}`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Security source and CSP checks passed.\n");
}

async function files(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await files(path)));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}
