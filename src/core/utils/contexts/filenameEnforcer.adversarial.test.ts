/**
 * Adversarial tests for FilenameEnforcer (Notidian-rmz8).
 *
 * Locks six safety invariants under hostile conditions:
 *   1. Kill-switch blocks ALL renames — zero filesystem calls.
 *   2. Reentrancy guard prevents rename loops.
 *   3. Queue serialization — concurrent calls produce sequential renames.
 *   4. Error containment — parse/eval/collision errors caught, never thrown.
 *   5. Collision notification — ui.notify called exactly once on collision.
 *   6. Guard TTL cleanup — renaming set entries cleared after timeout.
 *
 * Reuses mock infrastructure from filenameEnforcer.test.ts.
 */

import { FilenameEnforcer } from "./filenameEnforcer";

// ---------------------------------------------------------------------------
// Mock superstate factory (mirrored from filenameEnforcer.test.ts)
// ---------------------------------------------------------------------------

function createMockSuperstate(
  overrides: {
    filenameTemplateEnforcement?: boolean;
    pathsIndex?: Map<string, any>;
    spacesIndex?: Map<string, any>;
  } = {}
) {
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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flush pending microtasks so that fire-and-forget async chains (like
 * drainQueue inside onMetadataChange) have a chance to complete. Each
 * `await Promise.resolve()` yields one microtask cycle; the drain needs
 * ~2 cycles per queued rename (one for `await op()`, one for `await
 * renamePath()`), so 20 cycles is generous for any realistic queue depth.
 */
async function flushMicrotasks(cycles = 20): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await Promise.resolve();
  }
}

/** Build a standard pathsIndex + spacesIndex for a db folder with a template. */
function buildIndexes(
  files: Array<{
    path: string;
    space: string;
    property: Record<string, any>;
  }>,
  template: string
) {
  const pathsIndex = new Map<string, any>();
  for (const f of files) {
    pathsIndex.set(f.path, {
      spaces: [f.space],
      metadata: { property: f.property },
    });
  }

  const spacesIndex = new Map<string, any>();
  const spaces = new Set(files.map((f) => f.space));
  for (const s of spaces) {
    spacesIndex.set(s, { metadata: { filenameTemplate: template } });
  }

  return { pathsIndex, spacesIndex };
}

// ---------------------------------------------------------------------------
// Adversarial tests
// ---------------------------------------------------------------------------

