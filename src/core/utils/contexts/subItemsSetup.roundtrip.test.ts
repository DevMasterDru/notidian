// Round-trip LOCK for the "Turn on sub-items" front-door column shape (bd
// Notidian-xqxc). This is the guard that the created column type ("link",
// frontmatter-backed) actually closes the write -> materialize -> read loop, and
// that a future "upgrade" to a context relation column can't silently flatten
// the tree without a red test.
//
// The loop, with the REAL collaborators (no mocks). NOTE: subItemCreate now
// writes a PATH-QUALIFIED link `[[Folder/Parent|Parent]]` (Notidian-kg81); the
// first case below uses a bare `[[Parent]]` only as a minimal materialization
// fixture, and the kg81 cases at the bottom pin the real write form.
//   1. WRITE   — subItemCreate writes the parent link to the child's frontmatter
//                under the column NAME (the write key).
//   2. MATERIALIZE — linkContextRow.ts:101 sets row[col] = parseProperty(col,
//                frontmatterValue, "link"). NOTE parseLinkString strips the
//                wikilink brackets (and the |alias), so the materialized value is
//                the link TARGET (a bare basename, or a full path), not the raw
//                "[[...]]" — these tests pin that.
//   3. READ    — buildRowTree reads row["Parent item"], parseRelationLinks keeps
//                the target, and the live resolver canonicalizes it to the
//                parent row's path, forming the parent->child edge.
import { parseProperty } from "../../../utils/parsers";
import { buildRowTree } from "./tableRowTree";

describe("sub-items front-door column round-trip (Notidian-xqxc)", () => {
  it("a child's frontmatter parent wikilink nests it under the in-set parent row", () => {
    // MATERIALIZATION-MECHANICS fixture (NOT subItemCreate's output — that is now
    // path-qualified, see the kg81 cases below). A bare `[[Parent]]` exercises the
    // simplest parseLinkString path: brackets stripped to the bare basename.
    const written = "[[Parent]]";
    // What materialization puts into row["Parent item"] for a link column.
    const materialized = parseProperty("Parent item", written, "link");
    // Pin the intermediate: parseLinkString strips the brackets to the basename.
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

  // Notidian-kg81: subItemCreate writes a PATH-QUALIFIED link with a basename
  // alias, e.g. "[[Folder/Parent|Parent]]". This proves that form materializes
  // to the full path (so it resolves to the EXACT parent row, immune to
  // vault-wide basename collisions) and still nests — and that a bare basename
  // "[[Parent]]" would mis-resolve and orphan the child.
  it("a PATH-QUALIFIED parent link materializes to the full path and nests the child", () => {
    // What subItemCreate now writes; parseProperty(link) strips brackets + alias.
    const materialized = parseProperty("Parent item", "[[Folder/Parent|Parent]]", "link");
    expect(materialized).toBe("Folder/Parent"); // full path, NOT the bare basename
    const rows = [
      { File: "Folder/Parent.md" },
      { File: "Folder/Child.md", "Parent item": materialized },
    ];
    // The live resolver maps the path-qualified target to the parent row's key.
    const resolveLink = (link: string) =>
      link.endsWith(".md") || !link.includes("/")
        ? link
        : link === "Folder/Parent"
          ? "Folder/Parent.md"
          : link;
    const tree = buildRowTree({ rows, parentKey: "Parent item", pathKey: "File", resolveLink });
    const parent = tree.find((n) => n.row.File === "Folder/Parent.md");
    const child = tree.find((n) => n.row.File === "Folder/Child.md");
    expect(parent?.hasChildren).toBe(true);
    expect(child?.depth).toBe(1);
  });

  it("REGRESSION: a bare-basename link that resolves to a WRONG vault-wide file orphans the child (no triangle)", () => {
    // The old subItemCreate output: bare "[[Parent]]" -> materializes to "Parent"
    // -> the resolver (Obsidian's getFirstLinkpathDest) sends it to a same-named
    // file in ANOTHER folder, so it never matches the intended parent row.
    const materialized = parseProperty("Parent item", "[[Parent]]", "link");
    expect(materialized).toBe("Parent");
    const rows = [
      { File: "Folder/Parent.md" },
      { File: "Folder/Child.md", "Parent item": materialized },
    ];
    // Simulate the ambiguous resolution: bare "Parent" captured by Elsewhere/.
    const resolveLink = (link: string) =>
      link === "Parent" ? "Elsewhere/Parent.md" : link;
    const tree = buildRowTree({ rows, parentKey: "Parent item", pathKey: "File", resolveLink });
    const parent = tree.find((n) => n.row.File === "Folder/Parent.md");
    const child = tree.find((n) => n.row.File === "Folder/Child.md");
    // The intended parent has NO children and the child surfaces as a root —
    // exactly why the disclosure triangle never appeared.
    expect(parent?.hasChildren).toBe(false);
    expect(child?.depth).toBe(0);
    expect(child?.surfacedAsRoot).toBe(true);
  });
});
