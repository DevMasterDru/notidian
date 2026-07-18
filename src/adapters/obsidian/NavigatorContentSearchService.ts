import { normalizeNavigatorContentText } from "core/superstate/workers/navigatorContentSearch/impl";
import { PathState, SuperstateEvent } from "shared/types/PathState";
import {
  INavigatorContentSearch,
  NavigatorContentSearchRequest,
  NavigatorContentSearchResult,
  NavigatorContentSearchSnapshot,
  NavigatorContentWorkerFactory,
  NavigatorContentWorkerPort,
  NavigatorContentWorkerRequest,
  NavigatorContentWorkerResponse,
} from "shared/types/navigatorContentSearch";
import { EventDispatcher } from "shared/utils/dispatchers/dispatcher";

export type NavigatorContentFile = {
  path: string;
  extension?: string;
};

export interface NavigatorContentVault {
  cachedRead(file: NavigatorContentFile): Promise<string>;
  getAbstractFileByPath(path: string): NavigatorContentFile | null;
  on(event: string, callback: (...args: any[]) => unknown): object;
  offref(ref: any): void;
}

type NavigatorContentSuperstate = {
  initialized: boolean;
  settings: { enableNavigatorTextFilter: boolean };
  pathsIndex: Map<string, PathState>;
  eventsDispatcher: EventDispatcher<SuperstateEvent>;
};

type NavigatorContentSearchServiceOptions = {
  vault: NavigatorContentVault;
  superstate: NavigatorContentSuperstate;
  createWorker: NavigatorContentWorkerFactory;
  registerVaultEvent?: (ref: object) => void;
};

type PendingMutation = {
  resolve: (revision: number) => void;
  reject: (error: Error) => void;
};

type ReadTask = {
  path: string;
  generation: number;
  resolve: () => void;
};

type PendingQuery = {
  request: NavigatorContentSearchRequest;
  normalizedQuery: string;
  posted: boolean;
  resolve: (result: NavigatorContentSearchResult) => void;
};

const MAX_CONCURRENT_READS = 4;

export const reconcileNavigatorContentSearchLifecycle = <
  T extends { start(): void; stop(): void }
>(
  enabled: boolean,
  current: T | null,
  create: () => T
): T | null => {
  if (enabled) {
    if (current) return current;
    const service = create();
    service.start();
    return service;
  }
  current?.stop();
  return null;
};

