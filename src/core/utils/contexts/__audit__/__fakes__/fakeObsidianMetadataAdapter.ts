/**
 * A narrow fake Obsidian adapter that models the parts of Obsidian's runtime
 * the write bridge actually depends on, with the timing that production code
 * must survive but unit tests usually paper over:
 *
 *  1. processFrontMatter timing — a frontmatter save writes the file content
 *     synchronously, but the value the bridge READS back (via pathsIndex /
 *     metadataCache) lags by N "metadata ticks", modeling Obsidian's async
 *     `metadataCache.changed` event. Until the lag settles, a read of the path
 *     returns the PRE-save value, exactly the window in which the audit-w
 *     conflict gate must not mistake metadata lag for an external edit.
 *
 *  2. metadataCache.changed ordering — an external edit (someone else / another
 *     surface writing the file) can land in the cache before OR after our own
 *     save settles. `externalEdit()` updates both file and cache immediately,
 *     so a save scheduled before it observes the cache change on settle.
 *
 *  3. rename side effects — renamePath moves the file on disk AND, after the
 *     same metadata lag, updates the path key inside the cache, the paths index
 *     and the context table rows. A configurable `renameFails` set models the
 *     Obsidian adapter's "resolve null on failure" mode (bd Notidian-lrf/79s).
 *
 * It exposes a `superstate`-shaped facade so the REAL bridge functions
 * (executeBulkPageTitleRename, executeTableValueWrites, saveFrontmatterProperties)
 * run against it unmodified — no React provider required. testEnvironment is
 * "node", so there is no jsdom/window; timing is driven by an explicit
 * `settle()` pump rather than real timers.
 */
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTable } from "shared/types/mdb";

export type FakeFile = {
  /** The live, on-disk frontmatter (what processFrontMatter mutates). */
  frontmatter: Record<string, unknown>;
};

type PendingMetadataUpdate = {
  ticksRemaining: number;
  apply: () => void;
};

export type FakeObsidianAdapterOptions = {
  /**
   * How many `settle()` pumps a frontmatter save / rename takes before the
   * metadata cache (the bridge's read surface) reflects it. 0 = synchronous
   * (no lag); >=1 models real Obsidian async metadata propagation.
   */
  metadataLagTicks?: number;
  /** Paths whose rename resolves null (failure), modeling the adapter mode. */
  renameFails?: Set<string>;
  /** Paths that already exist on disk (so a rename target collides). */
  existingPaths?: Iterable<string>;
};

export class FakeObsidianMetadataAdapter {
  /** Source of truth for file contents (what a save mutates immediately). */
  readonly files = new Map<string, FakeFile>();
  /** Lagged read surface — pathsIndex/metadataCache reads come from here. */
  readonly cache = new Map<string, Record<string, unknown>>();
  /** The Notidian context table (row projection), keyed by context path. */
  readonly contextTables = new Map<string, SpaceTable>();

  readonly notifications: string[] = [];
  readonly saveTableCalls: { contextPath: string; rows: DBRow[] }[] = [];
  /** Ordered log of cache mutations for ordering assertions. */
  readonly cacheLog: { path: string; column: string; value: unknown }[] = [];

  private readonly pending: PendingMetadataUpdate[] = [];
  private readonly lagTicks: number;
  private readonly renameFails: Set<string>;

  constructor(options: FakeObsidianAdapterOptions = {}) {
    this.lagTicks = options.metadataLagTicks ?? 1;
    this.renameFails = options.renameFails ?? new Set();
    for (const path of options.existingPaths ?? []) {
      if (!this.files.has(path)) this.files.set(path, { frontmatter: {} });
      if (!this.cache.has(path)) this.cache.set(path, {});
    }
  }

  // ---- seeding -----------------------------------------------------------

  seedFile(path: string, frontmatter: Record<string, unknown> = {}): this {
    this.files.set(path, { frontmatter: { ...frontmatter } });
    this.cache.set(path, { ...frontmatter });
    return this;
  }

  seedContext(contextPath: string, table: SpaceTable): this {
    this.contextTables.set(contextPath, {
      ...table,
      rows: table.rows.map((row) => ({ ...row })),
    });
    return this;
  }

  // ---- the metadata clock ------------------------------------------------

  private schedule(apply: () => void): void {
    if (this.lagTicks <= 0) {
      apply();
      return;
    }
    this.pending.push({ ticksRemaining: this.lagTicks, apply });
  }