describe("FilenameEnforcer — adversarial", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // =========================================================================
  // Invariant 1: Kill-switch blocks ALL renames
  // =========================================================================

  describe("Invariant 1: kill-switch blocks ALL renames", () => {
    it("blocks all renames even when 50 rapid events fire", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [{ path: "db/old.md", space: "db", property: { name: "new" } }],
        "{name}"
      );
      const { superstate, renamePath, notify } = createMockSuperstate({
        filenameTemplateEnforcement: false,
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);

      const promises: Promise<void>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push(enforcer.onMetadataChange("db/old.md"));
      }
      await Promise.all(promises);

      expect(renamePath).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("blocks renames when kill-switch is toggled OFF mid-flight", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [{ path: "db/old.md", space: "db", property: { name: "new" } }],
        "{name}"
      );
      const { superstate, renamePath } = createMockSuperstate({
        filenameTemplateEnforcement: true,
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);

      // First call goes through
      await enforcer.onMetadataChange("db/old.md");
      expect(renamePath).toHaveBeenCalledTimes(1);

      // Clear reentrancy guard
      jest.advanceTimersByTime(3000);

      // Disable kill-switch
      superstate.settings.filenameTemplateEnforcement = false;

      // Subsequent calls should be blocked
      await enforcer.onMetadataChange("db/old.md");
      expect(renamePath).toHaveBeenCalledTimes(1); // still 1
    });
  });

  // =========================================================================
  // Invariant 2: Reentrancy guard prevents rename loops
  // =========================================================================

  describe("Invariant 2: reentrancy guard prevents rename loops", () => {
    it("blocks metadataChange on old path during active rename", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [{ path: "db/old.md", space: "db", property: { name: "new" } }],
        "{name}"
      );

      // Make renamePath slow to simulate in-flight rename
      let renameResolve: (() => void) | null = null;
      const slowRenamePath = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            renameResolve = resolve;
          })
      );

      const { superstate, notify } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });
      superstate.spaceManager.renamePath = slowRenamePath;

      const enforcer = new FilenameEnforcer(superstate);

      // Start the first rename (will block on renamePath)
      const firstCall = enforcer.onMetadataChange("db/old.md");

      // Allow the queue to start processing
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Now fire a second event for the same path — should be blocked by reentrancy
      await enforcer.onMetadataChange("db/old.md");
      // And for the NEW path (db/new.md) — also should be guarded
      await enforcer.onMetadataChange("db/new.md");

      // Resolve the rename
      renameResolve!();
      await firstCall;

      // Only one rename should have occurred
      expect(slowRenamePath).toHaveBeenCalledTimes(1);
    });

    it("blocks the new path (rename target) from re-triggering", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [{ path: "db/old.md", space: "db", property: { name: "new" } }],
        "{name}"
      );
      const { superstate, renamePath } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);
      await enforcer.onMetadataChange("db/old.md");
      expect(renamePath).toHaveBeenCalledTimes(1);

      // Immediately after rename, the new path should be guarded
      // Simulate a metadata change on the new path
      pathsIndex.set("db/new.md", {
        spaces: ["db"],
        metadata: { property: { name: "new" } },
      });
      await enforcer.onMetadataChange("db/new.md");
      expect(renamePath).toHaveBeenCalledTimes(1); // still 1 — guarded
    });

    it("suppresses 50 rapid metadataChange events for same path", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [{ path: "db/file.md", space: "db", property: { name: "target" } }],
        "{name}"
      );
      const { superstate, renamePath } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);

      // Fire 50 events in rapid succession
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push(enforcer.onMetadataChange("db/file.md"));
      }
      await Promise.all(promises);

      // Only 1 rename should occur: first call queues, rest hit reentrancy guard
      expect(renamePath).toHaveBeenCalledTimes(1);
      expect(renamePath).toHaveBeenCalledWith("db/file.md", "db/target.md");
    });
  });

  // =========================================================================
  // Invariant 3: Queue serialization
  // =========================================================================

  describe("Invariant 3: queue serialization", () => {
    it("concurrent calls for different files produce sequential renames", async () => {
      const pathsIndex = new Map<string, any>([
        [
          "db/a.md",
          { spaces: ["db"], metadata: { property: { name: "alpha" } } },
        ],
        [
          "db/b.md",
          { spaces: ["db"], metadata: { property: { name: "beta" } } },
        ],
        [
          "db/c.md",
          { spaces: ["db"], metadata: { property: { name: "gamma" } } },
        ],
      ]);
      const spacesIndex = new Map<string, any>([
        ["db", { metadata: { filenameTemplate: "{name}" } }],
      ]);

      const renameOrder: string[] = [];
      const renamePath = jest.fn(async (oldPath: string, _newPath: string) => {
        renameOrder.push(oldPath);
      });

      const { superstate } = createMockSuperstate({ pathsIndex, spacesIndex });
      superstate.spaceManager.renamePath = renamePath;

      const enforcer = new FilenameEnforcer(superstate);

      // Fire all three concurrently
      await Promise.all([
        enforcer.onMetadataChange("db/a.md"),
        enforcer.onMetadataChange("db/b.md"),
        enforcer.onMetadataChange("db/c.md"),
      ]);
      // drainQueue is fire-and-forget — flush microtasks so the chain completes
      await flushMicrotasks();

      expect(renamePath).toHaveBeenCalledTimes(3);
      // They should have executed in the order they were queued
      expect(renameOrder).toEqual(["db/a.md", "db/b.md", "db/c.md"]);
    });

    it("queue drains serially even when renamePath is slow", async () => {
      const pathsIndex = new Map<string, any>([
        [
          "db/x.md",
          { spaces: ["db"], metadata: { property: { name: "x-new" } } },
        ],
        [
          "db/y.md",
          { spaces: ["db"], metadata: { property: { name: "y-new" } } },
        ],
      ]);
      const spacesIndex = new Map<string, any>([
        ["db", { metadata: { filenameTemplate: "{name}" } }],
      ]);

      let concurrentCount = 0;
      let maxConcurrent = 0;

      const renamePath = jest.fn(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        // Simulate async work without fake timers (avoids timer/microtask interleaving)
        await Promise.resolve();
        await Promise.resolve();
        concurrentCount--;
      });

      const { superstate } = createMockSuperstate({ pathsIndex, spacesIndex });
      superstate.spaceManager.renamePath = renamePath;

      const enforcer = new FilenameEnforcer(superstate);

      await Promise.all([
        enforcer.onMetadataChange("db/x.md"),
        enforcer.onMetadataChange("db/y.md"),
      ]);
      // drainQueue is fire-and-forget — flush microtasks so the chain completes
      await flushMicrotasks();

      expect(renamePath).toHaveBeenCalledTimes(2);
      // Serialization invariant: never more than 1 concurrent rename
      expect(maxConcurrent).toBe(1);
    });
  });

  // =========================================================================
  // Invariant 4: Error containment
  // =========================================================================

  describe("Invariant 4: error containment", () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("catches malformed template (unmatched brace) without throwing", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [{ path: "db/f.md", space: "db", property: { a: 1 } }],
        "{a|" // malformed — no closing brace
      );
      const { superstate, renamePath } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);

      // Must not throw
      await expect(
        enforcer.onMetadataChange("db/f.md")
      ).resolves.toBeUndefined();
      expect(renamePath).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("malformed template"),
        expect.anything()
      );
    });

    it("catches empty field template without throwing", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [{ path: "db/f.md", space: "db", property: { a: 1 } }],
        "{}" // empty field name
      );
      const { superstate, renamePath } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);
      await expect(
        enforcer.onMetadataChange("db/f.md")
      ).resolves.toBeUndefined();
      expect(renamePath).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });

    it("catches template producing invalid filename without throwing", async () => {
      // A template that evaluates to just dots (which validatePageTitle rejects)
      const { pathsIndex, spacesIndex } = buildIndexes(
        [{ path: "db/f.md", space: "db", property: { name: "..." } }],
        "{name}"
      );
      const { superstate, renamePath } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);
      await expect(
        enforcer.onMetadataChange("db/f.md")
      ).resolves.toBeUndefined();
      expect(renamePath).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("template evaluation failed"),
        expect.anything()
      );
    });

    it("catches renamePath failure without throwing", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [{ path: "db/old.md", space: "db", property: { name: "new" } }],
        "{name}"
      );
      const { superstate } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      // renamePath throws
      superstate.spaceManager.renamePath = jest
        .fn()
        .mockRejectedValue(new Error("ENOSPC: no space left on device"));

      const enforcer = new FilenameEnforcer(superstate);

      // Must not throw — error is contained
      await expect(
        enforcer.onMetadataChange("db/old.md")
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("rename failed"),
        expect.anything()
      );
    });

    it("catches collision resolution exhaustion without throwing", async () => {
      // Create 101 files that all collide: alpha, alpha-2, alpha-3, ..., alpha-101
      const files: Array<{
        path: string;
        space: string;
        property: Record<string, any>;
      }> = [];

      // The file to be renamed
      files.push({
        path: "db/untitled.md",
        space: "db",
        property: { name: "alpha" },
      });

      // 101 existing files that block all collision resolution slots
      files.push({
        path: "db/alpha.md",
        space: "db",
        property: { name: "alpha" },
      });
      for (let i = 2; i <= 101; i++) {
        files.push({
          path: `db/alpha-${i}.md`,
          space: "db",
          property: { name: "alpha" },
        });
      }

      const { pathsIndex, spacesIndex } = buildIndexes(files, "{name}");
      const { superstate, renamePath } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);
      await expect(
        enforcer.onMetadataChange("db/untitled.md")
      ).resolves.toBeUndefined();
      expect(renamePath).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("collision resolution failed"),
        expect.anything()
      );
    });

    it("subsequent renames still work after a caught error", async () => {
      const pathsIndex = new Map<string, any>([
        [
          "db/bad.md",
          { spaces: ["db"], metadata: { property: { name: "..." } } }, // produces invalid name
        ],
        [
          "db/good.md",
          { spaces: ["db"], metadata: { property: { name: "valid" } } },
        ],
      ]);
      const spacesIndex = new Map<string, any>([
        ["db", { metadata: { filenameTemplate: "{name}" } }],
      ]);
      const { superstate, renamePath } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);

      // First call fails (invalid filename) but doesn't throw
      await enforcer.onMetadataChange("db/bad.md");
      expect(renamePath).not.toHaveBeenCalled();

      // Second call should still work
      await enforcer.onMetadataChange("db/good.md");
      expect(renamePath).toHaveBeenCalledWith("db/good.md", "db/valid.md");
    });
  });

  // =========================================================================
  // Invariant 5: Collision notification
  // =========================================================================

  describe("Invariant 5: collision notification", () => {
    it("notifies exactly once on collision", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [
          { path: "db/untitled.md", space: "db", property: { name: "taken" } },
          { path: "db/taken.md", space: "db", property: { name: "taken" } },
        ],
        "{name}"
      );
      const { superstate, renamePath, notify } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);
      await enforcer.onMetadataChange("db/untitled.md");

      expect(renamePath).toHaveBeenCalledWith(
        "db/untitled.md",
        "db/taken-2.md"
      );
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("collision"),
        "notice"
      );
    });

    it("does NOT notify when there is no collision", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [
          {
            path: "db/untitled.md",
            space: "db",
            property: { name: "unique" },
          },
        ],
        "{name}"
      );
      const { superstate, notify } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);
      await enforcer.onMetadataChange("db/untitled.md");

      expect(notify).not.toHaveBeenCalled();
    });

    it("notifies once per collision across multiple rapid colliding events", async () => {
      // Two files that will both collide with the same target
      const pathsIndex = new Map<string, any>([
        [
          "db/a.md",
          { spaces: ["db"], metadata: { property: { name: "same" } } },
        ],
        [
          "db/b.md",
          { spaces: ["db"], metadata: { property: { name: "same" } } },
        ],
        [
          "db/same.md",
          { spaces: ["db"], metadata: { property: { name: "same" } } },
        ],
      ]);
      const spacesIndex = new Map<string, any>([
        ["db", { metadata: { filenameTemplate: "{name}" } }],
      ]);
      const { superstate, notify } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);

      // Both files are not named "same" so both trigger a rename
      await enforcer.onMetadataChange("db/a.md");
      await enforcer.onMetadataChange("db/b.md");

      // Each collision event should produce exactly one notification
      // (a gets same-2, b gets same-3 — two collisions, two notifications)
      expect(notify).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // Invariant 6: Guard TTL cleanup
  // =========================================================================

  describe("Invariant 6: guard TTL cleanup", () => {
    it("clears reentrancy guard after TTL (2000ms)", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [{ path: "db/old.md", space: "db", property: { name: "new" } }],
        "{name}"
      );
      const { superstate, renamePath } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);
      await enforcer.onMetadataChange("db/old.md");
      expect(renamePath).toHaveBeenCalledTimes(1);

      // Within TTL: guard blocks
      await enforcer.onMetadataChange("db/old.md");
      expect(renamePath).toHaveBeenCalledTimes(1);

      // Advance past TTL
      jest.advanceTimersByTime(2500);

      // Guard should be cleared — now a re-trigger works
      // (need to update pathsIndex so the old path still exists)
      pathsIndex.set("db/old.md", {
        spaces: ["db"],
        metadata: { property: { name: "new" } },
      });
      await enforcer.onMetadataChange("db/old.md");
      expect(renamePath).toHaveBeenCalledTimes(2);
    });

    it("does not leak guard entries after many renames", async () => {
      const spacesIndex = new Map<string, any>([
        ["db", { metadata: { filenameTemplate: "{name}" } }],
      ]);
      const pathsIndex = new Map<string, any>();

      const { superstate, renamePath } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);

      // Simulate 20 rename cycles, each with TTL clearing
      for (let i = 0; i < 20; i++) {
        const path = `db/file-${i}.md`;
        pathsIndex.set(path, {
          spaces: ["db"],
          metadata: { property: { name: `renamed-${i}` } },
        });
        await enforcer.onMetadataChange(path);
        // Flush fire-and-forget drainQueue so rename completes and setTimeout is set
        await flushMicrotasks();
        // Advance past TTL to clear guards
        jest.advanceTimersByTime(3000);
      }

      expect(renamePath).toHaveBeenCalledTimes(20);

      // After all TTLs, all guards should be cleared —
      // re-triggering any of them should work
      pathsIndex.set("db/file-0.md", {
        spaces: ["db"],
        metadata: { property: { name: "re-renamed-0" } },
      });
      await enforcer.onMetadataChange("db/file-0.md");
      await flushMicrotasks();
      expect(renamePath).toHaveBeenCalledTimes(21);
    });

    it("guard covers both old and new paths", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [{ path: "db/old.md", space: "db", property: { name: "new" } }],
        "{name}"
      );
      const { superstate, renamePath } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);
      await enforcer.onMetadataChange("db/old.md");
      expect(renamePath).toHaveBeenCalledTimes(1);

      // Both the old path and new path should be guarded
      pathsIndex.set("db/new.md", {
        spaces: ["db"],
        metadata: { property: { name: "another" } },
      });
      await enforcer.onMetadataChange("db/new.md");
      expect(renamePath).toHaveBeenCalledTimes(1); // guarded

      // Clear TTL
      jest.advanceTimersByTime(2500);

      // Now new.md is no longer guarded
      await enforcer.onMetadataChange("db/new.md");
      expect(renamePath).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // Adversarial scenario: 50 rapid metadataChange events for same path
  // =========================================================================

  describe("adversarial: 50 rapid metadataChange for same path", () => {
    it("produces exactly 1 rename from 50 simultaneous events", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [
          {
            path: "db/original.md",
            space: "db",
            property: { title: "target" },
          },
        ],
        "{title}"
      );
      const { superstate, renamePath } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);

      // Fire 50 events simultaneously
      const promises = Array.from({ length: 50 }, () =>
        enforcer.onMetadataChange("db/original.md")
      );
      await Promise.all(promises);

      // Exactly 1 rename: first call queues, subsequent calls hit reentrancy
      expect(renamePath).toHaveBeenCalledTimes(1);
      expect(renamePath).toHaveBeenCalledWith(
        "db/original.md",
        "db/target.md"
      );
    });
  });

  // =========================================================================
  // Adversarial scenario: path with no spaces (orphan file)
  // =========================================================================

  describe("adversarial: path with no spaces", () => {
    it("does nothing for a file with no parent spaces", async () => {
      const pathsIndex = new Map<string, any>([
        [
          "db/orphan.md",
          {
            spaces: [], // belongs to no space
            metadata: { property: { name: "should-not-rename" } },
          },
        ],
      ]);
      const spacesIndex = new Map<string, any>([
        ["db", { metadata: { filenameTemplate: "{name}" } }],
      ]);
      const { superstate, renamePath } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);
      await enforcer.onMetadataChange("db/orphan.md");
      expect(renamePath).not.toHaveBeenCalled();
    });

    it("does nothing when pathEntry.spaces is undefined", async () => {
      const pathsIndex = new Map<string, any>([
        [
          "db/orphan.md",
          {
            // no spaces property at all
            metadata: { property: { name: "nope" } },
          },
        ],
      ]);
      const spacesIndex = new Map<string, any>([
        ["db", { metadata: { filenameTemplate: "{name}" } }],
      ]);
      const { superstate, renamePath } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);
      await enforcer.onMetadataChange("db/orphan.md");
      expect(renamePath).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Adversarial scenario: malformed template strings
  // =========================================================================

  describe("adversarial: malformed template strings", () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    const malformedTemplates = [
      { template: "{", desc: "single opening brace" },
      { template: "}", desc: "single closing brace (no variable)" },
      { template: "{}", desc: "empty field name" },
      { template: "{{nested}}", desc: "nested braces" },
      { template: "{|slug}", desc: "pipe with no field name" },
      { template: "{field|slug:abc}", desc: "non-numeric transform param" },
    ];

    for (const { template, desc } of malformedTemplates) {
      it(`handles ${desc}: "${template}" without throwing`, async () => {
        const { pathsIndex, spacesIndex } = buildIndexes(
          [{ path: "db/f.md", space: "db", property: { x: 1 } }],
          template
        );
        const { superstate, renamePath } = createMockSuperstate({
          pathsIndex,
          spacesIndex,
        });

        const enforcer = new FilenameEnforcer(superstate);
        await expect(
          enforcer.onMetadataChange("db/f.md")
        ).resolves.toBeUndefined();
        // Either no rename (parse error) or a valid rename — never a throw
      });
    }
  });

  // =========================================================================
  // Adversarial scenario: all paths in directory collide
  // =========================================================================

  describe("adversarial: all paths in directory collide", () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("handles collision cascade without throwing", async () => {
      // 5 files, all with the same name property, plus the target already exists
      const files = [
        { path: "db/target.md", space: "db", property: { name: "target" } },
      ];
      for (let i = 1; i <= 5; i++) {
        files.push({
          path: `db/file-${i}.md`,
          space: "db",
          property: { name: "target" },
        });
      }

      const { pathsIndex, spacesIndex } = buildIndexes(files, "{name}");
      const { superstate, renamePath, notify } = createMockSuperstate({
        pathsIndex,
        spacesIndex,
      });

      const enforcer = new FilenameEnforcer(superstate);

      // Rename all non-target files — each will collide and get target-2, target-3, etc.
      for (let i = 1; i <= 5; i++) {
        await enforcer.onMetadataChange(`db/file-${i}.md`);
        // Flush fire-and-forget drainQueue so rename completes
        await flushMicrotasks();
        // Clear reentrancy guard between calls
        jest.advanceTimersByTime(3000);
      }

      // All 5 should have been renamed (with collision suffixes)
      expect(renamePath).toHaveBeenCalledTimes(5);
      // Each collision should produce a notification
      expect(notify).toHaveBeenCalledTimes(5);
    });
  });

  // =========================================================================
  // Adversarial scenario: renamePath throws
  // =========================================================================

  describe("adversarial: renamePath throws", () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("contains the error and does not break the queue", async () => {
      const pathsIndex = new Map<string, any>([
        [
          "db/a.md",
          { spaces: ["db"], metadata: { property: { name: "a-new" } } },
        ],
        [
          "db/b.md",
          { spaces: ["db"], metadata: { property: { name: "b-new" } } },
        ],
      ]);
      const spacesIndex = new Map<string, any>([
        ["db", { metadata: { filenameTemplate: "{name}" } }],
      ]);

      let callCount = 0;
      const renamePath = jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Simulated filesystem error");
        }
      });

      const { superstate } = createMockSuperstate({ pathsIndex, spacesIndex });
      superstate.spaceManager.renamePath = renamePath;

      const enforcer = new FilenameEnforcer(superstate);

      // Queue both renames
      await Promise.all([
        enforcer.onMetadataChange("db/a.md"),
        enforcer.onMetadataChange("db/b.md"),
      ]);

      // First rename fails, but second should still execute
      expect(renamePath).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("rename failed"),
        expect.anything()
      );
    });

    it("clears reentrancy guard even after rename failure", async () => {
      const { pathsIndex, spacesIndex } = buildIndexes(
        [{ path: "db/fail.md", space: "db", property: { name: "target" } }],
        "{name}"
      );

      const renamePath = jest
        .fn()
        .mockRejectedValueOnce(new Error("Disk error"))
        .mockResolvedValue(undefined);

      const { superstate } = createMockSuperstate({ pathsIndex, spacesIndex });
      superstate.spaceManager.renamePath = renamePath;

      const enforcer = new FilenameEnforcer(superstate);

      // First call: rename fails but error is caught
      await enforcer.onMetadataChange("db/fail.md");
      expect(renamePath).toHaveBeenCalledTimes(1);

      // Within TTL: still guarded even after error (expected — guard prevents double-rename)
      await enforcer.onMetadataChange("db/fail.md");
      expect(renamePath).toHaveBeenCalledTimes(1);

      // After TTL: guard clears, retry is possible
      jest.advanceTimersByTime(2500);
      await enforcer.onMetadataChange("db/fail.md");
      expect(renamePath).toHaveBeenCalledTimes(2);
    });
  });
});
