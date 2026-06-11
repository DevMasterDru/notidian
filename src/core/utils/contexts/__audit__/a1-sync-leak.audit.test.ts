import { defaultContextDBSchema } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { PathPropertyName } from "shared/types/context";
import { IndexMap } from "shared/types/indexMap";
import { SpaceTable } from "shared/types/mdb";
import { PathState } from "shared/types/PathState";
import { MakeMDSettings } from "shared/types/settings";
import {
  frontmatterPropertySource,
  materializeFrontmatterBackedContextTable,
  stripFrontmatterBackedRowValues,
} from "core/utils/properties/allProperties";
import { linkContextRow, syncContextRow } from "../linkContextRow";

const settings = {
  autoImportObsidianPropertiesToContexts: true,
  fmKeyAlias: "aliases",
  fmKeyBanner: "banner",
  fmKeyBannerOffset: "banner_y",
  fmKeyColor: "color",
  fmKeySticker: "sticker",
} as MakeMDSettings;

describe("audit a1-synccontextrow-leak", () => {
  it("does not overlay YAML onto unmarked mixed-context columns", () => {
    const spacePath = "Relays & Devices";
    const filePath = "Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md";
    const spaceState = { path: spacePath, type: "space" } as unknown as PathState;
    const pathsIndex = new Map<string, PathState>([
      [spacePath, spaceState],
      [
        filePath,
        {
          path: filePath,
          type: "path",
          metadata: {
            property: {
              canonicalStatus: "frontmatter-visible",
              status: "frontmatter-active",
            },
          },
        } as unknown as PathState,
      ],
    ]);
    const persistedMixedContext: SpaceTable = {
      schema: defaultContextDBSchema,
      cols: [
        ...(defaultContextFields.rows as any),
        {
          name: "canonicalStatus",
          type: "text",
          value: "",
          schemaId: "files",
          source: frontmatterPropertySource,
        },
        { name: "status", type: "text", value: "", schemaId: "files" },
        { name: "manual", type: "text", value: "", schemaId: "files" },
      ],
      rows: [
        {
          [PathPropertyName]: filePath,
          canonicalStatus: "old-frontmatter-snapshot",
          status: "old-context-shadow",
          manual: "notidian-owned",
        },
      ],
    };

    const materialized = materializeFrontmatterBackedContextTable(
      persistedMixedContext,
      pathsIndex,
      [filePath],
      settings,
      true
    ).table;
    const syncedRow = syncContextRow(
      pathsIndex,
      materialized.rows[0],
      materialized.cols,
      spaceState
    );
    const linkedRow = linkContextRow(
      null as any,
      pathsIndex,
      new Map(),
      new IndexMap(),
      syncedRow,
      materialized.cols,
      spaceState,
      settings,
      []
    );
    const persistedAfterReload = stripFrontmatterBackedRowValues({
      ...materialized,
      rows: [linkedRow],
    });

    // Only explicit frontmatter-backed columns project YAML values. A sourceless
    // mixed-context column remains Notidian-owned even when its name matches YAML.
    expect(
      materialized.cols.find((col) => col.name == "status")?.source
    ).toBeUndefined();
    expect(linkedRow.canonicalStatus).toBe("frontmatter-visible");
    expect(linkedRow.status).toBe("old-context-shadow");
    expect(persistedAfterReload.rows[0]).toMatchObject({
      [PathPropertyName]: filePath,
      status: "old-context-shadow",
      manual: "notidian-owned",
    });
    expect(persistedAfterReload.rows[0]).not.toHaveProperty(
      "canonicalStatus"
    );
  });
});
