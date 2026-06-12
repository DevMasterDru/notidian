import { SpaceHeader } from "core/react/components/SpaceView/SpaceHeader";
import { SpaceNoteBody } from "core/react/components/SpaceView/SpaceNoteBody";
import SpaceOuter from "core/react/components/SpaceView/SpaceOuter";
import { SpaceContext } from "core/react/context/SpaceContext";
import { Backlinks, Superstate } from "makemd-core";
import React, { useContext, useRef } from "react";

export const SpaceInner = (props: {
  superstate: Superstate;
  header: boolean;
}) => {
  const ref = useRef(null);
  const { spaceState } = useContext(SpaceContext);
  return (
    <>
      {props.header && (
        <SpaceHeader superstate={props.superstate}></SpaceHeader>
      )}
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
  );
};
