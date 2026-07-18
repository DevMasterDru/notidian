import { NavigatorContentWorkerRuntime } from "./impl";
import {
  NavigatorContentWorkerRequest,
  NavigatorContentWorkerResponse,
} from "shared/types/navigatorContentSearch";

const runtime = new NavigatorContentWorkerRuntime();

self.onmessage = (event: MessageEvent<NavigatorContentWorkerRequest>) => {
  const request = event.data;
  try {
    self.postMessage(runtime.handle(request));
  } catch (_error) {
    const response: NavigatorContentWorkerResponse = {
      type: "error",
      operation: request.type,
      requestId: request.type === "query" ? request.requestId : undefined,
      generation:
        request.type !== "query" && request.type !== "dispose"
          ? request.generation
          : undefined,
      message: "Navigator content worker operation failed",
    };
    self.postMessage(response);
  }
};
