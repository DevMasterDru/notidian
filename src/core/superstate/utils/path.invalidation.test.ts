import { hidePaths } from "./path";

describe("hidePaths invalidated reload propagation", () => {
  it("returns reload results and suppresses the event when every reload is invalidated", async () => {
    const superstate = {
      settings: { hiddenFiles: [] },
      saveSettings: jest.fn(),
      reloadPath: jest.fn().mockResolvedValue(false),
      dispatchEvent: jest.fn(),
    } as any;

    await expect(hidePaths(superstate, ["A.md", "B.md"])).resolves.toEqual([false, false]);

    expect(superstate.reloadPath).toHaveBeenCalledTimes(2);
    expect(superstate.dispatchEvent).not.toHaveBeenCalled();
  });

  it("dispatches once when at least one reload remains valid", async () => {
    const superstate = {
      settings: { hiddenFiles: [] },
      saveSettings: jest.fn(),
      reloadPath: jest.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
      dispatchEvent: jest.fn(),
    } as any;

    await expect(hidePaths(superstate, ["A.md", "B.md"])).resolves.toEqual([false, true]);

    expect(superstate.dispatchEvent).toHaveBeenCalledWith("superstateUpdated", null);
  });
});
