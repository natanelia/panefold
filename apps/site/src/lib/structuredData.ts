import { docBySlug } from "../content/docs";

const siteOrigin = "https://natanelia.github.io/panefold";

interface PageMetadata {
  readonly title: string;
  readonly description: string;
  readonly path: string;
}

export function installStructuredData(): void {
  const existing = document.getElementById("panefold-structured-data");
  const structuredData =
    existing instanceof HTMLScriptElement ? existing : document.createElement("script");
  structuredData.id = "panefold-structured-data";
  structuredData.type = "application/ld+json";
  structuredData.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: "Panefold",
    description: "Experimental deterministic workspace runtime for panel-heavy web applications.",
    codeRepository: "https://github.com/natanelia/panefold",
    license: "https://opensource.org/licenses/MIT",
    programmingLanguage: "TypeScript",
    runtimePlatform: "Web browser",
  });
  if (existing === null) document.head.append(structuredData);
}

export function updatePageMetadata(path: string): void {
  const metadata = metadataFor(path);
  const canonicalUrl = `${siteOrigin}${metadata.path === "/" ? "/" : `${metadata.path}/`}`;

  document.title = metadata.title;
  setMeta("name", "description", metadata.description);
  setMeta("property", "og:title", metadata.title);
  setMeta("property", "og:description", metadata.description);
  setMeta("property", "og:url", canonicalUrl);
  setMeta("name", "twitter:title", metadata.title);
  setMeta("name", "twitter:description", metadata.description);

  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  canonical?.setAttribute("href", canonicalUrl);
}

function metadataFor(path: string): PageMetadata {
  if (path === "/demo") {
    return {
      title: "Live code workbench — Panefold",
      description:
        "Try the interactive Panefold Code fixture powered by Panefold's deterministic workspace runtime.",
      path,
    };
  }

  if (path === "/docs") {
    return {
      title: "Documentation — Panefold",
      description:
        "Build your first workspace. Learn React integration, panel components, tab rails, themes, commands and persistence.",
      path,
    };
  }

  if (path.startsWith("/docs/")) {
    const slug = path.slice("/docs/".length);
    const page = docBySlug(slug);
    if (page !== undefined) {
      return {
        title: `${page.title} — Panefold documentation`,
        description: page.description,
        path,
      };
    }
  }

  if (path !== "/")
    return {
      title: "Page not found — Panefold",
      description: "This page is not in the Panefold documentation catalog.",
      path,
    };

  return {
    title: "Panefold — Build tools. Not tab management.",
    description:
      "Dockable panels, resizable splits and layouts that come back. An experimental TypeScript workspace runtime for web applications.",
    path: "/",
  };
}

function setMeta(attribute: "name" | "property", key: string, content: string): void {
  document
    .querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
    ?.setAttribute("content", content);
}
