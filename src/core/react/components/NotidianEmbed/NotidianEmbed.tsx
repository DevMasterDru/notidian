import { SpaceManagerProvider } from "core/react/context/SpaceManagerContext";
import {
  descriptorToFragmentPath,
  NotidianEmbedDescriptor,
} from "core/utils/embeds/notidianEmbed";
import type { Superstate } from "makemd-core";
import React from "react";
import { Predicate } from "shared/types/predicate";
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

  // ADR-0066 / Notidian-ioxi — render-path declared-view overlay from the
  // block's `where:` clauses. READ-PATH ONLY: handed to the SpaceFragment as its
  // predicate prop, which the context branch forwards to ContextEditorProvider
  // as `predicateOverlay` and folds into the row-visibility matcher — it is
  // never persisted to the view schema/views.mdb. The renderPathViewOverlays
  // kill-switch is enforced at that merge seam, so when the flag is off this
  // overlay is ignored and the base view renders unfiltered (legacy). A plain
  // const (not a hook) keeps it after the early return above; the merge memo
  // keys off `.filters` (the stable descriptor.where array), not this wrapper.
  const overlay: Partial<Predicate> | undefined =
    descriptor.where && descriptor.where.length > 0
      ? { filters: descriptor.where }
      : undefined;

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
          predicate={overlay}
        />
      </SpaceManagerProvider>
    </div>
  );
};
