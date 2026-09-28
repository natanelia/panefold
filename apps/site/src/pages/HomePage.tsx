import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  Code2,
  Layers3,
  Move,
  PanelsTopLeft,
  RotateCcw,
  Save,
} from "lucide-react";
import { SiteLink } from "../components/SiteLink";
import { CodeBlock } from "../components/CodeBlock";
import { TabPlayground } from "../components/TabPlayground";
import { siteAsset } from "../lib/router";

const features = [
  {
    icon: Move,
    title: "A place for every panel.",
    text: "Dock a document. Split a view. Float an inspector. Give users a workspace that follows their task—not a fixed arrangement they have to work around.",
    link: "layouts",
    cta: "Explore layouts",
  },
  {
    icon: Code2,
    title: "Your components, still yours.",
    text: "Bring the editor, map, chart or data grid you already have. Register React components by type and keep business logic on your side of the boundary.",
    link: "panels",
    cta: "Build a panel",
  },
  {
    icon: RotateCcw,
    title: "Changes you can explain.",
    text: "One command path for interaction, history and application actions. Inspect the result, handle a rejection, or undo a layout change without guessing what mutated.",
    link: "mental-model",
    cta: "Learn the model",
  },
];
export function HomePage({ navigate }: { readonly navigate: (path: string) => void }) {
  const [demoOpen, setDemoOpen] = useState(false);
  return (
    <main id="main-content" tabIndex={-1}>
      <section className="hero page-shell">
        <div className="hero-copy">
          <p className="section-eyebrow">
            <span className="live-dot" /> The workspace engine for web apps
          </p>
          <h1>
            Build tools.
            <br />
            <span>Not tab management.</span>
          </h1>
          <p className="hero-description">
            Dockable panels. Resizable splits. Layouts that come back.
            <br className="desktop-break" /> Give your users room to work—and keep your code in
            control.
          </p>
          <div className="button-row">
            <SiteLink to="/docs/quickstart" navigate={navigate} className="button-primary">
              Start building <ArrowRight size={17} />
            </SiteLink>
            <SiteLink to="/demo" navigate={navigate} className="button-secondary">
              Try the playground <ArrowUpRight size={17} />
            </SiteLink>
          </div>
          <p className="hero-note">
            MIT licensed · TypeScript · React renderer
            <br />
            <span>Experimental, source-only. No npm release yet.</span>
          </p>
        </div>
        <div className="hero-visual">
          <div className="workspace-window">
            <div className="window-bar">
              <span className="window-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>your next great tool</span>
              <PanelsTopLeft size={15} />
            </div>
            <div
              className="workspace-sketch"
              role="img"
              aria-label="Illustration of a panel-based developer workspace"
            >
              <div className="sketch-sidebar">
                <span className="sketch-label">EXPLORER</span>
                <span>⌄ workspace</span>
                <span className="sketch-muted">　components</span>
                <span className="sketch-file">　workspace.ts</span>
                <span className="sketch-muted">　panels.tsx</span>
                <span className="sketch-muted">　theme.css</span>
                <div className="sketch-sidebar-bottom">
                  <Layers3 size={16} /> Your app. Your rules.
                </div>
              </div>
              <div className="sketch-editor">
                <div className="sketch-tab">
                  <Code2 size={13} /> workspace.ts <span>×</span>
                </div>
                <div className="sketch-code">
                  <p>
                    <em>const</em> workspace = <b>yourApp</b>;
                  </p>
                  <p className="sketch-muted">// Focus on what makes it yours.</p>
                  <br />
                  <p>panels: [</p>
                  <p>
                    　 <b>Editor</b>,
                  </p>
                  <p>
                    　 <b>MapCanvas</b>,
                  </p>
                  <p>
                    　 <b>Inspector</b>,
                  </p>
                  <p>]</p>
                </div>
                <div className="sketch-output">
                  <span className="sketch-label">OUTPUT</span>
                  <span>
                    <Check size={13} /> A little more room to think.
                  </span>
                </div>
              </div>
              <div className="sketch-float">
                <div>
                  <Move size={12} /> Inspector <span>↗</span>
                </div>
                <p>
                  Make room for
                  <br />
                  <strong>the next idea.</strong>
                </p>
                <div className="mini-bars" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
            <div className="window-status">
              <span>
                <span className="live-dot" /> One workspace. Many ways to work.
              </span>
              <span>Illustration</span>
            </div>
          </div>
          <span className="visual-caption">
            <span className="caption-line" /> Serious tools deserve more than a fixed grid.
          </span>
        </div>
      </section>
      <div className="use-case-strip">
        <div className="page-shell">
          <span>MADE FOR MULTI-PANEL WORK</span>
          <span>Developer tools</span>
          <span>Map editors</span>
          <span>Data workbenches</span>
          <span>Creative applications</span>
        </div>
      </div>
      <section id="why" className="section-space page-shell">
        <div className="section-heading">
          <p className="section-eyebrow">Less plumbing. More product.</p>
          <h2>
            The workspace is the foundation.
            <br />
            <span>Your application is the point.</span>
          </h2>
          <p>
            You should be building the tool people came for—not another system for moving rectangles
            around a screen.
          </p>
        </div>
        <div className="feature-grid">
          {features.map(({ icon: Icon, title, text, link, cta }) => (
            <article key={link}>
              <div className="feature-icon">
                <Icon size={22} />
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
              <SiteLink to={`/docs/${link}`} navigate={navigate} className="text-link">
                {cta} <ArrowRight size={15} />
              </SiteLink>
            </article>
          ))}
        </div>
      </section>
      <section id="playground" className="demo-section">
        <div className="page-shell section-space">
          <div className="section-heading split-heading">
            <div>
              <p className="section-eyebrow">The proof is in the interaction</p>
              <h2>
                Don't just read about it.
                <br />
                <span>Rearrange it.</span>
              </h2>
            </div>
            <p>
              Move a tab into another group. Drop at an edge to split. Float a panel. Change the tab
              rail. The live reference workbench is the place to feel the difference.
            </p>
          </div>
          <div className="demo-frame">
            <div className="demo-frame-bar">
              <span>
                <span className="live-dot" /> Panefold Code · live reference fixture
              </span>
              <a href={siteAsset("workbench/")} target="_blank" rel="noreferrer">
                Open full screen <ArrowUpRight size={15} />
              </a>
            </div>
            {demoOpen ? (
              <iframe
                title="Interactive Panefold Code workbench demo"
                src={siteAsset("workbench/")}
              />
            ) : (
              <div className="demo-poster">
                <img
                  src={siteAsset("media/panefold-interactions-poster.jpg")}
                  alt="Panefold Code workbench with editor, explorer, inspector and output panels"
                  loading="lazy"
                  width="1440"
                  height="900"
                />
                <button type="button" className="button-primary" onClick={() => setDemoOpen(true)}>
                  Launch interactive demo <ArrowRight size={17} />
                </button>
              </div>
            )}
          </div>
          <div className="demo-footnote">
            <span>
              <Save size={16} /> The full demo saves layout in this browser's IndexedDB.
            </span>
            <span>Reference fixture—not a browser or accessibility certification.</span>
          </div>
        </div>
      </section>
      <section id="customize" className="section-space page-shell customize-section">
        <div className="customize-copy">
          <p className="section-eyebrow">Opinionated foundations. Your finish.</p>
          <h2>
            Looks like your product.
            <br />
            <span>Works like their workspace.</span>
          </h2>
          <p>
            Put document tabs across the top. Give tools an icon rail. Support right-to-left
            layouts. Style the chrome with CSS tokens and keep your panel content independent.
          </p>
          <p>Try the presentation controls. The code updates to show the exact renderer props.</p>
          <SiteLink to="/docs/tabs" navigate={navigate} className="text-link">
            Customize tabs and rails <ArrowRight size={16} />
          </SiteLink>
          <SiteLink to="/docs/styling" navigate={navigate} className="text-link">
            Bring your design system <ArrowRight size={16} />
          </SiteLink>
        </div>
        <TabPlayground />
      </section>
      <section className="build-section">
        <div className="page-shell section-space">
          <div className="section-heading">
            <p className="section-eyebrow">From first run to your own workspace</p>
            <h2>
              A clear path from
              <br />
              <span>“interesting” to “it's working.”</span>
            </h2>
          </div>
          <div className="build-grid">
            <div className="learning-path">
              {[
                [
                  "01",
                  "Run the source",
                  "Get the reference app running. No pretend npm command.",
                  "quickstart",
                ],
                [
                  "02",
                  "Bring a component",
                  "Connect your runtime, projection and panel registry.",
                  "react",
                ],
                [
                  "03",
                  "Make it your own",
                  "Own the theme, interactions, persistence and product policy.",
                  "styling",
                ],
              ].map(([number, title, text, slug]) => (
                <SiteLink key={number} to={`/docs/${slug}`} navigate={navigate}>
                  <span>{number}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                  <ArrowUpRight size={18} />
                </SiteLink>
              ))}
            </div>
            <div>
              <CodeBlock
                language="bash"
                label="Start from source"
                code={
                  "git clone https://github.com/natanelia/panefold.git\ncd panefold\npnpm install --frozen-lockfile\npnpm dev"
                }
              />
              <p className="fine-print">
                Node.js 22+ and pnpm 11.16.0. Open the local URL Vite prints.
                <br />
                For the smaller example, append <code>?fixture=starter</code>.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="section-space page-shell trust-section">
        <div>
          <p className="section-eyebrow">Built in the open. Boundaries included.</p>
          <h2>
            Good foundations.
            <br />
            <span>Honest claims.</span>
          </h2>
          <p>
            Panefold is experimental. Inspect what works, what was measured, and what still needs
            independent evidence before making it part of your product.
          </p>
        </div>
        <div className="trust-links">
          <SiteLink to="/docs/support" navigate={navigate}>
            <span>
              Support matrix<small>Frameworks, browsers and current limits.</small>
            </span>
            <ArrowUpRight size={20} />
          </SiteLink>
          <SiteLink to="/docs/performance" navigate={navigate}>
            <span>
              Measured performance<small>Results, raw samples, controls and caveats.</small>
            </span>
            <ArrowUpRight size={20} />
          </SiteLink>
          <SiteLink to="/docs/production" navigate={navigate}>
            <span>
              Adoption checklist<small>Accessibility, cleanup, recovery and real workloads.</small>
            </span>
            <ArrowUpRight size={20} />
          </SiteLink>
        </div>
      </section>
      <section className="closing-cta page-shell">
        <p className="section-eyebrow">Bring your next great tool</p>
        <h2>We'll make room.</h2>
        <SiteLink to="/docs/quickstart" navigate={navigate} className="button-primary">
          Build your first workspace <ArrowRight size={18} />
        </SiteLink>
        <SiteLink to="/docs" navigate={navigate} className="text-link">
          Explore the docs <ArrowDown size={16} />
        </SiteLink>
      </section>
    </main>
  );
}
