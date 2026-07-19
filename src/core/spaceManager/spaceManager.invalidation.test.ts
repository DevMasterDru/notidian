import { SpaceManager } from "./spaceManager";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const managerHarness = () => {
  const manager = new SpaceManager();
  manager.superstate = {
    reloadSpace: jest.fn().mockResolvedValue({ path: "Space" }),
    onSpaceDefinitionChanged: jest.fn().mockResolvedValue(undefined),
    onPathCreated: jest.fn().mockResolvedValue(true),
    onPathRename: jest.fn().mockResolvedValue(true),
    reloadContextByPath: jest.fn().mockResolvedValue(true),
  } as any;
  manager.spaceInfoForPath = jest.fn((path: string) => ({ path })) as any;
  return manager;
};

describe("SpaceManager reload outcome propagation", () => {
  it("awaits and returns the Superstate path-created outcome", async () => {
    const manager = managerHarness();
    const gate = deferred<boolean>();
    (manager.superstate.onPathCreated as jest.Mock).mockReturnValueOnce(gate.promise);
    let settled = false;

    const creation = manager.onPathCreated("Queued.md").then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve(false);

    await expect(creation).resolves.toBe(false);
  });

  it("awaits and returns the Superstate path-change outcome", async () => {
    const manager = managerHarness();
    const gate = deferred<boolean>();
    (manager.superstate.onPathRename as jest.Mock).mockReturnValueOnce(gate.promise);
    let settled = false;

    const change = manager.onPathChanged("New.md", "Old.md").then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve(false);

    await expect(change).resolves.toBe(false);
  });

  it("stops space creation before context reload when path creation is invalidated", async () => {
    const manager = managerHarness();
    (manager.superstate.onPathCreated as jest.Mock).mockResolvedValueOnce(false);

    await expect(manager.onSpaceCreated("Space")).resolves.toBe(false);

    expect(manager.superstate.reloadContextByPath).not.toHaveBeenCalled();
  });

  it("returns the path-rename outcome from space rename", async () => {
    const manager = managerHarness();
    manager.superstate.onSpaceRenamed = jest.fn().mockResolvedValue(undefined);
    (manager.superstate.onPathRename as jest.Mock).mockResolvedValueOnce(false);

    await expect(manager.onSpaceRenamed("New", "Old")).resolves.toBe(false);
  });
});
