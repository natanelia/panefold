import {
  Accessibility,
  Boxes,
  Braces,
  Frame,
  Gauge,
  History,
  Layers3,
  LockKeyhole,
  Orbit,
  PanelsTopLeft,
  RefreshCw,
  ScanLine,
} from "lucide-react";

export const proofPoints = [
  { value: "36", label: "implemented commands" },
  { value: "190", label: "traced requirements" },
  { value: "200+", label: "repository tests" },
  { value: "19", label: "workspace packages" },
] as const;

export const featureCards = [
  {
    title: "One source of workspace truth",
    description:
      "Every committed change passes through a pure semantic kernel. No component-local layout truth, no half-applied operations.",
    icon: Orbit,
    tone: "cyan",
    size: "wide",
    detail: "Atomic commands · typed rejection · canonical snapshots",
  },
  {
    title: "Geometry that adds up",
    description:
      "N-ary logical-axis solving respects hard constraints and conserves every integer pixel—even through collapse and overflow.",
    icon: ScanLine,
    tone: "mint",
    size: "standard",
    detail: "RTL-aware · deterministic rounding",
  },
  {
    title: "Stable hosts preserve panel identity",
    description:
      "Same-document hosts can keep mounted panel trees intact as tabs hide or move. Lifecycle leases make cooperative suspension and cleanup observable.",
    icon: Frame,
    tone: "violet",
    size: "standard",
    detail: "17 fixtures · browser evidence",
  },
  {
    title: "Undo follows semantic work",
    description:
      "Each accepted direct-manipulation gesture creates at most one workspace-history entry. DOM focus repair and motion stay outside it.",
    icon: History,
    tone: "amber",
    size: "standard",
    detail: "Bounded history · snapshot-based inverses",
  },
  {
    title: "Accessible at the projection edge",
    description:
      "Tabs, splitters, menus, keyboard movement, focus recovery, announcements, and reduced motion are designed into the adapter.",
    icon: Accessibility,
    tone: "cyan",
    size: "standard",
    detail: "Keyboard-first · focus-safe · motion-aware",
  },
  {
    title: "Frameworks are views, not owners",
    description:
      "React, Vue, Svelte, Angular, and Web Components bind to the same immutable external-store contract.",
    icon: Boxes,
    tone: "mint",
    size: "wide",
    detail: "Shared contract · native lifecycle disposal",
  },
] as const;

export const craftPrinciples = [
  {
    index: "01",
    title: "Semantics before pixels",
    text: "A resize is a command with an identity, origin, revision, result, and inverse—not a spray of pointer coordinates into application state.",
    icon: Braces,
  },
  {
    index: "02",
    title: "Temporary stays temporary",
    text: "Geometry previews, protocol state, focus repair, and motion explain a change. They never become competing sources of truth.",
    icon: Layers3,
  },
  {
    index: "03",
    title: "Failure is part of the API",
    text: "Queues are bounded. Rejections are typed. Persistence is checksummed. External transfer prepares before ownership changes.",
    icon: LockKeyhole,
  },
  {
    index: "04",
    title: "Evidence over adjectives",
    text: "Support claims live beside requirement traces, test evidence, blocked gates, and explicit limitations.",
    icon: Gauge,
  },
] as const;

export const architectureLayers = [
  { label: "Adapters", note: "accessible projection", color: "border-cyan-300/40" },
  { label: "Runtime", note: "bounded orchestration", color: "border-sky-400/35" },
  { label: "Kernel", note: "semantic authority", color: "border-teal-300/45" },
  { label: "Model", note: "immutable schema", color: "border-white/20" },
] as const;

export const frameworkBindings = [
  { name: "React", evidence: "Chromium fixture" },
  { name: "Vue", evidence: "JSDOM contract" },
  { name: "Svelte", evidence: "JSDOM contract" },
  { name: "Angular", evidence: "JSDOM contract" },
  { name: "Web Components", evidence: "JSDOM contract" },
] as const;

export const commandSequence = [
  { icon: PanelsTopLeft, label: "split-group", status: "committed", revision: "r42" },
  { icon: RefreshCw, label: "move-panel", status: "committed", revision: "r43" },
  { icon: History, label: "undo", status: "committed", revision: "r44" },
] as const;
