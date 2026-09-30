import catalog from "./doc-catalog.json";

export const docSections = [
  "Start",
  "Build",
  "Customize",
  "Operate",
  "Reference",
  "Decisions",
  "Specification",
] as const;
export type DocSection = (typeof docSections)[number];
export interface DocPage {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly section: DocSection;
  readonly sourcePath: string;
  readonly eyebrow?: string;
  readonly loadSource: () => Promise<string>;
}
const sources = import.meta.glob<string>("../../../../docs/**/*.md", {
  query: "?raw",
  import: "default",
});
export const docPages: readonly DocPage[] = catalog.map((page) => ({
  ...page,
  section: page.section as DocSection,
  loadSource: async () => {
    const load = sources[`../../../../${page.sourcePath}`];
    if (load === undefined) throw new Error(`Missing document: ${page.sourcePath}`);
    return load();
  },
}));
export function docBySlug(slug: string): DocPage | undefined {
  return docPages.find((page) => page.slug === slug);
}
export function sourceUrl(path: string): string {
  const ref = import.meta.env.VITE_SOURCE_REF || "main";
  return `https://github.com/natanelia/panefold/${path.endsWith("/") ? "tree" : "blob"}/${ref}/${path}`;
}
export interface Heading {
  readonly depth: 2 | 3;
  readonly label: string;
  readonly id: string;
}
export function headingId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_()[\]{}]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
export function uniqueHeadingId(label: string, seen: Map<string, number>): string {
  const base = headingId(label) || "section";
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}
interface ParsedHeading {
  readonly depth: number;
  readonly label: string;
  readonly id: string;
  readonly line: number;
}
function scanHeadings(source: string): readonly ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  const seen = new Map<string, number>();
  let fence: string | undefined;
  for (const [index, line] of source.split("\n").entries()) {
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (delimiter !== undefined) {
      if (fence === undefined) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const label = match[2]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*`_]/g, "")
      .trim();
    const id = uniqueHeadingId(label, seen);
    headings.push({ depth: match[1].length, label, id, line: index + 1 });
  }
  return headings;
}
export function headingsFor(source: string): readonly Heading[] {
  return scanHeadings(source).filter(
    (item): item is ParsedHeading & Heading => item.depth === 2 || item.depth === 3,
  );
}
export function headingAnchors(source: string): ReadonlyMap<number, string> {
  return new Map(scanHeadings(source).map((item) => [item.line, item.id]));
}
/** Resolve relative Markdown links against their actual source file, not the browser route. */
export function resolveDocLink(
  href: string,
  page: DocPage,
): { readonly kind: "site" | "external" | "anchor"; readonly href: string } | undefined {
  if (href.startsWith("#")) return { kind: "anchor", href };
  if (/^https?:\/\//i.test(href)) return { kind: "external", href };
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//") || href === "") return undefined;
  if (
    /^\/(?:docs|demo|workbench|atlas)(?:[/?#]|$)/.test(href) ||
    href === "/" ||
    href.startsWith("/#")
  )
    return { kind: "site", href };
  const resolved = new URL(href, `https://source.invalid/${page.sourcePath}`);
  const path = resolved.pathname.slice(1);
  const target = docPages.find((item) => item.sourcePath === path);
  if (target !== undefined) return { kind: "site", href: `/docs/${target.slug}${resolved.hash}` };
  if (path === "README.md") return { kind: "site", href: "/docs/overview" };
  return { kind: "external", href: `${sourceUrl(path)}${resolved.hash}` };
}
