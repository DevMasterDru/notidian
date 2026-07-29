import { NoteView } from "core/react/components/PathView/NoteView";
import { SpaceContext } from "core/react/context/SpaceContext";
import { saveSpaceMetadataValue } from "core/superstate/utils/spaces";
import {
  HubTabDeclaration,
  hubTabLabel,
  hubTabPageCandidates,
  resolveActiveHubTab,
} from "core/utils/spaces/hubTabs";
import { Superstate } from "makemd-core";
import React, { useContext, useEffect, useMemo, useState } from "react";

// Tabbed hub view (ADR 0065 / Atlas ADR-0096 H1, bd Notidian-pb7p.1):
// persistent top tab bar over the active tab's authored composition note.
// Every declared tab is always visible (wrap on overflow, never a dropdown —
// the no-spatial-memory ruling); only the ACTIVE composition is mounted so a
// dense multi-embed hub pays one page's provider-tree cost at a time (Atlas
// ADR-0066 D8). The active tab persists as SpaceDefinition.activeHubTab in
// .notidian/def.json — never frontmatter (Atlas ADR-0066 D4 config-vs-state
// split; same home as noteBodyCollapsed).
export const HubTabsView = (props: {
  superstate: Superstate;
  tabs: HubTabDeclaration[];
}) => {
  const { spaceState, readMode } = useContext(SpaceContext);
  const tabs = props.tabs;

  const [activeId, setActiveId] = useState<string>(() =>
    resolveActiveHubTab(tabs, spaceState?.metadata?.activeHubTab)
  );
  // A declaration edit (tab removed/renamed) revalidates the current
  // selection instead of leaving a dangling id mounted.
  useEffect(() => {
    setActiveId((current) => resolveActiveHubTab(tabs, current));
  }, [tabs]);

  const activeTab =
    tabs.find((tab) => tab.id == activeId) ?? tabs[0] ?? null;

  // Hub-folder-relative first, then vault-absolute (ADR 0065 §1), resolved
  // against the live path index — no filesystem probe on the render path.
  const activePagePath = useMemo(() => {
    if (!activeTab) return null;
    const candidates = hubTabPageCandidates(
      activeTab.page,
      spaceState?.path ?? ""
    );
    return (
      candidates.find((candidate) =>
        props.superstate.pathsIndex.has(candidate)
      ) ?? null
    );
  }, [activeTab, spaceState?.path, props.superstate]);

  if (!activeTab) return null;

  const selectTab = (id: string) => {
    if (id == activeTab.id) return;
    setActiveId(id);
    if (spaceState) {
      void saveSpaceMetadataValue(
        props.superstate,
        spaceState.path,
        "activeHubTab",
        id
      );
    }
  };

  return (
    <div className="mk-hub-tabs">
      <div className="mk-hub-tabs-bar" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id == activeTab.id ? "true" : "false"}
            className={`mk-hub-tab${
              tab.id == activeTab.id ? " mk-active" : ""
            }`}
            onClick={() => selectTab(tab.id)}
          >
            {hubTabLabel(tab)}
          </button>
        ))}
      </div>
      <div className="mk-hub-tab-page" data-tab={activeTab.id}>
        {activePagePath ? (
          // Keyed by tab id: switching tabs UNMOUNTS the previous composition
          // (one page's embed cost at a time — the D8 guardrail's bound).
          <NoteView
            key={activeTab.id}
            superstate={props.superstate}
            path={activePagePath}
            forceNote={true}
            load={true}
            readOnly={readMode}
          ></NoteView>
        ) : (
          <div className="mk-notidian-embed-error" role="note">
            <strong>Hub tab</strong>
            <div>
              {`Tab "${activeTab.id}" page not found: ${activeTab.page}`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
