
import { formulas } from "core/utils/formula/formulas";
import type * as math from "mathjs";
import { stringifyJob } from "core/utils/superstate/serializer";
import { Superstate } from "makemd-core";
import { WorkerJobType } from "shared/types/PathState";
import {
  BatchContextWorkerPayload,
  ContextWorkerPayload,
  PathWorkerPayload,
  indexAllPaths,
  parseAllContexts,
  parseAllPaths,
  parseContext,
  parsePath,
} from "./impl";

type FileCallback = (p: any) => void;

let _runContext: math.MathJsInstance | null = null;
function getRunContext(): math.MathJsInstance {
  if (!_runContext) {
    const m: typeof math = require("mathjs");
    const all = {
      ...m.all,
      createAdd: m.factory("add", [], () => function add(a: any, b: any) {
        return a + b;
      }),
      createEqual: m.factory("equal", [], () => function equal(a: any, b: any) {
        return a == b;
      }),
      createUnequal: m.factory("unequal", [], () => function unequal(a: any, b: any) {
        return a != b;
      }),
    };
    _runContext = m.create(all, { matrix: "Array" });
    _runContext.import(formulas, { override: true });
  }
  return _runContext;
}

export class Indexer {
  reloadQueue: WorkerJobType[];
  reloadSet: Set<string>;
  callbacks: Map<string, [FileCallback, FileCallback][]>;
  private draining: boolean;
  private activeJobs: Set<string>;
  private trailingJobs: Map<string, WorkerJobType>;

  public constructor(public numWorkers: number, public cache: Superstate) {
    this.reloadQueue = [];
    this.reloadSet = new Set();
    this.callbacks = new Map();
    this.draining = false;
    this.activeJobs = new Set();
    this.trailingJobs = new Map();
  }

