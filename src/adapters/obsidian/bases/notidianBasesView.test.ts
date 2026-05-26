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
  notidianBasesClipboardTextForSelection,
  notidianBasesCreateUndoEntry,
  notidianBasesNotePropertyKey,
  notidianBasesParseTsv,
  notidianBasesPreflightFileNameWrites,
  notidianBasesRowsWithVisibleBaseValues,
  notidianBasesStructuredCutPlan,
  notidianBasesStructuredPastePlan,
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

  it("does not classify file and formula properties as note properties", () => {
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
      authority: "frontmatter",
      path: "Relays & Devices/Pump.md",
      propertyId: "note.status",
      propertyKey: "status",
      value: "active",
    });
  });

  it("plans file name edits as same-folder file renames", () => {
    expect(
      notidianBasesCellEditPlan({
        path: "Relays & Devices/Pump.md",
        propertyId: "file.name",
        value: "Main Pump",
      })
    ).toEqual({
      ok: true,
      authority: "file-name",
      path: "Relays & Devices/Pump.md",
      propertyId: "file.name",
      title: "Main Pump",
      newPath: "Relays & Devices/Main Pump.md",
      value: "Main Pump",
      changed: true,
    });
  });

  it("rejects missing paths, unsafe names, and read-only properties", () => {
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
        value: "Other/Pump 2",
      })
    ).toEqual({
      ok: false,
      reason: "slash",
      path: "Relays & Devices/Pump.md",
      propertyId: "file.name",
    });

    expect(
      notidianBasesCellEditPlan({
        path: "Relays & Devices/Pump.md",
        propertyId: "file.path",
        value: "Relays & Devices/Pump 2.md",
      })
    ).toEqual({
      ok: false,
      reason: "read-only-property",
      path: "Relays & Devices/Pump.md",
      propertyId: "file.path",
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
      authority: "frontmatter",
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

  it("skips stale note property edits when frontmatter changed outside the view", async () => {
    const file = {
      path: "Relays & Devices/Pump.md",
      extension: "md",
    };
    const app = {
      vault: {
        getAbstractFileByPath: jest.fn(() => file),
      },
      metadataCache: {
        getFileCache: jest.fn(() => ({
          frontmatter: {
            status: "external",
          },
        })),
      },
      fileManager: {
        processFrontMatter: jest.fn(),
      },
    };

    await expect(
      writeNotidianBasesCellEdit(app, {
        ok: true,
        authority: "frontmatter",
        path: "Relays & Devices/Pump.md",
        propertyId: "status",
        propertyKey: "status",
        value: "active",
        baseValue: "queued",
      })
    ).rejects.toMatchObject({
      reason: "frontmatter-conflict",
      currentValue: "external",
      baseValue: "queued",
      attemptedValue: "active",
    });
    expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });

  it("allows explicit forced note property writes after conflict review", async () => {
    const file = {
      path: "Relays & Devices/Pump.md",
      extension: "md",
    };
    const frontmatter = {
      status: "external",
    };
    const app = {
      vault: {
        getAbstractFileByPath: jest.fn(() => file),
      },
      metadataCache: {
        getFileCache: jest.fn(() => ({
          frontmatter,
        })),
      },
      fileManager: {
        processFrontMatter: jest.fn(async (_file: unknown, update: any) => {
          update(frontmatter);
        }),
      },
    };

    await writeNotidianBasesCellEdit(app, {
      ok: true,
      authority: "frontmatter",
      path: "Relays & Devices/Pump.md",
      propertyId: "status",
      propertyKey: "status",
      value: "active",
      baseValue: "queued",
      forceFrontmatterWrite: true,
    });

    expect(frontmatter.status).toBe("active");
    expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(
      file,
      expect.any(Function)
    );
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
          authority: "frontmatter",
          path: "Relays & Devices/Pump.md",
          propertyId: "note.status",
          propertyKey: "status",
          value: "active",
        }
      )
    ).rejects.toThrow("processFrontMatter");
  });

  it("renames file name edits through Obsidian fileManager", async () => {
    const file = {
      path: "Relays & Devices/Pump.md",
      extension: "md",
    };
    const app = {
      vault: {
        getAbstractFileByPath: jest.fn((path: string) =>
          path == "Relays & Devices/Pump.md" ? file : null
        ),
      },
      fileManager: {
        renameFile: jest.fn(async (): Promise<void> => undefined),
      },
    };

    await writeNotidianBasesCellEdit(app, {
      ok: true,
      authority: "file-name",
      path: "Relays & Devices/Pump.md",
      propertyId: "file.name",
      title: "Main Pump",
      newPath: "Relays & Devices/Main Pump.md",
      value: "Main Pump",
      changed: true,
    });

    expect(app.fileManager.renameFile).toHaveBeenCalledWith(
      file,
      "Relays & Devices/Main Pump.md"
    );
  });

  it("rejects file name edits when the target path already exists", async () => {
    const source = {
      path: "Relays & Devices/Pump.md",
      extension: "md",
    };
    const target = {
      path: "Relays & Devices/Main Pump.md",
      extension: "md",
    };
    const app = {
      vault: {
        getAbstractFileByPath: jest.fn((path: string) =>
          path == source.path ? source : path == target.path ? target : null
        ),
      },
      fileManager: {
        renameFile: jest.fn(async (): Promise<void> => undefined),
      },
    };

    await expect(
      writeNotidianBasesCellEdit(app, {
        ok: true,
        authority: "file-name",
        path: source.path,
        propertyId: "file.name",
        title: "Main Pump",
        newPath: target.path,
        value: "Main Pump",
        changed: true,
      })
    ).rejects.toThrow("already exists");
    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
  });
});

