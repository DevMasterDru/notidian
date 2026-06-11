import { defaultContextSchemaID } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { PathPropertyName } from "shared/types/context";
import { MakeMDSettings } from "shared/types/settings";
import {
  frontmatterPropertySource,
  materializeFrontmatterBackedContextTable,
} from "../allProperties";

const settings = {
  fmKeyAlias: "aliases",
  fmKeyBanner: "banner",
  fmKeyBannerOffset: "banner_y",
  fmKeyColor: "color",
  fmKeySticker: "sticker",
} as MakeMDSettings;

const trackedPathState = (
  property: Record<string, unknown>,
  onRead: () => void
) => {
  const metadata = {};
  Object.defineProperty(metadata, "property", {
    get: () => {
      onRead();
      return property;
    },
  });

  return { metadata } as any;
};

describe("materializeFrontmatterBackedContextTable frontmatter scan cost", () => {
  it("reuses one observed frontmatter pass while preserving materialized columns", () => {
    let propertyReads = 0;
    const pathsIndex = new Map<string, any>([
      [
        "a.md",
        trackedPathState(
          {
            status: "active",
            area: "Veg",
          },
          () => {
            propertyReads += 1;
          }
        ),
      ],
    ]);

    const result = materializeFrontmatterBackedContextTable(
      {
        schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
        cols: [
          ...(defaultContextFields.rows as any),
          { name: "status", type: "text", value: "", schemaId: "files" },
        ],
        rows: [{ [PathPropertyName]: "a.md", status: "active" }],
      },
      pathsIndex,
      ["a.md"],
      settings,
      true
    );

    expect(result.table.cols).toEqual([
      ...(defaultContextFields.rows as any),
      {
        name: "status",
        type: "text",
        value: "",
        schemaId: "files",
        source: frontmatterPropertySource,
      },
      {
        name: "area",
        type: "text",
        value: "",
        schemaId: "files",
        source: frontmatterPropertySource,
      },
    ]);
    expect(propertyReads).toBe(1);
  });
});