  public reload<T>(jerb: WorkerJobType): Promise<T> {
    const jobKey = stringifyJob(jerb);
    const promise: Promise<T> = new Promise((resolve, reject) => {
      if (this.callbacks.has(jobKey)) this.callbacks.get(jobKey)?.push([resolve, reject]);
      else this.callbacks.set(jobKey, [[resolve, reject]]);
    });

    if (this.reloadSet.has(jobKey)) {
      // A queued job can absorb duplicate requests because it has not read its
      // source yet. An active job already owns a snapshot, so retain the latest
      // request as one trailing reload instead of resolving it with stale data.
      if (this.activeJobs.has(jobKey)) this.trailingJobs.set(jobKey, jerb);
      return promise;
    }
    this.reloadSet.add(jobKey);
    this.reloadQueue.push(jerb);
    this.drain();
    return promise;
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.reloadQueue.length > 0) {
        const job = this.reloadQueue.shift()!;
        await this.processJob(job);
      }
    } finally {
      this.draining = false;
    }
  }

  private async processJob(job: WorkerJobType) {
    const jobKey = stringifyJob(job);
    // Freeze the callback generation before execute() starts reading. Reloads
    // arriving during that read collect in a new callback batch for the
    // trailing job.
    const calls = ([] as [FileCallback, FileCallback][]).concat(
      this.callbacks.get(jobKey) ?? []
    );
    this.callbacks.delete(jobKey);
    this.activeJobs.add(jobKey);

    let data: any;
    try {
      data = await this.execute(job);
    } catch (error) {
      data = { $error: `Failed to index ${job.type} ${job.path}: ${error}` };
    }
    this.finish(calls, data);
    this.activeJobs.delete(jobKey);

    const trailingJob = this.trailingJobs.get(jobKey);
    if (trailingJob) {
      this.trailingJobs.delete(jobKey);
      this.reloadQueue.push(trailingJob);
    } else {
      this.reloadSet.delete(jobKey);
    }
  }

  private async execute(job: WorkerJobType): Promise<any> {
    if (job.type === "paths") {
      const pathCaches = await this.cache.spaceManager.allCaches();
      return parseAllPaths({
        settings: this.cache.settings,
        spacesCache: this.cache.spacesIndex,
        pathCache: pathCaches,
        oldMetadata: this.cache.pathsIndex,
      });
    }

    if (job.type === "path") {
      const payload = await this.buildPathPayload(job);
      return parsePath(payload);
    }

    if (job.type === "index") {
      return indexAllPaths({ pathsIndex: this.cache.pathsIndex });
    }

    if (job.type === "context") {
      const payload = await this.buildContextPayload(job);
      if (!payload) return { $error: `No space found for ${job.path}` };
      return parseContext(payload, getRunContext());
    }

    if (job.type === "contexts") {
      const payload = await this.buildBatchContextPayload();
      return parseAllContexts(payload, getRunContext());
    }

    return { $error: `Unknown job type: ${job.type}` };
  }

  private async buildPathPayload(job: WorkerJobType): Promise<PathWorkerPayload> {
    const spaceState = this.cache.spacesIndex.get(job.path);
    let cachePath = job.path;
    let name: string | undefined;
    let isFolderNote = false;

    if (spaceState) {
      name = spaceState.space.name;
      if (
        this.cache.settings.enableFolderNote &&
        (await this.cache.spaceManager.pathExists(
          (cachePath = spaceState.space.notePath)
        ))
      ) {
        cachePath = spaceState.space.notePath;
        isFolderNote = true;
      } else {
        cachePath = spaceState.space.defPath;
      }
    }

    let pathMetadata =
      (await this.cache.spaceManager.readPathCache(cachePath)) ??
      (await this.cache.spaceManager.readPathCache(job.path));

    if (isFolderNote && pathMetadata) {
      const folderMetadata = await this.cache.spaceManager.readPathCache(
        job.path
      );
      if (folderMetadata) {
        pathMetadata = {
          ...pathMetadata,
          file: folderMetadata.file,
          parent: folderMetadata.parent,
          subtype: folderMetadata.subtype,
          type: folderMetadata.type,
          contentTypes: folderMetadata.contentTypes,
        };
      }
    }

    name = name ?? pathMetadata?.label.name;
    const parent = await this.cache.spaceManager.parentPathForPath(job.path);
    const type = spaceState ? "space" : pathMetadata?.type;
    const subtype = spaceState ? spaceState.type : pathMetadata?.subtype;

    return {
      path: job.path,
      settings: this.cache.settings,
      spacesCache: this.cache.spacesIndex,
      pathMetadata,
      name,
      parent,
      type,
      subtype,
      oldMetadata: this.cache.pathsIndex.get(job.path),
    };
  }

  private async buildContextPayload(
    job: WorkerJobType
  ): Promise<ContextWorkerPayload | null> {
    const space = this.cache.spacesIndex.get(job.path)?.space;
    if (!space || !space.path) {
      return {
        space,
        mdb: null,
        paths: [...this.cache.spacesMap.getInverse(job.path)],
        settings: this.cache.settings,
        pathsIndex: this.cache.pathsIndex,
        spacesMap: this.cache.spacesMap,
        contextsIndex: this.cache.contextsIndex,
        options: job.payload,
      } as ContextWorkerPayload;
    }
    const dbExists = await this.cache.spaceManager.contextInitiated(space.path);
    const mdb = await this.cache.spaceManager.readAllTables(space.path);
    return {
      space,
      mdb,
      paths: [...this.cache.spacesMap.getInverse(job.path)],
      spacesMap: this.cache.spacesMap,
      settings: this.cache.settings,
      dbExists,
      contextsIndex: this.cache.contextsIndex,
      pathsIndex: this.cache.pathsIndex,
      options: job.payload,
    } as ContextWorkerPayload;
  }

  private async buildBatchContextPayload(): Promise<BatchContextWorkerPayload> {
    const spaces = this.cache
      .allSpaces()
      .filter((f) => f.type != "default")
      .map((f) => f.space);
    const map = new Map<string, any>();
    for (const space of spaces) {
      const dbExists = await this.cache.spaceManager.contextInitiated(
        space.path
      );
      const mdb = await this.cache.spaceManager.readAllTables(space.path);
      map.set(space.path, {
        space,
        mdb,
        paths: [...this.cache.spacesMap.getInverse(space.path)],
        settings: this.cache.settings,
        spacesMap: this.cache.spacesMap,
        contextsIndex: this.cache.contextsIndex,
        dbExists,
      });
    }
    return {
      map,
      pathsIndex: this.cache.pathsIndex,
      settings: this.cache.settings,
      spacesMap: this.cache.spacesMap,
      contextsIndex: this.cache.contextsIndex,
    };
  }

  private finish(calls: [FileCallback, FileCallback][], data: any) {
    if (data && typeof data === "object" && "$error" in data) {
      for (const [_, reject] of calls) reject(data["$error"]);
    } else {
      for (const [callback, _] of calls) callback(data);
    }
  }
}
