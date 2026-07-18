import {
  ReminderFiredState,
  ReminderDeliveryIdentity,
  ReminderFiredStateStore,
  ReminderStateFileIO,
} from "adapters/mdb/ReminderFiredStateStore";
import { EventDispatcher } from "shared/utils/dispatchers/dispatcher";
import { SuperstateEvent } from "shared/types/PathState";
import * as dateReminderSchedule from "core/utils/date-reminders/schedule";
import {
  ReminderDeliveryLifecycleController,
  ReminderDeliveryService,
  reconcileReminderDeliveryLifecycle,
} from "./ReminderDeliveryService";

const NOW = Date.parse("2026-07-19T12:00:00Z");

type DeferredResolve<T> = [T] extends [void]
  ? (value?: T) => void
  : (value: T) => void;

const deferred = <T = void,>() => {
  let resolve!: DeferredResolve<T>;
  const promise = new Promise<T>((res) => {
    resolve = res as DeferredResolve<T>;
  });
  return { promise, resolve };
};

class MemoryState implements ReminderFiredState {
  identities = new Set<string>();
  opened = 0;
  closed = 0;
  flushes = 0;
  deletes: string[] = [];
  renames: Array<[string, string]> = [];
  invalidations: Array<[string, string | null]> = [];
  failClaims = false;
  batchCalls = 0;
  reconcileCalls = 0;
  private claimBarrier: {
    started: ReturnType<typeof deferred>;
    release: ReturnType<typeof deferred>;
  } | null = null;
  private reconcileBarrier: {
    started: ReturnType<typeof deferred>;
    release: ReturnType<typeof deferred>;
  } | null = null;
  private renameBarrier: {
    started: ReturnType<typeof deferred>;
    release: ReturnType<typeof deferred>;
  } | null = null;

  async open() { this.opened += 1; }
  async claim(identity: ReminderDeliveryIdentity) {
    return (await this.claimMany([identity])).length === 1;
  }
  async claimMany(identities: readonly ReminderDeliveryIdentity[]) {
    this.batchCalls += 1;
    if (this.failClaims) throw new Error("state failed");
    const barrier = this.claimBarrier;
    if (barrier) {
      barrier.started.resolve(undefined);
      await barrier.release.promise;
      this.claimBarrier = null;
    }
    const claimed: ReminderDeliveryIdentity[] = [];
    for (const identity of identities) {
      const key = JSON.stringify(identity);
      if (this.identities.has(key)) continue;
      this.identities.add(key);
      claimed.push(identity);
    }
    return claimed;
  }
  holdNextBatch() {
    const barrier = { started: deferred(), release: deferred() };
    this.claimBarrier = barrier;
    return barrier;
  }
  async reconcileCandidates(candidates: ReadonlyMap<string, string>) {
    this.reconcileCalls += 1;
    const barrier = this.reconcileBarrier;
    if (barrier) {
      barrier.started.resolve(undefined);
      await barrier.release.promise;
      this.reconcileBarrier = null;
    }
    for (const key of this.identities) {
      const identity = JSON.parse(key) as ReminderDeliveryIdentity;
      if (candidates.get(identity.path) !== identity.fingerprint) {
        this.identities.delete(key);
      }
    }
  }
  holdNextReconcile() {
    const barrier = { started: deferred(), release: deferred() };
    this.reconcileBarrier = barrier;
    return barrier;
  }
  async deletePath(path: string) {
    this.deletes.push(path);
    for (const key of this.identities) {
      if ((JSON.parse(key) as ReminderDeliveryIdentity).path === path) this.identities.delete(key);
    }
  }
  async renamePath(oldPath: string, newPath: string) {
    this.renames.push([oldPath, newPath]);
    const barrier = this.renameBarrier;
    if (barrier) {
      barrier.started.resolve(undefined);
      await barrier.release.promise;
      this.renameBarrier = null;
    }
    const moved: ReminderDeliveryIdentity[] = [];
    for (const key of this.identities) {
      const identity = JSON.parse(key) as ReminderDeliveryIdentity;
      if (identity.path === oldPath) {
        this.identities.delete(key);
        moved.push({ ...identity, path: newPath });
      }
    }
    for (const identity of moved) this.identities.add(JSON.stringify(identity));
  }
  holdNextRename() {
    const barrier = { started: deferred(), release: deferred() };
    this.renameBarrier = barrier;
    return barrier;
  }
  async invalidateSchedule(path: string, fingerprint: string | null) {
    this.invalidations.push([path, fingerprint]);
    for (const key of this.identities) {
      const identity = JSON.parse(key) as ReminderDeliveryIdentity;
      if (identity.path === path && identity.fingerprint !== fingerprint) this.identities.delete(key);
    }
  }
  async prune() {}
  async flush() { this.flushes += 1; }
  async close() { this.closed += 1; await this.flush(); }
}

