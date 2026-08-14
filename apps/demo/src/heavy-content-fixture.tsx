import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { WorkspacePanelRenderProps } from "@panefold/react";

const FIXTURE_KINDS = [
  "plain-form",
  "uncontrolled-form",
  "code-editor",
  "webgl-map",
  "canvas",
  "data-grid",
  "video",
  "same-origin-iframe",
  "cross-origin-iframe",
  "web-component",
  "microfrontend",
  "async-close-guard",
  "suspendable",
  "corrupt-checkpoint",
  "throwing-renderer",
  "slow-resize-consumer",
  "missing-plugin-placeholder",
] as const;

export function HeavyContentFixturePanel({ lifecycle }: WorkspacePanelRenderProps) {
  const mountToken = useId().replaceAll(":", "");
  const [controlledValue, setControlledValue] = useState("controlled draft");
  const [throwRenderer, setThrowRenderer] = useState(false);
  const [guardStatus, setGuardStatus] = useState("idle");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workRef = useRef<HTMLOutputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const webComponentHostRef = useRef<HTMLDivElement>(null);
  const microfrontendHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("webgl2") ?? canvas.getContext("2d");
    canvas.dataset.renderer =
      typeof WebGL2RenderingContext !== "undefined" && context instanceof WebGL2RenderingContext
        ? "webgl2"
        : "canvas-2d";
    if (
      typeof CanvasRenderingContext2D !== "undefined" &&
      context instanceof CanvasRenderingContext2D
    ) {
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, "#163b68");
      gradient.addColorStop(1, "#4cd6b0");
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "#edf3fb";
      context.beginPath();
      context.moveTo(8, canvas.height - 12);
      context.lineTo(canvas.width / 2, 16);
      context.lineTo(canvas.width - 8, canvas.height - 28);
      context.stroke();
    }
  }, []);

  useEffect(() => {
    const output = workRef.current;
    const ownerWindow = output?.ownerDocument.defaultView;
    if (output === null || ownerWindow === undefined || ownerWindow === null) return;
    output.dataset.lifecycle = lifecycle;
    videoRef.current?.toggleAttribute("data-suspended", lifecycle === "suspended");
    if (lifecycle === "suspended") {
      videoRef.current?.pause();
      return;
    }
    let frame = 0;
    let frameWindow = ownerWindow;
    const tick = () => {
      const currentWindow = output.ownerDocument.defaultView;
      if (currentWindow === null) return;
      frameWindow = currentWindow;
      frame = currentWindow.requestAnimationFrame(() => {
        const units = Number(output.dataset.workUnits ?? "0") + 1;
        output.dataset.workUnits = String(units);
        output.value = String(units);
        tick();
      });
    };
    tick();
    return () => {
      frameWindow.cancelAnimationFrame(frame);
    };
  }, [lifecycle]);

  useEffect(() => {
    const host = webComponentHostRef.current;
    const ownerWindow = host?.ownerDocument.defaultView;
    if (host === null || ownerWindow === undefined || ownerWindow === null) return;
    const name = "panefold-heavy-fixture";
    if (ownerWindow.customElements.get(name) === undefined) {
      ownerWindow.customElements.define(
        name,
        class extends ownerWindow.HTMLElement {
          public connectedCallback() {
            const count = Number(this.dataset.connectCount ?? "0") + 1;
            this.dataset.connectCount = String(count);
            const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
            root.textContent = "Shadow-root workspace probe";
          }
        },
      );
    }
    const element = host.ownerDocument.createElement(name);
    element.setAttribute("aria-label", "Web Component fixture");
    element.dataset.instanceToken = mountToken;
    host.append(element);
    return () => {
      element.remove();
    };
  }, [mountToken]);

  useEffect(() => {
    const host = microfrontendHostRef.current;
    if (host === null) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const input = host.ownerDocument.createElement("input");
    input.setAttribute("aria-label", "Microfrontend state");
    input.value = "isolated application state";
    root.append(input);
    return () => {
      root.replaceChildren();
    };
  }, []);

  if (throwRenderer) throw new Error("Intentional heavy-fixture renderer failure");

  return (
    <div
      className="demo-heavy-lab"
      data-heavy-fixture-lifecycle={lifecycle}
      data-heavy-mount-token={mountToken}
    >
      <header>
        <div>
          <span className="demo-kicker">Browser lifecycle fixture</span>
          <h3>17-panel content contract in one stable host</h3>
        </div>
        <output ref={workRef} aria-label="Heavy fixture work units" data-work-units="0">
          0
        </output>
      </header>

      <div className="demo-heavy-grid">
        <Fixture kind="plain-form">
          <label>
            Controlled input
            <input
              aria-label="Controlled fixture value"
              value={controlledValue}
              onChange={(event) => setControlledValue(event.target.value)}
            />
          </label>
        </Fixture>
        <Fixture kind="uncontrolled-form">
          <label>
            DOM-owned input
            <input aria-label="Uncontrolled fixture value" defaultValue="DOM draft" />
          </label>
        </Fixture>
        <Fixture kind="code-editor">
          <label>
            Editor buffer
            <textarea
              aria-label="Code editor fixture"
              defaultValue="const workbench = createWorkspace();"
            />
          </label>
        </Fixture>
        <Fixture kind="webgl-map">
          <canvas ref={canvasRef} width="260" height="92" aria-label="GPU editor fixture" />
        </Fixture>
        <Fixture kind="canvas">
          <span data-canvas-identity={mountToken}>Stable canvas buffer · {mountToken}</span>
        </Fixture>
        <Fixture kind="data-grid">
          <div className="demo-heavy-table-scroll">
            <table>
              <caption>Module inventory</caption>
              <tbody>
                {Array.from({ length: 24 }, (_, index) => (
                  <tr key={index}>
                    <th scope="row">MOD-{String(index + 1).padStart(3, "0")}</th>
                    <td>{index % 2 === 0 ? "Typed" : "Review"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fixture>
        <Fixture kind="video">
          <video ref={videoRef} aria-label="Video fixture" controls preload="none" />
        </Fixture>
        <Fixture kind="same-origin-iframe">
          <iframe
            title="Same-origin fixture"
            srcDoc="<!doctype html><button>Frame action</button>"
          />
        </Fixture>
        <Fixture kind="cross-origin-iframe">
          <iframe
            title="Opaque-origin fixture"
            src="data:text/html,%3Cp%3EOpaque%20sandbox%20fixture%3C%2Fp%3E"
            sandbox=""
          />
        </Fixture>
        <Fixture kind="web-component">
          <div ref={webComponentHostRef} />
        </Fixture>
        <Fixture kind="microfrontend">
          <div ref={microfrontendHostRef} aria-label="Isolated microfrontend root" />
        </Fixture>
        <Fixture kind="async-close-guard">
          <button
            type="button"
            onClick={() => {
              setGuardStatus("checking");
              queueMicrotask(() => setGuardStatus("retained safely"));
            }}
          >
            Run close guard
          </button>
          <output aria-label="Close guard result">{guardStatus}</output>
        </Fixture>
        <Fixture kind="suspendable">
          <span>Lifecycle lease: {lifecycle}</span>
        </Fixture>
        <Fixture kind="corrupt-checkpoint">
          <span role="status">Invalid checkpoint → safe placeholder</span>
        </Fixture>
        <Fixture kind="throwing-renderer">
          <button type="button" onClick={() => setThrowRenderer(true)}>
            Throw renderer failure
          </button>
        </Fixture>
        <Fixture kind="slow-resize-consumer">
          <span>Adaptive resize · latest value wins</span>
        </Fixture>
        <Fixture kind="missing-plugin-placeholder">
          <span>Plugin unavailable · descriptor retained</span>
        </Fixture>
      </div>

      <footer>
        {FIXTURE_KINDS.length} fixture classes · stable host {mountToken} · {lifecycle}
      </footer>
    </div>
  );
}

function Fixture({
  kind,
  children,
}: {
  readonly kind: (typeof FIXTURE_KINDS)[number];
  readonly children: ReactNode;
}) {
  return (
    <section className="demo-heavy-fixture" data-test-panel-fixture={kind} aria-label={kind}>
      <strong>{kind}</strong>
      {children}
    </section>
  );
}
