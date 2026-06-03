import { applyFrontmatterSchemaWritePlans } from "./notidianSchemaApply";

describe("applyFrontmatterSchemaWritePlans", () => {
  it("sets replacement frontmatter before removing the old key", async () => {
    const calls: string[] = [];
    const saveProperties = jest.fn(async () => {
      calls.push("set");
      return { ok: true as const };
    });
    const deleteProperty = jest.fn(async () => {
      calls.push("remove");
      return { ok: true as const };
    });

    const result = await applyFrontmatterSchemaWritePlans({
      writes: [
        {
          path: "Relays & Devices/A.md",
          set: { state: "active" },
          removeKeys: ["status"],
        },
      ],
      saveProperties,
      deleteProperty,
    });

    expect(result).toEqual({
      ok: true,
      applied: 1,
      failed: [],
    });
    expect(saveProperties).toHaveBeenCalledWith("Relays & Devices/A.md", {
      state: "active",
    });
    expect(deleteProperty).toHaveBeenCalledWith(
      "Relays & Devices/A.md",
      "status"
    );
    expect(calls).toEqual(["set", "remove"]);
  });

  it("does not remove the old key when setting the replacement fails", async () => {
    const error = new Error("write failed");
    const deleteProperty = jest.fn();

    const result = await applyFrontmatterSchemaWritePlans({
      writes: [
        {
          path: "Relays & Devices/A.md",
          set: { state: "active" },
          removeKeys: ["status"],
        },
        {
          path: "Relays & Devices/B.md",
          set: { state: "queued" },
          removeKeys: ["status"],
        },
      ],
      saveProperties: jest.fn(async () => ({ ok: false as const, error })),
      deleteProperty,
    });

    expect(result).toEqual({
      ok: false,
      applied: 0,
      failed: [
        {
          path: "Relays & Devices/A.md",
          phase: "set",
          error,
        },
      ],
    });
    expect(deleteProperty).not.toHaveBeenCalled();
  });

  it("supports remove-only writes for duplicate equal frontmatter keys", async () => {
    const saveProperties = jest.fn();
    const deleteProperty = jest.fn(async () => ({ ok: true as const }));

    const result = await applyFrontmatterSchemaWritePlans({
      writes: [
        {
          path: "Relays & Devices/C.md",
          set: {},
          removeKeys: ["status"],
        },
      ],
      saveProperties,
      deleteProperty,
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    expect(saveProperties).not.toHaveBeenCalled();
    expect(deleteProperty).toHaveBeenCalledWith(
      "Relays & Devices/C.md",
      "status"
    );
  });
});
