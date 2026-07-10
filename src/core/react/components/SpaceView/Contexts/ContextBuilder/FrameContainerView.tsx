import { FrameEditorProvider } from "core/react/context/FrameEditorRootContext";
import {
  FrameRootContext,
  FrameRootContextType,
  FrameRootProvider,
} from "core/react/context/FrameRootContext";
import { FrameSelectionContext } from "core/react/context/FrameSelectionContext";
import { FramesMDBProvider } from "core/react/context/FramesMDBContext";
import { Superstate } from "makemd-core";
import React, { useContext, useMemo } from "react";
import { FrameEditorMode } from "shared/types/frameExec";
import { SpaceProperty } from "shared/types/mdb";
import { URI } from "shared/types/path";

export const FrameContainerView = (props: {
  superstate: Superstate;
  uri: URI;
  cols: SpaceProperty[];
  children?: React.ReactNode;
  editMode: FrameEditorMode;
}) => {
  const { selected: _selected } = useContext(FrameSelectionContext);
  // bd Notidian-pg6g (regression on Notidian-214 / ADR 0022 2c): the editor
  // branch below used to mount NO FrameRootContext, so FrameInstanceContext fell
  // back to the shared "?" trust identity for EVERY editable space's main frame —
  // aliasing distinct frames in the session bless registry (frameTrustSession)
  // and letting one "Trust dynamic frame code" gesture stamp a frame the user
  // never chose. Provide the REAL frame identity here (the same uri.fullPath the
  // read path gets from FrameRootProvider); `root` stays null exactly like the
  // previous context default — the editor branch's executable root comes from
  // FramesEditorRootContext, never from here.
  const editorFrameIdentity = useMemo<FrameRootContextType>(
    () => ({ root: null, path: props.uri.fullPath }),
    [props.uri.fullPath]
  );
  return props.editMode >= FrameEditorMode.Page &&
    props.uri.authority != "$kit" ? (
    <FramesMDBProvider superstate={props.superstate} schema={props.uri.ref}>
      <FrameEditorProvider
        superstate={props.superstate}
        cols={props.cols}
        editMode={props.editMode}
      >
        <FrameRootContext.Provider value={editorFrameIdentity}>
          {props.children}
        </FrameRootContext.Provider>
      </FrameEditorProvider>
    </FramesMDBProvider>
  ) : (
    <FrameRootProvider
      superstate={props.superstate}
      path={props.uri}
      cols={props.cols}
    >
      {props.children}
    </FrameRootProvider>
  );
};
