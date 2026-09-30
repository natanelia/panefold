import { describe, expect, it } from "vitest";
import { docBySlug, docPages, headingAnchors, headingsFor, resolveDocLink } from "./docs";
import { preparedMarkdown } from "../lib/markdown";

describe("documentation source contracts", () => {
  it("loads every catalog document and keeps slugs unique", async () => {
    expect(new Set(docPages.map((page) => page.slug)).size).toBe(docPages.length);
    for (const page of docPages)
      expect(await page.loadSource(), page.sourcePath).toMatch(/^#{1,3} /m);
  });
  it("ignores code-fence headings and gives duplicate sections stable anchors", () => {
    const source =
      "## Hello `world`\n```md\n## Not a section\n```\n## Hello world\n### Child\n~~~\n## Also not a heading\n~~~";
    expect(headingsFor(source).map((item) => item.id)).toEqual([
      "hello-world",
      "hello-world-1",
      "child",
    ]);
    expect([...headingAnchors(source).keys()]).toEqual([1, 5, 6]);
  });
  it("resolves links from each source directory and rejects unsafe schemes", () => {
    const page = docBySlug("react");
    if (page === undefined) throw new Error("React guide missing");
    expect(resolveDocLink("tabs.md#choose-a-rail", page)).toEqual({
      kind: "site",
      href: "/docs/tabs#choose-a-rail",
    });
    expect(resolveDocLink("../PERFORMANCE.md", page)).toEqual({
      kind: "site",
      href: "/docs/performance",
    });
    expect(resolveDocLink("../../apps/demo/src/docs-starter.tsx", page)?.href).toMatch(
      /\/blob\/main\/apps\/demo\/src\/docs-starter\.tsx$/,
    );
    expect(resolveDocLink("/workbench/?fixture=starter", page)).toEqual({
      kind: "site",
      href: "/workbench/?fixture=starter",
    });
    for (const href of ["javascript:alert(1)", "data:text/html,bad", "//other.example", ""])
      expect(resolveDocLink(href, page)).toBeUndefined();
  });
  it("retains all fourteen system-design figures with one shell-owned h1", async () => {
    const source = await docBySlug("system-design")?.loadSource();
    if (source === undefined) throw new Error("System design missing");
    const body = preparedMarkdown(source, "system-design");
    expect(body.match(/^# /gm)).toBeNull();
    expect(body.match(/!\[[^\]]*\]\(media\//g)).toHaveLength(14);
    expect(headingAnchors(body).size).toBeGreaterThan(50);
  });
});
