// Consumption-gate contract for an already-persisted sub-items config
// (bd Notidian-8k9b). resolveSubItemsCol resolves the configured parent-link
// column ONLY on the primary files schema; off-primary it returns null so a
// stale predicate (written by the pre-fix ungated designate path) renders no
// dead tree, no inline "+ New sub-item", and no delete subtree. Every sub-items
// consumer derives from this column, so the gate here neutralizes the whole
// surface in one seam.
import {
  resolveSubItemsCol,
  subItemsSchemaCanRoundTrip,
} from "./subItemsResolve";
import { defaultContextSchemaID } from "shared/schemas/context";
import { SpaceTableColumn } from "shared/types/mdb";

const col = (name: string, table = ""): SpaceTableColumn => ({
  name,
  type: "link",
  table,
});

describe("resolveSubItemsCol (bd Notidian-8k9b consumption gate)", () => {
  const PRIMARY = defaultContextSchemaID; // "files"
  // A primary-table self-relation column keys as name+table where table === "".
  const cols: SpaceTableColumn[] = [col("parent"), col("title"), col("status")];

  it("resolves the live parent-link column on the primary files schema", () => {
    expect(resolveSubItemsCol("parent", cols, PRIMARY)).toBe(cols[0]);
  });

  it.each([
    ["custom db table", "custom-db"],
    ["empty schema id", ""],
    ["a view id", "MyView"],
    ["undefined schema", undefined],
    ["null schema", null],
  ])(
    "returns null off the primary schema even when the field still resolves: %s",
    (_label, schemaId) => {
      // The exact stale-predicate-on-non-primary state the bead targets: the
      // field DOES match an existing eligible column, but the schema can't
      // materialize the tree, so the config must be ignored.
      expect(
        resolveSubItemsCol("parent", cols, schemaId as string | null | undefined)
      ).toBeNull();
    }
  );

  it("returns null when sub-items is off (no field) regardless of schema", () => {
    expect(resolveSubItemsCol(undefined, cols, PRIMARY)).toBeNull();
    expect(resolveSubItemsCol(null, cols, PRIMARY)).toBeNull();
    expect(resolveSubItemsCol("", cols, PRIMARY)).toBeNull();
  });

  it("returns null on the primary schema when the field no longer resolves to a column", () => {
    expect(resolveSubItemsCol("deletedCol", cols, PRIMARY)).toBeNull();
  });

  it("matches on name+table so a non-primary-table column key resolves correctly", () => {
    const linked = col("ref", "OtherTable");
    expect(
      resolveSubItemsCol("refOtherTable", [...cols, linked], PRIMARY)
    ).toBe(linked);
  });
});

describe("subItemsSchemaCanRoundTrip (write-path guard)", () => {
  it("is true only for the primary files schema", () => {
    expect(subItemsSchemaCanRoundTrip(defaultContextSchemaID)).toBe(true);
  });

  it.each([["custom-db"], [""], ["MyView"], [undefined], [null]])(
    "is false off-primary: %s",
    (schemaId) => {
      expect(
        subItemsSchemaCanRoundTrip(schemaId as string | null | undefined)
      ).toBe(false);
    }
  );
});
