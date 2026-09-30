import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const siteOrigin = "https://natanelia.github.io/panefold";
export async function readSiteCatalog(root = resolve(import.meta.dirname, "..")) {
  const pages = JSON.parse(
    await readFile(resolve(root, "apps/site/src/content/doc-catalog.json"), "utf8"),
  );
  const slugs = new Set();
  for (const page of pages) {
    if (!/^[a-z0-9-]+$/.test(page.slug) || slugs.has(page.slug))
      throw new Error(`Invalid or duplicate document slug: ${page.slug}`);
    slugs.add(page.slug);
    if (!/^docs\/[a-zA-Z0-9_./-]+\.md$/.test(page.sourcePath) || page.sourcePath.includes(".."))
      throw new Error(`Invalid document source: ${page.sourcePath}`);
    await readFile(resolve(root, page.sourcePath), "utf8");
  }
  return [
    {
      path: "demo",
      title: "Live code workbench — Panefold",
      description:
        "Try the interactive Panefold Code fixture powered by Panefold's deterministic workspace runtime.",
    },
    {
      path: "docs",
      title: "Documentation — Panefold",
      description:
        "Build your first workspace. Learn React integration, panel components, tab rails, themes, commands and persistence.",
    },
    ...pages.map((page) => ({
      path: `docs/${page.slug}`,
      title: `${page.title} — Panefold documentation`,
      description: page.description,
    })),
  ];
}
export function previewSiteBase(demoBase) {
  // Only opt into nested docs for the existing same-repository Pages preview pipeline.
  // This must remain a path, never an arbitrary executable command or external URL.
  if (
    typeof demoBase !== "string" ||
    /^\/\.{1,2}\//.test(demoBase) ||
    !/^\/[a-zA-Z0-9_.-]+\/previews\/pr-[1-9][0-9]*\/workbench\/$/.test(demoBase)
  )
    return undefined;
  return `${demoBase}site/`;
}
