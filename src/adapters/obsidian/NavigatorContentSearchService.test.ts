import { EventDispatcher } from "shared/utils/dispatchers/dispatcher";
import { PathState, SuperstateEvent } from "shared/types/PathState";
import {
  NavigatorContentWorkerPort,
  NavigatorContentWorkerRequest,
  NavigatorContentWorkerResponse,
} from "shared/types/navigatorContentSearch";
import { NavigatorContentWorkerRuntime } from "core/superstate/workers/navigatorContentSearch/impl";
import {
  NavigatorContentSearchService,
  NavigatorContentVault,
  reconcileNavigatorContentSearchLifecycle,
} from "./NavigatorContentSearchService";

type FakeFile = { path: string; extension: string };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

class FakeVault implements NavigatorContentVault {
  readonly files = new Map<string, FakeFile>();
  readonly bodies = new Map<string, string | (() => Promise<string>)>();
  readCount = 0;
  activeReads = 0;
  maxActiveReads = 0;
  private listeners = new Map<string, Set<(...args: any[]) => unknown>>();

  add(path: string, body: string): FakeFile {
    const file = { path, extension: "md" };
    this.files.set(path, file);
    this.bodies.set(path, body);
    return file;
  }

  getAbstractFileByPath(path: string): FakeFile | null {
    return this.files.get(path) ?? null;
  }

  async cachedRead(file: FakeFile): Promise<string> {
    this.readCount += 1;
    this.activeReads += 1;
    this.maxActiveReads = Math.max(this.maxActiveReads, this.activeReads);
    try {
      const body = this.bodies.get(file.path);
      return typeof body === "function" ? await body() : body ?? "";
    } finally {
      this.activeReads -= 1;
    }
  }

  on(event: string, callback: (...args: any[]) => unknown): object {
    const callbacks = this.listeners.get(event) ?? new Set();
    callbacks.add(callback);
    this.listeners.set(event, callbacks);
    return { event, callback };
  }

  offref(ref: { event: string; callback: (...args: any[]) => unknown }): void {
    this.listeners.get(ref.event)?.delete(ref.callback);
  }

  async emit(event: string, ...args: any[]): Promise<void> {
    await Promise.all(
      Array.from(this.listeners.get(event) ?? []).map((callback) =>
        callback(...args)
      )
    );
  }
}

class RuntimeWorker implements NavigatorContentWorkerPort {
  onmessage:
    | ((event: MessageEvent<NavigatorContentWorkerResponse>) => void)
    | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly runtime = new NavigatorContentWorkerRuntime();
  readonly messages: NavigatorContentWorkerRequest[] = [];
  readonly heldQueryResponses: NavigatorContentWorkerResponse[] = [];
  terminated = false;

  constructor(private holdQueries = false) {}

