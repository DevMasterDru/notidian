// Contract for the "Turn on sub-items" front-door helper (bd Notidian-xqxc).
// enableSubItemsWithColumn must, in one action, either REUSE an existing
// eligible self-relation column or CREATE a frontmatter-backed link column, then
// set predicate.subItems.field — and must NEVER point the predicate at a column
// that saveColumn rejected. The created column shape is the hard round-trip
// invariant (type:"link", source:"frontmatter", table:"") asserted exactly here.
import { enableSubItemsWithColumn } from "./subItemsSetup";
import { DEFAULT_SETTINGS } from "core/schemas/settings";
import type { SpaceTableColumn } from "shared/types/mdb";

const linkCol = (name: string, over: Partial<SpaceTableColumn> = {}): SpaceTableColumn => ({
  name,
  type: "link",
  table: "",
  schemaId: "files",
  ...over,
});

describe("enableSubItemsWithColumn (Notidian-xqxc front-door)", () => {
  it("CREATE: no eligible col -> makes the exact frontmatter link column + sets the predicate", () => {
    const saveColumn = jest.fn(() => true);
    const savePredicate = jest.fn();
    const result = enableSubItemsWithColumn({
      cols: [{ name: "File", type: "file", table: "" }, { name: "status", type: "text", table: "" }],
      saveColumn,
      savePredicate,
    });

    expect(saveColumn).toHaveBeenCalledTimes(1);
    expect(saveColumn).toHaveBeenCalledWith({
      name: "Parent item",
      type: "link",
      value: "",
      table: "",
      schemaId: "files",
      source: "frontmatter",
    });
    expect(savePredicate).toHaveBeenCalledTimes(1);
    expect(savePredicate).toHaveBeenCalledWith({ subItems: { field: "Parent item" } });
    expect(result).toEqual({ ok: true, field: "Parent item", created: true });
  });

  it("REUSE: an existing eligible link col is designated, no column created", () => {
    const saveColumn = jest.fn(() => true);
    const savePredicate = jest.fn();
    const result = enableSubItemsWithColumn({
      cols: [{ name: "File", type: "file", table: "" }, linkCol("Parent")],
      saveColumn,
      savePredicate,
    });

    expect(saveColumn).not.toHaveBeenCalled();
    expect(savePredicate).toHaveBeenCalledWith({ subItems: { field: "Parent" } });
    expect(result).toEqual({ ok: true, field: "Parent", created: false });
  });

  it("REUSE prefers a link col over a context col (a context self-relation does not round-trip)", () => {
    const saveColumn = jest.fn(() => true);
    const savePredicate = jest.fn();
    const result = enableSubItemsWithColumn({
      // context col appears FIRST; the link col must still win.
      cols: [{ name: "rel", type: "context", table: "" }, linkCol("Parent")],
      saveColumn,
      savePredicate,
    });

    expect(saveColumn).not.toHaveBeenCalled();
    expect(result.field).toBe("Parent");
    expect(result.created).toBe(false);
  });

  it("REUSE: a lone eligible context col is still reused (the menu surfaces it; we honor it)", () => {
    const saveColumn = jest.fn(() => true);
    const savePredicate = jest.fn();
    const result = enableSubItemsWithColumn({
      cols: [{ name: "rel", type: "context", table: "" }],
      saveColumn,
      savePredicate,
    });

    expect(saveColumn).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, field: "rel", created: false });
  });

  it("does NOT reuse a HIDDEN eligible link col — it CREATES, matching the menu's 'creates' promise", () => {
    const saveColumn = jest.fn(() => true);
    const savePredicate = jest.fn();
    // The menu only offers the create option when no VISIBLE eligible col
    // exists, so a hidden eligible col must NOT be silently reused behind the
    // "creates Parent item column" label.
    const result = enableSubItemsWithColumn({
      cols: [linkCol("Parent", { hidden: "true" })],
      saveColumn,
      savePredicate,
    });

    expect(saveColumn).toHaveBeenCalledTimes(1);
    expect(saveColumn).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Parent item", type: "link", source: "frontmatter" })
    );
    expect(result.created).toBe(true);
  });

  it("dedupes against HIDDEN columns too (a hidden 'Parent item' forces 'Parent item 2')", () => {
    const saveColumn = jest.fn(() => true);
    const savePredicate = jest.fn();
    const result = enableSubItemsWithColumn({
      cols: [{ name: "Parent item", type: "text", table: "", hidden: "true" }],
      saveColumn,
      savePredicate,
    });

    expect(saveColumn).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Parent item 2" })
    );
    expect(result.field).toBe("Parent item 2");
  });

  it("uses the provided schemaId for the created column", () => {
    const saveColumn = jest.fn(() => true);
    const savePredicate = jest.fn();
    enableSubItemsWithColumn({
      cols: [],
      saveColumn,
      savePredicate,
      schemaId: "files",
    });
    expect(saveColumn).toHaveBeenCalledWith(
      expect.objectContaining({ schemaId: "files" })
    );
  });

  it("does NOT reuse a non-primary (table != '') link col — only self-relations qualify", () => {
    const saveColumn = jest.fn(() => true);
    const savePredicate = jest.fn();
    const result = enableSubItemsWithColumn({
      cols: [linkCol("OtherSpace", { table: "#project" })],
      saveColumn,
      savePredicate,
    });

    // No eligible self-relation -> falls through to CREATE.
    expect(saveColumn).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(true);
  });

  it("CREATE dedupes the name CASE-INSENSITIVELY to match saveColumn's guard", () => {
    const saveColumn = jest.fn(() => true);
    const savePredicate = jest.fn();
    // A non-eligible col already named "parent item" (lowercase) must force a
    // distinct name; a case-sensitive uniquifier would collide and saveColumn
    // would silently reject.
    const result = enableSubItemsWithColumn({
      cols: [{ name: "parent item", type: "text", table: "" }],
      saveColumn,
      savePredicate,
    });

    expect(saveColumn).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Parent item 2", type: "link", source: "frontmatter" })
    );
    expect(savePredicate).toHaveBeenCalledWith({ subItems: { field: "Parent item 2" } });
    expect(result.field).toBe("Parent item 2");
  });

  it("ABORT: saveColumn rejecting (returns false) leaves the predicate untouched", () => {
    const saveColumn = jest.fn(() => false);
    const savePredicate = jest.fn();
    const result = enableSubItemsWithColumn({
      cols: [{ name: "File", type: "file", table: "" }],
      saveColumn,
      savePredicate,
    });

    expect(savePredicate).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, field: null, created: false });
  });

  it("preserves existing subItems display/filterScope/collapsed keys (ADR 0050 spread)", () => {
    const saveColumn = jest.fn(() => true);
    const savePredicate = jest.fn();
    enableSubItemsWithColumn({
      cols: [{ name: "File", type: "file", table: "" }],
      saveColumn,
      savePredicate,
      currentSubItems: {
        field: "stale",
        display: "flattened",
        filterScope: "subItems",
        collapsed: ["A/B.md"],
      },
    });

    expect(savePredicate).toHaveBeenCalledWith({
      subItems: {
        field: "Parent item",
        display: "flattened",
        filterScope: "subItems",
        collapsed: ["A/B.md"],
      },
    });
  });

  // The front-door ships ON (owner verifies by USE) with a kill-switch; lock the
  // default so a future flip to false is a deliberate, reviewed change.
  it("ships default-ON (kill-switch)", () => {
    expect(DEFAULT_SETTINGS.subItemsSetup).toBe(true);
  });
});
