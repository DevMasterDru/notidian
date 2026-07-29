import { SpaceManagerProvider } from "core/react/context/SpaceManagerContext";
import {
  descriptorToFragmentPath,
  NotidianEmbedDescriptor,
} from "core/utils/embeds/notidianEmbed";
import {
  DeclaredViewInspection,
  DeclaredViewRuntimeResult,
  inspectDeclaredViewForEmbed,
  resolveDeclaredViewForEmbed,
} from "core/utils/embeds/notidianDeclaredViewRuntime";
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

type NotidianEmbedProps = {
  superstate: Superstate;
  sourcePath: string;
  host: NotidianEmbedHost;
  descriptor?: NotidianEmbedDescriptor;
  error?: NotidianEmbedError;
};

const NotidianEmbedContent = (
  props: Omit<NotidianEmbedProps, "descriptor" | "error"> & {
    descriptor: NotidianEmbedDescriptor;
    predicateOverlay?: Partial<Predicate>;
  }
) => {
  const descriptor = props.descriptor;
  const fragmentPath = descriptorToFragmentPath(descriptor);
  const heightStyle =
    descriptor.height == null ? undefined : { height: `${descriptor.height}px` };

  // ADR-0066 / Notidian-ioxi — render-path declared-view overlay from the
  // block's `where:` clauses or a folder declaration's schema-resolved rich
  // values. READ-PATH ONLY: the context branch projects it for rendering and
  // strips every owned key from save payloads. The renderPathViewOverlays
  // kill-switch is enforced at that projection seam.
  const overlay: Partial<Predicate> | undefined =
    props.predicateOverlay ??
    (descriptor.where && descriptor.where.length > 0
      ? { filters: descriptor.where }
      : undefined);

  // H2 embed hygiene (Notidian-pb7p.2 / Atlas ADR-0096): `bar: false` mounts
  // the fragment in minMode, which suppresses the whole view-config bar
  // (title row, toolbar, filter/sort chips) — the zero-chrome hub-tab mode.
  const barSuppressed = descriptor.bar === false;

  return (
    <div
      className="mk-notidian-embed"
      data-host={props.host}
      data-kind={descriptor.kind}
      data-editable={descriptor.editable === true ? "true" : "false"}
      data-bar={barSuppressed ? "false" : "true"}
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
          minMode={barSuppressed}
          predicate={overlay}
        />
      </SpaceManagerProvider>
    </div>
  );
};

const DeclaredNotidianEmbed = (
  props: Omit<NotidianEmbedProps, "descriptor" | "error"> & {
    descriptor: NotidianEmbedDescriptor;
    inspection: Extract<DeclaredViewInspection, { kind: "declaration" }>;
  }
) => {
  const [resolution, setResolution] = React.useState<DeclaredViewRuntimeResult>(
    null
  );

  React.useEffect(() => {
    let current = true;
    resolveDeclaredViewForEmbed({
      superstate: props.superstate,
      descriptor: props.descriptor,
      inspection: props.inspection,
    }).then((result) => {
      if (current) setResolution(result);
    });
    return () => {
      current = false;
    };
  }, [props.superstate, props.descriptor, props.inspection]);

  if (!resolution) {
    return (
      <div className="mk-notidian-embed-loading" role="status">
        Loading Notidian embed…
      </div>
    );
  }
  if (resolution.ok === false) {
    return <NotidianEmbedErrorView error={{ message: resolution.message }} />;
  }
  return (
    <NotidianEmbedContent
      {...props}
      descriptor={resolution.descriptor}
      predicateOverlay={resolution.predicateOverlay}
    />
  );
};

export const NotidianEmbed = (props: NotidianEmbedProps) => {
  if (props.error || !props.descriptor) {
    return (
      <NotidianEmbedErrorView
        error={props.error ?? { message: "Missing Notidian embed descriptor" }}
      />
    );
  }

  const inspection = inspectDeclaredViewForEmbed({
    superstate: props.superstate,
    sourcePath: props.sourcePath,
    descriptor: props.descriptor,
  });
  if (inspection.kind == "error") {
    return <NotidianEmbedErrorView error={{ message: inspection.message }} />;
  }
  if (inspection.kind == "none") {
    return <NotidianEmbedContent {...props} descriptor={props.descriptor} />;
  }
  return (
    <DeclaredNotidianEmbed
      {...props}
      descriptor={props.descriptor}
      inspection={inspection}
    />
  );
};
