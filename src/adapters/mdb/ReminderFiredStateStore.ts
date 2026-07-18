export const REMINDER_STATE_PATH = ".notidian/reminder-state.mdc";
export const REMINDER_STATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_REMINDER_STATE_RECORDS = 50_000;

export interface ReminderStateFileIO {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
}

export interface ReminderStateVaultAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  process?(
    path: string,
    update: (current: string) => string,
  ): Promise<string>;
}

export class ObsidianReminderStateFileIO implements ReminderStateFileIO {
  constructor(private readonly adapter: ReminderStateVaultAdapter) {}

  async read(path: string): Promise<string | null> {
    return (await this.adapter.exists(path)) ? this.adapter.read(path) : null;
  }

  async write(path: string, content: string): Promise<void> {
    if (!(await this.adapter.exists(".notidian"))) {
      await this.adapter.mkdir(".notidian");
    }
    if (
      (await this.adapter.exists(path)) &&
      typeof this.adapter.process === "function"
    ) {
      await this.adapter.process(path, () => content);
      return;
    }
    await this.adapter.write(path, content);
  }
}

export type ReminderDeliveryIdentity = {
  path: string;
  occurrenceStartMs: number;
  fingerprint: string;
};

type FiredRecord = ReminderDeliveryIdentity & { firedAtMs: number };
type PersistedState = { version: 1; records: FiredRecord[] };

type ReminderFiredStateStoreOptions = {
  retentionMs?: number;
  maxRecords?: number;
};

const identityKey = ({
  path,
  occurrenceStartMs,
  fingerprint,
}: ReminderDeliveryIdentity) =>
  JSON.stringify([path, occurrenceStartMs, fingerprint]);

const isFiredRecord = (value: unknown): value is FiredRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) =>
      ["path", "occurrenceStartMs", "fingerprint", "firedAtMs"].includes(key),
    ) &&
    typeof record.path === "string" &&
    Number.isFinite(record.occurrenceStartMs) &&
    typeof record.fingerprint === "string" &&
    Number.isFinite(record.firedAtMs)
  );
};

