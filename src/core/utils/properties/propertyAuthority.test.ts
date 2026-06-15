import { PathPropertyName } from "shared/types/context";
import { frontmatterPropertySource } from "./allProperties";
import {
  notidianPropertySource,
  propertyAuthorityForColumn,
  shouldPersistAuthorityValueToContext,
  shouldWriteAuthorityValueToFrontmatter,
} from "./propertyAuthority";

describe("propertyAuthorityForColumn", () => {
  it("classifies file identity, frontmatter, and computed columns", () => {
    expect(
      propertyAuthorityForColumn({ name: PathPropertyName, type: "file" })
    ).toBe("file");
    expect(
      propertyAuthorityForColumn({
        name: "status",
        type: "text",
        source: frontmatterPropertySource,
      })
    ).toBe("frontmatter");
    expect(propertyAuthorityForColumn({ name: "age", type: "fileprop" })).toBe(
      "computed"
    );
  });

  it("requires an explicit source:notidian marker for durable MDB ownership", () => {
    // The "Notidian-owned field" choice persists source: "notidian"; only then
    // does a file-backed-compatible column durably store its value in the MDB.
    expect(
      propertyAuthorityForColumn({
        name: "manual",
        type: "text",
        source: notidianPropertySource,
      })
    ).toBe("notidian");
    expect(
      shouldPersistAuthorityValueToContext({
        name: "manual",
        type: "text",
        source: notidianPropertySource,
      })
    ).toBe(true);
    expect(
      shouldWriteAuthorityValueToFrontmatter({
        name: "manual",
        type: "text",
        source: notidianPropertySource,
      })
    ).toBe(false);
  });

  it("never silently flips an unmarked file-backed column into the hidden store (bd Notidian-2j3)", () => {
    // A source-less ordinary column defaults to the visible frontmatter layer,
    // NOT durable MDB ownership — this closes the fallback-to-notidian hole that
    // let a missing/lost source marker hand file-backed data to the hidden MDB.
    for (const type of [
      "text",
      "number",
      "boolean",
      "date",
      "option",
      "option-multi",
      "link",
      "image",
      "password",
      "tags-multi",
    ]) {
      expect(propertyAuthorityForColumn({ name: "x", type })).toBe(
        "frontmatter"
      );
    }
    expect(
      shouldWriteAuthorityValueToFrontmatter({ name: "manual", type: "text" })
    ).toBe(true);
    expect(
      shouldPersistAuthorityValueToContext({ name: "manual", type: "text" })
    ).toBe(false);
  });

  it("keeps source-less context-only types Notidian-owned (no frontmatter representation)", () => {
    // Relation/object/flex types cannot live in frontmatter, so the MDB is their
    // only durable home even without an explicit marker — behavior unchanged.
    for (const type of ["context", "object", "flex"]) {
      expect(propertyAuthorityForColumn({ name: "rel", type })).toBe("notidian");
      expect(
        shouldPersistAuthorityValueToContext({ name: "rel", type })
      ).toBe(true);
      expect(
        shouldWriteAuthorityValueToFrontmatter({ name: "rel", type })
      ).toBe(false);
    }
  });

  it("resolves a computed type BEFORE any source marker (computed wins over source:frontmatter/notidian)", () => {
    // Precedence fix (bd DEPTH-apiValueWriteTarget-authority-matrix): the
    // computedTypes check runs before the `source` markers, so a computed column
    // carrying a stray source marker (mislabel / corrupt MDB / materialization
    // match on a same-named frontmatter key) still classifies as "computed" and
    // never leaks a DERIVED value into YAML or the MDB. Previously source:
    // "frontmatter" was checked first and mislabeled such a column "frontmatter".
    for (const type of ["fileprop", "aggregate", "rollup", "backlink"]) {
      expect(
        propertyAuthorityForColumn({
          name: "derived",
          type,
          source: frontmatterPropertySource,
        })
      ).toBe("computed");
      expect(
        propertyAuthorityForColumn({
          name: "derived",
          type,
          source: notidianPropertySource,
        })
      ).toBe("computed");
    }
  });

  it("classifies rollup and backlink as computed/read-only (no write-through)", () => {
    expect(propertyAuthorityForColumn({ name: "total", type: "rollup" })).toBe(
      "computed"
    );
    expect(
      propertyAuthorityForColumn({ name: "linkedFrom", type: "backlink" })
    ).toBe("computed");
    // Computed columns must not persist a pasted/undone value into context.
    expect(
      shouldPersistAuthorityValueToContext({ name: "total", type: "rollup" })
    ).toBe(false);
    expect(
      shouldPersistAuthorityValueToContext({
        name: "linkedFrom",
        type: "backlink",
      })
    ).toBe(false);
  });

  it("does not persist frontmatter or computed values as durable context values", () => {
    expect(
      shouldPersistAuthorityValueToContext({
        name: PathPropertyName,
        type: "file",
      })
    ).toBe(true);
    expect(
      shouldPersistAuthorityValueToContext({
        name: "status",
        type: "text",
        source: frontmatterPropertySource,
      })
    ).toBe(false);
    expect(
      shouldPersistAuthorityValueToContext({ name: "age", type: "fileprop" })
    ).toBe(false);
  });
});
