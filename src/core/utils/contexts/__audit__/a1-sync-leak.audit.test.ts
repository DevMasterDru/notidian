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
import { notidianPropertySource } from "core/utils/properties/propertyAuthority";
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
  // Regression test (flipped from a characterization of the old buggy behavior):
  // After bd Notidian-2j3 / ADR 0017, an UNMARKED file-backed column reflects the
  // live frontmatter value instead of a stale hidden-MDB shadow, while an
  // EXPLICITLY Notidian-owned column is still never overlaid by YAML — preserving
  // the original A1-leak fix.
  it("reflects live frontmatter for unmarked columns but never overlays YAML onto explicit Notidian-owned columns", () => {
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
        // Unmarked column whose name matches a live frontmatter key (the bug case).
        { name: "status", type: "text", value: "", schemaId: "files" },
        // Explicitly Notidian-owned column with no frontmatter representation.
        {
          name: "manual",
          type: "text",
          value: "",
          schemaId: "files",
          source: notidianPropertySource,
        },
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

    // The mixed table is not auto-materialized (it carries an explicit
    // Notidian-owned column that is not present in any file's frontmatter), so
    // the unmarked "status" column keeps its source-less shape on disk.
    expect(
      materialized.cols.find((col) => col.name == "status")?.source
    ).toBeUndefined();
    // Explicit frontmatter-backed columns project the live YAML value.
    expect(linkedRow.canonicalStatus).toBe("frontmatter-visible");
    // FIXED (Notidian-2j3): an UNMARKED column whose name matches a frontmatter
    // key now reflects the live file value, not the stale hidden-MDB shadow.
    expect(linkedRow.status).toBe("frontmatter-active");
    // The explicit Notidian-owned column is never overlaid by YAML (A1-leak fix
    // preserved) and survives persistence; the now-frontmatter "status" and the
    // computed/frontmatter columns are stripped from the durable MDB row.
    expect(persistedAfterReload.rows[0]).toMatchObject({
      [PathPropertyName]: filePath,
      manual: "notidian-owned",
    });
    expect(persistedAfterReload.rows[0]).not.toHaveProperty("canonicalStatus");
    expect(persistedAfterReload.rows[0]).not.toHaveProperty("status");
  });
});
