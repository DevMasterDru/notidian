import {
  ObsidianReminderStateFileIO,
  REMINDER_STATE_PATH,
  ReminderFiredStateStore,
  ReminderStateFileIO,
} from "./ReminderFiredStateStore";

class MemoryFileIO implements ReminderStateFileIO {
  files = new Map<string, string>();
  writes: string[] = [];
  failWrites = false;

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async write(path: string, content: string): Promise<void> {
    if (this.failWrites) throw new Error("disk unavailable");
    this.writes.push(path);
    this.files.set(path, content);
  }
}

const claim = (
  path = "Events/A.md",
  occurrenceStartMs = Date.parse("2026-07-19T12:30:00Z"),
  fingerprint = "schedule-a",
) => ({ path, occurrenceStartMs, fingerprint });

describe("ReminderFiredStateStore", () => {
  it("claims a batch durably with one state-file write", async () => {
    const io = new MemoryFileIO();
    const store = new ReminderFiredStateStore(io, () => 1_000);
    await store.open();
    const identities = [claim("A.md", 1), claim("B.md", 2), claim("A.md", 1)];

    const claimed = await store.claimMany(identities);

    expect(claimed).toEqual(identities.slice(0, 2));
    expect(io.writes).toEqual([REMINDER_STATE_PATH]);
    const reloaded = new ReminderFiredStateStore(io, () => 2_000);
    await reloaded.open();
    await expect(reloaded.claimMany(identities)).resolves.toEqual([]);
  });

  it("keeps an entire failed batch unclaimed in memory", async () => {
    const io = new MemoryFileIO();
    const store = new ReminderFiredStateStore(io, () => 1_000);
    await store.open();
    const identities = [claim("A.md", 1), claim("B.md", 2)];
    io.failWrites = true;

    await expect(store.claimMany(identities)).rejects.toThrow("disk unavailable");
    io.failWrites = false;
    await expect(store.claimMany(identities)).resolves.toEqual(identities);
    expect(io.writes).toEqual([REMINDER_STATE_PATH]);
  });

  it("reconciles a scale-shaped candidate snapshot in one durable mutation", async () => {
    const io = new MemoryFileIO();
    const store = new ReminderFiredStateStore(io, () => 1_000);
    await store.open();
    await store.claimMany([
      claim("Keep.md", 1, "keep"),
      claim("Stale.md", 2, "old"),
      claim("Absent.md", 3, "gone"),
      claim("NoSchedule.md", 4, "removed"),
    ]);
    io.writes.length = 0;
    const candidates = new Map<string, string>([
      ["Keep.md", "keep"],
      ["Stale.md", "new"],
      ...Array.from({ length: 2_000 }, (_, index) => [
        `Candidate-${index}.md`,
        `fingerprint-${index}`,
      ] as [string, string]),
    ]);

    await store.reconcileCandidates(candidates);

    expect(io.writes).toEqual([REMINDER_STATE_PATH]);
    const persisted = JSON.parse(io.files.get(REMINDER_STATE_PATH)!);
    expect(persisted.records).toEqual([
      expect.objectContaining({ path: "Keep.md", fingerprint: "keep" }),
    ]);
  });

  it("persists a claim before resolving and recovers it after reload", async () => {
    const io = new MemoryFileIO();
    const store = new ReminderFiredStateStore(io, () => 1_000);
    await store.open();

    await expect(store.claim(claim())).resolves.toBe(true);
    expect(io.writes).toEqual([REMINDER_STATE_PATH]);

    const reloaded = new ReminderFiredStateStore(io, () => 2_000);
    await reloaded.open();
    await expect(reloaded.claim(claim())).resolves.toBe(false);
  });

  it("serializes concurrent claims so the same identity is won once", async () => {
    const io = new MemoryFileIO();
    const store = new ReminderFiredStateStore(io, () => 1_000);
    await store.open();

    await expect(Promise.all([store.claim(claim()), store.claim(claim())])).resolves.toEqual([
      true,
      false,
    ]);
  });

  it("fails closed on persistence failure and can claim after storage recovers", async () => {
    const io = new MemoryFileIO();
    const store = new ReminderFiredStateStore(io, () => 1_000);
    await store.open();
    io.failWrites = true;

    await expect(store.claim(claim())).rejects.toThrow("disk unavailable");
    io.failWrites = false;
    await expect(store.claim(claim())).resolves.toBe(true);
  });

  it("migrates path identities on rename and purges them on delete", async () => {
    const io = new MemoryFileIO();
    const store = new ReminderFiredStateStore(io, () => 1_000);
    await store.open();
    await store.claim(claim("Old.md"));

    await store.renamePath("Old.md", "New.md");
    await expect(store.claim(claim("New.md"))).resolves.toBe(false);
    await store.deletePath("New.md");
    await expect(store.claim(claim("New.md"))).resolves.toBe(true);
  });

  it("invalidates only stale schedule identities and leaves unrelated edits stable", async () => {
    const io = new MemoryFileIO();
    const store = new ReminderFiredStateStore(io, () => 1_000);
    await store.open();
    await store.claim(claim("A.md", 1, "old"));
    await store.claim(claim("B.md", 2, "other"));

    await store.invalidateSchedule("A.md", "new");

    await expect(store.claim(claim("A.md", 1, "old"))).resolves.toBe(true);
    await expect(store.claim(claim("B.md", 2, "other"))).resolves.toBe(false);
  });

  it("prunes records older than 30 days and then the oldest records above the cap", async () => {
    const io = new MemoryFileIO();
    let now = 40 * 24 * 60 * 60 * 1000;
    const store = new ReminderFiredStateStore(io, () => now, {
      retentionMs: 30 * 24 * 60 * 60 * 1000,
      maxRecords: 2,
    });
    await store.open();
    now = 0;
    await store.claim(claim("expired.md", 1));
    now = 40 * 24 * 60 * 60 * 1000 - 2;
    await store.claim(claim("oldest.md", 2));
    now += 1;
    await store.claim(claim("middle.md", 3));
    now += 1;
    await store.claim(claim("newest.md", 4));

    await store.prune();

    const persisted = JSON.parse(io.files.get(REMINDER_STATE_PATH)!);
    expect(persisted.records.map((record: { path: string }) => record.path)).toEqual([
      "middle.md",
      "newest.md",
    ]);
  });

  it("rejects corrupt persisted state instead of treating it as empty", async () => {
    const io = new MemoryFileIO();
    io.files.set(REMINDER_STATE_PATH, "{broken");
    const store = new ReminderFiredStateStore(io, () => 1_000);

    await expect(store.open()).rejects.toThrow("Invalid reminder fired state");
  });

  it("flushes queued work and closes idempotently on unload", async () => {
    const io = new MemoryFileIO();
    const store = new ReminderFiredStateStore(io, () => 1_000);
    await store.open();
    const pending = store.claim(claim());

    await store.close();
    await pending;
    await store.close();
    await expect(store.claim(claim("later.md"))).rejects.toThrow("closed");
  });
});

