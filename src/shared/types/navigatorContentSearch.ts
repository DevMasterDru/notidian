export type NavigatorContentSearchStatus =
  | "building"
  | "ready"
  | "unavailable";

export type NavigatorContentSearchSnapshot = {
  status: NavigatorContentSearchStatus;
  revision: number;
};

export type NavigatorContentSearchRequest = {
  requestId: number;
  query: string;
  revision: number;
};

export type NavigatorContentSearchResult = {
  requestId: number;
  query: string;
  requestedRevision: number;
  revision: number;
  paths: string[];
  cancelled?: boolean;
};

export interface INavigatorContentSearch {
  getSnapshot(): NavigatorContentSearchSnapshot;
  subscribe(listener: (snapshot: NavigatorContentSearchSnapshot) => void): () => void;
  search(
    request: NavigatorContentSearchRequest
  ): Promise<NavigatorContentSearchResult>;
}

export type NavigatorContentDocument = {
  path: string;
  body: string;
};

export type NavigatorContentWorkerRequest =
  | { type: "reset"; generation: number }
  | {
      type: "upsert";
      generation: number;
      documents: NavigatorContentDocument[];
    }
  | { type: "remove"; generation: number; paths: string[] }
  | { type: "reconcile"; generation: number; paths: string[] }
  | ({ type: "query" } & NavigatorContentSearchRequest)
  | { type: "dispose" };

export type NavigatorContentWorkerResponse =
  | { type: "mutation"; generation: number; revision: number }
  | NavigatorContentSearchResult & { type: "result" }
  | { type: "disposed" }
  | {
      type: "error";
      operation: NavigatorContentWorkerRequest["type"];
      requestId?: number;
      generation?: number;
      message: string;
    };

export interface NavigatorContentWorkerPort {
  postMessage(message: NavigatorContentWorkerRequest): void;
  terminate(): void;
  onmessage:
    | ((event: MessageEvent<NavigatorContentWorkerResponse>) => void)
    | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export type NavigatorContentWorkerFactory = () => NavigatorContentWorkerPort;