class FakeTimer {
  callback: (() => void | Promise<void>) | null = null;
  intervalMs: number | null = null;
  cleared = 0;
  register = (callback: () => void, intervalMs: number) => {
    this.callback = callback;
    this.intervalMs = intervalMs;
    return 17;
  };
  clear = (_handle: unknown) => { this.cleared += 1; this.callback = null; };
  async fire() {
    await this.callback?.();
    await Promise.resolve();
  }
}

class DelayedStateFileIO implements ReminderStateFileIO {
  private content: string | null = null;
  private barrier: {
    started: ReturnType<typeof deferred>;
    release: ReturnType<typeof deferred>;
  } | null = null;

  async read(): Promise<string | null> { return this.content; }

  async write(_path: string, content: string): Promise<void> {
    const barrier = this.barrier;
    if (barrier) {
      barrier.started.resolve(undefined);
      await barrier.release.promise;
      this.barrier = null;
    }
    this.content = content;
  }

  holdNextWrite() {
    const barrier = { started: deferred(), release: deferred() };
    this.barrier = barrier;
    return barrier;
  }
}

const schedule = (due: string, before = "PT0S", repeat?: Record<string, unknown>) => ({
  due,
  reminder: { before },
  ...(repeat ? { repeat } : {}),
});

const pathState = (property: Record<string, unknown>) => ({
  type: "file",
  subtype: "md",
  hidden: false,
  metadata: { property },
});

const makeHarness = (
  rows: Record<string, Record<string, unknown>> = {},
  overrides: { notify?: (message: string) => void } = {},
) => {
  const index = new Map(
    Object.entries(rows).map(([path, property]) => [path, pathState(property)]),
  );
  const events = new EventDispatcher<SuperstateEvent>();
  const store = new MemoryState();
  const timer = new FakeTimer();
  const notices: string[] = [];
  const diagnostics: unknown[] = [];
  let clock = () => NOW;
  const service = new ReminderDeliveryService({
    index: { entries: () => index.entries(), get: (path) => index.get(path) },
    events,
    store,
    now: () => clock(),
    notify: overrides.notify ?? ((message) => notices.push(message)),
    diagnostic: (error) => diagnostics.push(error),
    registerInterval: timer.register,
    clearInterval: timer.clear,
  });
  return {
    service,
    index,
    events,
    store,
    timer,
    notices,
    diagnostics,
    setClock: (next: () => number) => { clock = next; },
  };
};

