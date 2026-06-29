import { FilenameEnforcer } from "./filenameEnforcer";

// ---------------------------------------------------------------------------
// Mock superstate factory
// ---------------------------------------------------------------------------

function createMockSuperstate(overrides: {
  filenameTemplateEnforcement?: boolean;
  pathsIndex?: Map<string, any>;
  spacesIndex?: Map<string, any>;
} = {}) {
  const renamePath = jest.fn().mockResolvedValue(undefined);
  const notify = jest.fn();

  const pathsIndex = overrides.pathsIndex ?? new Map();
  const spacesIndex = overrides.spacesIndex ?? new Map();

  return {
    superstate: {
      settings: {
        filenameTemplateEnforcement:
          overrides.filenameTemplateEnforcement ?? true,
      },
      pathsIndex,
      spacesIndex,
      spaceManager: { renamePath },
      ui: { notify },
    } as any,
    renamePath,
    notify,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FilenameEnforcer", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does nothing when kill-switch is OFF", async () => {
    const { superstate, renamePath } = createMockSuperstate({
      filenameTemplateEnforcement: false,
    });
    const enforcer = new FilenameEnforcer(superstate);
    await enforcer.onMetadataChange("test/file.md");
    expect(renamePath).not.toHaveBeenCalled();
  });

  it("does nothing when no template is configured", async () => {
    const pathsIndex = new Map([
      [
        "db/untitled.md",
        {
          spaces: ["db"],
          metadata: { property: { board_id: 1 } },
        },
      ],
    ]);
    const spacesIndex = new Map([
      ["db", { metadata: {} }], // no filenameTemplate
    ]);
    const { superstate, renamePath } = createMockSuperstate({
      pathsIndex,
      spacesIndex,
    });

    const enforcer = new FilenameEnforcer(superstate);
    await enforcer.onMetadataChange("db/untitled.md");
    expect(renamePath).not.toHaveBeenCalled();
  });

  it("does nothing when filename already matches template", async () => {
    const pathsIndex = new Map([
      [
        "db/02-ch05-joker.md",
        {
          spaces: ["db"],
          metadata: {
            property: { board_id: 2, address: 5, device: "Joker" },
          },
        },
      ],
    ]);
    const spacesIndex = new Map([
      [
        "db",
        {
          metadata: {
            filenameTemplate:
              "{board_id:02d}-ch{address:02d}-{device|slug}",
          },
        },
      ],
    ]);
    const { superstate, renamePath } = createMockSuperstate({
      pathsIndex,
      spacesIndex,
    });

    const enforcer = new FilenameEnforcer(superstate);
    await enforcer.onMetadataChange("db/02-ch05-joker.md");
    expect(renamePath).not.toHaveBeenCalled();
  });

  it("renames when filename diverges from template", async () => {
    const pathsIndex = new Map([
      [
        "db/untitled.md",
        {
          spaces: ["db"],
          metadata: {
            property: { board_id: 2, address: 5, device: "Joker" },
          },
        },
      ],
    ]);
    const spacesIndex = new Map([
      [
        "db",
        {
          metadata: {
            filenameTemplate:
              "{board_id:02d}-ch{address:02d}-{device|slug}",
          },
        },
      ],
    ]);
    const { superstate, renamePath } = createMockSuperstate({
      pathsIndex,
      spacesIndex,
    });

    const enforcer = new FilenameEnforcer(superstate);
    await enforcer.onMetadataChange("db/untitled.md");
    expect(renamePath).toHaveBeenCalledWith(
      "db/untitled.md",
      "db/02-ch05-joker.md"
    );
  });

  it("uses placeholder for missing fields", async () => {
    const pathsIndex = new Map([
      [
        "db/old.md",
        {
          spaces: ["db"],
          metadata: { property: { board_id: 2 } },
        },
      ],
    ]);
    const spacesIndex = new Map([
      [
        "db",
        {
          metadata: { filenameTemplate: "{board_id}-{missing}" },
        },
      ],
    ]);
    const { superstate, renamePath } = createMockSuperstate({
      pathsIndex,
      spacesIndex,
    });

    const enforcer = new FilenameEnforcer(superstate);
    await enforcer.onMetadataChange("db/old.md");
    expect(renamePath).toHaveBeenCalledWith("db/old.md", "db/2-_.md");
  });

  it("resolves collision with -2 suffix", async () => {
    const pathsIndex = new Map([
      [
        "db/untitled.md",
        {
          spaces: ["db"],
          metadata: { property: { name: "alpha" } },
        },
      ],
      [
        "db/alpha.md",
        {
          spaces: ["db"],
          metadata: { property: { name: "alpha" } },
        },
      ],
    ]);
    const spacesIndex = new Map([
      [
        "db",
        { metadata: { filenameTemplate: "{name}" } },
      ],
    ]);
    const { superstate, renamePath, notify } = createMockSuperstate({
      pathsIndex,
      spacesIndex,
    });

    const enforcer = new FilenameEnforcer(superstate);
    await enforcer.onMetadataChange("db/untitled.md");
    expect(renamePath).toHaveBeenCalledWith("db/untitled.md", "db/alpha-2.md");
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("collision"),
      "notice"
    );
  });

  it("suppresses reentrancy guard within TTL", async () => {
    const pathsIndex = new Map([
      [
        "db/old.md",
        {
          spaces: ["db"],
          metadata: { property: { name: "new" } },
        },
      ],
    ]);
    const spacesIndex = new Map([
      [
        "db",
        { metadata: { filenameTemplate: "{name}" } },
      ],
    ]);
    const { superstate, renamePath } = createMockSuperstate({
      pathsIndex,
      spacesIndex,
    });

    const enforcer = new FilenameEnforcer(superstate);
    await enforcer.onMetadataChange("db/old.md");
    expect(renamePath).toHaveBeenCalledTimes(1);

    // The new path "db/new.md" should be in the reentrancy guard
    await enforcer.onMetadataChange("db/new.md");
    expect(renamePath).toHaveBeenCalledTimes(1); // still 1, not 2

    // After TTL (2s), guard clears
    jest.advanceTimersByTime(2500);
    // Now it would check again (but pathsIndex hasn't been updated, so
    // we just verify the guard was cleared by checking no error)
  });

  it("handles malformed template gracefully (no crash)", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const pathsIndex = new Map([
      [
        "db/file.md",
        {
          spaces: ["db"],
          metadata: { property: { a: 1 } },
        },
      ],
    ]);
    const spacesIndex = new Map([
      [
        "db",
        { metadata: { filenameTemplate: "{" } }, // malformed
      ],
    ]);
    const { superstate, renamePath } = createMockSuperstate({
      pathsIndex,
      spacesIndex,
    });

    const enforcer = new FilenameEnforcer(superstate);
    await enforcer.onMetadataChange("db/file.md");
    expect(renamePath).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("does nothing when path is not in pathsIndex", async () => {
    const { superstate, renamePath } = createMockSuperstate({
      pathsIndex: new Map(),
      spacesIndex: new Map(),
    });

    const enforcer = new FilenameEnforcer(superstate);
    await enforcer.onMetadataChange("nonexistent.md");
    expect(renamePath).not.toHaveBeenCalled();
  });

  it("handles root-level files (no parent directory)", async () => {
    const pathsIndex = new Map([
      [
        "old.md",
        {
          spaces: ["root-db"],
          metadata: { property: { title: "new-name" } },
        },
      ],
    ]);
    const spacesIndex = new Map([
      [
        "root-db",
        { metadata: { filenameTemplate: "{title}" } },
      ],
    ]);
    const { superstate, renamePath } = createMockSuperstate({
      pathsIndex,
      spacesIndex,
    });

    const enforcer = new FilenameEnforcer(superstate);
    await enforcer.onMetadataChange("old.md");
    expect(renamePath).toHaveBeenCalledWith("old.md", "new-name.md");
  });
});
