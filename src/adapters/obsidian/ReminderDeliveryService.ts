import {
  ReminderFiredState,
  ReminderDeliveryIdentity,
} from "adapters/mdb/ReminderFiredStateStore";
import {
  expandDueReminderOccurrences,
  parseReminderSchedule,
  ReminderSchedule,
} from "core/utils/date-reminders/schedule";
import { SuperstateEvent } from "shared/types/PathState";
import { EventDispatcher } from "shared/utils/dispatchers/dispatcher";

export const REMINDER_SCAN_INTERVAL_MS = 60_000;
export const MAX_REMINDER_OCCURRENCES_PER_SCAN = 1_000;
export const MAX_INDIVIDUAL_REMINDER_NOTICES = 10;

type ReminderPathState = {
  type?: string;
  subtype?: string;
  hidden?: boolean;
  metadata?: { property?: Record<string, unknown> };
};

export interface ReminderCandidateIndex {
  entries(): IterableIterator<[string, ReminderPathState]>;
  get(path: string): ReminderPathState | undefined;
}

type ReminderDeliveryServiceOptions = {
  index: ReminderCandidateIndex;
  events: EventDispatcher<SuperstateEvent>;
  store: ReminderFiredState;
  now: () => number;
  notify: (message: string) => void;
  diagnostic: (error: unknown) => void;
  registerInterval: (callback: () => void, intervalMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
  isIndexReady?: () => boolean;
};

type Candidate = {
  path: string;
  schedule: ReminderSchedule;
  generation: number;
};

type CollectedIdentity = ReminderDeliveryIdentity & {
  reminderAtMs: number;
  generation: number;
};

type OccurrenceCursor = {
  fingerprint: string;
  generation: number;
  afterOccurrenceStartMs: number;
};

type RenameRedirect = {
  newPath: string;
  completion: Promise<void>;
};

const deliveryIdentityKey = (identity: ReminderDeliveryIdentity) =>
  JSON.stringify([
    identity.path,
    identity.occurrenceStartMs,
    identity.fingerprint,
  ]);

export const reconcileReminderDeliveryLifecycle = async <
  T extends { start(): Promise<void>; stop(): Promise<void> },
>(
  enabled: boolean,
  current: T | null,
  create: () => T,
): Promise<T | null> => {
  if (enabled) {
    if (current) return current;
    const service = create();
    await service.start();
    return service;
  }
  await current?.stop();
  return null;
};

export class ReminderDeliveryLifecycleController<
  T extends { start(): Promise<void>; stop(): Promise<void> },
> {
  private current: T | null = null;
  private queue: Promise<void> = Promise.resolve();
  private shutdownStarted = false;

  constructor(private readonly create: () => T) {}

  reconcile(enabled: boolean): Promise<void> {
    const result = this.queue.then(async () => {
      this.current = await reconcileReminderDeliveryLifecycle(
        enabled && !this.shutdownStarted,
        this.current,
        this.create,
      );
    });
    this.queue = result.catch((): void => undefined);
    return result;
  }

  getCurrent(): T | null {
    return this.current;
  }

  shutdown(reportError: (error: unknown) => void): void {
    if (this.shutdownStarted) return;
    this.shutdownStarted = true;
    void this.reconcile(false).catch((error) => {
      try {
        reportError(error);
      } catch (_diagnosticError) {
        // Host unload is synchronous; never leak a rejected cleanup promise.
      }
    });
  }
}

export class ReminderDeliveryService {
  private readonly candidates = new Map<string, Candidate>();
  private readonly listeners: Array<
    [keyof SuperstateEvent, (payload: any) => void | Promise<void>]
  > = [];
  private started = false;
  private stopped = false;
  private seeded = false;
  private storageFailed = false;
  private deliveryFailed = false;
  private warned = false;
  private diagnosticReported = false;
  private intervalHandle: unknown = null;
  private scanPromise: Promise<void> | null = null;
  private scanCursorPath: string | null = null;
  private nextGeneration = 1;
  private readonly pathGenerations = new Map<string, number>();
  private readonly occurrenceCursors = new Map<string, OccurrenceCursor>();
  private readonly renameRedirects = new Map<string, RenameRedirect>();

  constructor(private readonly options: ReminderDeliveryServiceOptions) {}

  async start(): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    try {
      await this.options.store.open();
    } catch (error) {
      this.failStorage(error);
      return;
    }
    this.registerEvents();
    this.intervalHandle = this.options.registerInterval(
      () => {
        void this.scanNow().catch((error) => this.failDelivery(error));
      },
      REMINDER_SCAN_INTERVAL_MS,
    );
    if (this.options.isIndexReady?.()) {
      await this.seedAndScan();
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.started = false;
    for (const [event, listener] of this.listeners) {
      this.options.events.removeListener(event as any, listener as any);
    }
    this.listeners.length = 0;
    if (this.intervalHandle !== null) {
      this.options.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    await this.scanPromise;
    this.candidates.clear();
    try {
      await this.options.store.close();
    } catch (error) {
      this.failStorage(error);
    }
  }

  scanNow(): Promise<void> {
    if (
      !this.started ||
      this.stopped ||
      !this.seeded ||
      this.storageFailed ||
      this.deliveryFailed
    ) {
      return Promise.resolve();
    }
    if (this.scanPromise) return this.scanPromise;
    const scan = this.executeScan().catch((error) => this.failDelivery(error));
    const wrapped = scan.finally(() => {
      this.renameRedirects.clear();
      if (this.scanPromise === wrapped) this.scanPromise = null;
    });
    this.scanPromise = wrapped;
    return wrapped;
  }

  private registerEvents(): void {
    this.addListener("superstateUpdated", () => this.seedAndScan());
    this.addListener("pathStateUpdated", ({ path }) =>
      this.reconcilePath(path, false),
    );
    this.addListener("pathCreated", ({ path }) =>
      this.reconcilePath(path, false),
    );
    this.addListener("pathDeleted", ({ path }) => this.deletePath(path));
    this.addListener("pathChanged", ({ path, newPath }) =>
      this.renamePath(path, newPath),
    );
  }

  private addListener<K extends keyof SuperstateEvent>(
    event: K,
    listener: (payload: SuperstateEvent[K]) => void | Promise<void>,
  ): void {
    this.options.events.addListener(event, listener);
    this.listeners.push([event, listener]);
  }

  private async seedAndScan(): Promise<void> {
    if (this.stopped || this.storageFailed) return;
    const previousCandidates = new Map(this.candidates);
    const nextCandidates = new Map<string, Candidate>();
    const fingerprints = new Map<string, string>();
    for (const [path] of this.options.index.entries()) {
      const candidate = this.candidateFor(path);
      if (!candidate) continue;
      const previous = previousCandidates.get(path);
      if (previous?.schedule.fingerprint === candidate.schedule.fingerprint) {
        candidate.generation = previous.generation;
      } else {
        candidate.generation = this.bumpPath(path);
        this.occurrenceCursors.delete(path);
      }
      nextCandidates.set(path, candidate);
      fingerprints.set(path, candidate.schedule.fingerprint);
    }
    this.candidates.clear();
    for (const [path, candidate] of nextCandidates) {
      this.candidates.set(path, candidate);
    }
    for (const path of Array.from(this.pathGenerations.keys())) {
      if (!nextCandidates.has(path)) {
        this.pathGenerations.delete(path);
        this.occurrenceCursors.delete(path);
      }
    }
    try {
      await this.options.store.reconcileCandidates(fingerprints);
    } catch (error) {
      this.failStorage(error);
      return;
    }
    this.seeded = true;
    await this.scanNow();
  }

  private candidateFor(path: string): Candidate | null {
    const state = this.options.index.get(path);
    if (
      !state ||
      state.hidden ||
      state.type !== "file" ||
      state.subtype !== "md"
    )
      return null;
    const schedule = parseReminderSchedule(state.metadata?.property);
    return schedule
      ? { path, schedule, generation: this.pathGenerations.get(path) ?? 0 }
      : null;
  }

  private async reconcilePath(path: string, forceInvalidation: boolean): Promise<void> {
    if (this.stopped || this.storageFailed) return;
    const previous = this.candidates.get(path);
    const next = this.candidateFor(path);
    const nextFingerprint = next?.schedule.fingerprint ?? null;
    const scheduleChanged =
      (previous?.schedule.fingerprint ?? null) !== nextFingerprint;
    if (scheduleChanged || forceInvalidation) {
      const generation = this.bumpPath(path);
      if (next) next.generation = generation;
      this.occurrenceCursors.delete(path);
    }
    if (next) {
      this.candidates.set(path, next);
    } else {
      this.candidates.delete(path);
      this.pathGenerations.delete(path);
    }
    if (
      forceInvalidation ||
      scheduleChanged
    ) {
      try {
        await this.options.store.invalidateSchedule(path, nextFingerprint);
      } catch (error) {
        this.failStorage(error);
      }
    }
  }

  private async deletePath(path: string): Promise<void> {
    this.bumpPath(path);
    this.candidates.delete(path);
    this.pathGenerations.delete(path);
    this.occurrenceCursors.delete(path);
    if (this.storageFailed) return;
    try {
      await this.options.store.deletePath(path);
    } catch (error) {
      this.failStorage(error);
    }
  }

  private async renamePath(oldPath: string, newPath: string): Promise<void> {
    const previous = this.candidates.get(oldPath);
    const previousCursor = this.occurrenceCursors.get(oldPath);
    this.bumpPath(oldPath);
    this.bumpPath(newPath);
    this.candidates.delete(oldPath);
    this.pathGenerations.delete(oldPath);
    this.occurrenceCursors.delete(oldPath);
    this.occurrenceCursors.delete(newPath);
    if (this.storageFailed) return;
    let completeRename!: () => void;
    const completion = new Promise<void>((resolve) => {
      completeRename = resolve;
    });
    this.renameRedirects.set(oldPath, { newPath, completion });
    try {
      await this.options.store.renamePath(oldPath, newPath);
      const next = this.candidateFor(newPath);
      if (next) {
        this.candidates.set(newPath, next);
        if (
          previousCursor &&
          previous?.schedule.fingerprint === next.schedule.fingerprint &&
          previousCursor.fingerprint === next.schedule.fingerprint
        ) {
          this.occurrenceCursors.set(newPath, {
            ...previousCursor,
            generation: next.generation,
          });
        }
      } else {
        this.pathGenerations.delete(newPath);
      }
      if (
        (previous?.schedule.fingerprint ?? null) !==
        (next?.schedule.fingerprint ?? null)
      ) {
        await this.options.store.invalidateSchedule(
          newPath,
          next?.schedule.fingerprint ?? null,
        );
      }
    } catch (error) {
      this.failStorage(error);
    } finally {
      completeRename();
    }
  }

  private async executeScan(): Promise<void> {
    const now = new Date(this.options.now());
    const identities: CollectedIdentity[] = [];
    const sortedCandidates = Array.from(this.candidates.values()).sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    const startIndex = this.scanCursorPath === null
      ? 0
      : Math.max(
          0,
          sortedCandidates.findIndex(
            (candidate) => candidate.path.localeCompare(this.scanCursorPath!) > 0,
          ),
        );
    const candidates = sortedCandidates.length === 0
      ? []
      : [
          ...sortedCandidates.slice(startIndex),
          ...sortedCandidates.slice(0, startIndex),
        ];
    for (const candidate of candidates) {
      const remaining = MAX_REMINDER_OCCURRENCES_PER_SCAN - identities.length;
      if (remaining <= 0) break;
      const cursor = this.occurrenceCursors.get(candidate.path);
      const occurrences = expandDueReminderOccurrences(candidate.schedule, now, {
        afterOccurrenceStartMs:
          cursor &&
          cursor.fingerprint === candidate.schedule.fingerprint &&
          cursor.generation === candidate.generation
            ? cursor.afterOccurrenceStartMs
            : undefined,
        maxOccurrences: remaining,
      });
      for (const occurrence of occurrences) {
        identities.push({
          path: candidate.path,
          occurrenceStartMs: occurrence.occurrenceStartMs,
          fingerprint: candidate.schedule.fingerprint,
          reminderAtMs: occurrence.reminderAtMs,
          generation: candidate.generation,
        });
      }
      this.scanCursorPath = candidate.path;
      if (identities.length >= MAX_REMINDER_OCCURRENCES_PER_SCAN) break;
    }

    const currentIdentities = identities.filter((identity) =>
      this.isCurrent(identity),
    );
    let claimed: CollectedIdentity[] = [];
    try {
      const deliveryIdentities = currentIdentities.map(
        ({ reminderAtMs: _reminderAtMs, generation: _generation, ...identity }) =>
          identity,
      );
      const newlyClaimed = await this.options.store.claimMany(deliveryIdentities);
      const resolvedByKey = new Map<string, CollectedIdentity>();
      for (const identity of currentIdentities) {
        const resolved = await this.resolveCurrentIdentity(identity);
        if (resolved) {
          resolvedByKey.set(deliveryIdentityKey(identity), resolved);
        }
      }
      this.advanceOccurrenceCursors(Array.from(resolvedByKey.values()));
      claimed = newlyClaimed
        .map((identity) => resolvedByKey.get(deliveryIdentityKey(identity)))
        .filter((identity): identity is CollectedIdentity => !!identity);
    } catch (error) {
      this.failStorage(error);
      return;
    }
    if (this.stopped || this.storageFailed) return;

    let individualNotices = 0;
    let overflow = 0;
    for (const identity of claimed) {
      if (!this.isCurrent(identity)) continue;
      if (individualNotices >= MAX_INDIVIDUAL_REMINDER_NOTICES) {
        overflow += 1;
        continue;
      }
      if (!this.notifyReminder(
        `${identity.path} reminder due (${new Date(
          identity.occurrenceStartMs,
        ).toISOString()})`,
      )) return;
      individualNotices += 1;
    }
    if (overflow > 0) {
      this.notifyReminder(
        `${overflow} additional reminder${overflow === 1 ? "" : "s"} were due.`,
      );
    }
  }

  private isCurrent(identity: CollectedIdentity): boolean {
    const candidate = this.candidates.get(identity.path);
    return (
      !!candidate &&
      candidate.generation === identity.generation &&
      candidate.schedule.fingerprint === identity.fingerprint
    );
  }

  private async resolveCurrentIdentity(
    identity: CollectedIdentity,
  ): Promise<CollectedIdentity | null> {
    let path = identity.path;
    const visited = new Set<string>();
    while (!visited.has(path)) {
      visited.add(path);
      const candidate = this.candidates.get(path);
      if (
        candidate &&
        candidate.schedule.fingerprint === identity.fingerprint &&
        (path !== identity.path || candidate.generation === identity.generation)
      ) {
        return {
          ...identity,
          path,
          generation: candidate.generation,
        };
      }
      const redirect = this.renameRedirects.get(path);
      if (!redirect) return null;
      await redirect.completion;
      if (this.storageFailed || this.stopped) return null;
      path = redirect.newPath;
    }
    return null;
  }

  private advanceOccurrenceCursors(identities: readonly CollectedIdentity[]): void {
    for (const identity of identities) {
      if (!this.isCurrent(identity)) continue;
      const current = this.occurrenceCursors.get(identity.path);
      if (
        !current ||
        current.fingerprint !== identity.fingerprint ||
        current.generation !== identity.generation ||
        identity.occurrenceStartMs > current.afterOccurrenceStartMs
      ) {
        this.occurrenceCursors.set(identity.path, {
          fingerprint: identity.fingerprint,
          generation: identity.generation,
          afterOccurrenceStartMs: identity.occurrenceStartMs,
        });
      }
    }
  }

  private bumpPath(path: string): number {
    const generation = this.nextGeneration;
    this.nextGeneration += 1;
    this.pathGenerations.set(path, generation);
    return generation;
  }

  private notifyReminder(message: string): boolean {
    try {
      this.options.notify(message);
      return true;
    } catch (error) {
      this.failDelivery(error);
      return false;
    }
  }

  private attemptWarning(message: string): void {
    if (this.warned) return;
    this.warned = true;
    try {
      this.options.notify(message);
    } catch (_error) {
      // The notifier itself is unavailable; never recurse or emit another
      // diagnostic while attempting the one bounded session warning.
    }
  }

  private reportDiagnostic(error: unknown): void {
    if (this.diagnosticReported) return;
    this.diagnosticReported = true;
    try {
      this.options.diagnostic(error);
    } catch (_diagnosticError) {
      // Diagnostics must not become an unhandled delivery failure.
    }
  }

  private failStorage(error: unknown): void {
    if (this.storageFailed) return;
    this.storageFailed = true;
    this.reportDiagnostic(error);
    this.attemptWarning(
      "Notidian reminders are paused because fired-state storage is unavailable.",
    );
  }

  private failDelivery(error: unknown): void {
    if (this.deliveryFailed) return;
    this.deliveryFailed = true;
    this.reportDiagnostic(error);
    this.attemptWarning(
      "Notidian reminders are paused because reminder delivery failed.",
    );
  }
}
