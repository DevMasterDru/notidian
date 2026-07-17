/** @jest-environment jsdom */
import React from "react";
import { TextDecoder, TextEncoder } from "util";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

// react-dom/server.browser reads TextEncoder at module initialization, so load
// it only after the jsdom environment receives Node's WHATWG implementation.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { renderToStaticMarkup } = require("react-dom/server");

let mockFragmentProps: any;

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
      predicate?: any;
    }) => (
      (mockFragmentProps = props),
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
  spacesIndex: new Map(),
  pathsIndex: new Map(),
  contextsIndex: new Map(),
  spaceManager: {
    uriByString: (path: string) => ({
      basePath: path.split("/#")[0],
      ref: path.split("/#")[1]?.slice(1),
      refType: path.includes("/#*") ? "frame" : "context",
    }),
  },
} as any;

describe("NotidianEmbed", () => {
  beforeEach(() => {
    mockFragmentProps = null;
  });

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

  it("resolves a folder-note declaration to its explicit base and ordered overlays", async () => {
    const notePath = "Projects/Projects.md";
    const declaredSuperstate = {
      ...superstate,
      spacesIndex: new Map([
        ["Projects", { space: { path: "Projects", notePath } }],
      ]),
      pathsIndex: new Map([
        [
          notePath,
          {
            metadata: {
              property: {
                views: [
                  {
                    id: "gidi-active",
                    base: { kind: "view", id: "active" },
                    where: ["repo = Gidi"],
                    sort: [{ field: "updated", direction: "desc" }],
                    groupBy: ["repo"],
                    columns: ["File", "repo", "updated"],
                    limit: 10,
                    kind: "table",
                  },
                ],
              },
            },
          },
        ],
      ]),
      contextsIndex: new Map([
        ["Projects", { schemas: [{ id: "files", type: "db" }] }],
      ]),
      spaceManager: {
        ...superstate.spaceManager,
        uriByString: (path: string) => ({
          basePath: path.split("/#")[0],
          ref: path.split("/#")[1]?.slice(1),
          refType: path.includes("/#*") ? "frame" : "context",
        }),
        readFrame: jest.fn(async () => ({
          schema: {
            id: "active",
            name: "Active",
            type: "view",
            def: JSON.stringify({ db: "files" }),
          },
          cols: [] as any[],
          rows: [] as any[],
        })),
        readTable: jest.fn(async () => ({
          schema: { id: "files", type: "db" },
          cols: [
            { name: "File", type: "fileprop" },
            { name: "repo", type: "text" },
            { name: "priority", type: "text" },
            { name: "updated", type: "date" },
          ],
          rows: [] as any[],
        })),
      },
    } as any;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <NotidianEmbed
          superstate={declaredSuperstate}
          sourcePath="Topics/Gidi.md"
          host="markdown"
          descriptor={{
            target: "Projects",
            kind: "view",
            id: "gidi-active",
            title: true,
            editable: false,
            where: [
              {
                field: "priority",
                fn: "is",
                value: "urgent",
                fType: "text",
              },
            ],
          }}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector(".mock-space-fragment")).not.toBeNull();
    expect(mockFragmentProps.path).toBe("Projects/#*active");
    expect(mockFragmentProps.predicate).toEqual({
      filters: [
        { field: "repo", fn: "is", value: "Gidi", fType: "text" },
        { field: "priority", fn: "is", value: "urgent", fType: "text" },
      ],
      sort: [{ field: "updated", fn: "latest" }],
      groupBy: ["repo"],
      colsOrder: ["File", "repo", "updated"],
      colsHidden: ["priority"],
      limit: 10,
      view: "table",
      listView: "",
      listGroup: "",
      listItem: "",
    });

    act(() => root.unmount());
    container.remove();
  });

  it("renders matching invalid declarations as escaped errors without mounting a table", () => {
    const maliciousId = "<img src=x onerror=alert(1)>";
    const notePath = "Projects.md";
    const invalidSuperstate = {
      ...superstate,
      spacesIndex: new Map([
        ["Projects", { space: { path: "Projects", notePath } }],
      ]),
      pathsIndex: new Map([
        [
          notePath,
          {
            metadata: {
              property: {
                views: [
                  {
                    id: maliciousId,
                    base: { kind: "view", id: "active" },
                  },
                ],
              },
            },
          },
        ],
      ]),
      spaceManager: {
        ...superstate.spaceManager,
        uriByString: () => ({ basePath: "Projects" }),
      },
    } as any;

    const markup = renderToStaticMarkup(
      <NotidianEmbed
        superstate={invalidSuperstate}
        sourcePath="Topic.md"
        host="markdown"
        descriptor={descriptorFor(maliciousId)}
      />
    );

    expect(markup).toContain("mk-notidian-embed-error");
    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("mock-space-fragment");
  });

  it("renders schema-invalid rich declarations as errors without mounting a table", async () => {
    const notePath = "Projects/Projects.md";
    const declaredSuperstate = {
      ...superstate,
      spacesIndex: new Map([
        ["Projects", { space: { path: "Projects", notePath } }],
      ]),
      pathsIndex: new Map([
        [
          notePath,
          {
            metadata: {
              property: {
                views: [
                  {
                    id: "gidi-active",
                    base: { kind: "view", id: "active" },
                    kind: "spreadsheet",
                  },
                ],
              },
            },
          },
        ],
      ]),
      contextsIndex: new Map([
        ["Projects", { schemas: [{ id: "files", type: "db" }] }],
      ]),
      spaceManager: {
        ...superstate.spaceManager,
        readFrame: jest.fn(async () => ({
          schema: {
            id: "active",
            type: "view",
            def: JSON.stringify({ db: "files" }),
          },
        })),
        readTable: jest.fn(async () => ({
          schema: { id: "files", type: "db" },
          cols: [{ name: "File", type: "fileprop" }],
          rows: [] as any[],
        })),
      },
    } as any;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <NotidianEmbed
          superstate={declaredSuperstate}
          sourcePath="Topic.md"
          host="markdown"
          descriptor={descriptorFor("gidi-active")}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector(".mk-notidian-embed-error")).not.toBeNull();
    expect(container.textContent).toContain("spreadsheet");
    expect(container.querySelector(".mock-space-fragment")).toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});

const descriptorFor = (id: string) => ({
  target: "Projects",
  kind: "view" as const,
  id,
  title: true,
  editable: false,
});
