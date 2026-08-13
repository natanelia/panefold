import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const siteDist = resolve(root, "apps/site/dist");
const demoDist = resolve(root, "apps/demo/dist");
const siteOrigin = "https://natanelia.github.io/panefold";
const siteRoutes = [
  {
    path: "demo",
    title: "Live Atlas workspace — Panefold",
    description:
      "Try the interactive Atlas map-operations fixture powered by Panefold's deterministic workspace runtime.",
  },
  {
    path: "docs",
    title: "Documentation — Panefold",
    description:
      "Explore Panefold architecture, commands, support boundaries, conformance evidence, decisions, and system design.",
  },
  {
    path: "docs/overview",
    title: "Overview — Panefold documentation",
    description: "What Panefold is, what works today, and how to run it.",
  },
  {
    path: "docs/architecture",
    title: "Architecture — Panefold documentation",
    description: "Authority boundaries, state flow, and package responsibilities.",
  },
  {
    path: "docs/commands",
    title: "Command catalog — Panefold documentation",
    description: "All 36 semantic commands and their current support boundaries.",
  },
  {
    path: "docs/support",
    title: "Support matrix — Panefold documentation",
    description: "Framework, browser, surface, and capability status without hand-waving.",
  },
  {
    path: "docs/conformance",
    title: "Conformance — Panefold documentation",
    description: "Evidence inventory, hard gates, and the meaning of experimental.",
  },
  {
    path: "docs/design-audit",
    title: "System-design audit — Panefold documentation",
    description: "An exact 190-requirement implementation and evidence matrix.",
  },
  {
    path: "docs/roadmap",
    title: "Roadmap — Panefold documentation",
    description: "Completed engineering and the external evidence still required.",
  },
  {
    path: "docs/marketing",
    title: "Marketing and launch — Panefold documentation",
    description: "Product narrative, interaction media, measurement, and launch operations.",
  },
  {
    path: "docs/adr-authoritative-kernel",
    title: "Authoritative kernel — Panefold documentation",
    description: "Why all committed workspace state has one semantic owner.",
  },
  {
    path: "docs/adr-experimental-scope",
    title: "Experimental scope — Panefold documentation",
    description: "Why feature implementation and stable conformance are separate claims.",
  },
  {
    path: "docs/adr-schema-command-catalog",
    title: "Schema v2 and commands — Panefold documentation",
    description: "Snapshot evolution and the single command inventory.",
  },
  {
    path: "docs/adr-panel-lifecycle",
    title: "Panel lifecycle — Panefold documentation",
    description: "Stable hosts, suspension, cancellation, and renderer policy.",
  },
  {
    path: "docs/adr-persistence-trust",
    title: "Persistence and trust — Panefold documentation",
    description: "Durable journals, decoder bounds, and security boundaries.",
  },
  {
    path: "docs/adr-external-surfaces",
    title: "External surfaces — Panefold documentation",
    description: "Prepared transfer, ownership epochs, and orphan recovery.",
  },
  {
    path: "docs/adr-panel-plugin-boundaries",
    title: "Panel and plugin boundaries — Panefold documentation",
    description: "Versioned codecs, deterministic registration, and missing-provider recovery.",
  },
  {
    path: "docs/adr-single-writer-coordination",
    title: "Single-writer coordination — Panefold documentation",
    description: "Authenticated intake, revision assignment, epochs, and presence separation.",
  },
  {
    path: "docs/adr-fail-closed-runtime",
    title: "Fail-closed runtime — Panefold documentation",
    description: "Last-valid-state preservation and bounded redacted incident reproduction.",
  },
  {
    path: "docs/adr-evidence-taxonomy",
    title: "Executable evidence taxonomy — Panefold documentation",
    description: "Proof classes, immutable artifacts, trace coverage, and hard-gate rules.",
  },
  {
    path: "docs/adr-independent-oracle",
    title: "Independent semantic oracle — Panefold documentation",
    description: "Why semantic independence and production optimization remain separate claims.",
  },
  {
    path: "docs/adr-protocol-motion-lifecycles",
    title: "Protocol and motion lifecycles — Panefold documentation",
    description: "Bounded actors, disposable leases, and progressive animation fallback.",
  },
  {
    path: "docs/adr-direct-placement-durable-demo",
    title: "Direct placement and durable Atlas — Panefold documentation",
    description:
      "Revision-bound docking, controlled live popouts, tab presentation, and restore-before-render persistence.",
  },
  {
    path: "docs/adr-post-commit-effects",
    title: "Post-commit effect delivery — Panefold documentation",
    description:
      "Deterministic effect identity, bounded duplicate suppression, and honest retry guarantees.",
  },
  {
    path: "docs/system-design",
    title: "System design — Panefold documentation",
    description: "The complete normative design and 190-requirement register source.",
  },
];

await stat(resolve(demoDist, "index.html")).catch(() => {
  throw new Error("Atlas demo must be built before the marketing site");
});

await copyStableTree(demoDist, resolve(siteDist, "atlas"));
const rootHtml = await readFile(resolve(siteDist, "index.html"), "utf8");
for (const route of siteRoutes) {
  const routeDirectory = resolve(siteDist, route.path);
  await mkdir(routeDirectory, { recursive: true });
  await writeFile(resolve(routeDirectory, "index.html"), withMetadata(rootHtml, route));
}
await copyFile(resolve(siteDist, "index.html"), resolve(siteDist, "404.html"));

function withMetadata(html, route) {
  const canonicalUrl = `${siteOrigin}/${route.path}/`;
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(route.title)}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*("\s*\/?>)/,
      `$1${escapeHtml(route.description)}$2`,
    )
    .replace(
      /(<meta\s+property="og:title"\s+content=")[^"]*("\s*\/?>)/,
      `$1${escapeHtml(route.title)}$2`,
    )
    .replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*("\s*\/?>)/,
      `$1${escapeHtml(route.description)}$2`,
    )
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*("\s*\/?>)/, `$1${canonicalUrl}$2`)
    .replace(
      /(<meta\s+name="twitter:title"\s+content=")[^"]*("\s*\/?>)/,
      `$1${escapeHtml(route.title)}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:description"\s+content=")[^"]*("\s*\/?>)/,
      `$1${escapeHtml(route.description)}$2`,
    )
    .replace(/(<link\s+rel="canonical"\s+href=")[^"]*("\s*\/?>)/, `$1${canonicalUrl}$2`);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function copyStableTree(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    // Vite uses hidden, short-lived files while publishing sourcemaps. They are not deployable
    // assets and may disappear between readdir and copy on fast CI filesystems.
    if (entry.name.startsWith(".")) continue;
    const sourcePath = resolve(source, entry.name);
    const destinationPath = resolve(destination, entry.name);
    if (entry.isDirectory()) await copyStableTree(sourcePath, destinationPath);
    else if (entry.isFile()) await copyFile(sourcePath, destinationPath);
  }
}
