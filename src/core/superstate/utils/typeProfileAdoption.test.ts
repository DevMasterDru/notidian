import {
  applyTypeProfileAdoptionDraft,
  buildTypeProfileAdoptionDraft,
  gatherSiblingDatabaseFieldValues,
  resolveAdoptionTargetFolder,
} from "./typeProfileAdoption";

// Minimal fake Superstate: only the surfaces this module actually reads
// (contextsIndex/pathsIndex/spacesIndex Maps, settings, spaceManager methods)
// — mirrors the "as any" fake-superstate convention already used by
// label.test.ts / resolvePath.test.ts in this directory.
const makeSuperstate = (overrides: Record<string, any> = {}) =>
  ({
    contextsIndex: new Map(),
    pathsIndex: new Map(),
    spacesIndex: new Map(),
    settings: {
      enableFolderNote: true,
      fmKeyAlias: "aliases",
    },
    spaceManager: {
      parentPathForPath: (path: string) =>
        path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
      saveProperties: jest.fn().mockResolvedValue(true),
    },
    ui: { notify: jest.fn() },
    ...overrides,
  } as any);

const registerFolder = (
  superstate: any,
  folder: string,
  paths: string[],
  frontmatterByPath: Record<string, Record<string, unknown>>,
  hub?: { path: string; frontmatter?: Record<string, unknown> }
) => {
  superstate.contextsIndex.set(folder, { path: folder, paths });
  for (const path of paths) {
    superstate.pathsIndex.set(path, {
      metadata: { property: frontmatterByPath[path] ?? {} },
    });
  }
  if (hub) {
    superstate.spacesIndex.set(folder, {
      space: { defPath: hub.path, notePath: hub.path },
    });
    superstate.pathsIndex.set(hub.path, {
      metadata: { property: hub.frontmatter ?? {} },
    });
  }
};

describe("gatherSiblingDatabaseFieldValues", () => {
  it("collects distinct trimmed values per sibling field, excluding the target folder itself", () => {
    const superstate = makeSuperstate();
    registerFolder(superstate, "Sensors", ["Sensors/A.md"], {
      "Sensors/A.md": { board_id: "board-1" },
    });
    registerFolder(
      superstate,
      "Boards",
      ["Boards/1.md", "Boards/2.md"],
      {
        "Boards/1.md": { board_id: " board-1 " },
        "Boards/2.md": { board_id: "board-2" },
      }
    );

    const siblings = gatherSiblingDatabaseFieldValues(superstate, "Sensors");
    const boardsField = siblings.find(
      (s) => s.targetFolder == "Boards" && s.targetKey == "board_id"
    );
    expect(boardsField?.values).toEqual(new Set(["board-1", "board-2"]));
    expect(siblings.some((s) => s.targetFolder == "Sensors")).toBe(false);
  });

  it("excludes configured keys and drops fields left with zero values", () => {
    const superstate = makeSuperstate();
    registerFolder(superstate, "Sensors", ["Sensors/A.md"], {
      "Sensors/A.md": {},
    });
    registerFolder(superstate, "Boards", ["Boards/1.md"], {
      "Boards/1.md": { internal: "skip", blank: "" },
    });

    const siblings = gatherSiblingDatabaseFieldValues(superstate, "Sensors", {
      excludedKeys: new Set(["internal"]),
    });
    expect(siblings).toEqual([]);
  });

  it("caps the number of sibling folders scanned", () => {
    const superstate = makeSuperstate();
    registerFolder(superstate, "Target", ["Target/A.md"], {
      "Target/A.md": {},
    });
    registerFolder(superstate, "Sib1", ["Sib1/1.md"], {
      "Sib1/1.md": { id: "x" },
    });
    registerFolder(superstate, "Sib2", ["Sib2/1.md"], {
      "Sib2/1.md": { id: "y" },
    });

    const siblings = gatherSiblingDatabaseFieldValues(superstate, "Target", {
      maxSiblingFolders: 1,
    });
    expect(siblings.length).toBe(1);
  });
});

describe("resolveAdoptionTargetFolder", () => {
  it("resolves directly when activePath IS the database folder", () => {
    const superstate = makeSuperstate();
    registerFolder(superstate, "Sensors", ["Sensors/A.md"], {
      "Sensors/A.md": {},
    });
    expect(resolveAdoptionTargetFolder(superstate, "Sensors")).toBe("Sensors");
  });

  it("resolves via the hub note path", () => {
    const superstate = makeSuperstate();
    registerFolder(
      superstate,
      "Sensors",
      ["Sensors/A.md"],
      { "Sensors/A.md": {} },
      { path: "Sensors/Sensors.md" }
    );
    expect(resolveAdoptionTargetFolder(superstate, "Sensors/Sensors.md")).toBe(
      "Sensors"
    );
  });

  it("resolves via a row file's parent folder", () => {
    const superstate = makeSuperstate();
    registerFolder(superstate, "Sensors", ["Sensors/A.md"], {
      "Sensors/A.md": {},
    });
    expect(resolveAdoptionTargetFolder(superstate, "Sensors/A.md")).toBe(
      "Sensors"
    );
  });

  it("returns null when nothing resolves", () => {
    const superstate = makeSuperstate();
    expect(resolveAdoptionTargetFolder(superstate, "Nowhere/X.md")).toBeNull();
    expect(resolveAdoptionTargetFolder(superstate, null)).toBeNull();
  });
});