  /** Advance the metadata clock by one tick; applies any updates that mature. */
  tick(): void {
    const ready: PendingMetadataUpdate[] = [];
    for (const update of this.pending) {
      update.ticksRemaining -= 1;
      if (update.ticksRemaining <= 0) ready.push(update);
    }
    for (const update of ready) {
      this.pending.splice(this.pending.indexOf(update), 1);
      update.apply();
    }
  }

  /** Drain ALL pending metadata updates (run the cache fully forward). */
  settle(): void {
    while (this.pending.length > 0) this.tick();
  }

  hasPendingMetadata(): boolean {
    return this.pending.length > 0;
  }

  // ---- external edits ----------------------------------------------------

  /**
   * Another surface edited the file directly. File AND cache update
   * immediately (it is "someone else's already-settled write"), so a save we
   * scheduled earlier will observe this when IT settles — modeling
   * metadataCache.changed ordering / lost-update windows.
   */
  externalEdit(path: string, column: string, value: unknown): void {
    const file = this.files.get(path) ?? { frontmatter: {} };
    file.frontmatter = { ...file.frontmatter, [column]: value };
    this.files.set(path, file);
    this.cache.set(path, { ...(this.cache.get(path) ?? {}), [column]: value });
    this.cacheLog.push({ path, column, value });
  }

  // ---- the superstate-shaped facade --------------------------------------

  get superstate(): any {
    const self = this;
    return {
      // pathsIndex.get(path).metadata.property[col] — the LAGGED read surface.
      pathsIndex: {
        get(path: string) {
          const cached = self.cache.get(path);
          if (!cached) return undefined;
          return { metadata: { property: cached } };
        },
      },
      contextsIndex: {
        get(contextPath: string) {
          const table = self.contextTables.get(contextPath);
          return table ? { contextTable: table } : undefined;
        },
      },
      reloadContextByPath: async (_contextPath: string) => {
        // Reload is where Obsidian re-derives the context from current cache;
        // in this fake the context table is mutated directly by renamePath /
        // saveTable, so reload is a no-op that still settles metadata.
        self.settle();
      },
      reloadContext: async () => {
        self.settle();
      },
      ui: {
        notify: (message: string) => {
          self.notifications.push(message);
        },
      },
      spaceManager: {
        resolvePath: (path: string) => path,
        pathExists: async (path: string) =>
          self.files.has(path) || self.cache.has(path),
        // processFrontMatter: write file content NOW, settle cache LATER.
        saveProperties: async (
          path: string,
          properties: Record<string, unknown>
        ): Promise<boolean> => {
          const file = self.files.get(path) ?? { frontmatter: {} };
          file.frontmatter = { ...file.frontmatter, ...properties };
          self.files.set(path, file);
          self.schedule(() => {
            const next = { ...(self.cache.get(path) ?? {}) };
            for (const [column, value] of Object.entries(properties)) {
              next[column] = value;
              self.cacheLog.push({ path, column, value });
            }
            self.cache.set(path, next);
          });
          return true;
        },
        renamePath: async (
          from: string,
          to: string
        ): Promise<string | null> => {
          if (self.renameFails.has(from)) return null;
          const file = self.files.get(from);
          if (!file) return null;
          // Move the file content immediately (on-disk move).
          self.files.delete(from);
          self.files.set(to, file);
          // Cache + context-row path key update lags like real metadata.
          self.schedule(() => {
            const cached = self.cache.get(from);
            if (cached) {
              self.cache.delete(from);
              self.cache.set(to, cached);
            }
            for (const table of self.contextTables.values()) {
              for (const row of table.rows) {
                if (row[PathPropertyName] == from) {
                  row[PathPropertyName] = to;
                }
              }
            }
          });
          return to;
        },
        saveTable: async (
          contextPath: string,
          table: SpaceTable,
          _force?: boolean
        ): Promise<boolean> => {
          self.saveTableCalls.push({
            contextPath,
            rows: table.rows.map((row) => ({ ...row })),
          });
          self.contextTables.set(contextPath, {
            ...table,
            rows: table.rows.map((row) => ({ ...row })),
          });
          return true;
        },
      },
    };
  }

  // ---- read helpers for assertions --------------------------------------

  fileValue(path: string, column: string): unknown {
    return this.files.get(path)?.frontmatter[column];
  }

  cacheValue(path: string, column: string): unknown {
    return this.cache.get(path)?.[column];
  }

  contextRowPaths(contextPath: string): string[] {
    return (
      this.contextTables.get(contextPath)?.rows.map(
        (row) => String(row[PathPropertyName])
      ) ?? []
    );
  }
}
