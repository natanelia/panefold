import type { TestPanelFixtureKind } from "./fixtures";

export type FixtureLifecycle = "active" | "visible" | "suspended" | "detached";

export interface TestFixtureMetrics {
  readonly mountCount: number;
  readonly unmountCount: number;
  readonly lifecycleCount: number;
  readonly resizeCount: number;
  readonly resourceCount: number;
  readonly disposed: boolean;
}

export interface TestPanelFixtureOptions {
  readonly sameOriginFrameSource?: string;
  readonly crossOriginFrameSource?: string;
  readonly slowResizeMs?: number;
  readonly acquireWebGlContext?: boolean;
}

export interface TestPanelFixtureRuntime {
  readonly kind: TestPanelFixtureKind;
  readonly element: HTMLElement;
  readonly mount: (container: Element) => void;
  readonly unmount: () => void;
  readonly setLifecycle: (lifecycle: FixtureLifecycle) => void;
  readonly resize: (inlineSize: number, blockSize: number) => Promise<void>;
  readonly checkpoint: () => unknown;
  readonly restore: (checkpoint: unknown) => void;
  readonly prepareClose: () => Promise<boolean>;
  readonly metrics: () => TestFixtureMetrics;
  readonly dispose: () => void;
}

interface MutableMetrics {
  mountCount: number;
  unmountCount: number;
  lifecycleCount: number;
  resizeCount: number;
  resourceCount: number;
  disposed: boolean;
}

/**
 * Dependency-free browser fixtures used by framework, lifecycle, recovery,
 * and leak suites. All platform objects are created from an injected Document
 * so importing the testkit remains SSR-safe.
 */
export function createTestPanelFixture(
  document: Document,
  kind: TestPanelFixtureKind,
  options: TestPanelFixtureOptions = {},
): TestPanelFixtureRuntime {
  const metrics: MutableMetrics = {
    mountCount: 0,
    unmountCount: 0,
    lifecycleCount: 0,
    resizeCount: 0,
    resourceCount: 0,
    disposed: false,
  };
  const AbortControllerConstructor = document.defaultView?.AbortController ?? AbortController;
  const controller = new AbortControllerConstructor();
  const element = createFixtureElement(document, kind, options, metrics, controller.signal);
  element.dataset.panefoldTestFixture = kind;
  element.dataset.lifecycle = "visible";
  let lifecycle: FixtureLifecycle = "visible";
  let mounted = false;
  let checkpoint: unknown = Object.freeze({ schemaVersion: 1, kind });

  const assertLive = () => {
    if (metrics.disposed) throw new Error(`Fixture ${kind} is disposed`);
  };

  return Object.freeze({
    kind,
    element,
    mount: (container: Element) => {
      assertLive();
      if (kind === "throwing-renderer") throw new Error("Synthetic renderer failure");
      if (mounted) {
        if (element.parentElement !== container) container.append(element);
        return;
      }
      container.append(element);
      mounted = true;
      metrics.mountCount += 1;
      metrics.resourceCount += resourceWeight(kind);
    },
    unmount: () => {
      if (!mounted) return;
      element.remove();
      mounted = false;
      metrics.unmountCount += 1;
      metrics.resourceCount = Math.max(0, metrics.resourceCount - resourceWeight(kind));
    },
    setLifecycle: (next: FixtureLifecycle) => {
      assertLive();
      if (next === lifecycle) return;
      lifecycle = next;
      metrics.lifecycleCount += 1;
      element.dataset.lifecycle = next;
      element.toggleAttribute("inert", next === "suspended" || next === "detached");
      element.hidden = next === "detached";
      element.dispatchEvent(
        createCustomEvent(document, "panefold:test-lifecycle", {
          bubbles: true,
          detail: Object.freeze({ kind, lifecycle: next }),
        }),
      );
    },
    resize: async (inlineSize: number, blockSize: number) => {
      assertLive();
      if (!Number.isFinite(inlineSize) || !Number.isFinite(blockSize)) {
        throw new RangeError("Fixture dimensions must be finite");
      }
      if (inlineSize < 0 || blockSize < 0) {
        throw new RangeError("Fixture dimensions must be non-negative");
      }
      if (kind === "slow-resize-consumer") {
        await delay(options.slowResizeMs ?? 16, controller.signal);
      }
      element.style.inlineSize = `${String(inlineSize)}px`;
      element.style.blockSize = `${String(blockSize)}px`;
      metrics.resizeCount += 1;
      element.dispatchEvent(
        createCustomEvent(document, "panefold:test-resize", {
          detail: Object.freeze({ inlineSize, blockSize }),
        }),
      );
    },
    checkpoint: () => checkpoint,
    restore: (value: unknown) => {
      assertLive();
      if (kind === "corrupt-checkpoint") {
        throw new TypeError("Synthetic corrupt checkpoint rejected");
      }
      if (!validCheckpoint(value, kind)) throw new TypeError("Fixture checkpoint is invalid");
      checkpoint = freezeCheckpoint(value);
    },
    prepareClose: async () => {
      assertLive();
      if (kind !== "async-close-guard") return true;
      await Promise.resolve();
      return element.dataset.allowClose === "true";
    },
    metrics: () => Object.freeze({ ...metrics }),
    dispose: () => {
      if (metrics.disposed) return;
      controller.abort("fixture-disposed");
      if (mounted) {
        element.remove();
        mounted = false;
        metrics.unmountCount += 1;
      }
      metrics.resourceCount = 0;
      metrics.disposed = true;
    },
  });
}

