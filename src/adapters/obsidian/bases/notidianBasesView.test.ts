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
