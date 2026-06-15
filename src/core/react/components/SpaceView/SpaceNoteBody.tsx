import { UICollapse } from "basics/ui/UICollapse";
import { NoteView } from "core/react/components/PathView/NoteView";
import { SpaceContext } from "core/react/context/SpaceContext";
import { saveSpaceMetadataValue } from "core/superstate/utils/spaces";
import { isNoteBodyEmpty } from "core/utils/spaceNoteBody";
import {
  isCollapsibleNoteBodyEnabled,
  nextNoteBodyCollapsed,
  resolveNoteBodyCollapsed,
  shouldRenderNoteContent,
} from "core/utils/spaceNoteBodyCollapse";
import { Superstate } from "makemd-core";
import React, { useContext, useEffect, useState } from "react";

// Renders the space's folder note (hub note) body above the space body so a
// database's legend/definitions live on its own page (Notidian-7oj).
// Emptiness is evaluated when the note path changes, not live — the region
// must not vanish while the user is editing it down to empty.
//
// Notidian-8sl (flag-gated, default OFF — settings.collapsibleNoteBody): when the
// flag is ON the region gains a collapse chevron (per-space view state persisted
// in the SpaceDefinition as noteBodyCollapsed) and the body shrinks to fit its
// text (the mk-space-note--collapsible class drives the CSS override). When the
// flag is OFF the rendered output is byte-identical to the legacy region (no
// header, no chevron, no extra class) so the owner's current vault is unchanged
// until the change is live-verified (docs/AUTONOMOUS-REVIEW-QUEUE.md).
export const SpaceNoteBody = (props: { superstate: Superstate }) => {
  const { spaceState, readMode } = useContext(SpaceContext);
  const notePath = spaceState?.space?.notePath;
  const [hasBody, setHasBody] = useState(false);

  const collapsible = isCollapsibleNoteBodyEnabled(
    props.superstate.settings.collapsibleNoteBody,
    Boolean(spaceState)
  );
  const collapsed =
    collapsible && resolveNoteBodyCollapsed(spaceState?.metadata);

  useEffect(() => {
    let active = true;
    setHasBody(false);
    if (!notePath || !props.superstate.settings.enableFolderNote) return;
    (async () => {
      try {
        const exists = await props.superstate.spaceManager.pathExists(notePath);
        if (!exists || !active) return;
        const content = await props.superstate.spaceManager.readPath(notePath);
        if (active && !isNoteBodyEmpty(content)) setHasBody(true);
      } catch (e) {
        // A read failure (deleted mid-read, permission, etc.) must not throw an
        // unhandled rejection; just leave the region collapsed.
        if (active) setHasBody(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [notePath]);

  if (!hasBody || !spaceState) return null;

  const toggleCollapsed = (next: boolean) => {
    // Persist per-space view state to the SpaceDefinition (space metadata) — not
    // row data, so no source:"notidian" ownership is involved (ADR 0001/0014).
    void saveSpaceMetadataValue(
      props.superstate,
      spaceState.path,
      "noteBodyCollapsed",
      nextNoteBodyCollapsed(next)
    );
  };

  const renderNote = shouldRenderNoteContent(collapsible, collapsed);

  // Legacy (flag-OFF) path: byte-identical to the pre-Notidian-8sl region.
  if (!collapsible) {
    return (
      <div className="mk-space-note">
        <NoteView
          superstate={props.superstate}
          path={spaceState.path}
          forceNote={true}
          load={true}
          readOnly={readMode}
        ></NoteView>
      </div>
    );
  }

  // Flag-ON path: collapsible header + shrink-to-fit body.
  return (
    <div
      className={`mk-space-note mk-space-note--collapsible${
        collapsed ? " mk-space-note--collapsed" : ""
      }`}
    >
      <div className="mk-space-note-header">
        <UICollapse
          collapsed={collapsed}
          onToggle={(next) => toggleCollapsed(next)}
        ></UICollapse>
        <span className="mk-space-note-header-label">{spaceState.name}</span>
      </div>
      {renderNote && (
        <NoteView
          superstate={props.superstate}
          path={spaceState.path}
          forceNote={true}
          load={true}
          readOnly={readMode}
        ></NoteView>
      )}
    </div>
  );
};
