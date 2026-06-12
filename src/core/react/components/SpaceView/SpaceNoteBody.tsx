import { NoteView } from "core/react/components/PathView/NoteView";
import { SpaceContext } from "core/react/context/SpaceContext";
import { isNoteBodyEmpty } from "core/utils/spaceNoteBody";
import { Superstate } from "makemd-core";
import React, { useContext, useEffect, useState } from "react";

// Renders the space's folder note (hub note) body above the space body so a
// database's legend/definitions live on its own page (Notidian-7oj).
// Emptiness is evaluated when the note path changes, not live — the region
// must not vanish while the user is editing it down to empty.
export const SpaceNoteBody = (props: { superstate: Superstate }) => {
  const { spaceState } = useContext(SpaceContext);
  const notePath = spaceState?.space?.notePath;
  const [hasBody, setHasBody] = useState(false);

  useEffect(() => {
    let active = true;
    setHasBody(false);
    if (!notePath || !props.superstate.settings.enableFolderNote) return;
    (async () => {
      const exists = await props.superstate.spaceManager.pathExists(notePath);
      if (!exists || !active) return;
      const content = await props.superstate.spaceManager.readPath(notePath);
      if (active && !isNoteBodyEmpty(content)) setHasBody(true);
    })();
    return () => {
      active = false;
    };
  }, [notePath]);

  if (!hasBody || !spaceState) return null;
  return (
    <div className="mk-space-note">
      <NoteView
        superstate={props.superstate}
        path={spaceState.path}
        forceNote={true}
        load={true}
      ></NoteView>
    </div>
  );
};
