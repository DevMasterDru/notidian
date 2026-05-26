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
  notidianBasesCellEditPlan,
  notidianBasesNotePropertyKey,
  notidianBasesRuntimeCapabilities,
  notidianBasesViewSnapshot,
  registerNotidianBasesView,
  writeNotidianBasesCellEdit,
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

describe("notidianBasesNotePropertyKey", () => {
  it("maps Bases note properties to frontmatter keys", () => {
    expect(notidianBasesNotePropertyKey("note.status")).toBe("status");
    expect(notidianBasesNotePropertyKey("status")).toBe("status");
    expect(notidianBasesNotePropertyKey("note.owner.name")).toBe(
      "owner.name"
    );
  });

  it("keeps file and formula properties read-only", () => {
    expect(notidianBasesNotePropertyKey("file.name")).toBeNull();
    expect(notidianBasesNotePropertyKey("file.path")).toBeNull();
    expect(notidianBasesNotePropertyKey("formula.remaining")).toBeNull();
    expect(notidianBasesNotePropertyKey("")).toBeNull();
    expect(notidianBasesNotePropertyKey("note.")).toBeNull();
  });
});

describe("notidianBasesCellEditPlan", () => {
  it("plans ordinary note property edits as frontmatter writes", () => {
    expect(
      notidianBasesCellEditPlan({
        path: "Relays & Devices/Pump.md",
        propertyId: "note.status",
        value: "active",
      })
    ).toEqual({
      ok: true,
      path: "Relays & Devices/Pump.md",
      propertyId: "note.status",
      propertyKey: "status",
      value: "active",
    });
  });

  it("rejects missing paths and read-only properties", () => {
    expect(
      notidianBasesCellEditPlan({
        path: "",
        propertyId: "status",
        value: "active",
      })
    ).toEqual({
      ok: false,
      reason: "missing-path",
      propertyId: "status",
    });

    expect(
      notidianBasesCellEditPlan({
        path: "Relays & Devices/Pump.md",
        propertyId: "file.name",
        value: "Pump 2",
      })
    ).toEqual({
      ok: false,
      reason: "read-only-property",
      path: "Relays & Devices/Pump.md",
      propertyId: "file.name",
    });
  });
});

describe("writeNotidianBasesCellEdit", () => {
  it("writes planned note property edits through Obsidian frontmatter", async () => {
    const file = {
      path: "Relays & Devices/Pump.md",
      extension: "md",
    };
    const frontmatter = {
      status: "queued",
      rating: 2,
    };
    const app = {
      vault: {
        getAbstractFileByPath: jest.fn(() => file),
      },
      fileManager: {
        processFrontMatter: jest.fn(async (_file: unknown, update: any) => {
          update(frontmatter);
        }),
      },
    };

    await writeNotidianBasesCellEdit(app, {
      ok: true,
      path: "Relays & Devices/Pump.md",
      propertyId: "note.status",
      propertyKey: "status",
      value: "active",
    });

    expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith(
      "Relays & Devices/Pump.md"
    );
    expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(
      file,
      expect.any(Function)
    );
    expect(frontmatter).toEqual({
      status: "active",
      rating: 2,
    });
  });

  it("fails instead of accepting a write without Obsidian frontmatter authority", async () => {
    await expect(
      writeNotidianBasesCellEdit(
        {
          vault: {
            getAbstractFileByPath: jest.fn(() => ({
              path: "Relays & Devices/Pump.md",
              extension: "md",
            })),
          },
        },
        {
          ok: true,
          path: "Relays & Devices/Pump.md",
          propertyId: "note.status",
          propertyKey: "status",
          value: "active",
        }
      )
    ).rejects.toThrow("processFrontMatter");
  });
});