function createFixtureElement(
  document: Document,
  kind: TestPanelFixtureKind,
  options: TestPanelFixtureOptions,
  metrics: MutableMetrics,
  signal: AbortSignal,
): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("aria-label", fixtureLabel(kind));

  switch (kind) {
    case "plain-form":
    case "uncontrolled-form": {
      const label = document.createElement("label");
      label.textContent = kind === "plain-form" ? "Controlled fixture" : "Uncontrolled fixture";
      const input = document.createElement("input");
      input.name = "fixture-value";
      input.defaultValue = "preserved value";
      label.append(input);
      root.append(label);
      break;
    }
    case "code-editor": {
      const editor = document.createElement("textarea");
      editor.setAttribute("aria-label", "Code editor fixture");
      editor.spellcheck = false;
      editor.value = "export const stableHost = true;\n";
      root.append(editor);
      break;
    }
    case "webgl-map":
    case "canvas": {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      canvas.setAttribute(
        "aria-label",
        kind === "webgl-map" ? "WebGL map fixture" : "Canvas fixture",
      );
      canvas.setAttribute("role", "img");
      if (kind === "webgl-map" && options.acquireWebGlContext === true) {
        const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
        root.dataset.webgl = context === null ? "unavailable" : "ready";
      }
      root.append(canvas);
      break;
    }
    case "data-grid": {
      const table = document.createElement("table");
      const caption = document.createElement("caption");
      caption.textContent = "Virtualized data grid fixture";
      table.append(caption);
      const body = document.createElement("tbody");
      for (let rowIndex = 0; rowIndex < 100; rowIndex += 1) {
        const row = document.createElement("tr");
        const header = document.createElement("th");
        header.scope = "row";
        header.textContent = `Row ${String(rowIndex + 1)}`;
        const cell = document.createElement("td");
        cell.textContent = `Value ${String(rowIndex + 1)}`;
        row.append(header, cell);
        body.append(row);
      }
      table.append(body);
      root.append(table);
      break;
    }
    case "video": {
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.muted = true;
      video.setAttribute("aria-label", "Video fixture");
      root.append(video);
      break;
    }
    case "same-origin-iframe":
    case "cross-origin-iframe": {
      const frame = document.createElement("iframe");
      frame.title = kind === "same-origin-iframe" ? "Same-origin fixture" : "Cross-origin fixture";
      frame.setAttribute("sandbox", "allow-scripts");
      frame.referrerPolicy = "no-referrer";
      if (kind === "same-origin-iframe") {
        frame.srcdoc =
          options.sameOriginFrameSource ??
          '<!doctype html><html><body><button type="button">Fixture action</button></body></html>';
      } else {
        frame.src = options.crossOriginFrameSource ?? "about:blank";
      }
      root.append(frame);
      break;
    }
    case "web-component":
    case "microfrontend": {
      const host = document.createElement(kind === "web-component" ? "panefold-test-panel" : "div");
      const shadow = host.attachShadow({ mode: "open" });
      const heading = document.createElement("strong");
      heading.textContent =
        kind === "web-component" ? "Web Component fixture" : "Microfrontend root";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Local action";
      shadow.append(heading, button);
      root.append(host);
      break;
    }
    case "async-close-guard": {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener(
        "change",
        () => {
          root.dataset.allowClose = String(checkbox.checked);
        },
        { signal },
      );
      const label = document.createElement("label");
      label.append(checkbox, " Allow close");
      root.dataset.allowClose = "false";
      root.append(label);
      break;
    }
    case "suspendable": {
      const output = document.createElement("output");
      output.textContent = "Resource lease active";
      root.append(output);
      break;
    }
    case "corrupt-checkpoint":
    case "throwing-renderer":
    case "slow-resize-consumer":
    case "missing-plugin-placeholder": {
      const message = document.createElement("p");
      message.textContent = fixtureLabel(kind);
      if (kind === "missing-plugin-placeholder") {
        root.setAttribute("role", "status");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Retry plugin";
        root.append(message, retry);
      } else {
        root.append(message);
      }
      break;
    }
  }

  root.addEventListener(
    "panefold:test-resize",
    () => {
      // The listener deliberately participates in resource accounting so leak
      // suites can prove AbortSignal cleanup after fixture disposal.
      metrics.resourceCount = Math.max(0, metrics.resourceCount);
    },
    { signal },
  );
  return root;
}

function fixtureLabel(kind: TestPanelFixtureKind): string {
  return `${kind.replaceAll("-", " ")} test panel`;
}

function resourceWeight(kind: TestPanelFixtureKind): number {
  return new Set<TestPanelFixtureKind>([
    "webgl-map",
    "canvas",
    "video",
    "same-origin-iframe",
    "cross-origin-iframe",
    "web-component",
    "microfrontend",
  ]).has(kind)
    ? 2
    : 1;
}

function createCustomEvent(
  document: Document,
  type: string,
  init: CustomEventInit<unknown>,
): CustomEvent<unknown> {
  const CustomEventConstructor = document.defaultView?.CustomEvent ?? CustomEvent;
  return new CustomEventConstructor(type, init);
}

function validCheckpoint(value: unknown, kind: TestPanelFixtureKind): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && record.kind === kind;
}

function freezeCheckpoint(value: unknown): unknown {
  return Object.freeze({ ...(value as Record<string, unknown>) });
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 60_000) {
    throw new RangeError("slowResizeMs must be an integer from 0 to 60,000");
  }
  if (signal.aborted) throw new DOMException("Fixture is disposed", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const aborted = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Fixture is disposed", "AbortError"));
    };
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
  });
}