export interface ReminderFiredState {
  open(): Promise<void>;
  claim(identity: ReminderDeliveryIdentity): Promise<boolean>;
  claimMany(
    identities: readonly ReminderDeliveryIdentity[],
  ): Promise<ReminderDeliveryIdentity[]>;
  reconcileCandidates(candidates: ReadonlyMap<string, string>): Promise<void>;
  deletePath(path: string): Promise<void>;
  renamePath(oldPath: string, newPath: string): Promise<void>;
  invalidateSchedule(path: string, fingerprint: string | null): Promise<void>;
  prune(): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export class ReminderFiredStateStore implements ReminderFiredState {
  private records = new Map<string, FiredRecord>();
  private queue: Promise<void> = Promise.resolve();
  private opened = false;
  private closed = false;
  private readonly retentionMs: number;
  private readonly maxRecords: number;

  constructor(
    private readonly io: ReminderStateFileIO,
    private readonly now: () => number = Date.now,
    options: ReminderFiredStateStoreOptions = {},
  ) {
    this.retentionMs = options.retentionMs ?? REMINDER_STATE_RETENTION_MS;
    this.maxRecords = options.maxRecords ?? MAX_REMINDER_STATE_RECORDS;
  }

  async open(): Promise<void> {
    if (this.opened) return;
    if (this.closed) throw new Error("Reminder fired state is closed");
    const raw = await this.io.read(REMINDER_STATE_PATH);
    if (raw !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (_error) {
        throw new Error("Invalid reminder fired state");
      }
      if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as PersistedState).version !== 1 ||
        !Array.isArray((parsed as PersistedState).records) ||
        !(parsed as PersistedState).records.every(isFiredRecord)
      ) {
        throw new Error("Invalid reminder fired state");
      }
      this.records = new Map(
        (parsed as PersistedState).records.map((record) => [
          identityKey(record),
          record,
        ]),
      );
    }
    this.opened = true;
  }

  async claim(identity: ReminderDeliveryIdentity): Promise<boolean> {
    return (await this.claimMany([identity])).length === 1;
  }

  async claimMany(
    identities: readonly ReminderDeliveryIdentity[],
  ): Promise<ReminderDeliveryIdentity[]> {
    this.assertUsable();
    return this.enqueue(async () => {
      const next = new Map(this.records);
      const newlyClaimed: ReminderDeliveryIdentity[] = [];
      const firedAtMs = this.now();
      for (const identity of identities) {
        const key = identityKey(identity);
        if (next.has(key)) continue;
        next.set(key, { ...identity, firedAtMs });
        newlyClaimed.push(identity);
      }
      this.pruneMap(next);
      if (this.sameRecords(next, this.records)) return [];
      await this.persist(next);
      this.records = next;
      return newlyClaimed.filter((identity) => next.has(identityKey(identity)));
    });
  }

  reconcileCandidates(candidates: ReadonlyMap<string, string>): Promise<void> {
    return this.mutate((next) => {
      for (const [key, record] of next) {
        if (candidates.get(record.path) !== record.fingerprint) {
          next.delete(key);
        }
      }
      this.pruneMap(next);
    });
  }

  deletePath(path: string): Promise<void> {
    return this.mutate((next) => {
      for (const [key, record] of next) {
        if (record.path === path) next.delete(key);
      }
    });
  }

  renamePath(oldPath: string, newPath: string): Promise<void> {
    return this.mutate((next) => {
      const moved: FiredRecord[] = [];
      for (const [key, record] of next) {
        if (record.path !== oldPath) continue;
        next.delete(key);
        moved.push({ ...record, path: newPath });
      }
      for (const record of moved) {
        const key = identityKey(record);
        const existing = next.get(key);
        if (!existing || record.firedAtMs < existing.firedAtMs) {
          next.set(key, record);
        }
      }
    });
  }

  invalidateSchedule(path: string, fingerprint: string | null): Promise<void> {
    return this.mutate((next) => {
      for (const [key, record] of next) {
        if (record.path === path && record.fingerprint !== fingerprint) {
          next.delete(key);
        }
      }
    });
  }

  prune(): Promise<void> {
    return this.mutate((next) => this.pruneMap(next));
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.flush();
  }

  private mutate(update: (next: Map<string, FiredRecord>) => void): Promise<void> {
    this.assertUsable();
    return this.enqueue(async () => {
      const next = new Map(this.records);
      update(next);
      if (this.sameRecords(next, this.records)) return;
      await this.persist(next);
      this.records = next;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      (): void => undefined,
      (): void => undefined,
    );
    return result;
  }

  private pruneMap(records: Map<string, FiredRecord>): void {
    const cutoff = this.now() - this.retentionMs;
    for (const [key, record] of records) {
      if (record.firedAtMs < cutoff) records.delete(key);
    }
    if (records.size <= this.maxRecords) return;
    const oldest = Array.from(records.entries()).sort(
      ([, left], [, right]) => left.firedAtMs - right.firedAtMs,
    );
    for (let index = 0; index < oldest.length - this.maxRecords; index += 1) {
      records.delete(oldest[index][0]);
    }
  }

  private persist(records: Map<string, FiredRecord>): Promise<void> {
    const state: PersistedState = {
      version: 1,
      records: Array.from(records.values()).sort(
        (left, right) => left.firedAtMs - right.firedAtMs,
      ),
    };
    return this.io.write(REMINDER_STATE_PATH, JSON.stringify(state));
  }

  private sameRecords(
    left: Map<string, FiredRecord>,
    right: Map<string, FiredRecord>,
  ): boolean {
    if (left.size !== right.size) return false;
    for (const [key, value] of left) {
      if (right.get(key) !== value) return false;
    }
    return true;
  }

  private assertUsable(): void {
    if (!this.opened) throw new Error("Reminder fired state is not open");
    if (this.closed) throw new Error("Reminder fired state is closed");
  }
}
