import { newPathInSpace } from "core/superstate/utils/spaces";
import { CsvImportPlan } from "core/utils/contexts/tableCsvImport";
import { saveFrontmatterProperties } from "core/utils/properties/frontmatterWrite";
import { Superstate } from "makemd-core";
import { SpaceState } from "shared/types/PathState";
import { SpaceTableColumn } from "shared/types/mdb";
import { parseMDBStringValue } from "utils/properties";

// Runtime bridge for CSV import (Notidian-84u): given a reviewed CsvImportPlan,
// create one markdown row file per record (newPathInSpace) and write the
// record's other headers as frontmatter, type-coerced via the matching column's
// kind when one exists. Writes to the vault — only run after the preview modal's
// explicit confirm. Sequential on purpose: bounded vault pressure + stable order.

export type CsvImportResult = {
  created: number;
  failed: number;
};

export const executeCsvImport = async (params: {
  superstate: Superstate;
  space: SpaceState;
  plan: CsvImportPlan;
  cols: SpaceTableColumn[]; // matched columns drive type-aware serialization
}): Promise<CsvImportResult> => {
  const { superstate, space, plan, cols } = params;
  // New rows are primary-table files, so headers map to primary-table columns
  // only (table == ""). Keying by bare name would pick a same-named context
  // column and coerce with the wrong kind.
  const colByName = new Map(
    cols.filter((c) => (c.table ?? "") == "").map((c) => [c.name, c])
  );
  let created = 0;
  let failed = 0;

  for (const row of plan.rows) {
    // Coerce BEFORE creating the file: parseMDBStringValue can throw (e.g.
    // object cells), and we must not leave a stray empty note behind on failure.
    let properties: Record<string, unknown>;
    try {
      properties = {};
      for (const [key, raw] of Object.entries(row.properties)) {
        // Skip empty cells: avoids NaN for number columns and frontmatter noise.
        if (String(raw).trim().length == 0) continue;
        const col = colByName.get(key);
        // Matched column → coerce to its kind; new header → raw string (it will
        // materialize as a frontmatter-backed text column).
        properties[key] = col ? parseMDBStringValue(col.type, raw, true) : raw;
      }
    } catch (e) {
      failed++;
      continue; // nothing created
    }

    try {
      // newPathInSpace auto-dedupes a colliding basename (Obsidian's
      // createNewMarkdownFile), so an "existing"/"duplicate" row gets a suffixed
      // file rather than clobbering one.
      const path = await newPathInSpace(
        superstate,
        space,
        "md",
        row.fileName,
        true // dontOpen — bulk create, do not steal focus per file
      );
      if (typeof path != "string" || path.length == 0) {
        failed++;
        continue;
      }
      const result = await saveFrontmatterProperties({
        superstate,
        path,
        properties,
        failureMessage: `Could not write properties for "${row.title}".`,
      });
      // The file exists either way; on a frontmatter failure it is a valid
      // title-only row, counted as failed so the summary flags it.
      if (result.ok) created++;
      else failed++;
    } catch (e) {
      failed++;
    }
  }

  return { created, failed };
};
