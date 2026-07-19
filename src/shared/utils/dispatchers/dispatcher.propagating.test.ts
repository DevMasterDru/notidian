import { EventDispatcher } from "./dispatcher";

describe("EventDispatcher propagating failures", () => {
  it("collects every listener failure exactly once", async () => {
    const dispatcher = new EventDispatcher<{ event: null }>();
    dispatcher.addListener("event", () => { throw new Error("first"); });
    dispatcher.addListener("event", async () => { throw new Error("second"); });
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(dispatcher.dispatchEventPropagating("event", null)).rejects.toEqual(
      expect.objectContaining({
        name: "AggregateError",
        errors: [
          expect.objectContaining({ message: "first" }),
          expect.objectContaining({ message: "second" }),
        ],
      }),
    );
    errorLog.mockRestore();
  });
});
