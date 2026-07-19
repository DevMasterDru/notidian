import {
  dispatchBestEffort,
  isPostPhysicalLifecycleFailure,
  postPhysicalLifecycleFailure,
  runBulkAsync,
} from "./asyncContracts";

describe("rejecting async caller contracts", () => {
  it("waits for every bulk operation and reports all failures once", async () => {
    const completed: string[] = [];
    const bulk = runBulkAsync(["A", "B", "C"], async path => {
      completed.push(path);
      if (path !== "B") throw new Error(`${path} failed`);
    });
    await expect(bulk).rejects.toEqual(expect.objectContaining({
      name: "AggregateError",
      errors: [
        expect.objectContaining({ message: "A failed" }),
        expect.objectContaining({ message: "C failed" }),
      ],
    }));
    expect(completed).toEqual(["A", "B", "C"]);
  });

  it("starts every bulk operation and aggregates synchronous callback throws", async () => {
    const started: string[] = [];
    const completed: string[] = [];
    let releaseC = (): void => undefined;
    const bulk = runBulkAsync(["A", "B", "C"], path => {
      started.push(path);
      if (path === "A") throw new Error("A threw synchronously");
      if (path === "B") return Promise.reject(new Error("B rejected asynchronously"));
      return new Promise<void>(resolve => {
        releaseC = () => {
          completed.push(path);
          resolve();
        };
      });
    });
    const rejected = expect(bulk).rejects.toEqual(expect.objectContaining({
      name: "AggregateError",
      errors: [
        expect.objectContaining({ message: "A threw synchronously" }),
        expect.objectContaining({ message: "B rejected asynchronously" }),
      ],
    }));

    await Promise.resolve();
    expect(started).toEqual(["A", "B", "C"]);
    releaseC();
    await rejected;
    expect(completed).toEqual(["C"]);
  });

  it("turns a best-effort event rejection into an explicit report", async () => {
    const report = jest.fn();
    dispatchBestEffort(Promise.reject(new Error("metadata failed")), report);
    await Promise.resolve();
    await Promise.resolve();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: "metadata failed" }));
  });

  it("marks post-physical lifecycle failures without losing aggregate details", () => {
    const cleanup = new Error("cache cleanup failed");
    const listener = new Error("listener failed");
    const aggregate = new AggregateError([cleanup, listener], "delete lifecycle failed");

    const marked = postPhysicalLifecycleFailure(
      "Delete lifecycle failed after the file was removed",
      aggregate,
    );

    expect(isPostPhysicalLifecycleFailure(marked)).toBe(true);
    expect(marked).toMatchObject({
      name: "PostPhysicalLifecycleError",
      cause: aggregate,
      errors: [cleanup, listener],
    });
    expect(isPostPhysicalLifecycleFailure({
      name: "PostPhysicalLifecycleError",
      message: "looks similar",
    })).toBe(false);
    expect(isPostPhysicalLifecycleFailure({
      [Symbol.for("notidian.postPhysicalLifecycleFailure")]: true,
    })).toBe(false);
    expect(isPostPhysicalLifecycleFailure({
      [Symbol.for("notidian.postPhysicalLifecycleFailure")]: true,
      cause: cleanup,
      errors: "not an aggregate detail list",
    })).toBe(false);
  });
});