describe("notidianBasesStructuredPastePlan", () => {
  it("prefers visible accepted cell base values over stale snapshot values", () => {
    expect(
      notidianBasesRowsWithVisibleBaseValues({
        properties: ["file.name", "status", "rating"],
        rows: [
          {
            path: "Relays & Devices/Beta.md",
            values: ["Beta", "queued", "2"],
          },
        ],
        baseValueForCell: (_rowIndex, columnIndex) =>
          columnIndex == 1 ? "base-view-active" : undefined,
      })
    ).toEqual([
      {
        path: "Relays & Devices/Beta.md",
        values: ["Beta", "base-view-active", "2"],
      },
    ]);
  });

  it("plans file-name paste as rename writes with base titles", () => {
    const plan = notidianBasesStructuredPastePlan({
      properties: ["file.name", "status"],
      rows: [
        { path: "Relays & Devices/Beta.md", values: ["Beta", "queued"] },
        { path: "Relays & Devices/Gamma.md", values: ["Gamma", "old"] },
      ],
      startRowIndex: 0,
      startColumnIndex: 0,
      text: "Beta Renamed\tactive\nGamma Renamed\tpaused",
    });

    expect(plan.writes).toEqual([
      {
        rowIndex: 0,
        columnIndex: 0,
        request: {
          path: "Relays & Devices/Beta.md",
          propertyId: "file.name",
          baseValue: "Beta",
          value: "Beta Renamed",
        },
      },
      {
        rowIndex: 0,
        columnIndex: 1,
        request: {
          path: "Relays & Devices/Beta.md",
          propertyId: "status",
          baseValue: "queued",
          value: "active",
        },
      },
      {
        rowIndex: 1,
        columnIndex: 0,
        request: {
          path: "Relays & Devices/Gamma.md",
          propertyId: "file.name",
          baseValue: "Gamma",
          value: "Gamma Renamed",
        },
      },
      {
        rowIndex: 1,
        columnIndex: 1,
        request: {
          path: "Relays & Devices/Gamma.md",
          propertyId: "status",
          baseValue: "old",
          value: "paused",
        },
      },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("plans TSV paste across note-property cells", () => {
    expect(notidianBasesParseTsv("active\t7\npaused\t3")).toEqual([
      ["active", "7"],
      ["paused", "3"],
    ]);

    const plan = notidianBasesStructuredPastePlan({
      properties: ["file.name", "status", "rating"],
      rows: [
        { path: "Relays & Devices/Beta.md", values: ["Beta", "queued", "2"] },
        { path: "Relays & Devices/Gamma.md", values: ["Gamma", "old", "1"] },
      ],
      startRowIndex: 0,
      startColumnIndex: 1,
      text: "active\t7\npaused\t3",
    });

    expect(plan.writes).toEqual([
      {
        rowIndex: 0,
        columnIndex: 1,
        request: {
          path: "Relays & Devices/Beta.md",
          propertyId: "status",
          baseValue: "queued",
          value: "active",
        },
      },
      {
        rowIndex: 0,
        columnIndex: 2,
        request: {
          path: "Relays & Devices/Beta.md",
          propertyId: "rating",
          baseValue: "2",
          value: "7",
        },
      },
      {
        rowIndex: 1,
        columnIndex: 1,
        request: {
          path: "Relays & Devices/Gamma.md",
          propertyId: "status",
          baseValue: "old",
          value: "paused",
        },
      },
      {
        rowIndex: 1,
        columnIndex: 2,
        request: {
          path: "Relays & Devices/Gamma.md",
          propertyId: "rating",
          baseValue: "1",
          value: "3",
        },
      },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips read-only properties and out-of-bounds cells", () => {
    const plan = notidianBasesStructuredPastePlan({
      properties: ["file.name", "status", "file.path"],
      rows: [{ path: "Relays & Devices/Beta.md", values: ["Beta", "queued", ""] }],
      startRowIndex: 0,
      startColumnIndex: 1,
      text: "active\tOther.md\tignored",
    });

    expect(plan.writes).toEqual([
      {
        rowIndex: 0,
        columnIndex: 1,
        request: {
          path: "Relays & Devices/Beta.md",
          propertyId: "status",
          baseValue: "queued",
          value: "active",
        },
      },
    ]);
    expect(plan.skipped).toEqual([
      {
        rowIndex: 0,
        columnIndex: 2,
        reason: "read-only-property",
        value: "Other.md",
      },
      {
        rowIndex: 0,
        columnIndex: 3,
        reason: "out-of-bounds",
        value: "ignored",
      },
    ]);
  });
});

describe("notidianBasesSelectionClipboard", () => {
  it("serializes a selected rectangle as TSV from visible Bases values", () => {
    expect(
      notidianBasesClipboardTextForSelection({
        rows: [
          { values: ["Beta", "active", "7"] },
          { values: ["Gamma", "paused", "3"] },
        ],
        selection: {
          anchor: { rowIndex: 0, columnIndex: 1 },
          focus: { rowIndex: 1, columnIndex: 2 },
          active: { rowIndex: 1, columnIndex: 2 },
        },
      })
    ).toBe("active\t7\npaused\t3");
  });

  it("plans cut as clears for note-property cells while skipping file and formula cells", () => {
    const plan = notidianBasesStructuredCutPlan({
      properties: ["file.name", "status", "file.path", "rating"],
      rows: [
        {
          path: "Relays & Devices/Beta.md",
          values: ["Beta", "active", "Relays & Devices/Beta.md", "7"],
        },
      ],
      selection: {
        anchor: { rowIndex: 0, columnIndex: 0 },
        focus: { rowIndex: 0, columnIndex: 3 },
        active: { rowIndex: 0, columnIndex: 3 },
      },
    });

    expect(plan.writes).toEqual([
      {
        rowIndex: 0,
        columnIndex: 1,
        request: {
          path: "Relays & Devices/Beta.md",
          propertyId: "status",
          baseValue: "active",
          value: "",
        },
      },
      {
        rowIndex: 0,
        columnIndex: 3,
        request: {
          path: "Relays & Devices/Beta.md",
          propertyId: "rating",
          baseValue: "7",
          value: "",
        },
      },
    ]);
    expect(plan.skipped).toEqual([
      {
        rowIndex: 0,
        columnIndex: 0,
        reason: "read-only-property",
        value: "Beta",
      },
      {
        rowIndex: 0,
        columnIndex: 2,
        reason: "read-only-property",
        value: "Relays & Devices/Beta.md",
      },
    ]);
  });
});

describe("notidianBasesPreflightFileNameWrites", () => {
  it("accepts unique safe file-name paste targets", () => {
    expect(
      notidianBasesPreflightFileNameWrites({
        writes: [
          {
            path: "Relays & Devices/Beta.md",
            propertyId: "file.name",
            baseValue: "Beta",
            value: "Beta Renamed",
          },
          {
            path: "Relays & Devices/Gamma.md",
            propertyId: "file.name",
            baseValue: "Gamma",
            value: "Gamma Renamed",
          },
        ],
        pathExists: () => false,
      })
    ).toEqual({
      ok: true,
      plans: [
        {
          path: "Relays & Devices/Beta.md",
          newPath: "Relays & Devices/Beta Renamed.md",
          value: "Beta Renamed",
        },
        {
          path: "Relays & Devices/Gamma.md",
          newPath: "Relays & Devices/Gamma Renamed.md",
          value: "Gamma Renamed",
        },
      ],
      issues: [],
    });
  });

  it("rejects unsafe, duplicate, and existing file-name paste targets before rename", () => {
    const result = notidianBasesPreflightFileNameWrites({
      writes: [
        {
          path: "Relays & Devices/Beta.md",
          propertyId: "file.name",
          baseValue: "Beta",
          value: "Bad/Name",
        },
        {
          path: "Relays & Devices/Gamma.md",
          propertyId: "file.name",
          baseValue: "Gamma",
          value: "Duplicate",
        },
        {
          path: "Relays & Devices/Delta.md",
          propertyId: "file.name",
          baseValue: "Delta",
          value: "Duplicate",
        },
        {
          path: "Relays & Devices/Epsilon.md",
          propertyId: "file.name",
          baseValue: "Epsilon",
          value: "Existing",
        },
      ],
      pathExists: (path) => path == "Relays & Devices/Existing.md",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        request: {
          path: "Relays & Devices/Beta.md",
          propertyId: "file.name",
          baseValue: "Beta",
          value: "Bad/Name",
        },
        reason: "slash",
      },
      {
        request: {
          path: "Relays & Devices/Delta.md",
          propertyId: "file.name",
          baseValue: "Delta",
          value: "Duplicate",
        },
        reason: "duplicate-target",
        newPath: "Relays & Devices/Duplicate.md",
      },
      {
        request: {
          path: "Relays & Devices/Epsilon.md",
          propertyId: "file.name",
          baseValue: "Epsilon",
          value: "Existing",
        },
        reason: "target-exists",
        newPath: "Relays & Devices/Existing.md",
      },
    ]);
  });

  it("rejects file-name paste targets that collide with another source path", () => {
    const result = notidianBasesPreflightFileNameWrites({
      writes: [
        {
          path: "Relays & Devices/Beta.md",
          propertyId: "file.name",
          baseValue: "Beta",
          value: "Gamma",
        },
        {
          path: "Relays & Devices/Gamma.md",
          propertyId: "file.name",
          baseValue: "Gamma",
          value: "Gamma Next",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        request: {
          path: "Relays & Devices/Beta.md",
          propertyId: "file.name",
          baseValue: "Beta",
          value: "Gamma",
        },
        reason: "target-source-conflict",
        newPath: "Relays & Devices/Gamma.md",
      },
    ]);
  });
});

describe("notidianBasesCreateUndoEntry", () => {
  it("creates inverse writes for applied note-property edits", () => {
    expect(
      notidianBasesCreateUndoEntry({
        label: "Paste cells",
        writes: [
          {
            path: "Relays & Devices/Beta.md",
            propertyId: "status",
            baseValue: "queued",
            value: "active",
          },
          {
            path: "Relays & Devices/Beta.md",
            propertyId: "rating",
            baseValue: "2",
            value: "9",
          },
        ],
      })
    ).toEqual({
      label: "Paste cells",
      writes: [
        {
          path: "Relays & Devices/Beta.md",
          propertyId: "rating",
          baseValue: "9",
          value: "2",
        },
        {
          path: "Relays & Devices/Beta.md",
          propertyId: "status",
          baseValue: "active",
          value: "queued",
        },
      ],
    });
  });

  it("creates inverse writes for applied file-name edits", () => {
    expect(
      notidianBasesCreateUndoEntry({
        label: "Rename file",
        writes: [
          {
            path: "Relays & Devices/Beta.md",
            propertyId: "file.name",
            baseValue: "Beta",
            value: "Renamed Beta",
          },
        ],
      })
    ).toEqual({
      label: "Rename file",
      writes: [
        {
          path: "Relays & Devices/Renamed Beta.md",
          propertyId: "file.name",
          baseValue: "Renamed Beta",
          value: "Beta",
        },
      ],
    });
  });

  it("undoes mixed file-name and note-property writes in reverse transaction order", () => {
    expect(
      notidianBasesCreateUndoEntry({
        label: "Paste cells",
        writes: [
          {
            path: "Relays & Devices/Beta.md",
            propertyId: "file.name",
            baseValue: "Beta",
            value: "Renamed Beta",
          },
          {
            path: "Relays & Devices/Renamed Beta.md",
            propertyId: "status",
            baseValue: "queued",
            value: "active",
          },
        ],
      })
    ).toEqual({
      label: "Paste cells",
      writes: [
        {
          path: "Relays & Devices/Renamed Beta.md",
          propertyId: "status",
          baseValue: "active",
          value: "queued",
        },
        {
          path: "Relays & Devices/Renamed Beta.md",
          propertyId: "file.name",
          baseValue: "Renamed Beta",
          value: "Beta",
        },
      ],
    });
  });
});
