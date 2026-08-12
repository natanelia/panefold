export interface MobileProjectionSource {
  readonly revision: string;
  readonly groups: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly panelIds: readonly string[];
        readonly selectedPanelId: string;
        readonly label?: string;
      }
    >
  >;
  readonly panels: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly title: string;
      }
    >
  >;
  readonly activePanelId?: string;
}

export interface MobileProjectionOptions {
  readonly preferredGroupId?: string;
}

export interface MobileGroupItem {
  readonly id: string;
  readonly label: string;
  readonly panelCount: number;
  readonly current: boolean;
}

export interface MobilePanelItem {
  readonly id: string;
  readonly title: string;
  readonly selected: boolean;
  readonly active: boolean;
}

export interface MobileWorkspaceProjection {
  readonly revision: string;
  readonly mode: "single-region";
  readonly minimumTargetSize: 44;
  readonly currentGroupId?: string;
  readonly currentPanelId?: string;
  readonly groups: readonly MobileGroupItem[];
  readonly panels: readonly MobilePanelItem[];
}

export interface MobileWorkspaceProfile {
  readonly compact: boolean;
  readonly minimumTargetSize: 44;
  readonly navigation: "region-switcher" | "full-layout";
}

/** Pure projection: canonical group, panel, and activation state is unchanged. */
export function createMobileWorkspaceProjection(
  source: MobileProjectionSource,
  options: MobileProjectionOptions = {},
): MobileWorkspaceProjection {
  const sourceGroups = Object.values(source.groups);
  const activeGroup = sourceGroups.find((group) =>
    group.panelIds.includes(source.activePanelId ?? ""),
  );
  const preferredGroup =
    options.preferredGroupId === undefined ? undefined : source.groups[options.preferredGroupId];
  const currentGroup = activeGroup ?? preferredGroup ?? sourceGroups[0];
  const currentPanelId =
    currentGroup === undefined
      ? undefined
      : currentGroup.panelIds.includes(source.activePanelId ?? "")
        ? source.activePanelId
        : currentGroup.selectedPanelId;

  return {
    revision: source.revision,
    mode: "single-region",
    minimumTargetSize: 44,
    ...(currentGroup === undefined ? {} : { currentGroupId: currentGroup.id }),
    ...(currentPanelId === undefined ? {} : { currentPanelId }),
    groups: sourceGroups.map((group) => ({
      id: group.id,
      label: group.label ?? group.id,
      panelCount: group.panelIds.length,
      current: group.id === currentGroup?.id,
    })),
    panels: (currentGroup?.panelIds ?? []).flatMap((panelId) => {
      const panel = source.panels[panelId];
      return panel === undefined
        ? []
        : [
            {
              id: panel.id,
              title: panel.title,
              selected: panel.id === currentGroup?.selectedPanelId,
              active: panel.id === source.activePanelId,
            },
          ];
    }),
  };
}

export function resolveMobileProfile(options: {
  readonly inlineSize: number;
  readonly coarsePointer: boolean;
}): MobileWorkspaceProfile {
  const compact = options.coarsePointer || options.inlineSize < 720;
  return {
    compact,
    minimumTargetSize: 44,
    navigation: compact ? "region-switcher" : "full-layout",
  };
}
