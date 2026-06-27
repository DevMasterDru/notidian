import {
  attrsWithTextGroupOrder,
  effectiveTextGroupOrder,
  parseTextGroupOrder,
  reorderGroupedIslandOptions,
  serializeTextGroupOrder,
  textGroupOrderFromAttrs,
} from "./groupedIslandOrder";

describe("text-backed grouped island order", () => {
  it("uses a view override before the column global order, retaining new values stably", () => {
    const observed = ["Gamma", "Beta", "Alpha", "Delta"];
    const global = parseTextGroupOrder(
      serializeTextGroupOrder(["Beta", "Alpha", "Beta", ""])
    );

    expect(
      effectiveTextGroupOrder({
        observed,
        global,
        view: ["Alpha", "Beta"],
      })
    ).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
  });

  it("uses a valid column order when no view override exists", () => {
    expect(
      effectiveTextGroupOrder({
        observed: ["Gamma", "Beta", "Alpha"],
        global: parseTextGroupOrder('["Beta", "Alpha"]'),
      })
    ).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("falls back to observed order when stored global configuration is malformed", () => {
    expect(
      effectiveTextGroupOrder({
        observed: ["First", "Second"],
        global: parseTextGroupOrder("not JSON"),
      })
    ).toEqual(["First", "Second"]);
  });

  it("reads a global order from the persisted field metadata envelope", () => {
    expect(
      textGroupOrderFromAttrs(
        JSON.stringify({ icon: "lucide-circle", notidianGroupOrder: ["Done", "Open"] })
      )
    ).toEqual(["Done", "Open"]);
    expect(textGroupOrderFromAttrs("not JSON")).toEqual([]);
  });

  it("writes the global order without replacing other field metadata", () => {
    expect(
      JSON.parse(
        attrsWithTextGroupOrder(
          JSON.stringify({ icon: "lucide-circle", displayMode: "compact" }),
          ["Done", "Open", "Done", ""]
        )!
      )
    ).toEqual({
      icon: "lucide-circle",
      displayMode: "compact",
      notidianGroupOrder: ["Done", "Open"],
    });
    expect(
      attrsWithTextGroupOrder(
        JSON.stringify({ icon: "lucide-circle", notidianGroupOrder: ["Done"] }),
        []
      )
    ).toBe(JSON.stringify({ icon: "lucide-circle" }));
  });

  it("reorders a group when its draggable handle is dropped over another group", () => {
    expect(
      reorderGroupedIslandOptions(["Open", "In progress", "Done"], "Done", "Open")
    ).toEqual(["Done", "Open", "In progress"]);
    expect(
      reorderGroupedIslandOptions(["Open", "Done"], "missing", "Done")
    ).toEqual(["Open", "Done"]);
  });
});
