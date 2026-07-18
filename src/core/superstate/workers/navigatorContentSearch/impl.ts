import { stripFrontmatter } from "core/utils/spaceNoteBody";
import Fuse, { IFuseOptions } from "fuse.js";
import {
  NavigatorContentDocument,
  NavigatorContentWorkerRequest,
  NavigatorContentWorkerResponse,
} from "shared/types/navigatorContentSearch";

type IndexedNavigatorContentDocument = NavigatorContentDocument & {
  order: number;
};

const fuseOptions: IFuseOptions<IndexedNavigatorContentDocument> = {
  keys: ["body"],
  threshold: 0,
  ignoreLocation: true,
  shouldSort: false,
  isCaseSensitive: false,
};

export const normalizeNavigatorContentText = (
  content: string,
  stripFrontmatterFirst = false
): string => {
  const source = stripFrontmatterFirst ? stripFrontmatter(content ?? "") : content ?? "";
  return source.normalize("NFKC").toLowerCase();
};

export class NavigatorContentIndex {
  private documents = new Map<string, IndexedNavigatorContentDocument>();
  private fuse = new Fuse<IndexedNavigatorContentDocument>([], fuseOptions);
  private nextOrder = 0;

  reset(): void {
    this.documents.clear();
    this.fuse = new Fuse<IndexedNavigatorContentDocument>([], fuseOptions);
    this.nextOrder = 0;
  }

  upsert(documents: NavigatorContentDocument[]): void {
    for (const document of documents) {
      const existing = this.documents.get(document.path);
      if (existing) {
        this.fuse.remove((candidate) => candidate.path === document.path);
      }
      const indexed: IndexedNavigatorContentDocument = {
        path: document.path,
        body: normalizeNavigatorContentText(document.body, true),
        order: existing?.order ?? this.nextOrder++,
      };
      this.documents.set(document.path, indexed);
      this.fuse.add(indexed);
    }
  }

  remove(paths: Iterable<string>): void {
    for (const path of paths) {
      if (!this.documents.delete(path)) continue;
      this.fuse.remove((candidate) => candidate.path === path);
    }
  }

  reconcile(paths: ReadonlySet<string>): void {
    this.remove(
      Array.from(this.documents.keys()).filter((path) => !paths.has(path))
    );
  }

  search(query: string): string[] {
    const normalizedQuery = normalizeNavigatorContentText(query).trim();
    if (normalizedQuery.length === 0) return [];
    return this.fuse
      .search(normalizedQuery)
      .map((result) => result.item)
      .sort((left, right) => left.order - right.order)
      .map((document) => document.path);
  }

  paths(): string[] {
    return Array.from(this.documents.values())
      .sort((left, right) => left.order - right.order)
      .map((document) => document.path);
  }
}

export class NavigatorContentWorkerRuntime {
  private readonly index = new NavigatorContentIndex();
  private revision = 0;

  handle(
    message: NavigatorContentWorkerRequest
  ): NavigatorContentWorkerResponse {
    switch (message.type) {
      case "reset":
        this.index.reset();
        return this.mutation(message.generation);
      case "upsert":
        this.index.upsert(message.documents);
        return this.mutation(message.generation);
      case "remove":
        this.index.remove(message.paths);
        return this.mutation(message.generation);
      case "reconcile":
        this.index.reconcile(new Set(message.paths));
        return this.mutation(message.generation);
      case "query":
        return {
          type: "result",
          requestId: message.requestId,
          query: normalizeNavigatorContentText(message.query).trim(),
          requestedRevision: message.revision,
          revision: this.revision,
          paths: this.index.search(message.query),
        };
      case "dispose":
        this.index.reset();
        this.revision += 1;
        return { type: "disposed" };
    }
  }

  private mutation(generation: number): NavigatorContentWorkerResponse {
    this.revision += 1;
    return { type: "mutation", generation, revision: this.revision };
  }
}
