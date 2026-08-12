import { lazy, Suspense, useEffect } from "react";

import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { HomePage } from "./pages/HomePage";
import { SocialCardPage } from "./pages/SocialCardPage";
import { updatePageMetadata } from "./lib/structuredData";
import { useRoute } from "./lib/router";
import { useMarketingAnalytics } from "./lib/analytics";

const DemoPage = lazy(() =>
  import("./pages/DemoPage").then((module) => ({ default: module.DemoPage })),
);
const DocsPage = lazy(() =>
  import("./pages/DocsPage").then((module) => ({ default: module.DocsPage })),
);

export default function App() {
  const [path, navigate] = useRoute();
  const cleanPath = path.split(/[?#]/)[0] ?? "/";
  useMarketingAnalytics(cleanPath);

  useEffect(() => {
    updatePageMetadata(cleanPath);
  }, [cleanPath]);

  if (cleanPath === "/social-card") return <SocialCardPage />;

  if (cleanPath === "/demo") {
    return (
      <>
        <SkipLink />
        <Header path={cleanPath} navigate={navigate} />
        <Suspense fallback={<RouteLoading />}>
          <DemoPage navigate={navigate} />
        </Suspense>
      </>
    );
  }

  if (cleanPath === "/docs" || cleanPath.startsWith("/docs/")) {
    const slug = cleanPath.startsWith("/docs/") ? cleanPath.slice("/docs/".length) : undefined;
    return (
      <>
        <SkipLink />
        <Header path={cleanPath} navigate={navigate} />
        <Suspense fallback={<RouteLoading />}>
          <DocsPage slug={slug} navigate={navigate} />
        </Suspense>
      </>
    );
  }

  return (
    <>
      <SkipLink />
      <Header path={cleanPath} navigate={navigate} />
      <HomePage navigate={navigate} />
      <Footer navigate={navigate} />
    </>
  );
}

function SkipLink() {
  return (
    <a className="site-skip-link" href="#main-content">
      Skip to main content
    </a>
  );
}

function RouteLoading() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="grid min-h-screen place-items-center bg-[#080c12] pt-[68px]"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">
        Loading Panefold…
      </span>
    </main>
  );
}
