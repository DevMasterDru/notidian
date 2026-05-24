import { saveFrontmatterProperties } from "./frontmatterWrite";

describe("saveFrontmatterProperties", () => {
  it("returns success only when the space manager confirms the write", async () => {
    const saveProperties = jest.fn(async () => true);

    const result = await saveFrontmatterProperties({
      superstate: {
        spaceManager: { saveProperties },
      } as any,
      path: "a.md",
      properties: { status: "active" },
    });

    expect(result.ok).toBe(true);
    expect(saveProperties).toHaveBeenCalledWith("a.md", { status: "active" });
  });

  it("skips empty writes without notifying", async () => {
    const notify = jest.fn();
    const saveProperties = jest.fn();

    const result = await saveFrontmatterProperties({
      superstate: {
        spaceManager: { saveProperties },
        ui: { notify },
      } as any,
      path: "a.md",
      properties: {},
    });

    expect(result.ok).toBe(true);
    expect(saveProperties).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("notifies and returns failure when the write returns false or undefined", async () => {
    const notify = jest.fn();

    const falseResult = await saveFrontmatterProperties({
      superstate: {
        spaceManager: { saveProperties: jest.fn(async () => false) },
        ui: { notify },
      } as any,
      path: "a.md",
      properties: { status: "active" },
    });
    const undefinedResult = await saveFrontmatterProperties({
      superstate: {
        spaceManager: {
          saveProperties: jest.fn(async (): Promise<undefined> => undefined),
        },
        ui: { notify },
      } as any,
      path: "a.md",
      properties: { status: "active" },
    });

    expect(falseResult.ok).toBe(false);
    expect(undefinedResult.ok).toBe(false);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("notifies and returns failure when the write throws", async () => {
    const notify = jest.fn();
    const error = new Error("denied");

    const result = await saveFrontmatterProperties({
      superstate: {
        spaceManager: {
          saveProperties: jest.fn(async () => {
            throw error;
          }),
        },
        ui: { notify },
      } as any,
      path: "a.md",
      properties: { status: "active" },
    });

    expect(result).toEqual({ ok: false, error });
    expect(notify).toHaveBeenCalled();
  });
});
