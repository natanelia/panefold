import { ArrowLeft, ExternalLink } from "lucide-react";

import { SiteLink } from "../components/SiteLink";
import { siteAsset } from "../lib/router";
import "./playground.css";

export function DemoPage({ navigate }: { readonly navigate: (path: string) => void }) {
  return (
    <main id="main-content" tabIndex={-1} className="playground-page">
      <h1 className="sr-only">Panefold Code live workbench demo</h1>
      <div className="playground-toolbar">
        <SiteLink
          to="/"
          navigate={navigate}
          data-track="demo_back_home"
          className="playground-back"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Back to Panefold
        </SiteLink>
        <p className="playground-description">
          A live workbench. Your layout is saved in this browser.
        </p>
        <a
          href={siteAsset("workbench/")}
          target="_blank"
          rel="noreferrer"
          data-track="demo_open_standalone"
          className="playground-open"
        >
          Open alone <ExternalLink size={15} aria-hidden="true" />
        </a>
      </div>
      <p className="playground-touch-tip">
        Switch panels below. Use a tab’s Actions menu to move or split it.
      </p>
      <iframe
        title="Panefold Code live workbench demo"
        src={siteAsset("workbench/")}
        className="playground-workbench"
      />
    </main>
  );
}
