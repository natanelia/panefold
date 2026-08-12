export type TestPanelFixtureKind =
  | "plain-form"
  | "uncontrolled-form"
  | "code-editor"
  | "webgl-map"
  | "canvas"
  | "data-grid"
  | "video"
  | "same-origin-iframe"
  | "cross-origin-iframe"
  | "web-component"
  | "microfrontend"
  | "async-close-guard"
  | "suspendable"
  | "corrupt-checkpoint"
  | "throwing-renderer"
  | "slow-resize-consumer"
  | "missing-plugin-placeholder";

export interface TestPanelFixtureDefinition {
  readonly kind: TestPanelFixtureKind;
  readonly contentClass: "dom" | "editor" | "gpu" | "media" | "document" | "failure";
  readonly expectedHostPolicy: "preserve" | "remount" | "checkpoint-remount";
  readonly resizeDelivery: "live" | "throttled" | "deferred" | "adaptive";
  readonly exercises: readonly string[];
}

export const TEST_PANEL_FIXTURES: readonly TestPanelFixtureDefinition[] = Object.freeze([
  fixture("plain-form", "dom", "preserve", "live", ["controlled state", "focus"]),
  fixture("uncontrolled-form", "dom", "preserve", "live", ["DOM-owned state", "focus"]),
  fixture("code-editor", "editor", "preserve", "adaptive", ["selection", "undo isolation"]),
  fixture("webgl-map", "gpu", "preserve", "adaptive", ["context identity", "resize"]),
  fixture("canvas", "gpu", "preserve", "adaptive", ["buffer identity", "resize"]),
  fixture("data-grid", "dom", "preserve", "throttled", ["virtualization", "scroll"]),
  fixture("video", "media", "preserve", "deferred", ["playback continuity", "visibility"]),
  fixture("same-origin-iframe", "document", "preserve", "adaptive", ["focus", "shield"]),
  fixture("cross-origin-iframe", "document", "checkpoint-remount", "deferred", [
    "shield",
    "fallback",
  ]),
  fixture("web-component", "dom", "preserve", "live", ["connection lifecycle", "shadow DOM"]),
  fixture("microfrontend", "document", "checkpoint-remount", "adaptive", [
    "isolated root",
    "cleanup",
  ]),
  fixture("async-close-guard", "failure", "preserve", "live", ["prepare", "cancel"]),
  fixture("suspendable", "dom", "preserve", "adaptive", ["lease abort", "resume"]),
  fixture("corrupt-checkpoint", "failure", "checkpoint-remount", "deferred", [
    "decode failure",
    "placeholder",
  ]),
  fixture("throwing-renderer", "failure", "remount", "live", ["error containment", "retry"]),
  fixture("slow-resize-consumer", "failure", "preserve", "adaptive", [
    "backpressure",
    "mode change",
  ]),
  fixture("missing-plugin-placeholder", "failure", "checkpoint-remount", "deferred", [
    "descriptor retention",
    "restore",
  ]),
]);

function fixture(
  kind: TestPanelFixtureKind,
  contentClass: TestPanelFixtureDefinition["contentClass"],
  expectedHostPolicy: TestPanelFixtureDefinition["expectedHostPolicy"],
  resizeDelivery: TestPanelFixtureDefinition["resizeDelivery"],
  exercises: readonly string[],
): TestPanelFixtureDefinition {
  return Object.freeze({
    kind,
    contentClass,
    expectedHostPolicy,
    resizeDelivery,
    exercises: Object.freeze([...exercises]),
  });
}
