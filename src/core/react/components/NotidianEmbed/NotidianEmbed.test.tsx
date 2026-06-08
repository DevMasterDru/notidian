import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("core/react/context/SpaceManagerContext", () => {
  const React = require("react");
  return {
    SpaceManagerProvider: (props: { children: React.ReactNode }) => (
      <div data-provider="space-manager">{props.children}</div>
    ),
  };
});

jest.mock("../SpaceView/Editor/EmbedView/SpaceFragmentView", () => {
  const React = require("react");
  return {
    SpaceFragmentViewComponent: (props: {
      path: string;
      readMode: boolean;
      showTitle: boolean;
    }) => (
      <div
        className="mock-space-fragment"
        data-path={props.path}
        data-read-mode={String(props.readMode)}
        data-show-title={String(props.showTitle)}
      />
    ),
  };
});

import { NotidianEmbed } from "./NotidianEmbed";

const superstate = {
  settings: {},
  spaceManager: {
    uriByString: (path: string) => ({
      basePath: path.split("/#")[0],
      ref: path.split("/#")[1]?.slice(1),
      refType: path.includes("/#*") ? "frame" : "context",
    }),
  },
} as any;

describe("NotidianEmbed", () => {
  it("renders inline errors without mounting a table", () => {
    const markup = renderToStaticMarkup(
      <NotidianEmbed
        superstate={superstate}
        sourcePath="Dashboard.md"
        host="markdown"
        error={{ message: "target is required" }}
      />
    );

    expect(markup).toContain("mk-notidian-embed-error");
    expect(markup).toContain("target is required");
  });

  it("applies sizing and read-only data attributes for valid descriptors", () => {
    const markup = renderToStaticMarkup(
      <NotidianEmbed
        superstate={superstate}
        sourcePath="Dashboard.md"
        host="markdown"
        descriptor={{
          target: "Projects",
          kind: "view",
          id: "active",
          height: 420,
          title: false,
          editable: false,
        }}
      />
    );

    expect(markup).toContain("mk-notidian-embed");
    expect(markup).toContain('data-host="markdown"');
    expect(markup).toContain('data-editable="false"');
    expect(markup).toContain('data-path="Projects/#*active"');
    expect(markup).toContain('data-read-mode="true"');
    expect(markup).toContain('data-show-title="false"');
    expect(markup).toContain("height:420px");
  });
});
