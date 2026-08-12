import type {
  WorkspaceDirection,
  WorkspaceTabContent,
  WorkspaceTabPlacement,
} from "@panefold/react";

export type DemoTheme = "dark" | "light";
export type DemoMotionProfile = "off" | "reduced" | "productive";

export interface DemoViewPreferences {
  readonly theme: DemoTheme;
  readonly direction: WorkspaceDirection;
  readonly motion: DemoMotionProfile;
  readonly tabPlacement: WorkspaceTabPlacement;
  readonly tabContent: WorkspaceTabContent;
}

const STORAGE_KEY = "panefold.atlas.view.v1";

export const DEFAULT_VIEW_PREFERENCES: DemoViewPreferences = Object.freeze({
  theme: "dark",
  direction: "ltr",
  motion: "productive",
  tabPlacement: "block-start",
  tabContent: "icon-and-label",
});

export function readDemoViewPreferences(storage?: Storage) {
  try {
    const value = JSON.parse(
      (storage ?? window.localStorage).getItem(STORAGE_KEY) ?? "null",
    ) as unknown;
    if (!isRecord(value)) return DEFAULT_VIEW_PREFERENCES;
    return Object.freeze({
      theme: value.theme === "light" ? "light" : "dark",
      direction: value.direction === "rtl" ? "rtl" : "ltr",
      motion: value.motion === "off" || value.motion === "reduced" ? value.motion : "productive",
      tabPlacement: isTabPlacement(value.tabPlacement) ? value.tabPlacement : "block-start",
      tabContent: isTabContent(value.tabContent) ? value.tabContent : "icon-and-label",
    });
  } catch {
    return DEFAULT_VIEW_PREFERENCES;
  }
}

export function writeDemoViewPreferences(
  preferences: DemoViewPreferences,
  storage?: Storage,
): void {
  try {
    (storage ?? window.localStorage).setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // View preferences are optional projection state. A denied or full storage
    // area must not interrupt semantic workspace interactions.
  }
}

function isTabPlacement(value: unknown): value is WorkspaceTabPlacement {
  return (
    value === "block-start" ||
    value === "block-end" ||
    value === "inline-start" ||
    value === "inline-end"
  );
}

function isTabContent(value: unknown): value is WorkspaceTabContent {
  return value === "icon-and-label" || value === "icon-only" || value === "label-only";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
