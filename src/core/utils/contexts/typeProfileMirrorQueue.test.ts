import {
  createTypeProfileMirrorQueue,
  runSerializedTypeProfileMirror,
} from "core/utils/contexts/typeProfileMirrorQueue";
import { mirrorSchemaChangeToTypeProfile } from "core/utils/contexts/typeProfileMirror";

jest.mock("core/utils/contexts/typeProfileMirror");

const mockMirror = mirrorSchemaChangeToTypeProfile as jest.MockedFunction<
  typeof mirrorSchemaChangeToTypeProfile
>;

const superstate = {} as any;
const ctx = "Library";
const state0 = { fields: {}, kindFields: {} };

beforeEach(() => {
  mockMirror.mockReset();
});

describe("runSerializedTypeProfileMirror", () => {
  it("runs mirror writes strictly one at a time (never interleaved)", async () => {
    let active = 0;
    let maxActive = 0;
    mockMirror.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      await Promise.resolve();
      active--;
      return { ok: true, state: state0 };
    });

    const state = createTypeProfileMirrorQueue();
    await Promise.all([
      runSerializedTypeProfileMirror(state, superstate, ctx, {
        kind: "add-option",
        name: "status",
        option: "a",
      }),
      runSerializedTypeProfileMirror(state, superstate, ctx, {
        kind: "add-option",
        name: "status",
        option: "b",
      }),
      runSerializedTypeProfileMirror(state, superstate, ctx, {
        kind: "add-option",
        name: "status",
        option: "c",
      }),
    ]);

    expect(maxActive).toBe(1);
    expect(mockMirror).toHaveBeenCalledTimes(3);
  });

  it("threads each write's state into the next so a burst cannot lose updates", async () => {
    const bases: Array<any> = [];
    // Simulate the real hazard: base=null means "read the (stale, lagging)
    // metadata cache", which here never reflects prior writes. Only threading
    // the previous result forward keeps every option.
    mockMirror.mockImplementation(async (_ss, _cp, change: any, base) => {
      bases.push(base);
      await Promise.resolve();
      const start = base?.fields ?? { stale: true };
      return {
        ok: true,
        state: { fields: { ...start, [change.option]: true }, kindFields: {} },
      };
    });

    const state = createTypeProfileMirrorQueue();
    await Promise.all(
      ["a", "b", "c"].map((option) =>
        runSerializedTypeProfileMirror(state, superstate, ctx, {
          kind: "add-option",
          name: "status",
          option,
        })
      )
    );

    // First call reads the cache (null); each later call builds on the prior
    // result, so the threaded map accumulates every option.
    expect(bases[0]).toBeNull();
    expect(bases[1].fields).toEqual({ stale: true, a: true });
    expect(bases[2].fields).toEqual({ stale: true, a: true, b: true });
  });

  it("clears the threaded state once a hub's burst drains, so the next mirror re-reads the cache", async () => {
    const bases: Array<any> = [];
    mockMirror.mockImplementation(async (_ss, _cp, change: any, base) => {
      bases.push(base);
      const start = base?.fields ?? {};
      return {
        ok: true,
        state: { fields: { ...start, [change.option]: true }, kindFields: {} },
      };
    });

    const state = createTypeProfileMirrorQueue();
    await runSerializedTypeProfileMirror(state, superstate, ctx, {
      kind: "add-option",
      name: "status",
      option: "a",
    });

    // Burst drained: no leaked threading/depth state.
    expect(state.threaded.size).toBe(0);
    expect(state.depth.size).toBe(0);

    await runSerializedTypeProfileMirror(state, superstate, ctx, {
      kind: "add-option",
      name: "status",
      option: "b",
    });

    // The second (separate) burst starts fresh from the cache, not the stale
    // in-memory state from the first.
    expect(bases[1]).toBeNull();
  });

  it("does not thread a failed write's state forward", async () => {
    const bases: Array<any> = [];
    mockMirror
      .mockImplementationOnce(async (_ss, _cp, _change, base) => {
        bases.push(base);
        return { ok: false, state: null };
      })
      .mockImplementationOnce(async (_ss, _cp, _change, base) => {
        bases.push(base);
        return { ok: true, state: { fields: { b: true }, kindFields: {} } };
      });

    const state = createTypeProfileMirrorQueue();
    await Promise.all([
      runSerializedTypeProfileMirror(state, superstate, ctx, {
        kind: "add-option",
        name: "status",
        option: "a",
      }),
      runSerializedTypeProfileMirror(state, superstate, ctx, {
        kind: "add-option",
        name: "status",
        option: "b",
      }),
    ]);

    // The failed first write threads nothing, so the second still reads the
    // cache (base=null) rather than a phantom map.
    expect(bases[0]).toBeNull();
    expect(bases[1]).toBeNull();
  });

  it("keeps separate hubs independent", async () => {
    const seen: Array<{ ctx: string; base: unknown }> = [];
    mockMirror.mockImplementation(async (_ss, cp: any, change: any, base) => {
      seen.push({ ctx: cp, base });
      const start = (base?.fields as any) ?? {};
      return {
        ok: true,
        state: { fields: { ...start, [change.option]: true }, kindFields: {} },
      };
    });

    const state = createTypeProfileMirrorQueue();
    await Promise.all([
      runSerializedTypeProfileMirror(state, superstate, "Library", {
        kind: "add-option",
        name: "status",
        option: "a",
      }),
      runSerializedTypeProfileMirror(state, superstate, "Tools", {
        kind: "add-option",
        name: "status",
        option: "x",
      }),
    ]);

    // Each hub's first mirror reads its own cache; neither inherits the other's
    // threaded state.
    expect(seen.find((s) => s.ctx == "Library")?.base).toBeNull();
    expect(seen.find((s) => s.ctx == "Tools")?.base).toBeNull();
  });
});