export class NavigatorContentSearchService
  implements INavigatorContentSearch
{
  private snapshot: NavigatorContentSearchSnapshot = {
    status: "building",
    revision: 0,
  };
  private readonly subscribers = new Set<
    (snapshot: NavigatorContentSearchSnapshot) => void
  >();
  private worker: NavigatorContentWorkerPort | null = null;
  private started = false;
  private stopped = false;
  private vaultEventRefs: object[] = [];
  private readonly superstateListeners: Array<
    [keyof SuperstateEvent, (payload: any) => void | Promise<void>]
  > = [];

  private nextWorkerGeneration = 0;
  private pendingMutations = new Map<number, PendingMutation>();
  private mutationQueue: Promise<void> = Promise.resolve();
  private pathGenerations = new Map<string, number>();
  private indexedPaths = new Set<string>();
  private pendingCreates = new Set<string>();
  private readQueue: ReadTask[] = [];
  private activeReadCount = 0;
  private pendingReads = new Set<Promise<void>>();
  private reconciliationGeneration = 0;
  private needsReset = true;

  private activeQuery: PendingQuery | null = null;
  private latestPendingQuery: PendingQuery | null = null;

  constructor(private readonly options: NavigatorContentSearchServiceOptions) {}

  getSnapshot(): NavigatorContentSearchSnapshot {
    return this.snapshot;
  }

  subscribe(
    listener: (snapshot: NavigatorContentSearchSnapshot) => void
  ): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  start(): void {
    if (this.started || !this.options.superstate.settings.enableNavigatorTextFilter)
      return;
    this.started = true;
    this.stopped = false;

    try {
      this.worker = this.options.createWorker();
      this.worker.onmessage = (event) => this.onWorkerMessage(event.data);
      this.worker.onerror = () => this.failWorker();
    } catch (_error) {
      this.failWorker();
      return;
    }

    this.registerVaultEvents();
    this.registerSuperstateEvents();

    // This path is used when the setting is enabled after startup. The normal
    // plugin load path waits for the canonical superstateUpdated event below.
    if (this.options.superstate.initialized) {
      queueMicrotask(() => void this.reconcileAndBuild());
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.started = false;
    this.reconciliationGeneration += 1;

    for (const [event, listener] of this.superstateListeners) {
      this.options.superstate.eventsDispatcher.removeListener(
        event as any,
        listener as any
      );
    }
    this.superstateListeners.length = 0;
    for (const ref of this.vaultEventRefs) this.options.vault.offref(ref);
    this.vaultEventRefs = [];

    for (const task of this.readQueue.splice(0)) task.resolve();
    for (const path of this.pathGenerations.keys()) this.bumpPath(path);
    this.pendingCreates.clear();
    this.indexedPaths.clear();
    this.cancelQuery(this.activeQuery);
    this.cancelQuery(this.latestPendingQuery);
    this.activeQuery = null;
    this.latestPendingQuery = null;

    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
    const error = new Error("Navigator content search stopped");
    for (const mutation of this.pendingMutations.values()) mutation.reject(error);
    this.pendingMutations.clear();
    this.subscribers.clear();
  }

  search(
    request: NavigatorContentSearchRequest
  ): Promise<NavigatorContentSearchResult> {
    const normalizedQuery = normalizeNavigatorContentText(request.query).trim();
    if (
      normalizedQuery.length === 0 ||
      this.snapshot.status !== "ready" ||
      !this.worker ||
      this.stopped
    ) {
      return Promise.resolve(this.cancelledResult(request, normalizedQuery));
    }

    return new Promise((resolve) => {
      const query: PendingQuery = {
        request,
        normalizedQuery,
        posted: false,
        resolve,
      };
      if (!this.activeQuery) {
        this.activeQuery = query;
        void this.dispatchQueryAfterMutations(query);
        return;
      }

      if (!this.activeQuery.posted) {
        this.cancelQuery(this.activeQuery);
        this.activeQuery = query;
        void this.dispatchQueryAfterMutations(query);
        return;
      }

      this.cancelQuery(this.latestPendingQuery);
      this.latestPendingQuery = query;
    });
  }

  private registerVaultEvents(): void {
    const register = (event: string, callback: (...args: any[]) => unknown) => {
      const ref = this.options.vault.on(event, callback);
      this.vaultEventRefs.push(ref);
      this.options.registerVaultEvent?.(ref);
    };
    register("create", (file: NavigatorContentFile) => this.onRawCreate(file));
    register("modify", (file: NavigatorContentFile) => this.onRawModify(file));
    register("delete", (file: NavigatorContentFile) => this.onRawDelete(file.path));
    register(
      "rename",
      (file: NavigatorContentFile, oldPath: string) =>
        this.onRawRename(file, oldPath)
    );
  }

  private registerSuperstateEvents(): void {
    this.addSuperstateListener("superstateReindex", () => {
      this.reconciliationGeneration += 1;
      this.needsReset = true;
      this.setSnapshot({ status: "building" });
    });
    this.addSuperstateListener("superstateUpdated", () =>
      this.reconcileAndBuild()
    );
    this.addSuperstateListener("pathStateUpdated", ({ path }) =>
      this.onEligibilityChanged(path)
    );
    this.addSuperstateListener("pathCreated", ({ path }) =>
      this.onEligibilityChanged(path)
    );
    this.addSuperstateListener("pathDeleted", ({ path }) =>
      this.removePath(path)
    );
    this.addSuperstateListener("pathChanged", ({ path, newPath }) =>
      this.onDerivedRename(path, newPath)
    );
  }

  private addSuperstateListener<K extends keyof SuperstateEvent>(
    event: K,
    listener: (payload: SuperstateEvent[K]) => void | Promise<void>
  ): void {
    this.options.superstate.eventsDispatcher.addListener(event, listener);
    this.superstateListeners.push([event, listener]);
  }

  private async onRawCreate(file: NavigatorContentFile): Promise<void> {
    this.pendingCreates.add(file.path);
    if (this.isEligible(file.path)) await this.scheduleRead(file.path);
  }

  private async onRawModify(file: NavigatorContentFile): Promise<void> {
    if (!this.isEligible(file.path)) {
      await this.removePath(file.path);
      return;
    }
    await this.scheduleRead(file.path);
  }

  private onRawDelete(path: string): Promise<void> {
    return this.removePath(path);
  }

  private async onRawRename(
    file: NavigatorContentFile,
    oldPath: string
  ): Promise<void> {
    await this.removePath(oldPath);
    this.pendingCreates.add(file.path);
    if (this.isEligible(file.path)) await this.scheduleRead(file.path);
  }

  private async onDerivedRename(
    oldPath: string,
    newPath: string
  ): Promise<void> {
    await this.removePath(oldPath);
    this.pendingCreates.add(newPath);
    if (this.isEligible(newPath)) await this.scheduleRead(newPath);
  }

  private async onEligibilityChanged(path: string): Promise<void> {
    if (!this.isEligible(path)) {
      await this.removePath(path);
      return;
    }
    if (this.pendingCreates.delete(path) || !this.indexedPaths.has(path)) {
      await this.scheduleRead(path);
    }
  }

  private async removePath(path: string): Promise<void> {
    this.bumpPath(path);
    this.pendingCreates.delete(path);
    if (!this.worker || this.stopped || this.snapshot.status === "unavailable") {
      this.indexedPaths.delete(path);
      return;
    }
    try {
      await this.enqueueMutation({ type: "remove", paths: [path] });
      this.indexedPaths.delete(path);
    } catch (_error) {
      // Worker failures are surfaced through the unavailable snapshot.
    }
  }

  private async reconcileAndBuild(): Promise<void> {
    if (!this.worker || this.stopped || this.snapshot.status === "unavailable")
      return;
    const reconciliation = ++this.reconciliationGeneration;
    this.setSnapshot({ status: "building" });
    try {
      if (this.needsReset) {
        await this.enqueueMutation({ type: "reset" });
        this.indexedPaths.clear();
        this.needsReset = false;
      }

      const eligiblePaths = this.eligiblePaths();
      const eligibleSet = new Set(eligiblePaths);
      await this.enqueueMutation({ type: "reconcile", paths: eligiblePaths });
      this.indexedPaths = new Set(
        Array.from(this.indexedPaths).filter((path) => eligibleSet.has(path))
      );

      const reads = eligiblePaths
        .filter((path) => !this.indexedPaths.has(path))
        .map((path) => this.scheduleRead(path));
      await Promise.all(reads);
      await this.drainReads();
      await this.mutationQueue;

      if (
        !this.stopped &&
        reconciliation === this.reconciliationGeneration &&
        this.getSnapshot().status !== "unavailable"
      ) {
        this.setSnapshot({ status: "ready" });
      }
    } catch (_error) {
      if (this.worker) this.failWorker();
    }
  }

  private eligiblePaths(): string[] {
    const paths: string[] = [];
    for (const path of this.options.superstate.pathsIndex.keys()) {
      if (this.isEligible(path)) paths.push(path);
    }
    return paths;
  }

  private isEligible(path: string): boolean {
    const state = this.options.superstate.pathsIndex.get(path);
    if (
      !state ||
      state.hidden ||
      state.type !== "file" ||
      state.subtype !== "md"
    )
      return false;
    const file = this.options.vault.getAbstractFileByPath(path);
    return !!file && file.extension?.toLowerCase() === "md";
  }

  private scheduleRead(path: string): Promise<void> {
    if (!this.worker || this.stopped || this.snapshot.status === "unavailable")
      return Promise.resolve();
    const generation = this.bumpPath(path);
    let resolveTask!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });
    this.pendingReads.add(promise);
    void promise.finally(() => this.pendingReads.delete(promise));
    this.readQueue.push({ path, generation, resolve: resolveTask });
    this.pumpReads();
    return promise;
  }

  private pumpReads(): void {
    while (
      !this.stopped &&
      this.activeReadCount < MAX_CONCURRENT_READS &&
      this.readQueue.length > 0
    ) {
      const task = this.readQueue.shift()!;
      this.activeReadCount += 1;
      void this.executeRead(task).finally(() => {
        this.activeReadCount -= 1;
        task.resolve();
        this.pumpReads();
      });
    }
  }

  private async executeRead(task: ReadTask): Promise<void> {
    if (
      !this.worker ||
      this.snapshot.status === "unavailable" ||
      !this.isCurrent(task.path, task.generation) ||
      !this.isEligible(task.path)
    )
      return;
    const file = this.options.vault.getAbstractFileByPath(task.path);
    if (!file) return;
    try {
      const body = await this.options.vault.cachedRead(file);
      if (
        !this.isCurrent(task.path, task.generation) ||
        !this.isEligible(task.path)
      )
        return;
      await this.enqueueMutation({
        type: "upsert",
        documents: [{ path: task.path, body }],
      });
      if (this.isCurrent(task.path, task.generation) && this.isEligible(task.path)) {
        this.indexedPaths.add(task.path);
        this.pendingCreates.delete(task.path);
      }
    } catch (_error) {
      // A single unreadable note is omitted; no body/query is logged and the
      // name/path filter remains available.
    }
  }

  private async drainReads(): Promise<void> {
    while (this.pendingReads.size > 0) {
      await Promise.all(Array.from(this.pendingReads));
    }
  }

  private bumpPath(path: string): number {
    const generation = (this.pathGenerations.get(path) ?? 0) + 1;
    this.pathGenerations.set(path, generation);
    return generation;
  }

  private isCurrent(path: string, generation: number): boolean {
    return !this.stopped && this.pathGenerations.get(path) === generation;
  }

  private enqueueMutation(
    request:
      | { type: "reset" }
      | { type: "upsert"; documents: { path: string; body: string }[] }
      | { type: "remove"; paths: string[] }
      | { type: "reconcile"; paths: string[] }
  ): Promise<number> {
    const run = () => {
      if (!this.worker || this.stopped || this.snapshot.status === "unavailable")
        throw new Error("Navigator content worker unavailable");
      const generation = ++this.nextWorkerGeneration;
      const message = { ...request, generation } as NavigatorContentWorkerRequest;
      return new Promise<number>((resolve, reject) => {
        this.pendingMutations.set(generation, { resolve, reject });
        try {
          this.worker!.postMessage(message);
        } catch (_error) {
          this.pendingMutations.delete(generation);
          reject(new Error("Navigator content worker operation failed"));
          this.failWorker();
        }
      });
    };

    const result = this.mutationQueue.then(run);
    this.mutationQueue = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  }

  private onWorkerMessage(response: NavigatorContentWorkerResponse): void {
    if (this.stopped) return;
    if (response.type === "mutation") {
      const pending = this.pendingMutations.get(response.generation);
      if (!pending) return;
      this.pendingMutations.delete(response.generation);
      this.setSnapshot({ revision: response.revision });
      pending.resolve(response.revision);
      return;
    }
    if (response.type === "result") {
      const active = this.activeQuery;
      if (!active || active.request.requestId !== response.requestId) return;
      active.resolve(response);
      this.activeQuery = null;
      const pending = this.latestPendingQuery;
      this.latestPendingQuery = null;
      if (pending) {
        this.activeQuery = pending;
        void this.dispatchQueryAfterMutations(pending);
      }
      return;
    }
    if (response.type === "error") this.failWorker();
  }

  private async dispatchQueryAfterMutations(query: PendingQuery): Promise<void> {
    await this.mutationQueue;
    if (this.activeQuery !== query || this.stopped) return;
    if (
      !this.worker ||
      this.snapshot.status !== "ready" ||
      query.request.revision !== this.snapshot.revision
    ) {
      this.cancelQuery(query);
      if (this.activeQuery === query) this.activeQuery = null;
      return;
    }
    query.posted = true;
    try {
      this.worker.postMessage({
        type: "query",
        requestId: query.request.requestId,
        query: query.normalizedQuery,
        revision: query.request.revision,
      });
    } catch (_error) {
      this.failWorker();
    }
  }

  private cancelQuery(query: PendingQuery | null): void {
    if (!query) return;
    query.resolve(this.cancelledResult(query.request, query.normalizedQuery));
  }

  private cancelledResult(
    request: NavigatorContentSearchRequest,
    normalizedQuery: string
  ): NavigatorContentSearchResult {
    return {
      requestId: request.requestId,
      query: normalizedQuery,
      requestedRevision: request.revision,
      revision: this.snapshot.revision,
      paths: [],
      cancelled: true,
    };
  }

  private failWorker(): void {
    if (this.snapshot.status === "unavailable") return;
    this.setSnapshot({ status: "unavailable" });
    const error = new Error("Navigator content worker unavailable");
    for (const mutation of this.pendingMutations.values()) mutation.reject(error);
    this.pendingMutations.clear();
    this.cancelQuery(this.activeQuery);
    this.cancelQuery(this.latestPendingQuery);
    this.activeQuery = null;
    this.latestPendingQuery = null;
    this.worker?.terminate();
    this.worker = null;
  }

  private setSnapshot(
    update: Partial<NavigatorContentSearchSnapshot>
  ): void {
    const next = { ...this.snapshot, ...update };
    if (
      next.status === this.snapshot.status &&
      next.revision === this.snapshot.revision
    )
      return;
    this.snapshot = next;
    for (const subscriber of this.subscribers) subscriber(this.snapshot);
  }
}
