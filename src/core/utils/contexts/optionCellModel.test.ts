import { parseMultiString } from "utils/parsers";
import {
  normalizeOptionCellSelection,
  optionCellMenuSavePayload,
  serializeOptionCellSelection,
} from "./optionCellModel";

describe("optionCellModel", () => {
  it("keeps only the selected value for Select", () => {
    expect(
      normalizeOptionCellSelection({
        currentValues: ["old"],
        incomingValues: ["new"],
        multi: false,
      })
    ).toEqual(["new"]);
  });

  it("keeps number-like and boolean-like Select option values", () => {
    expect(
      normalizeOptionCellSelection({
        currentValues: ["old"],
        incomingValues: [0, false, true] as unknown as string[],
        multi: false,
      })
    ).toEqual(["true"]);
  });

  it("clears Select when the menu chooses none", () => {
    expect(
      normalizeOptionCellSelection({
        currentValues: ["old"],
        incomingValues: [""],
        multi: false,
      })
    ).toEqual([]);
  });

  it("keeps the complete selected value set for Multi-select", () => {
    expect(
      normalizeOptionCellSelection({
        currentValues: ["one"],
        incomingValues: ["one", "two", "two", ""],
        multi: true,
      })
    ).toEqual(["one", "two"]);
  });

  it("serializes Select as the visible scalar value", () => {
    expect(serializeOptionCellSelection(["active"], false)).toBe("active");
    expect(serializeOptionCellSelection([], false)).toBe("");
  });

  it("serializes Multi-select as a JSON array string", () => {
    const serialized = serializeOptionCellSelection(["active", "paused"], true);

    expect(parseMultiString(serialized)).toEqual(["active", "paused"]);
  });

  it("builds a direct Select save payload for an existing option click", () => {
    expect(
      optionCellMenuSavePayload({
        optionValues: ["todo", "review"],
        incomingValues: ["review"],
        multi: false,
      })
    ).toEqual({
      optionValues: ["todo", "review"],
      selectedValues: ["review"],
    });
  });

  it("builds a direct Select save payload for clearing the selection", () => {
    expect(
      optionCellMenuSavePayload({
        optionValues: ["todo", "review"],
        incomingValues: [""],
        multi: false,
      })
    ).toEqual({
      optionValues: ["todo", "review"],
      selectedValues: [],
    });
  });
});
