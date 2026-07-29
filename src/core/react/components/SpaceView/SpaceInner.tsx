import { SpaceHeader } from "core/react/components/SpaceView/SpaceHeader";
import { HubTabsView } from "core/react/components/SpaceView/HubTabsView";
import { SpaceNoteBody } from "core/react/components/SpaceView/SpaceNoteBody";
import SpaceOuter from "core/react/components/SpaceView/SpaceOuter";
import { SpaceContext } from "core/react/context/SpaceContext";
import {
  HubTabsParseResult,
  parseHubTabsDeclaration,
} from "core/utils/spaces/hubTabs";
import { Backlinks, Superstate } from "makemd-core";
import React, { useContext, useEffect, useRef, useState } from "react";

// Hub tabs mount seam (ADR 0065 / Atlas ADR-0096 H1, bd Notidian-pb7p.1): the
// space's folder note may declare an ordered `tabs:` list. A structurally
// valid declaration (plus the default-ON hubTabbedViews kill-switch) swaps
// the space body for the tabbed hub view; anything else renders the legacy
// page byte-identical — an invalid declaration ATTEMPT additionally shows a
// visible violation banner (fail visible, never fail-brick).
const useHubTabsDeclaration = (
  superstate: Superstate,
  notePath: string
): HubTabsParseResult => {
  const read = (): HubTabsParseResult =>
    parseHubTabsDeclaration(
      notePath
        ? superstate.pathsIndex.get(notePath)?.metadata?.property?.tabs
        : undefined
    );
  const [declaration, setDeclaration] = useState<HubTabsParseResult>(read);
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    setDeclaration(readRef.current());
    if (!notePath) return;
    const refresh = (payload: { path: string }) => {
      if (payload.path == notePath) setDeclaration(readRef.current());
    };
    superstate.eventsDispatcher.addListener("pathStateUpdated", refresh);
    return () => {
      superstate.eventsDispatcher.removeListener("pathStateUpdated", refresh);
    };
  }, [superstate, notePath]);

  return declaration;
};

export const SpaceInner = (props: {
  superstate: Superstate;
  header: boolean;
}) => {
  const ref = useRef(null);
  const { spaceState } = useContext(SpaceContext);
  const hubTabs = useHubTabsDeclaration(
    props.superstate,
    spaceState?.space?.notePath
  );
  const hubTabsEnabled =
    props.superstate.settings.hubTabbedViews !== false;
  const hubActive =
    hubTabsEnabled && Boolean(spaceState) && hubTabs.kind == "ok";

  return (
    <>
      {props.header && (
        <SpaceHeader superstate={props.superstate}></SpaceHeader>
      )}
      {hubTabsEnabled && spaceState && hubTabs.kind == "error" && (
        <div className="mk-hub-tabs-error" role="note">
          <strong>Hub tabs</strong>
          {hubTabs.errors.map((error, i) => (
            <div key={i}>{error}</div>
          ))}
        </div>
      )}
      {hubActive ? (
        <HubTabsView
          superstate={props.superstate}
          tabs={hubTabs.tabs}
        ></HubTabsView>
      ) : (
        <>
          {spaceState && props.superstate.settings.spaceViewShowNoteBody && (
            <SpaceNoteBody superstate={props.superstate}></SpaceNoteBody>
          )}
          {spaceState && (
            <SpaceOuter
              superstate={props.superstate}
              ref={ref}
              containerRef={ref}
            ></SpaceOuter>
          )}
          {props.superstate.settings.inlineBacklinks && spaceState && (
            <div className="mk-space-footer">
              <Backlinks
                superstate={props.superstate}
                path={spaceState.space.notePath}
              ></Backlinks>
            </div>
          )}
        </>
      )}
    </>
  );
};
