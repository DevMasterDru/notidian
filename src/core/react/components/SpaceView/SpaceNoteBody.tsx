import { UICollapse } from "basics/ui/UICollapse";
import { NoteView } from "core/react/components/PathView/NoteView";
import { SpaceContext } from "core/react/context/SpaceContext";
import { saveSpaceMetadataValue } from "core/superstate/utils/spaces";
import { isNoteBodyEmpty } from "core/utils/spaceNoteBody";
import {
  isCollapsibleNoteBodyEnabled,
  isNoteBodyHidden,
  nextNoteBodyCollapsed,
  resolveNoteBodyCollapsed,
  resolveNoteBodyFullCollapse,
  shouldRenderNoteContent,
} from "core/utils/spaceNoteBodyCollapse";
import {
  clampNoteBodyHeight,
  nextNoteBodyHeightFromDrag,
  resolveNoteBodyHeight,
} from "core/utils/spaceNoteBodyResize";
import { Superstate } from "makemd-core";
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import i18n from "shared/i18n";

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
  // Notidian-50hn: full-collapse (default ON) UNMOUNTS the note on collapse so
  // 100% of its text is gone; the kill-switch (OFF) keeps it mounted-but-hidden.
  const fullCollapse = resolveNoteBodyFullCollapse(
    props.superstate.settings.spaceNoteBodyFullCollapse
  );

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

  // Notidian-egoh — resize/scroll. The persisted explicit height (null => auto /
  // shrink-to-fit). `dragHeight` is the live height during/after a drag; it wins
  // over the persisted value until the space changes, so the drag previews
  // smoothly before the metadata round-trips back.
  const persistedHeight = collapsible
    ? resolveNoteBodyHeight(spaceState?.metadata)
    : null;
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ startY: number; startH: number } | null>(null);

  // A different space carries its own persisted height — drop any stale drag
  // value so the new space's metadata (or auto) drives the region.
  useEffect(() => {
    setDragHeight(null);
  }, [spaceState?.path]);

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startH = clampNoteBodyHeight(
        bodyRef.current?.offsetHeight ?? persistedHeight ?? 0
      );
      dragOrigin.current = { startY: e.clientY, startH };
      setDragHeight(startH);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [persistedHeight]
  );

  const onResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const origin = dragOrigin.current;
      if (!origin) return;
      setDragHeight(
        nextNoteBodyHeightFromDrag(origin.startH, e.clientY - origin.startY)
      );
    },
    []
  );

  const onResizePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const origin = dragOrigin.current;
      if (!origin) return;
      dragOrigin.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      const finalH = nextNoteBodyHeightFromDrag(
        origin.startH,
        e.clientY - origin.startY
      );
      setDragHeight(finalH);
      if (spaceState) {
        void saveSpaceMetadataValue(
          props.superstate,
          spaceState.path,
          "noteBodyHeight",
          finalH
        );
      }
    },
    [props.superstate, spaceState]
  );

  // Double-click the handle: forget the explicit height and return to
  // shrink-to-fit (auto). Persisting `undefined` clears it from the metadata.
  const onResizeReset = useCallback(() => {
    dragOrigin.current = null;
    setDragHeight(null);
    if (spaceState) {
      void saveSpaceMetadataValue(
        props.superstate,
        spaceState.path,
        "noteBodyHeight",
        undefined
      );
    }
  }, [props.superstate, spaceState]);

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

  // Whether to MOUNT the note body. Default full-collapse unmounts it while
  // collapsed (zero note nodes — the owner-directed database-only view); the
  // kill-switch keeps it mounted but hidden (see noteBodyHidden below).
  const renderNote = shouldRenderNoteContent(
    collapsible,
    collapsed,
    fullCollapse
  );
  const noteBodyHidden = isNoteBodyHidden(collapsible, collapsed, fullCollapse);
  // The resize handle is only meaningful for a VISIBLE, expanded body — never
  // over a collapsed (hidden or unmounted) region.
  const showResize = collapsible && !collapsed;

  // A fixed height (live drag value, else persisted) makes the body scroll on
  // overflow; null => shrink-to-fit (auto, the Notidian-xazq default).
  const effectiveHeight = !collapsed ? dragHeight ?? persistedHeight : null;
  const bodyStyle =
    effectiveHeight != null
      ? { height: effectiveHeight, overflowY: "auto" as const }
      : undefined;

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
          ariaLabel={i18n.labels.collapseNote}
          className="mk-collapse-note"
        ></UICollapse>
        <span className="mk-space-note-header-label">{spaceState.name}</span>
      </div>
      {renderNote && (
        <>
          <div
            className={`mk-space-note-body${
              noteBodyHidden ? " mk-space-note-body--hidden" : ""
            }`}
            ref={bodyRef}
            style={bodyStyle}
          >
            <NoteView
              superstate={props.superstate}
              path={spaceState.path}
              forceNote={true}
              load={true}
              readOnly={readMode}
            ></NoteView>
          </div>
          {showResize && (
            <div
              className="mk-space-note-resize"
              onPointerDown={onResizePointerDown}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
              onDoubleClick={onResizeReset}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize note body — drag to set height, double-click to fit content"
              title="Drag to resize · double-click to fit content"
            ></div>
          )}
        </>
      )}
    </div>
  );
};
