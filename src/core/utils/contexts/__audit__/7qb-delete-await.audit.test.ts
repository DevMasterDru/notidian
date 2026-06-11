import { FilesystemSpaceAdapter } from "core/spaceManager/filesystemAdapter/filesystemAdapter";
import { applyFrontmatterSchemaWritePlans } from "core/utils/contexts/notidianSchemaApply";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const hasSettled = async (promise: Promise<unknown>) => {
  const pending = Symbol("pending");
  const result = await Promise.race([
    promise.then(
      () => "settled",
      () => "settled"
    ),
    Promise.resolve(pending),
  ]);

  return result !== pending;
};

const makeAdapter = (deletePromise: Promise<boolean>) => {
  const file = { path: "Rows/A.md" };
  const fileSystem = {
    eventDispatch: { addListener: jest.fn() },
    getFile: jest.fn(async () => file),
    deleteFileFragment: jest.fn(() => deletePromise),
  };

  return {
    adapter: new FilesystemSpaceAdapter(fileSystem as any, ".notidian"),
    file,
    fileSystem,
  };
};

describe("Notidian-7qb frontmatter property deletion awaiting", () => {
  it("keeps deleteProperty pending until the frontmatter fragment delete resolves", async () => {
    const deletion = createDeferred<boolean>();
    const { adapter, file, fileSystem } = makeAdapter(deletion.promise);

    const deletePropertyPromise = adapter.deleteProperty("Rows/A.md", "oldKey");

    await flushMicrotasks();

    expect(fileSystem.deleteFileFragment).toHaveBeenCalledWith(
      file,
      "property",
      "oldKey"
    );
    expect(await hasSettled(deletePropertyPromise)).toBe(false);

    deletion.resolve(false);

    await expect(deletePropertyPromise).resolves.toBe(false);
  });

  it("rejects deleteProperty when the frontmatter fragment delete rejects", async () => {
    const deletion = createDeferred<boolean>();
    deletion.promise.catch(() => {});
    const { adapter } = makeAdapter(deletion.promise);
    const deletePropertyPromise = adapter.deleteProperty("Rows/A.md", "oldKey");

    await flushMicrotasks();

    const error = new Error("frontmatter delete failed");
    deletion.reject(error);

    await expect(deletePropertyPromise).rejects.toBe(error);
  });

  it("reports schema remove failure after a rejected adapter deletion", async () => {
    const deletion = createDeferred<boolean>();
    deletion.promise.catch(() => {});
    const { adapter } = makeAdapter(deletion.promise);

    const applyPromise = applyFrontmatterSchemaWritePlans({
      writes: [{ path: "Rows/A.md", set: {}, removeKeys: ["oldKey"] }],
      saveProperties: jest.fn(),
      deleteProperty: async (path, key) => {
        try {
          await adapter.deleteProperty(path, key);
          return { ok: true as const };
        } catch (error) {
          return { ok: false as const, error };
        }
      },
    });

    await flushMicrotasks();

    expect(await hasSettled(applyPromise)).toBe(false);

    const error = new Error("frontmatter delete failed");
    deletion.reject(error);

    await expect(applyPromise).resolves.toEqual({
      ok: false,
      applied: 0,
      failed: [
        {
          path: "Rows/A.md",
          phase: "remove",
          key: "oldKey",
          error,
        },
      ],
    });
  });
});
