import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readSiteCatalog, siteOrigin } from "./site-catalog.mjs";

const root = resolve(import.meta.dirname, "..");
const siteDist = resolve(root, "apps/site/dist");
const demoDist = resolve(root, "apps/demo/dist");
const siteRoutes = await readSiteCatalog(root);
const preview = (process.env.PANEFOLD_SITE_BASE ?? "").includes("/previews/");

await stat(resolve(demoDist, "index.html")).catch(() => {
  throw new Error("Workbench demo must be built before the marketing site");
});

await copyStableTree(demoDist, resolve(siteDist, "workbench"));
// Retain the previous standalone URL as a compatibility alias.
await copyStableTree(demoDist, resolve(siteDist, "atlas"));
let rootHtml = await readFile(resolve(siteDist, "index.html"), "utf8");
if (preview) {
  rootHtml = rootHtml.replace('content="index,follow"', 'content="noindex,nofollow"');
  await writeFile(resolve(siteDist, "index.html"), rootHtml);
}
const urls = ["", ...siteRoutes.map((route) => route.path)];
await writeFile(
  resolve(siteDist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((path) => `<url><loc>${siteOrigin}/${path ? `${path}/` : ""}</loc></url>`).join("")}</urlset>\n`,
);
if (preview) await writeFile(resolve(siteDist, "robots.txt"), "User-agent: *\nDisallow: /\n");
for (const route of siteRoutes) {
  const routeDirectory = resolve(siteDist, route.path);
  await mkdir(routeDirectory, { recursive: true });
  await writeFile(resolve(routeDirectory, "index.html"), withMetadata(rootHtml, route));
}
await writeFile(
  resolve(siteDist, "404.html"),
  rootHtml.replace('content="index,follow"', 'content="noindex,nofollow"'),
);

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