describe("buildTypeProfileAdoptionDraft", () => {
  it("returns null for a folder with no live context", () => {
    const superstate = makeSuperstate();
    expect(buildTypeProfileAdoptionDraft(superstate, "Nope")).toBeNull();
  });

  it("drafts fields from live rows, skipping fields the hub note already declares", () => {
    const superstate = makeSuperstate();
    registerFolder(
      superstate,
      "Sensors",
      ["Sensors/A.md", "Sensors/B.md", "Sensors/C.md"],
      {
        "Sensors/A.md": { status: "active", owner: "alice" },
        "Sensors/B.md": { status: "active", owner: "bob" },
        "Sensors/C.md": { status: "paused", owner: "carol" },
      },
      {
        path: "Sensors/Sensors.md",
        frontmatter: {
          schema_type: "notidian_type_profile",
          fields: { owner: { kind: "text" } },
        },
      }
    );

    const draft = buildTypeProfileAdoptionDraft(superstate, "Sensors");
    expect(draft?.rowCount).toBe(3);
    const names = draft?.fields.map((f) => f.field.name);
    expect(names).toEqual(["status"]); // "owner" already declared -> skipped
    expect(draft?.fields[0].field.enum).toEqual({
      values: ["active", "paused"],
      strict: false,
    });
  });

  it("dedupes a duplicated path in contextsIndex.paths (observed live: overlapping reload passes can double-list a row)", () => {
    const superstate = makeSuperstate();
    registerFolder(superstate, "Sensors", ["Sensors/A.md", "Sensors/B.md"], {
      "Sensors/A.md": { status: "active" },
      "Sensors/B.md": { status: "paused" },
    });
    // Simulate the observed duplication directly on the live index.
    superstate.contextsIndex.get("Sensors").paths = [
      "Sensors/A.md",
      "Sensors/A.md",
      "Sensors/B.md",
    ];

    const draft = buildTypeProfileAdoptionDraft(superstate, "Sensors");
    expect(draft?.rowCount).toBe(2);
    const status = draft?.fields.find((f) => f.field.name == "status");
    // Without dedup this would report presentCount 3 / distinctCount 2 and a
    // (still-correct-looking) enum, but rowCount and per-row stats would be
    // silently wrong — assert the count actually reflects 2 real rows.
    expect(status?.emptyEncoding.presentCount).toBe(2);
  });
});

