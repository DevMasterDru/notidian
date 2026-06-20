/**
 * Tests for the fake Obsidian adapter itself (bd Notidian-3dv). The adapter is
 * the substrate the write-bridge tests trust, so its three modeled timing
 * behaviors are pinned here directly:
 *   1. processFrontMatter timing — file writes now, cache reads lag.
 *   2. metadataCache.changed ordering — external edits are immediately visible.
 *   3. rename side effects — file moves now, cache/context path keys lag.
 */
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import { FakeObsidianMetadataAdapter } from "./fakeObsidianMetadataAdapter";

const tableWith = (path: string): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
  cols: [{ name: PathPropertyName, type: "file" }],
  rows: [{ _index: "0", [PathPropertyName]: path }],
});

describe("FakeObsidianMetadataAdapter — processFrontMatter timing", () => {
  it("writes the file content immediately but the cache lags until settle", async () => {
    const adapter = new FakeObsidianMetadataAdapter({ metadataLagTicks: 2 });
    adapter.seedFile("a.md", { status: "todo" });

    await adapter.superstate.spaceManager.saveProperties("a.md", {
      status: "doing",
    });

    // File content reflects the write at once...
    expect(adapter.fileValue("a.md", "status")).toBe("doing");
    // ...but the metadata cache (the bridge's read surface) still shows the old
    // value until the lag settles.
    expect(adapter.cacheValue("a.md", "status")).toBe("todo");
    expect(adapter.hasPendingMetadata()).toBe(true);

    adapter.tick(); // 1 of 2
    expect(adapter.cacheValue("a.md", "status")).toBe("todo");
    adapter.tick(); // 2 of 2
    expect(adapter.cacheValue("a.md", "status")).toBe("doing");
    expect(adapter.hasPendingMetadata()).toBe(false);
  });

  it("with zero lag the cache updates synchronously", async () => {
    const adapter = new FakeObsidianMetadataAdapter({ metadataLagTicks: 0 });
    adapter.seedFile("a.md", { status: "todo" });
    await adapter.superstate.spaceManager.saveProperties("a.md", {
      status: "doing",
    });
    expect(adapter.cacheValue("a.md", "status")).toBe("doing");
    expect(adapter.hasPendingMetadata()).toBe(false);
  });

  it("the lagged read surface is exactly what pathsIndex.get exposes to the bridge", async () => {
    const adapter = new FakeObsidianMetadataAdapter({ metadataLagTicks: 1 });
    adapter.seedFile("a.md", { status: "todo" });
    await adapter.superstate.spaceManager.saveProperties("a.md", {
      status: "doing",
    });
    expect(
      adapter.superstate.pathsIndex.get("a.md").metadata.property.status
    ).toBe("todo");
    adapter.settle();
    expect(
      adapter.superstate.pathsIndex.get("a.md").metadata.property.status
    ).toBe("doing");
  });
});

describe("FakeObsidianMetadataAdapter — metadataCache.changed ordering", () => {
  it("an external edit is visible in the cache immediately and lands in the ordered log", () => {
    const adapter = new FakeObsidianMetadataAdapter({ metadataLagTicks: 5 });
    adapter.seedFile("a.md", { status: "todo" });
    adapter.externalEdit("a.md", "status", "blocked");
    expect(adapter.cacheValue("a.md", "status")).toBe("blocked");
    expect(adapter.fileValue("a.md", "status")).toBe("blocked");
    expect(adapter.cacheLog).toContainEqual({
      path: "a.md",
      column: "status",
      value: "blocked",
    });
  });

  it("a save scheduled BEFORE an external edit settles AFTER it — the external value is overwritten only when our lagged save matures", async () => {
    const adapter = new FakeObsidianMetadataAdapter({ metadataLagTicks: 2 });
    adapter.seedFile("a.md", { status: "todo" });
    // Our save is scheduled (lagged)...
    await adapter.superstate.spaceManager.saveProperties("a.md", {
      status: "ours",
    });
    // ...then an external edit lands immediately in the cache.
    adapter.externalEdit("a.md", "status", "theirs");
    expect(adapter.cacheValue("a.md", "status")).toBe("theirs");
    // Our save matures and overwrites the cache (last writer to settle wins in
    // the cache — modeling Obsidian's metadataCache.changed coalescing).
    adapter.settle();
    expect(adapter.cacheValue("a.md", "status")).toBe("ours");
  });
});

describe("FakeObsidianMetadataAdapter — rename side effects", () => {
  it("moves the file immediately and lazily retargets cache + context rows on settle", async () => {
    const adapter = new FakeObsidianMetadataAdapter({ metadataLagTicks: 1 });
    adapter.seedFile("Projects/Old.md", { status: "todo" });
    adapter.seedContext("Projects", tableWith("Projects/Old.md"));

    const renamed = await adapter.superstate.spaceManager.renamePath(
      "Projects/Old.md",
      "Projects/New.md"
    );
    expect(renamed).toBe("Projects/New.md");
    // File moved on disk at once.
    expect(adapter.files.has("Projects/Old.md")).toBe(false);
    expect(adapter.files.has("Projects/New.md")).toBe(true);
    // Cache + context row path key still lag.
    expect(adapter.cache.has("Projects/Old.md")).toBe(true);
    expect(adapter.contextRowPaths("Projects")).toEqual(["Projects/Old.md"]);

    adapter.settle();
    expect(adapter.cache.has("Projects/New.md")).toBe(true);
    expect(adapter.contextRowPaths("Projects")).toEqual(["Projects/New.md"]);
  });

  it("resolves null for a rename in the failure set without moving the file", async () => {
    const adapter = new FakeObsidianMetadataAdapter({
      metadataLagTicks: 0,
      renameFails: new Set(["Projects/Locked.md"]),
    });
    adapter.seedFile("Projects/Locked.md", { status: "todo" });
    const renamed = await adapter.superstate.spaceManager.renamePath(
      "Projects/Locked.md",
      "Projects/Unlocked.md"
    );
    expect(renamed).toBeNull();
    expect(adapter.files.has("Projects/Locked.md")).toBe(true);
    expect(adapter.files.has("Projects/Unlocked.md")).toBe(false);
  });

  it("pathExists sees both seeded and existing-paths files (rename-target collision surface)", async () => {
    const adapter = new FakeObsidianMetadataAdapter({
      existingPaths: ["Projects/Taken.md"],
    });
    adapter.seedFile("Projects/Self.md");
    expect(await adapter.superstate.spaceManager.pathExists("Projects/Taken.md")).toBe(true);
    expect(await adapter.superstate.spaceManager.pathExists("Projects/Self.md")).toBe(true);
    expect(await adapter.superstate.spaceManager.pathExists("Projects/Absent.md")).toBe(false);
  });
});