describe("ReminderDeliveryService", () => {
  it("waits for the first index update, seeds candidates, and scans every 60 seconds", async () => {
    const h = makeHarness({ "Due.md": schedule("2026-07-19T12:00:00Z") });
    await h.service.start();
    expect(h.notices).toEqual([]);
    expect(h.timer.intervalMs).toBe(60_000);

    await h.events.dispatchEvent("superstateUpdated", null);
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toContain("Due.md");
  });

  it("seeds a large mixed index with one fired-state reconciliation", async () => {
    const rows = Object.fromEntries([
      ["Due.md", schedule("2026-07-19T12:00:00Z")],
      ...Array.from({ length: 2_000 }, (_, index) => [
        `Plain-${index}.md`,
        { title: `Plain ${index}` },
      ]),
    ]);
    const h = makeHarness(rows);
    await h.service.start();

    await h.events.dispatchEvent("superstateUpdated", null);

    expect(h.store.reconcileCalls).toBe(1);
    expect(h.store.invalidations).toEqual([]);
    expect(h.notices).toHaveLength(1);
    expect((h.service as any).pathGenerations.size).toBe(1);

    h.index.delete("Plain-0.md");
    await h.events.dispatchEvent("pathDeleted", { path: "Plain-0.md" });
    expect((h.service as any).pathGenerations.size).toBe(1);
  });

  it("preserves a path created while full-seed reconciliation is awaiting storage", async () => {
    const h = makeHarness();
    await h.service.start();
    const barrier = h.store.holdNextReconcile();
    const seed = h.events.dispatchEvent("superstateUpdated", null);
    await barrier.started.promise;
    h.index.set("Created.md", pathState(schedule("2026-07-19T12:00:00Z")));
    await h.events.dispatchEvent("pathCreated", { path: "Created.md" });
    barrier.release.resolve();
    await seed;

    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toContain("Created.md");
  });

  it("preserves a rename applied while full-seed reconciliation is awaiting storage", async () => {
    const h = makeHarness({ "Old.md": schedule("2026-07-19T12:00:00Z") });
    await h.service.start();
    const barrier = h.store.holdNextReconcile();
    const seed = h.events.dispatchEvent("superstateUpdated", null);
    await barrier.started.promise;
    h.index.delete("Old.md");
    h.index.set("New.md", pathState(schedule("2026-07-19T12:00:00Z")));
    await h.events.dispatchEvent("pathChanged", { path: "Old.md", newPath: "New.md" });
    barrier.release.resolve();
    await seed;

    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toContain("New.md");
    expect(h.notices[0]).not.toContain("Old.md");
  });

  it("does not restore a path deleted while full-seed reconciliation is awaiting storage", async () => {
    const h = makeHarness({ "Gone.md": schedule("2026-07-19T12:00:00Z") });
    await h.service.start();
    const barrier = h.store.holdNextReconcile();
    const seed = h.events.dispatchEvent("superstateUpdated", null);
    await barrier.started.promise;
    h.index.delete("Gone.md");
    await h.events.dispatchEvent("pathDeleted", { path: "Gone.md" });
    barrier.release.resolve();
    await seed;

    expect(h.notices).toEqual([]);
  });

  it("does not repeat on duplicate ticks or concurrent scans", async () => {
    const h = makeHarness({ "Due.md": schedule("2026-07-19T12:00:00Z") });
    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);

    await Promise.all([h.service.scanNow(), h.service.scanNow()]);
    h.timer.callback?.();
    await h.service.scanNow();

    expect(h.notices).toHaveLength(1);
    expect(h.store.identities.size).toBe(1);
  });

  it("keeps unrelated edits stable and invalidates a rescheduled identity", async () => {
    const h = makeHarness({ "Event.md": schedule("2026-07-19T12:00:00Z") });
    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);
    const invalidationsAfterSeed = h.store.invalidations.length;

    h.index.set("Event.md", pathState({ ...schedule("2026-07-19T12:00:00Z"), title: "changed" }));
    await h.events.dispatchEvent("pathStateUpdated", { path: "Event.md" });
    expect(h.store.invalidations).toHaveLength(invalidationsAfterSeed);

    h.index.set("Event.md", pathState(schedule("2026-07-19T11:00:00Z")));
    await h.events.dispatchEvent("pathStateUpdated", { path: "Event.md" });
    await h.service.scanNow();
    expect(h.store.invalidations).toHaveLength(invalidationsAfterSeed + 1);
    expect(h.notices).toHaveLength(2);
  });

  it("migrates fired identities on rename and purges them on delete", async () => {
    const h = makeHarness({ "Old.md": schedule("2026-07-19T12:00:00Z") });
    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);

    h.index.delete("Old.md");
    h.index.set("New.md", pathState(schedule("2026-07-19T12:00:00Z")));
    await h.events.dispatchEvent("pathChanged", { path: "Old.md", newPath: "New.md" });
    await h.service.scanNow();
    expect(h.store.renames).toEqual([["Old.md", "New.md"]]);
    expect(h.notices).toHaveLength(1);

    h.index.delete("New.md");
    await h.events.dispatchEvent("pathDeleted", { path: "New.md" });
    expect(h.store.deletes).toEqual(["New.md"]);
  });

  it("claims overflow identities while emitting ten notices plus one summary", async () => {
    const rows = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `Due-${index}.md`,
        schedule("2026-07-19T12:00:00Z"),
      ]),
    );
    const h = makeHarness(rows);
    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);

    expect(h.store.identities.size).toBe(12);
    expect(h.notices).toHaveLength(11);
    expect(h.notices[10]).toContain("2 additional reminders");
    await h.service.scanNow();
    expect(h.notices).toHaveLength(11);
  });

  it("continues a single hourly row beyond its first 100 occurrences", async () => {
    const h = makeHarness({
      "Hourly.md": schedule("2026-07-12T12:00:00Z", "PT0S", {
        freq: "HOURLY",
        interval: 1,
      }),
    });
    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);
    expect(h.store.identities.size).toBe(100);

    await h.service.scanNow();
    expect(h.store.identities.size).toBe(169);
    const noticesAfterContinuation = h.notices.length;

    await h.service.scanNow();
    expect(h.store.identities.size).toBe(169);
    expect(h.notices).toHaveLength(noticesAfterContinuation);
  });

  it("continues within a row when the global cap truncates that row", async () => {
    const hourly = schedule("2026-07-12T12:00:00Z", "PT0S", {
      freq: "HOURLY",
      interval: 1,
    });
    const rows = Object.fromEntries([
      ...Array.from({ length: 9 }, (_, index) => [`A-${index}.md`, hourly]),
      ["B-One.md", schedule("2026-07-19T12:00:00Z")],
      ["C-Hourly.md", hourly],
    ]);
    const h = makeHarness(rows);
    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);

    expect(h.store.identities.size).toBe(1_000);
    const firstCHourlyCount = Array.from(h.store.identities).filter((key) =>
      key.includes("C-Hourly.md"),
    ).length;
    expect(firstCHourlyCount).toBe(99);

    await h.service.scanNow();
    const secondCHourlyCount = Array.from(h.store.identities).filter((key) =>
      key.includes("C-Hourly.md"),
    ).length;
    expect(secondCHourlyCount).toBe(169);
  });

  it("passes the exact remaining global budget into row expansion", async () => {
    const hourly = schedule("2026-07-12T12:00:00Z", "PT0S", {
      freq: "HOURLY",
      interval: 1,
    });
    const rows = Object.fromEntries([
      ...Array.from({ length: 9 }, (_, index) => [`A-${index}.md`, hourly]),
      ["B-One.md", schedule("2026-07-19T12:00:00Z")],
      ["C-Hourly.md", hourly],
    ]);
    const expansion = jest.spyOn(
      dateReminderSchedule,
      "expandDueReminderOccurrences",
    );
    try {
      const h = makeHarness(rows);
      await h.service.start();
      await h.events.dispatchEvent("superstateUpdated", null);

      expect(expansion.mock.calls.at(-1)?.[2]).toEqual(
        expect.objectContaining({ maxOccurrences: 99 }),
      );
    } finally {
      expansion.mockRestore();
    }
  });

  it("caps each scan at 1,000 occurrences and advances later candidates on the next scan", async () => {
    const rows = Object.fromEntries(
      Array.from({ length: 1_001 }, (_, index) => [
        `Due-${index.toString().padStart(4, "0")}.md`,
        schedule("2026-07-19T12:00:00Z"),
      ]),
    );
    const h = makeHarness(rows);
    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);

    expect(h.store.identities.size).toBe(1_000);
    expect(h.store.batchCalls).toBe(1);
    expect(
      Array.from(h.store.identities).some((key) => key.includes("Due-1000.md")),
    ).toBe(false);

    await h.service.scanNow();

    expect(h.store.identities.size).toBe(1_001);
    expect(
      Array.from(h.store.identities).some((key) => key.includes("Due-1000.md")),
    ).toBe(true);
  });

  it("keeps cap progress deterministic when the cursor path is deleted and an earlier path is inserted", async () => {
    const rows = Object.fromEntries(
      Array.from({ length: 1_001 }, (_, index) => [
        `Due-${index.toString().padStart(4, "0")}.md`,
        schedule("2026-07-19T12:00:00Z"),
      ]),
    );
    const h = makeHarness(rows);
    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);
    h.index.delete("Due-0999.md");
    await h.events.dispatchEvent("pathDeleted", { path: "Due-0999.md" });
    h.index.set("A-New.md", pathState(schedule("2026-07-19T12:00:00Z")));
    await h.events.dispatchEvent("pathCreated", { path: "A-New.md" });

    await h.service.scanNow();

    const claimed = Array.from(h.store.identities);
    expect(claimed.some((key) => key.includes("Due-1000.md"))).toBe(true);
    expect(claimed.some((key) => key.includes("A-New.md"))).toBe(true);
  });

  it("withholds a stale notice when a schedule changes during a delayed batch claim", async () => {
    const h = makeHarness({ "Event.md": schedule("2026-07-19T12:30:00Z") });
    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);
    h.index.set("Event.md", pathState(schedule("2026-07-19T12:00:00Z")));
    await h.events.dispatchEvent("pathStateUpdated", { path: "Event.md" });
    const barrier = h.store.holdNextBatch();
    const scan = h.service.scanNow();
    await barrier.started.promise;
    h.index.set("Event.md", pathState(schedule("2026-07-19T11:00:00Z")));
    await h.events.dispatchEvent("pathStateUpdated", { path: "Event.md" });
    barrier.release.resolve();
    await scan;

    expect(h.notices).toEqual([]);
    await h.service.scanNow();
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toContain("Event.md");
  });

  it("delivers exactly once at the final path when a rename chain races a durable claim", async () => {
    const index = new Map([
      ["Old.md", pathState(schedule("2026-07-19T12:30:00Z"))],
    ]);
    const events = new EventDispatcher<SuperstateEvent>();
    const io = new DelayedStateFileIO();
    const store = new ReminderFiredStateStore(io, () => NOW);
    const timer = new FakeTimer();
    const notices: string[] = [];
    const service = new ReminderDeliveryService({
      index: { entries: () => index.entries(), get: (path) => index.get(path) },
      events,
      store,
      now: () => NOW,
      notify: (message) => notices.push(message),
      diagnostic: (error) => { throw error; },
      registerInterval: timer.register,
      clearInterval: timer.clear,
    });
    await service.start();
    await events.dispatchEvent("superstateUpdated", null);
    index.set("Old.md", pathState(schedule("2026-07-19T12:00:00Z")));
    await events.dispatchEvent("pathStateUpdated", { path: "Old.md" });
    const barrier = io.holdNextWrite();

    const scan = service.scanNow();
    await barrier.started.promise;
    index.delete("Old.md");
    index.set("Middle.md", pathState(schedule("2026-07-19T12:00:00Z")));
    const firstRename = events.dispatchEvent("pathChanged", {
      path: "Old.md",
      newPath: "Middle.md",
    });
    index.delete("Middle.md");
    index.set("New.md", pathState(schedule("2026-07-19T12:00:00Z")));
    const secondRename = events.dispatchEvent("pathChanged", {
      path: "Middle.md",
      newPath: "New.md",
    });
    barrier.release.resolve();
    await Promise.all([scan, firstRename, secondRename]);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("New.md");
    expect(notices[0]).not.toContain("Old.md");
    expect(notices[0]).not.toContain("Middle.md");
    await service.scanNow();
    expect(notices).toHaveLength(1);
  });

  it("withholds a deleted-path notice when deletion occurs during a delayed batch claim", async () => {
    const h = makeHarness({ "Gone.md": schedule("2026-07-19T12:00:00Z") });
    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);
    h.notices.length = 0;
    h.store.identities.clear();
    const barrier = h.store.holdNextBatch();
    const scan = h.service.scanNow();
    await barrier.started.promise;
    h.index.delete("Gone.md");
    await h.events.dispatchEvent("pathDeleted", { path: "Gone.md" });
    barrier.release.resolve();
    await scan;

    expect(h.notices).toEqual([]);
    await h.service.scanNow();
    expect(h.notices).toEqual([]);
  });

  it("revalidates an earlier identity after a later rename resolution blocks", async () => {
    const h = makeHarness({
      "A.md": schedule("2026-07-19T12:30:00Z"),
      "B.md": schedule("2026-07-19T12:30:00Z"),
    });
    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);
    h.index.set("A.md", pathState(schedule("2026-07-19T12:00:00Z")));
    h.index.set("B.md", pathState(schedule("2026-07-19T12:00:00Z")));
    await h.events.dispatchEvent("pathStateUpdated", { path: "A.md" });
    await h.events.dispatchEvent("pathStateUpdated", { path: "B.md" });
    const claimBarrier = h.store.holdNextBatch();
    const renameBarrier = h.store.holdNextRename();

    const scan = h.service.scanNow();
    await claimBarrier.started.promise;
    h.index.delete("B.md");
    h.index.set("C.md", pathState(schedule("2026-07-19T12:00:00Z")));
    const rename = h.events.dispatchEvent("pathChanged", {
      path: "B.md",
      newPath: "C.md",
    });
    await renameBarrier.started.promise;
    claimBarrier.release.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    h.index.delete("A.md");
    await h.events.dispatchEvent("pathDeleted", { path: "A.md" });
    renameBarrier.release.resolve();
    await Promise.all([scan, rename]);

    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toContain("C.md");
    expect(h.notices[0]).not.toContain("A.md");
  });

  it("revalidates each identity after an earlier notifier callback mutates candidates", async () => {
    let h!: ReturnType<typeof makeHarness>;
    const notices: string[] = [];
    h = makeHarness(
      {
        "A.md": schedule("2026-07-19T12:00:00Z"),
        "B.md": schedule("2026-07-19T12:00:00Z"),
      },
      {
        notify: (message) => {
          notices.push(message);
          if (message.includes("A.md")) {
            h.index.delete("B.md");
            void h.events.dispatchEvent("pathDeleted", { path: "B.md" });
          }
        },
      },
    );

    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("A.md");
    expect(notices[0]).not.toContain("B.md");
  });

  it("excludes callback-invalidated identities from overflow accounting", async () => {
    let h!: ReturnType<typeof makeHarness>;
    const notices: string[] = [];
    const rows = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `Due-${index.toString().padStart(2, "0")}.md`,
        schedule("2026-07-19T12:00:00Z"),
      ]),
    );
    h = makeHarness(rows, {
      notify: (message) => {
        notices.push(message);
        if (message.includes("Due-00.md")) {
          for (const path of ["Due-10.md", "Due-11.md"]) {
            h.index.delete(path);
            void h.events.dispatchEvent("pathDeleted", { path });
          }
        }
      },
    });

    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);

    expect(notices).toHaveLength(10);
    expect(notices.some((notice) => notice.includes("additional"))).toBe(false);
  });

  it("rejects an in-flight identity when the same path and schedule are deleted and recreated", async () => {
    const index = new Map([
      ["Again.md", pathState(schedule("2026-07-19T12:00:00Z"))],
    ]);
    const events = new EventDispatcher<SuperstateEvent>();
    const io = new DelayedStateFileIO();
    const store = new ReminderFiredStateStore(io, () => NOW);
    const timer = new FakeTimer();
    const notices: string[] = [];
    let clock = NOW - 60_000;
    const service = new ReminderDeliveryService({
      index: { entries: () => index.entries(), get: (path) => index.get(path) },
      events,
      store,
      now: () => clock,
      notify: (message) => notices.push(message),
      diagnostic: (error) => { throw error; },
      registerInterval: timer.register,
      clearInterval: timer.clear,
    });
    await service.start();
    await events.dispatchEvent("superstateUpdated", null);
    clock = NOW;
    const barrier = io.holdNextWrite();

    const scan = service.scanNow();
    await barrier.started.promise;
    index.delete("Again.md");
    const deletion = events.dispatchEvent("pathDeleted", { path: "Again.md" });
    index.set("Again.md", pathState(schedule("2026-07-19T12:00:00Z")));
    const recreation = events.dispatchEvent("pathCreated", { path: "Again.md" });
    barrier.release.resolve();
    await Promise.all([scan, deletion, recreation]);

    expect(notices).toEqual([]);
    await service.scanNow();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("Again.md");
  });

  it("rejects an in-flight identity when a schedule is removed and re-added unchanged", async () => {
    const index = new Map([
      ["Again.md", pathState(schedule("2026-07-19T12:00:00Z"))],
    ]);
    const events = new EventDispatcher<SuperstateEvent>();
    const io = new DelayedStateFileIO();
    const store = new ReminderFiredStateStore(io, () => NOW);
    const timer = new FakeTimer();
    const notices: string[] = [];
    let clock = NOW - 60_000;
    const service = new ReminderDeliveryService({
      index: { entries: () => index.entries(), get: (path) => index.get(path) },
      events,
      store,
      now: () => clock,
      notify: (message) => notices.push(message),
      diagnostic: (error) => { throw error; },
      registerInterval: timer.register,
      clearInterval: timer.clear,
    });
    await service.start();
    await events.dispatchEvent("superstateUpdated", null);
    clock = NOW;
    const barrier = io.holdNextWrite();

    const scan = service.scanNow();
    await barrier.started.promise;
    index.set("Again.md", pathState({ title: "Again" }));
    const removal = events.dispatchEvent("pathStateUpdated", { path: "Again.md" });
    index.set("Again.md", pathState(schedule("2026-07-19T12:00:00Z")));
    const recreation = events.dispatchEvent("pathStateUpdated", { path: "Again.md" });
    barrier.release.resolve();
    await Promise.all([scan, removal, recreation]);

    expect(notices).toEqual([]);
    await service.scanNow();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("Again.md");
  });

  it("catches interval scan rejection and emits one bounded diagnostic", async () => {
    const h = makeHarness({ "Due.md": schedule("2026-07-19T12:00:00Z") });
    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);
    h.setClock(() => { throw new Error("clock failed"); });

    await h.timer.fire();
    await h.timer.fire();

    expect(h.diagnostics).toHaveLength(1);
    expect(h.notices.filter((notice) => notice.includes("paused"))).toHaveLength(1);
  });

  it("pauses after notifier failure with one diagnostic and one warning attempt", async () => {
    const rows = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `Due-${index}.md`,
        schedule("2026-07-19T12:00:00Z"),
      ]),
    );
    let attempts = 0;
    const h = makeHarness(rows, {
      notify: () => {
        attempts += 1;
        throw new Error("notifier failed");
      },
    });
    await h.service.start();

    await h.events.dispatchEvent("superstateUpdated", null);
    await h.service.scanNow();

    expect(attempts).toBe(2);
    expect(h.diagnostics).toHaveLength(1);
    expect(h.store.identities.size).toBe(12);
  });

  it("fails closed on storage errors with one session warning and diagnostics", async () => {
    const h = makeHarness({ "Due.md": schedule("2026-07-19T12:00:00Z") });
    h.store.failClaims = true;
    await h.service.start();
    await h.events.dispatchEvent("superstateUpdated", null);
    await h.service.scanNow();

    expect(h.notices).toEqual([
      "Notidian reminders are paused because fired-state storage is unavailable.",
    ]);
    expect(h.diagnostics).toHaveLength(1);
  });

  it("disposes listeners, timer, and fired-state storage on unload", async () => {
    const h = makeHarness({ "Due.md": schedule("2026-07-19T12:00:00Z") });
    await h.service.start();
    await h.service.stop();
    await h.service.stop();
    await h.events.dispatchEvent("superstateUpdated", null);

    expect(h.timer.cleared).toBe(1);
    expect(h.store.closed).toBe(1);
    expect(h.store.flushes).toBe(1);
    expect(h.notices).toEqual([]);
  });

  it("reconciles enable, disable, and re-enable idempotently", async () => {
    const created: ReminderDeliveryService[] = [];
    const create = () => {
      const service = makeHarness().service;
      created.push(service);
      return service;
    };
    let current: ReminderDeliveryService | null = null;

    current = await reconcileReminderDeliveryLifecycle(true, current, create);
    current = await reconcileReminderDeliveryLifecycle(true, current, create);
    expect(created).toHaveLength(1);
    current = await reconcileReminderDeliveryLifecycle(false, current, create);
    expect(current).toBeNull();
    current = await reconcileReminderDeliveryLifecycle(true, current, create);
    expect(created).toHaveLength(2);
    await current?.stop();
  });

  it("serializes overlapping lifecycle requests so a delayed enable cannot win after disable", async () => {
    const started = deferred();
    const releaseStart = deferred();
    const events: string[] = [];
    const service = {
      async start() {
        events.push("start");
        started.resolve();
        await releaseStart.promise;
      },
      async stop() { events.push("stop"); },
    };
    const controller = new ReminderDeliveryLifecycleController(() => service);

    const enable = controller.reconcile(true);
    await started.promise;
    const disable = controller.reconcile(false);
    releaseStart.resolve();
    await Promise.all([enable, disable]);

    expect(events).toEqual(["start", "stop"]);
    expect(controller.getCurrent()).toBeNull();
  });

  it("initiates reminder shutdown synchronously and only once", async () => {
    const stopStarted = deferred();
    const releaseStop = deferred();
    let stops = 0;
    const service = {
      async start() {},
      async stop() {
        stops += 1;
        stopStarted.resolve();
        await releaseStop.promise;
      },
    };
    const controller = new ReminderDeliveryLifecycleController(() => service);
    await controller.reconcile(true);

    expect(controller.shutdown(jest.fn())).toBeUndefined();
    controller.shutdown(jest.fn());
    await stopStarted.promise;
    expect(stops).toBe(1);
    releaseStop.resolve();
    await Promise.resolve();
  });

  it("never re-enables after shutdown when a stale reconcile callback is queued", async () => {
    const started = deferred();
    const releaseStart = deferred();
    const events: string[] = [];
    let created = 0;
    const controller = new ReminderDeliveryLifecycleController(() => {
      created += 1;
      return {
        async start() {
          events.push(`start-${created}`);
          if (created === 1) {
            started.resolve();
            await releaseStart.promise;
          }
        },
        async stop() { events.push(`stop-${created}`); },
      };
    });

    const enable = controller.reconcile(true);
    await started.promise;
    controller.shutdown(jest.fn());
    const staleEnable = controller.reconcile(true);
    releaseStart.resolve();
    await Promise.all([enable, staleEnable]);

    expect(created).toBe(1);
    expect(events).toEqual(["start-1", "stop-1"]);
    expect(controller.getCurrent()).toBeNull();
  });

  it("catches a shutdown rejection with one bounded diagnostic", async () => {
    const service = {
      async start() {},
      async stop() { throw new Error("flush failed"); },
    };
    const diagnostics: unknown[] = [];
    const reported = deferred();
    const controller = new ReminderDeliveryLifecycleController(() => service);
    await controller.reconcile(true);

    controller.shutdown((error: unknown) => {
      diagnostics.push(error);
      reported.resolve();
    });
    controller.shutdown((error: unknown) => diagnostics.push(error));
    await reported.promise;

    expect(diagnostics).toHaveLength(1);
  });
});
