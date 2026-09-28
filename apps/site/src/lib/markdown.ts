/** Preserve the normative source's figures and chapter hierarchy without allowing raw HTML. */
export function preparedMarkdown(source: string, slug: string): string {
  let result = source.replaceAll("<u>", "").replaceAll("</u>", "");
  result = result.replace(
    /<img\s+src="([^"]+)"\s+title="([^"]+)"\s+style="[^"]*"\s+alt="([^"]+)"\s*\/>/g,
    '![$3]($1 "$2")',
  );
  if (slug === "system-design") {
    result = result.replace(
      /^(#{1,5})(\s+)/gm,
      (_, marks: string, spacing: string) => `${marks}#${spacing}`,
    );
    result = result.replace(/\(#appendix-([a-j])\.-/g, "(#appendix-$1-");
  }
  return result;
}
