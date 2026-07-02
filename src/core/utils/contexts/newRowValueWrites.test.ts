import { PathPropertyName } from "shared/types/context";
import { SpaceTableColumn } from "shared/types/mdb";
import { partitionNewRowValuesByAuthority } from "./newRowValueWrites";

const columns: SpaceTableColumn[] = [
  { name: PathPropertyName, type: "file", table: "" },
  // Notidian-owned select column — value lives in the folder's context MDB.
  { name: "Status", type: "option", source: "notidian", table: "" },
  // Frontmatter-backed column — value lives in the file's YAML.
  { name: "Owner", type: "text", source: "frontmatter", table: "" },
  // Computed column — never seeded.
  { name: "Count", type: "aggregate", table: "" },
  // A context-only type with no source marker resolves to notidian ownership.
  { name: "Links", type: "context", table: "" },
  // A linked-context column (table != "") is not the folder's to seed here.
  { name: "Budget", type: "number", source: "frontmatter", table: "#client" },
];

describe("partitionNewRowValuesByAuthority", () => {
  it("routes source:notidian root values to the context partition (Notidian-i7jl)", () => {
    const partition = partitionNewRowValuesByAuthority(
      { Status: "Active", Owner: "Dru" },
      columns
    );
    expect(partition.context).toEqual({ Status: "Active" });
    expect(partition.frontmatter).toEqual({ Owner: "Dru" });
  });

  it("routes context-only (source-less) types to the context partition", () => {
    const partition = partitionNewRowValuesByAuthority({ Links: "[[A]]" }, columns);
    expect(partition.context).toEqual({ Links: "[[A]]" });
    expect(partition.frontmatter).toEqual({});
  });

  it("drops computed columns, the File identity key, and unmatched columns", () => {
    const partition = partitionNewRowValuesByAuthority(
      {
        [PathPropertyName]: "Space/New.md",
        Count: "9",
        Unknown: "keep-out",
      },
      columns
    );
    expect(partition.frontmatter).toEqual({});
    expect(partition.context).toEqual({});
  });

  it("does not seed linked-context columns from the new row (root columns only)", () => {
    const partition = partitionNewRowValuesByAuthority({ Budget: "5000" }, columns);
    // "Budget" only matches a table:"#client" column, not a root column.
    expect(partition.frontmatter).toEqual({});
    expect(partition.context).toEqual({});
  });

  it("coerces values to strings and returns empty partitions for no data", () => {
    expect(partitionNewRowValuesByAuthority(undefined, columns)).toEqual({
      frontmatter: {},
      context: {},
    });
    const partition = partitionNewRowValuesByAuthority(
      { Status: 5 as unknown as string, Owner: null as unknown as string },
      columns
    );
    expect(partition.context).toEqual({ Status: "5" });
    expect(partition.frontmatter).toEqual({ Owner: "" });
  });

  it("partitions a grouped-header create plan across both stores (Notidian-i7jl)", () => {
    // planGroupedRowCreate emits values keyed by column name: the group value
    // plus inherited/continued defaults. Both a Notidian-owned group column and
    // a frontmatter default must reach their own store.
    const partition = partitionNewRowValuesByAuthority(
      { Status: "Active", Owner: "Dru" },
      columns
    );
    expect(partition).toEqual({
      frontmatter: { Owner: "Dru" },
      context: { Status: "Active" },
    });
  });
});