  postMessage(message: NavigatorContentWorkerRequest): void {
    this.messages.push(message);
    const response = this.runtime.handle(message);
    if (message.type === "query" && this.holdQueries) {
      this.heldQueryResponses.push(response);
      return;
    }
    queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent));
  }

  releaseQuery(): void {
    const response = this.heldQueryResponses.shift();
    if (response) this.onmessage?.({ data: response } as MessageEvent);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const pathState = (path: string, overrides: Partial<PathState> = {}): PathState =>
  ({
    path,
    name: path,
    type: "file",
    subtype: "md",
    hidden: false,
    label: { name: path, sticker: "", color: "" },
    readOnly: false,
    ...overrides,
  } as PathState);

const makeSuperstate = (paths: string[]) => ({
  initialized: false,
  settings: { enableNavigatorTextFilter: true },
  pathsIndex: new Map(paths.map((path) => [path, pathState(path)])),
  eventsDispatcher: new EventDispatcher<SuperstateEvent>(),
});

const makeService = (
  vault: FakeVault,
  superstate: ReturnType<typeof makeSuperstate>,
  worker = new RuntimeWorker()
) => ({
  worker,
  service: new NavigatorContentSearchService({
    vault,
    superstate,
    createWorker: () => worker,
  }),
});

const build = async (
  service: NavigatorContentSearchService,
  superstate: ReturnType<typeof makeSuperstate>
) => {
  service.start();
  await superstate.eventsDispatcher.dispatchEvent("superstateUpdated", null);
  expect(service.getSnapshot().status).toBe("ready");
};

const search = (
  service: NavigatorContentSearchService,
  query: string,
  requestId = 1
) =>
  service.search({
    requestId,
    query,
    revision: service.getSnapshot().revision,
  });

describe("NavigatorContentSearchService", () => {
  it("waits for superstateUpdated and bounds initial cachedRead concurrency at four", async () => {
    const vault = new FakeVault();
    const paths = Array.from({ length: 12 }, (_, index) => `${index}.md`);
    for (const path of paths) {
      vault.add(path, `body ${path}`);
      vault.bodies.set(path, async () => {
        await tick();
        return `body ${path}`;
      });
    }
    const superstate = makeSuperstate(paths);
    const { service } = makeService(vault, superstate);

    service.start();
    expect(vault.readCount).toBe(0);
    expect(service.getSnapshot().status).toBe("building");

    await superstate.eventsDispatcher.dispatchEvent("superstateUpdated", null);

    expect(vault.readCount).toBe(12);
    expect(vault.maxActiveReads).toBe(4);
    expect((await search(service, "body")).paths).toHaveLength(12);
  });

  it("refreshes a metadata-neutral body edit from the raw modify event", async () => {
    const vault = new FakeVault();
    const file = vault.add("Note.md", "old body token");
    const superstate = makeSuperstate([file.path]);
    const { service } = makeService(vault, superstate);
    await build(service, superstate);

    vault.bodies.set(file.path, "new body token");
    await vault.emit("modify", file);

    expect((await search(service, "old body")).paths).toEqual([]);
    expect((await search(service, "new body", 2)).paths).toEqual([file.path]);
  });

  it("keeps a raw create pending until Superstate proves it eligible", async () => {
    const vault = new FakeVault();
    const superstate = makeSuperstate([]);
    const { service } = makeService(vault, superstate);
    await build(service, superstate);
    const file = vault.add("Created.md", "created body token");

    await vault.emit("create", file);
    expect(vault.readCount).toBe(0);
    superstate.pathsIndex.set(file.path, pathState(file.path));
    await superstate.eventsDispatcher.dispatchEvent("pathCreated", {
      path: file.path,
    });

    expect(vault.readCount).toBe(1);
    expect((await search(service, "created body")).paths).toEqual([file.path]);
  });

  it("drops a late A read after a newer B edit resolves", async () => {
    const vault = new FakeVault();
    const file = vault.add("Race.md", "initial");
    const superstate = makeSuperstate([file.path]);
    const { service } = makeService(vault, superstate);
    await build(service, superstate);

    const a = deferred<string>();
    const b = deferred<string>();
    vault.bodies.set(file.path, () => a.promise);
    const aEvent = vault.emit("modify", file);
    await tick();
    vault.bodies.set(file.path, () => b.promise);
    const bEvent = vault.emit("modify", file);
    b.resolve("new B token");
    await bEvent;
    a.resolve("stale A token");
    await aEvent;

    expect((await search(service, "stale A")).paths).toEqual([]);
    expect((await search(service, "new B", 2)).paths).toEqual([file.path]);
  });

  it("cannot resurrect a path deleted while its read is pending", async () => {
    const vault = new FakeVault();
    const file = vault.add("Delete.md", "initial");
    const superstate = makeSuperstate([file.path]);
    const { service } = makeService(vault, superstate);
    await build(service, superstate);

    const late = deferred<string>();
    vault.bodies.set(file.path, () => late.promise);
    const modify = vault.emit("modify", file);
    await tick();
    vault.files.delete(file.path);
    superstate.pathsIndex.delete(file.path);
    await vault.emit("delete", file);
    late.resolve("resurrection token");
    await modify;

    expect((await search(service, "resurrection")).paths).toEqual([]);
  });

  it("removes the old path and indexes the new path across rename-during-read", async () => {
    const vault = new FakeVault();
    const oldFile = vault.add("Old.md", "old token");
    const superstate = makeSuperstate([oldFile.path]);
    const { service } = makeService(vault, superstate);
    await build(service, superstate);

    const late = deferred<string>();
    vault.bodies.set(oldFile.path, () => late.promise);
    const modify = vault.emit("modify", oldFile);
    await tick();

    const newFile = { path: "New.md", extension: "md" };
    vault.files.delete(oldFile.path);
    vault.bodies.delete(oldFile.path);
    vault.files.set(newFile.path, newFile);
    vault.bodies.set(newFile.path, "renamed fresh token");
    superstate.pathsIndex.delete(oldFile.path);
    superstate.pathsIndex.set(newFile.path, pathState(newFile.path));
    await vault.emit("rename", newFile, oldFile.path);
    late.resolve("late old token");
    await modify;

    expect((await search(service, "late old")).paths).toEqual([]);
    expect((await search(service, "renamed fresh", 2)).paths).toEqual([
      newFile.path,
    ]);
  });

  it("removes a path that becomes hidden and isolates a single read failure", async () => {
    const vault = new FakeVault();
    const visible = vault.add("Visible.md", "visible token");
    const broken = vault.add("Broken.md", "broken token");
    const superstate = makeSuperstate([visible.path, broken.path]);
    const { service } = makeService(vault, superstate);
    await build(service, superstate);

    superstate.pathsIndex.set(
      visible.path,
      pathState(visible.path, { hidden: true })
    );
    await superstate.eventsDispatcher.dispatchEvent("pathStateUpdated", {
      path: visible.path,
    });
    vault.bodies.set(broken.path, () => Promise.reject(new Error("read failed")));
    await vault.emit("modify", broken);

    expect(service.getSnapshot().status).toBe("ready");
    expect((await search(service, "visible")).paths).toEqual([]);
  });

  it("becomes unavailable on worker failure instead of scanning on the main thread", async () => {
    const vault = new FakeVault();
    const file = vault.add("Failure.md", "body token");
    const superstate = makeSuperstate([file.path]);
    const worker = new RuntimeWorker();
    worker.postMessage = () => {
      queueMicrotask(() => worker.onerror?.({} as ErrorEvent));
    };
    const { service } = makeService(vault, superstate, worker);

    service.start();
    await superstate.eventsDispatcher.dispatchEvent("superstateUpdated", null);

    expect(service.getSnapshot().status).toBe("unavailable");
    const readsBeforeQuery = vault.readCount;
    expect((await search(service, "token")).paths).toEqual([]);
    await vault.emit("modify", file);
    expect(vault.readCount).toBe(readsBeforeQuery);
  });

  it("publishes a new revision so an active query can discard and refresh stale results", async () => {
    const vault = new FakeVault();
    const file = vault.add("Refresh.md", "old token");
    const superstate = makeSuperstate([file.path]);
    const worker = new RuntimeWorker(true);
    const { service } = makeService(vault, superstate, worker);
    await build(service, superstate);

    const oldRevision = service.getSnapshot().revision;
    const staleResult = search(service, "old token");
    await tick();
    vault.bodies.set(file.path, "new token");
    await vault.emit("modify", file);
    expect(service.getSnapshot().revision).toBeGreaterThan(oldRevision);

    worker.releaseQuery();
    expect((await staleResult).revision).toBe(oldRevision);
    const refreshed = search(service, "new token", 2);
    await tick();
    worker.releaseQuery();
    expect((await refreshed).paths).toEqual([file.path]);
  });

  it("performs zero vault reads while querying", async () => {
    const vault = new FakeVault();
    const file = vault.add("NoRead.md", "query token");
    const superstate = makeSuperstate([file.path]);
    const { service } = makeService(vault, superstate);
    await build(service, superstate);
    const readsAfterBuild = vault.readCount;

    await search(service, "query token");
    await search(service, "missing", 2);

    expect(vault.readCount).toBe(readsAfterBuild);
  });

  it("keeps a 20-query burst to one in-flight plus the final pending query", async () => {
    const vault = new FakeVault();
    const file = vault.add("Burst.md", "final token");
    const superstate = makeSuperstate([file.path]);
    const worker = new RuntimeWorker(true);
    const { service } = makeService(vault, superstate, worker);
    await build(service, superstate);

    const promises = [search(service, "query 0", 1)];
    await tick();
    for (let index = 1; index < 20; index++) {
      promises.push(search(service, index === 19 ? "final token" : `query ${index}`, index + 1));
    }
    expect(worker.messages.filter((message) => message.type === "query")).toHaveLength(1);

    worker.releaseQuery();
    await tick();
    expect(worker.messages.filter((message) => message.type === "query")).toHaveLength(2);
    worker.releaseQuery();

    const results = await Promise.all(promises);
    expect(results.slice(1, -1).every((result) => result.cancelled)).toBe(true);
    expect(results.at(-1)?.paths).toEqual([file.path]);
  });

  it("does nothing when the kill-switch is off", () => {
    const vault = new FakeVault();
    vault.add("Off.md", "body");
    const superstate = makeSuperstate(["Off.md"]);
    superstate.settings.enableNavigatorTextFilter = false;
    let workers = 0;
    const service = new NavigatorContentSearchService({
      vault,
      superstate,
      createWorker: () => {
        workers += 1;
        return new RuntimeWorker();
      },
    });

    service.start();

    expect(workers).toBe(0);
    expect(vault.readCount).toBe(0);
  });

  it("builds immediately when enabled after Superstate is already initialized", async () => {
    const vault = new FakeVault();
    const file = vault.add("EnabledLater.md", "enabled later token");
    const superstate = makeSuperstate([file.path]);
    superstate.initialized = true;
    const { service } = makeService(vault, superstate);

    service.start();
    await tick();
    await tick();

    expect(service.getSnapshot().status).toBe("ready");
    expect((await search(service, "enabled later")).paths).toEqual([file.path]);
  });

  it("constructs once, stops on OFF, and constructs afresh on ON", () => {
    const instances: Array<{ start: jest.Mock; stop: jest.Mock }> = [];
    const factory = () => {
      const instance = { start: jest.fn(), stop: jest.fn() };
      instances.push(instance);
      return instance;
    };

    let current = reconcileNavigatorContentSearchLifecycle(true, null, factory);
    current = reconcileNavigatorContentSearchLifecycle(true, current, factory);
    expect(instances).toHaveLength(1);
    expect(instances[0].start).toHaveBeenCalledTimes(1);

    current = reconcileNavigatorContentSearchLifecycle(false, current, factory);
    expect(current).toBeNull();
    expect(instances[0].stop).toHaveBeenCalledTimes(1);

    current = reconcileNavigatorContentSearchLifecycle(true, current, factory);
    expect(instances).toHaveLength(2);
    expect(instances[1].start).toHaveBeenCalledTimes(1);
  });
});
