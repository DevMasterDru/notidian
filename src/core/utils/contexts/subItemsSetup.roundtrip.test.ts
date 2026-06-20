// Round-trip LOCK for the "Turn on sub-items" front-door column shape (bd
// Notidian-xqxc). This is the guard that the created column type ("link",
// frontmatter-backed) actually closes the write -> materialize -> read loop, and
// that a future "upgrade" to a context relation column can't silently flatten
// the tree without a red test.
//
// The loop, with the REAL collaborators (no mocks):
//   1. WRITE   — subItemCreate writes `Parent item: "[[Parent]]"` to the child's
//                frontmatter (the column NAME is the write key).
//   2. MATERIALIZE — linkContextRow.ts:101 sets row[col] = parseProperty(col,
//                frontmatterValue, "link"). NOTE parseLinkString strips the
//                wikilink brackets, so the materialized value is the BARE
//                basename "Parent", not "[[Parent]]" — this test pins that.
//   3. READ    — buildRowTree reads row["Parent item"], parseRelationLinks keeps
//                the bare basename, and the live resolver canonicalizes it to the
//                parent row's path, forming the parent->child edge.
import { parseProperty } from "../../../utils/parsers";
import { buildRowTree } from "./tableRowTree";

describe("sub-items front-door column round-trip (Notidian-xqxc)", () => {
  it("a child's frontmatter parent wikilink nests it under the in-set parent row", () => {
    // (1) What subItemCreate writes under the created "Parent item" link column.
    const written = "[[Parent]]";
    // (2) What materialization puts into row["Parent item"] for a link column.
    const materialized = parseProperty("Parent item", written, "link");
    // Pin the real (perhaps surprising) intermediate: parseLinkString strips the
    // brackets to the bare basename.
    expect(materialized).toBe("Parent");

    const rows = [
      { File: "Folder/Parent.md" },
      { File: "Folder/Child.md", "Parent item": materialized },
    ];
    // The live makeRelationLinkResolver canonicalizes a bare basename to the
    // sibling row's path; emulate just enough of that here.
    const resolveLink = (link: string) =>
      link.includes("/") ? link : `Folder/${link}.md`;

    const tree = buildRowTree({
      rows,
      parentKey: "Parent item", // name + table, table == "" for a primary col
      pathKey: "File",
      resolveLink,
    });

    const parent = tree.find((n) => n.row.File === "Folder/Parent.md");
    const child = tree.find((n) => n.row.File === "Folder/Child.md");
    expect(parent?.depth).toBe(0);
    expect(parent?.hasChildren).toBe(true);
    expect(child?.depth).toBe(1);
    // Not an orphan/cycle artifact — a real nested child.
    expect(child?.surfacedAsRoot).toBe(false);
  });

  it("a parent with no parent-link value is a genuine root (flat until a child is added)", () => {
    const rows = [{ File: "Folder/Parent.md" }];
    const tree = buildRowTree({
      rows,
      parentKey: "Parent item",
      pathKey: "File",
      resolveLink: (link: string) => link,
    });
    expect(tree).toHaveLength(1);
    expect(tree[0].depth).toBe(0);
    expect(tree[0].hasChildren).toBe(false);
    expect(tree[0].surfacedAsRoot).toBe(false);
  });
});
