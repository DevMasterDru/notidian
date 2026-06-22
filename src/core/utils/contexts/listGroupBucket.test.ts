import { rowMatchesGroupOption } from "./listGroupBucket";
import { filterFnTypes } from "./predicate/filterFns/filterFnTypes";

// The default group filter used by the list/board grouped views.
const isFilter = filterFnTypes.is;

describe("rowMatchesGroupOption (Notidian-kxka)", () => {
  const textCol = { name: "Status", table: "", type: "text" };

  it("routes a row MISSING the grouped property into the None bucket, not into nothing", () => {
    const row = { File: "Note 3" } as any; // no Status key at all -> undefined

    // The regression: undefined == "" is false, so before the fix this row
    // matched NO option and disappeared from every grouped view.
    expect(rowMatchesGroupOption(row, textCol, "", isFilter)).toBe(true);
    // ...and it must NOT also leak into a real-valued bucket.
    expect(rowMatchesGroupOption(row, textCol, "Open", isFilter)).toBe(false);
  });

  it("routes an EMPTY-string value into the None bucket too (same bucket as missing)", () => {
    const row = { Status: "" } as any;
    expect(rowMatchesGroupOption(row, textCol, "", isFilter)).toBe(true);
    expect(rowMatchesGroupOption(row, textCol, "Open", isFilter)).toBe(false);
  });

  it("routes a valued row into its own bucket and out of None", () => {
    const row = { Status: "Open" } as any;
    expect(rowMatchesGroupOption(row, textCol, "Open", isFilter)).toBe(true);
    expect(rowMatchesGroupOption(row, textCol, "", isFilter)).toBe(false);
    expect(rowMatchesGroupOption(row, textCol, "Done", isFilter)).toBe(false);
  });

  it("does not coerce a falsy-but-real value like '0' into None", () => {
    const numCol = { name: "Count", table: "", type: "number" };
    const row = { Count: "0" } as any;
    // "0" is a real value, distinct from the no-value bucket.
    expect(rowMatchesGroupOption(row, numCol, "", filterFnTypes.equal)).toBe(
      false
    );
    expect(rowMatchesGroupOption(row, numCol, "0", filterFnTypes.equal)).toBe(
      true
    );
  });

  describe("multi-value fields", () => {
    const multiCol = { name: "Tags", table: "", type: "option-multi" };

    it("places a row with no parsed values into None", () => {
      expect(
        rowMatchesGroupOption({ Tags: "" } as any, multiCol, "", isFilter)
      ).toBe(true);
      expect(
        rowMatchesGroupOption({ Other: "x" } as any, multiCol, "", isFilter)
      ).toBe(true); // missing key -> undefined -> None
    });

    it("places a multi-value row into each option it contains, and out of None", () => {
      const row = { Tags: "a, b" } as any;
      expect(rowMatchesGroupOption(row, multiCol, "a", isFilter)).toBe(true);
      expect(rowMatchesGroupOption(row, multiCol, "b", isFilter)).toBe(true);
      expect(rowMatchesGroupOption(row, multiCol, "c", isFilter)).toBe(false);
      expect(rowMatchesGroupOption(row, multiCol, "", isFilter)).toBe(false);
    });
  });
});
