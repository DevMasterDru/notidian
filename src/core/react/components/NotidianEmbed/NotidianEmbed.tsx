import { SpaceManagerProvider } from "core/react/context/SpaceManagerContext";
import {
  descriptorToFragmentPath,
  NotidianEmbedDescriptor,
} from "core/utils/embeds/notidianEmbed";
import type { Superstate } from "makemd-core";
import React from "react";
import { SpaceFragmentViewComponent } from "../SpaceView/Editor/EmbedView/SpaceFragmentView";

export type NotidianEmbedHost =
  | "markdown"
  | "canvas-wrapper"
  | "legacy-transclusion"
  | "workspace-leaf";

export type NotidianEmbedError = {
  message: string;
};

export const NotidianEmbedErrorView = (props: {
  error: NotidianEmbedError;
}) => (
  <div className="mk-notidian-embed-error" role="note">
    <strong>Notidian embed</strong>
    <div>{props.error.message}</div>
  </div>
);

export const NotidianEmbed = (props: {
  superstate: Superstate;
  sourcePath: string;
  host: NotidianEmbedHost;
  descriptor?: NotidianEmbedDescriptor;
  error?: NotidianEmbedError;
}) => {
  if (props.error || !props.descriptor) {
    return (
      <NotidianEmbedErrorView
        error={props.error ?? { message: "Missing Notidian embed descriptor" }}
      />
    );
  }

  const descriptor = props.descriptor;
  const fragmentPath = descriptorToFragmentPath(descriptor);
  const heightStyle =
    descriptor.height == null ? undefined : { height: `${descriptor.height}px` };

  return (
    <div
      className="mk-notidian-embed"
      data-host={props.host}
      data-kind={descriptor.kind}
      data-editable={descriptor.editable === true ? "true" : "false"}
      style={heightStyle}
    >
      <SpaceManagerProvider superstate={props.superstate}>
        <SpaceFragmentViewComponent
          id={fragmentPath}
          path={fragmentPath}
          source={props.sourcePath}
          superstate={props.superstate}
          showTitle={descriptor.title !== false}
          readMode={descriptor.editable !== true}
        />
      </SpaceManagerProvider>
    </div>
  );
};