describe("applyTypeProfileAdoptionDraft", () => {
  it("is a no-op and never calls saveProperties when the draft has no fields", async () => {
    const superstate = makeSuperstate();
    registerFolder(
      superstate,
      "Sensors",
      ["Sensors/A.md"],
      { "Sensors/A.md": {} },
      { path: "Sensors/Sensors.md" }
    );
    const result = await applyTypeProfileAdoptionDraft(superstate, "Sensors", {
      fields: [],
    });
    expect(result).toEqual({ ok: true, addedFieldNames: [] });
    expect(superstate.spaceManager.saveProperties).not.toHaveBeenCalled();
  });

  it("writes schema_type + merged fields on confirm, bootstrapping schema_type when absent", async () => {
    const superstate = makeSuperstate();
    registerFolder(
      superstate,
      "Sensors",
      ["Sensors/A.md"],
      { "Sensors/A.md": { status: "active" } },
      { path: "Sensors/Sensors.md", frontmatter: {} }
    );
    const draft = buildTypeProfileAdoptionDraft(superstate, "Sensors")!;

    const result = await applyTypeProfileAdoptionDraft(
      superstate,
      "Sensors",
      draft
    );

    expect(result.ok).toBe(true);
    expect(superstate.spaceManager.saveProperties).toHaveBeenCalledTimes(1);
    const [path, properties] =
      superstate.spaceManager.saveProperties.mock.calls[0];
    expect(path).toBe("Sensors/Sensors.md");
    expect(properties.schema_type).toBe("notidian_type_profile");
    expect(properties.fields.status).toEqual({ kind: "text" });
  });

  it("does NOT bootstrap schema_type again when the hub already declares it", async () => {
    const superstate = makeSuperstate();
    registerFolder(
      superstate,
      "Sensors",
      ["Sensors/A.md"],
      { "Sensors/A.md": { status: "active" } },
      {
        path: "Sensors/Sensors.md",
        frontmatter: { schema_type: "notidian_type_profile" },
      }
    );
    const draft = buildTypeProfileAdoptionDraft(superstate, "Sensors")!;

    await applyTypeProfileAdoptionDraft(superstate, "Sensors", draft);

    const [, properties] = superstate.spaceManager.saveProperties.mock.calls[0];
    expect(properties.schema_type).toBeUndefined();
  });

  it("re-plans against the CURRENT hub fields at write time, never clobbering a field added since the preview opened", async () => {
    const superstate = makeSuperstate();
    registerFolder(
      superstate,
      "Sensors",
      ["Sensors/A.md"],
      { "Sensors/A.md": { status: "active" } },
      { path: "Sensors/Sensors.md", frontmatter: {} }
    );
    const draft = buildTypeProfileAdoptionDraft(superstate, "Sensors")!;

    // Simulate a concurrent edit: "status" gets declared by someone else
    // between preview and confirm.
    superstate.pathsIndex.get("Sensors/Sensors.md").metadata.property = {
      fields: { status: { kind: "text", required: true, value: "seeded" } },
    };

    const result = await applyTypeProfileAdoptionDraft(
      superstate,
      "Sensors",
      draft
    );

    // Nothing NEW to add -> no-op, and the concurrently-added declaration is
    // never touched by this call.
    expect(result).toEqual({ ok: true, addedFieldNames: [] });
    expect(superstate.spaceManager.saveProperties).not.toHaveBeenCalled();
  });

  it("reports write-failed when the underlying save rejects", async () => {
    const superstate = makeSuperstate();
    superstate.spaceManager.saveProperties = jest.fn().mockResolvedValue(false);
    registerFolder(
      superstate,
      "Sensors",
      ["Sensors/A.md"],
      { "Sensors/A.md": { status: "active" } },
      { path: "Sensors/Sensors.md", frontmatter: {} }
    );
    const draft = buildTypeProfileAdoptionDraft(superstate, "Sensors")!;

    const result = await applyTypeProfileAdoptionDraft(
      superstate,
      "Sensors",
      draft
    );
    expect(result).toEqual({
      ok: false,
      addedFieldNames: [],
      reason: "write-failed",
    });
  });

  it("reports no-space when the folder has no live space entry, and notifies the owner", async () => {
    const superstate = makeSuperstate();
    const result = await applyTypeProfileAdoptionDraft(superstate, "Ghost", {
      fields: [
        {
          field: { name: "x", kind: "text", type: "text" },
          foreignKeyCandidates: [],
          emptyEncoding: { absentCount: 0, emptyStringCount: 0, presentCount: 1 },
        },
      ],
    });
    expect(result).toEqual({
      ok: false,
      addedFieldNames: [],
      reason: "no-space",
    });
    // The confirm modal closes synchronously on click, before this async
    // write settles — an unnotified no-space failure would vanish silently.
    expect(superstate.ui.notify).toHaveBeenCalledTimes(1);
  });

  it("reports no-hub-path and notifies the owner when the folder's space cannot resolve a hub note path", async () => {
    const superstate = makeSuperstate();
    superstate.contextsIndex.set("Sensors", {
      path: "Sensors",
      paths: ["Sensors/A.md"],
    });
    superstate.pathsIndex.set("Sensors/A.md", {
      metadata: { property: { status: "active" } },
    });
    // A space entry exists but resolves no note path (enableFolderNote:true
    // means metadataPathForSpace reads space.notePath, which is absent here).
    superstate.spacesIndex.set("Sensors", { space: {} });

    const result = await applyTypeProfileAdoptionDraft(superstate, "Sensors", {
      fields: [
        {
          field: { name: "x", kind: "text", type: "text" },
          foreignKeyCandidates: [],
          emptyEncoding: { absentCount: 0, emptyStringCount: 0, presentCount: 1 },
        },
      ],
    });
    expect(result).toEqual({
      ok: false,
      addedFieldNames: [],
      reason: "no-hub-path",
    });
    expect(superstate.ui.notify).toHaveBeenCalledTimes(1);
  });

  it("never clobbers a field declared only in the hub's kind_fields at write time (Notidian-egz v2 kind-scoped columns, ADR-0056 D9 'never clobber')", async () => {
    const superstate = makeSuperstate();
    registerFolder(
      superstate,
      "Sensors",
      ["Sensors/A.md"],
      { "Sensors/A.md": { status: "active" } },
      { path: "Sensors/Sensors.md", frontmatter: {} }
    );
    const draft = buildTypeProfileAdoptionDraft(superstate, "Sensors")!;
    expect(draft.fields.map((f) => f.field.name)).toContain("status");

    // Simulate a concurrent edit via the table's kind_fields mirror
    // (planTypeProfileMirror): "status" gets declared under a specific kind
    // between preview-open and confirm-click, but never touches the flat
    // `fields:` map the stale draft was computed against.
    superstate.pathsIndex.get("Sensors/Sensors.md").metadata.property = {
      kind_fields: {
        task: { status: { kind: "select", options: ["active", "done"] } },
      },
    };

    const result = await applyTypeProfileAdoptionDraft(
      superstate,
      "Sensors",
      draft
    );

    // "status" is already declared (under kind_fields.task), so re-adding it
    // to the common `fields` map would create a duplicate, conflicting
    // declaration for the same name -> nothing to add, no write at all.
    expect(result).toEqual({ ok: true, addedFieldNames: [] });
    expect(superstate.spaceManager.saveProperties).not.toHaveBeenCalled();
  });
});
