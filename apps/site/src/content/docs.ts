export type DocSection = "Start" | "Build" | "Reference" | "Decisions" | "Specification";

export interface DocPage {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly section: DocSection;
  readonly loadSource: () => Promise<string>;
  readonly eyebrow?: string;
}

const raw = (loader: () => Promise<{ default: string }>) => () =>
  loader().then((item) => item.default);

export const docPages = [
  {
    slug: "overview",
    title: "Overview",
    description: "What Panefold is, what works today, and how to run it.",
    section: "Start",
    loadSource: raw(() => import("../../../../README.md?raw")),
    eyebrow: "Start here",
  },
  {
    slug: "architecture",
    title: "Architecture",
    description: "Authority boundaries, state flow, and package responsibilities.",
    section: "Build",
    loadSource: raw(() => import("../../../../docs/ARCHITECTURE.md?raw")),
  },
  {
    slug: "commands",
    title: "Command catalog",
    description: "All 36 semantic commands and their current support boundaries.",
    section: "Build",
    loadSource: raw(() => import("../../../../docs/COMMANDS.md?raw")),
  },
  {
    slug: "support",
    title: "Support matrix",
    description: "Framework, browser, surface, and capability status without hand-waving.",
    section: "Reference",
    loadSource: raw(() => import("../../../../docs/SUPPORT.md?raw")),
  },
  {
    slug: "conformance",
    title: "Conformance",
    description: "Evidence inventory, hard gates, and the meaning of experimental.",
    section: "Reference",
    loadSource: raw(() => import("../../../../docs/CONFORMANCE.md?raw")),
  },
  {
    slug: "roadmap",
    title: "Roadmap",
    description: "Completed engineering and the external evidence still required.",
    section: "Reference",
    loadSource: raw(() => import("../../../../docs/ROADMAP.md?raw")),
  },
  {
    slug: "adr-authoritative-kernel",
    title: "Authoritative kernel",
    description: "Why all committed workspace state has one semantic owner.",
    section: "Decisions",
    loadSource: raw(() => import("../../../../docs/adr/0001-authoritative-kernel.md?raw")),
    eyebrow: "ADR 0001",
  },
  {
    slug: "adr-experimental-scope",
    title: "Experimental scope",
    description: "Why feature implementation and stable conformance are separate claims.",
    section: "Decisions",
    loadSource: raw(() => import("../../../../docs/adr/0002-experimental-scope.md?raw")),
    eyebrow: "ADR 0002",
  },
  {
    slug: "adr-schema-command-catalog",
    title: "Schema v2 and commands",
    description: "Snapshot evolution and the single command inventory.",
    section: "Decisions",
    loadSource: raw(() => import("../../../../docs/adr/0003-schema-v2-and-command-catalog.md?raw")),
    eyebrow: "ADR 0003",
  },
  {
    slug: "adr-panel-lifecycle",
    title: "Panel lifecycle",
    description: "Stable hosts, suspension, cancellation, and renderer policy.",
    section: "Decisions",
    loadSource: raw(() => import("../../../../docs/adr/0004-panel-lifecycle-contract.md?raw")),
    eyebrow: "ADR 0004",
  },
  {
    slug: "adr-persistence-trust",
    title: "Persistence and trust",
    description: "Durable journals, decoder bounds, and security boundaries.",
    section: "Decisions",
    loadSource: raw(
      () => import("../../../../docs/adr/0005-durable-journal-and-trust-boundaries.md?raw"),
    ),
    eyebrow: "ADR 0005",
  },
  {
    slug: "adr-external-surfaces",
    title: "External surfaces",
    description: "Prepared transfer, ownership epochs, and orphan recovery.",
    section: "Decisions",
    loadSource: raw(
      () => import("../../../../docs/adr/0006-prepared-external-surface-ownership.md?raw"),
    ),
    eyebrow: "ADR 0006",
  },
  {
    slug: "system-design",
    title: "System design",
    description: "The complete normative design and 190-requirement register source.",
    section: "Specification",
    loadSource: raw(() => import("../../../../docs/spec/SYSTEM_DESIGN.md?raw")),
    eyebrow: "Normative source",
  },
] as const satisfies readonly DocPage[];

export const docSections = ["Start", "Build", "Reference", "Decisions", "Specification"] as const;

export function docBySlug(slug: string): DocPage | undefined {
  return docPages.find((page) => page.slug === slug);
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

export function headingsFor(source: string): readonly Heading[] {
  return source
    .split("\n")
    .flatMap((line): Heading[] => {
      const match = /^(##|###)\s+(.+?)\s*$/.exec(line);
      if (match === null) return [];
      const capturedLabel = match[2];
      if (capturedLabel === undefined) return [];
      const label = capturedLabel
        .replace(/\s+#+$/, "")
        .replace(/[*`]/g, "")
        .trim();
      return [{ depth: match[1] === "##" ? 2 : 3, label, id: headingId(label) }];
    })
    .slice(0, 24);
}