describe("ObsidianReminderStateFileIO", () => {
  const makeAdapter = (initial?: string) => {
    let content = initial;
    const adapter = {
      exists: jest.fn(async (path: string) =>
        path === ".notidian" || (path === REMINDER_STATE_PATH && content !== undefined),
      ),
      mkdir: jest.fn(async (): Promise<void> => undefined),
      read: jest.fn(async () => content ?? ""),
      write: jest.fn(async (_path: string, next: string) => { content = next; }),
      process: jest.fn(async (_path: string, update: (current: string) => string) => {
        content = update(content ?? "");
        return content;
      }),
      content: () => content,
    };
    return adapter;
  };

  it("uses the adapter atomic process operation for an existing state file", async () => {
    const adapter = makeAdapter("old");
    const io = new ObsidianReminderStateFileIO(adapter);

    await io.write(REMINDER_STATE_PATH, "new");

    expect(adapter.process).toHaveBeenCalledTimes(1);
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.content()).toBe("new");
  });

  it("creates a missing state file with one awaited write", async () => {
    const adapter = makeAdapter();
    const io = new ObsidianReminderStateFileIO(adapter);

    await io.write(REMINDER_STATE_PATH, "first");

    expect(adapter.write).toHaveBeenCalledWith(REMINDER_STATE_PATH, "first");
    expect(adapter.process).not.toHaveBeenCalled();
  });

  it("propagates an atomic process failure without falling back to a direct overwrite", async () => {
    const adapter = makeAdapter("old");
    adapter.process.mockRejectedValueOnce(new Error("atomic replace failed") as never);
    const io = new ObsidianReminderStateFileIO(adapter);

    await expect(io.write(REMINDER_STATE_PATH, "new")).rejects.toThrow("atomic replace failed");
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.content()).toBe("old");
  });
});
