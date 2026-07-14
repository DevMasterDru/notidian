import { Indexer } from "./indexer";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
});
