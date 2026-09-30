import { Brand } from "./Brand";
import { SiteLink } from "./SiteLink";

export function Footer({ navigate }: { readonly navigate: (path: string) => void }) {
  return (
    <footer className="site-footer">
      <div className="footer-inner page-shell">
        <div>
          <SiteLink to="/" navigate={navigate}>
            <Brand />
          </SiteLink>
          <p>Give great tools a place to work.</p>
          <p className="fine-print">
            MIT-licensed source. Experimental packages. Built in the open.
          </p>
        </div>
        <nav aria-label="Footer navigation">
          <SiteLink to="/docs/quickstart" navigate={navigate}>
            Get started
          </SiteLink>
          <SiteLink to="/docs/api" navigate={navigate}>
            API field guide
          </SiteLink>
          <SiteLink to="/docs/support" navigate={navigate}>
            Support & status
          </SiteLink>
          <SiteLink to="/docs/performance" navigate={navigate}>
            Benchmarks
          </SiteLink>
          <a href="https://github.com/natanelia/panefold/blob/main/CONTRIBUTING.md">Contribute</a>
        </nav>
      </div>
    </footer>
  );
}
