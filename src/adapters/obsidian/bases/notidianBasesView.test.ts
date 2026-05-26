jest.mock(
  "obsidian",
  () => ({
    BasesView: class {
      controller: unknown;
      data: unknown;
      config: unknown;

      constructor(controller: unknown) {
        this.controller = controller;
      }
    },
  }),
  { virtual: true }
);

import {
  NOTIDIAN_BASES_VIEW_TYPE,
  notidianBasesRuntimeCapabilities,
  notidianBasesViewSnapshot,
  registerNotidianBasesView,
} from "./notidianBasesView";

const parentEl = () =>
  ({
    createDiv: jest.fn(() => ({
      empty: jest.fn(),
      createEl: jest.fn(() => ({
        createEl: jest.fn(),
        createSpan: jest.fn(),
      })),
    })),
  } as any);

describe("registerNotidianBasesView", () => {
  it("returns false when Obsidian Bases custom views are unavailable", () => {
    expect(registerNotidianBasesView({} as any)).toBe(false);
  });

  it("registers the Notidian table view with a runtime factory", () => {
    const registerBasesView = jest.fn(
      (_viewType: string, _registration: any) => true
    );

    expect(registerNotidianBasesView({ registerBasesView } as any)).toBe(true);
    expect(registerBasesView).toHaveBeenCalledWith(
      NOTIDIAN_BASES_VIEW_TYPE,
      expect.objectContaining({
        name: "Notidian Table",
        icon: "lucide-table-2",
        factory: expect.any(Function),
      })
    );

    const registration = registerBasesView.mock.calls[0]?.[1];
    const view = registration.factory({ marker: "controller" }, parentEl());

    expect(view.type).toBe(NOTIDIAN_BASES_VIEW_TYPE);
  });
});

describe("notidianBasesViewSnapshot", () => {
  it("projects Bases query data without storing a separate durable table", () => {
    const snapshot = notidianBasesViewSnapshot({
      config: {
        getOrder: () => ["file.name", "status"],
      },
      data: {
        groupedData: [
          {
            key: "active",
            entries: [
              {
                file: {
                  name: "Pump.md",
                  path: "Relays & Devices/Pump.md",
                },
                getValue: (propertyId: string) => ({
                  isEmpty: () => false,
                  toString: () =>
                    propertyId === "file.name" ? "Pump" : "active",
                }),
              },
            ],
          },
        ],
        properties: ["file.name", "status"],
      },
    });

    expect(snapshot).toEqual({
      properties: ["file.name", "status"],
      groups: [
        {
          key: "active",
          rows: [
            {
              path: "Relays & Devices/Pump.md",
              values: ["Pump", "active"],
            },
          ],
        },
      ],
      rowCount: 1,
      diagnostics: [],
    });
  });

  it("falls back to the ungrouped Bases data and visible properties", () => {
    const snapshot = notidianBasesViewSnapshot({
      data: {
        data: [
          {
            file: {
              name: "Relay.md",
              path: "Relays & Devices/Relay.md",
            },
            getValue: (propertyId: string) =>
              propertyId === "file.name" ? "Relay" : undefined,
          },
        ],
        properties: ["file.name"],
      },
    });

    expect(snapshot.groups).toEqual([
      {
        key: "",
        rows: [
          {
            path: "Relays & Devices/Relay.md",
            values: ["Relay"],
          },
        ],
      },
    ]);
    expect(snapshot.rowCount).toBe(1);
  });
});

describe("notidianBasesRuntimeCapabilities", () => {
  it("captures the documented Bases read/config surface and value methods", () => {
    const capabilities = notidianBasesRuntimeCapabilities({
      controller: {
        refresh: (): void => undefined,
      },
      view: {
        config: {
          get: (): undefined => undefined,
          getOrder: () => ["file.name", "status"],
          getSort: () => [],
          getDisplayName: () => "Status",
          set: (): undefined => undefined,
        },
        data: {
          data: [
            {
              file: {
                path: "Relays & Devices/Pump.md",
                name: "Pump.md",
              },
              getValue: () => ({
                isEmpty: () => false,
                renderTo: (): undefined => undefined,
                toString: () => "active",
              }),
            },
          ],
          groupedData: [
            {
              key: "",
              entries: [],
            },
          ],
          properties: ["file.name", "status"],
        },
      },
    });

    expect(capabilities).toEqual(
      expect.objectContaining({
        controllerKeys: ["refresh"],
        configMethods: expect.arrayContaining([
          "get",
          "getDisplayName",
          "getOrder",
          "getSort",
          "set",
        ]),
        dataShape: {
          hasData: true,
          hasGroupedData: true,
          properties: ["file.name", "status"],
          ungroupedCount: 1,
          groupCount: 1,
          groupedRowCount: 0,
        },
        firstEntry: {
          keys: ["file", "getValue"],
          fileKeys: ["name", "path"],
          filePath: "Relays & Devices/Pump.md",
          getValueType: "function",
          valueMethods: ["isEmpty", "renderTo", "toString"],
        },
      })
    );
    expect(capabilities.writeSurface).toEqual({
      entryHasSetValue: false,
      configHasSet: true,
      notes:
        "No documented Bases cell-write API is assumed. Notidian writes must route through file/frontmatter authorities until a runtime write surface is proven.",
    });
  });
});
