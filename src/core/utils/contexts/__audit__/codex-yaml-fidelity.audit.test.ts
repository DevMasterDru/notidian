jest.mock("obsidian", () => ({ getAllTags: jest.fn() }), { virtual: true });
jest.mock("main", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("adapters/obsidian/utils/file", () => ({
  getAbstractFileAtPath: jest.fn(),
}));

import {
  removeLinkInValue,
  replaceLinkInValue,
  renameLinksInRow,
} from "core/utils/contexts/links";
import { PathPropertyName } from "shared/types/context";
import { defaultContextSchemaID } from "shared/schemas/context";
import { fieldTypeForField } from "schemas/mdb";
import { parseMDBStringValue } from "utils/properties";
import { shouldWriteAuthorityValueToFrontmatter } from "core/utils/properties/propertyAuthority";
import { executeTableValueWrites } from "../tableEditTransaction";

// F1 (links, bd Notidian-5tl) and F5 (clear-cell, bd Notidian-dnx) are FIXED here.
// F2 (tags, bd Notidian-c37) and F3 (deleteProperty, bd Notidian-7qb) were fixed
// in their own modules and now have dedicated correct-behavior tests
// (adapters/obsidian/utils/__audit__/tags-yaml-array.audit.test.ts and
// core/utils/contexts/__audit__/7qb-delete-await.audit.test.ts), so their
// obsolete characterization cases were removed from this file.
describe("codex audit repros for YAML fidelity findings", () => {
  it("F1 (FIXED): renaming a link in a multi-link value preserves unrelated links", () => {
    const value = JSON.stringify(["Old.md", "Other.md"]);

    // Only Old.md should become New.md; Other.md must be preserved (not collapsed
    // onto the old link). Regression guard for Notidian-5tl.
    expect(replaceLinkInValue("Old.md", "New.md", value)).toBe(
      JSON.stringify(["New.md", "Other.md"])
    );
  });

  it("F1 (FIXED): removeLinkInValue removes by parsed identity, including wikilink forms", () => {
    // Plain form
    expect(removeLinkInValue("Old.md", JSON.stringify(["Old.md", "Other.md"]))).toBe(
      JSON.stringify(["Other.md"])
    );
    // Wikilink form must actually be removed (the bug: detected but not removed).
    expect(
      removeLinkInValue("Old.md", JSON.stringify(["[[Old.md]]", "Other.md"]))
    ).toBe(JSON.stringify(["Other.md"]));
    // Duplicates of the target are all removed; unrelated links preserved.
    expect(
      removeLinkInValue(
        "Old.md",
        JSON.stringify(["[[Old.md]]", "Old.md", "Keep.md"])
      )
    ).toBe(JSON.stringify(["Keep.md"]));
  });

  it("F1 (FIXED): link maintenance writes only frontmatter-backed columns; Notidian-owned columns stay out of YAML", async () => {
    const manager = { saveProperties: jest.fn() };
    const row = {
      [PathPropertyName]: "Rows/A.md",
      related: JSON.stringify(["Old.md", "Other.md"]),
      relation: JSON.stringify(["Old.md"]),
    };

    const nextRow = await renameLinksInRow(
      manager as any,
      row,
      "Old.md",
      "New.md",
      [
        // frontmatter-backed link column -> may write to the file
        { name: "related", type: "link-multi", source: "frontmatter" } as any,
        // Notidian-owned (context/relation) column -> must NOT write to YAML
        { name: "relation", type: "context-multi" } as any,
      ]
    );

    // Both columns update in the returned row delta...
    expect(nextRow.related).toBe(JSON.stringify(["New.md", "Other.md"]));
    expect(nextRow.relation).toBe(JSON.stringify(["New.md"]));
    // ...but only the frontmatter-backed column is written to the Markdown file,
    // and unrelated links are preserved there too.
    expect(manager.saveProperties).toHaveBeenCalledTimes(1);
    expect(manager.saveProperties).toHaveBeenCalledWith("Rows/A.md", {
      related: ["[[New.md]]", "[[Other.md]]"],
    });
  });

  it("F5 (FIXED): clear-cell frontmatter writes become null, not typed junk", async () => {
    const parseValue = (column: { name: string; type: string }, value: string) =>
      parseMDBStringValue(fieldTypeForField(column as any), value, true);
    const savedFrontmatter: {
      path: string;
      properties: Record<string, unknown>;
    }[] = [];

    const result = await executeTableValueWrites({
      writes: [
        {
          rowId: "0",
          columnId: "rating",
          columnName: "rating",
          table: "",
          value: "",
          clear: true,
        },
        {
          rowId: "0",
          columnId: "done",
          columnName: "done",
          table: "",
          value: "",
          clear: true,
        },
        {
          rowId: "0",
          columnId: "labels",
          columnName: "labels",
          table: "",
          value: "",
          clear: true,
        },
      ],
      tableData: {
        schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
        cols: [
          { name: PathPropertyName, type: "file" },
          { name: "rating", type: "number", source: "frontmatter" },
          { name: "done", type: "boolean", source: "frontmatter" },
          { name: "labels", type: "option-multi", source: "frontmatter" },
        ],
        rows: [
          {
            [PathPropertyName]: "Rows/A.md",
            rating: "7",
            done: "true",
            labels: "one,two",
          },
        ],
      },
      contextTable: {},
      dbSchemaId: defaultContextSchemaID,
      contextPath: "Rows",
      resolvePath: (path) => path,
      shouldWritePropertyToFrontmatter: shouldWriteAuthorityValueToFrontmatter,
      parseValue,
      currentFrontmatterValue: ({ column }) => {
        if (column.name == "rating") return "7";
        if (column.name == "done") return "true";
        if (column.name == "labels") return "one,two";
        return undefined;
      },
      saveFrontmatterProperties: async ({ path, properties }) => {
        savedFrontmatter.push({ path, properties });
        return { ok: true };
      },
      saveDB: jest.fn(),
      saveContextDB: jest.fn(),
      contextKeyForTable: (tableName) => tableName,
    });

    expect(result).toMatchObject({ ok: true, applied: 3 });
    expect(savedFrontmatter).toEqual([
      {
        path: "Rows/A.md",
        properties: { rating: null, done: null, labels: null },
      },
    ]);
    expect(savedFrontmatter[0].properties.rating).not.toBeNaN();
    expect(savedFrontmatter[0].properties.done).not.toBe(false);
    expect(savedFrontmatter[0].properties.labels).not.toEqual([]);
  });

  it("F5 (FIXED): clearing a boolean frontmatter cell does not write false", async () => {
    const savedFrontmatter: {
      path: string;
      properties: Record<string, unknown>;
    }[] = [];

    await executeTableValueWrites({
      writes: [
        {
          rowId: "0",
          columnId: "done",
          columnName: "done",
          table: "",
          value: "",
          clear: true,
        },
      ],
      tableData: {
        schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
        cols: [
          { name: PathPropertyName, type: "file" },
          { name: "done", type: "boolean", source: "frontmatter" },
        ],
        rows: [{ [PathPropertyName]: "Rows/A.md", done: "true" }],
      },
      contextTable: {},
      dbSchemaId: defaultContextSchemaID,
      contextPath: "Rows",
      resolvePath: (path) => path,
      shouldWritePropertyToFrontmatter: shouldWriteAuthorityValueToFrontmatter,
      parseValue: (column, value) =>
        parseMDBStringValue(fieldTypeForField(column as any), value, true),
      currentFrontmatterValue: () => "true",
      saveFrontmatterProperties: async ({ path, properties }) => {
        savedFrontmatter.push({ path, properties });
        return { ok: true };
      },
      saveDB: jest.fn(),
      saveContextDB: jest.fn(),
      contextKeyForTable: (tableName) => tableName,
    });

    expect(savedFrontmatter).toEqual([
      { path: "Rows/A.md", properties: { done: null } },
    ]);
  });
});
