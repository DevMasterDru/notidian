import { Indexer } from "./indexer";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe("Indexer reload scheduling", () => {
  it("reruns a same-key reload requested while the first job is in flight", async () => {
    const firstExecution = deferred<{ generation: number }>();
    const indexer = new Indexer(1, {} as any);
    const execute = jest
      .fn<Promise<{ generation: number }>, [unknown]>()
      .mockImplementationOnce(() => firstExecution.promise)
      .mockResolvedValueOnce({ generation: 2 });
    (indexer as any).execute = execute;

    const job = { type: "context", path: "Fresh Database" } as any;
    const firstReload = indexer.reload<{ generation: number }>(job);

    expect(execute).toHaveBeenCalledTimes(1);
    const trailingReload = indexer.reload<{ generation: number }>(job);
    firstExecution.resolve({ generation: 1 });

    await expect(firstReload).resolves.toEqual({ generation: 1 });
    await expect(trailingReload).resolves.toEqual({ generation: 2 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("settles and neutralizes an in-flight path reload invalidated by deletion", async () => {
    const firstExecution = deferred<{ cache: { path: string }; changed: boolean }>();
    const indexer = new Indexer(1, {} as any);
    const execute = jest.fn().mockImplementation(() => firstExecution.promise);
    (indexer as any).execute = execute;

    const reload = indexer.reload({ type: "path", path: "Deleted.md" } as any);
    (indexer as any).invalidatePath("Deleted.md");
    firstExecution.resolve({ cache: { path: "Deleted.md" }, changed: true });

    const [settled] = await Promise.allSettled([reload]);
    expect(settled).toEqual({ status: "fulfilled", value: undefined });
  });

  it("neutralizes a queued path reload invalidated before execution", async () => {
    const blocker = deferred<{ ok: boolean }>();
    const indexer = new Indexer(1, {} as any);
    const execute = jest
      .fn()
      .mockImplementationOnce(() => blocker.promise)
      .mockResolvedValueOnce({ cache: { path: "Queued.md" }, changed: true });
    (indexer as any).execute = execute;

    const active = indexer.reload({ type: "context", path: "Blocker" } as any);
    const queued = indexer.reload({ type: "path", path: "Queued.md" } as any);
    indexer.invalidatePath("Queued.md");
    blocker.resolve({ ok: true });

    await active;
    await expect(queued).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("preserves a fresh trailing reload after invalidating an active path job", async () => {
    const staleExecution = deferred<{ cache: { generation: string }; changed: boolean }>();
    const indexer = new Indexer(1, {} as any);
    const execute = jest
      .fn()
      .mockImplementationOnce(() => staleExecution.promise)
      .mockResolvedValueOnce({ cache: { generation: "fresh" }, changed: true });
    (indexer as any).execute = execute;

    const stale = indexer.reload({ type: "path", path: "Recreated.md" } as any);
    indexer.invalidatePath("Recreated.md");
    const fresh = indexer.reload({ type: "path", path: "Recreated.md" } as any);
    staleExecution.resolve({ cache: { generation: "stale" }, changed: true });

    await expect(stale).resolves.toBeUndefined();
    await expect(fresh).resolves.toEqual({ cache: { generation: "fresh" }, changed: true });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("neutralizes work across repeated invalidations", async () => {
    const execution = deferred<{ cache: { path: string }; changed: boolean }>();
    const indexer = new Indexer(1, {} as any);
    (indexer as any).execute = jest.fn(() => execution.promise);

    const reload = indexer.reload({ type: "path", path: "Repeated.md" } as any);
    indexer.invalidatePath("Repeated.md");
    indexer.invalidatePath("Repeated.md");
    execution.resolve({ cache: { path: "Repeated.md" }, changed: true });

    await expect(reload).resolves.toBeUndefined();
  });

  it("settles an invalidated execution rejection benignly", async () => {
    const execution = deferred<never>();
    const indexer = new Indexer(1, {} as any);
    (indexer as any).execute = jest.fn(() => execution.promise);

    const reload = indexer.reload({ type: "path", path: "Rejected.md" } as any);
    indexer.invalidatePath("Rejected.md");
    execution.reject(new Error("late read failed"));

    await expect(reload).resolves.toBeUndefined();
  });
});
