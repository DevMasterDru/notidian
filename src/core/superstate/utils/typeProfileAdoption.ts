// Runtime glue for the schema-adoption command (Notidian-loan.3, ADR-0056
// D9). Everything that touches Superstate/the live index lives HERE; the
// actual drafting/merge LOGIC is the pure planner in
// core/utils/contexts/typeProfileAdopt.ts. Keeping the split means the
// heuristics (bounded-cardinality enum, empty-encoding policy, FK overlap
// scoring) are unit-testable without any Obsidian runtime state, matching
// every other ADR-0015-lineage planner in this codebase.

import { metadataPathForSpace } from "core/superstate/utils/spaces";
import {
  NotidianTypeProfile,
  parseTypeProfile,
  typeProfileSchemaType,
} from "core/utils/contexts/typeProfile";
import {
  SiblingDatabaseValues,
  TypeProfileAdoptionDraft,
  draftTypeProfileAdoption,
  planTypeProfileAdoptionMerge,
} from "core/utils/contexts/typeProfileAdopt";
import { excludedFrontmatterPropertyNames } from "core/utils/properties/allProperties";
import { saveFrontmatterProperties } from "core/utils/properties/frontmatterWrite";
import { Superstate } from "makemd-core";

// Bounds the sibling-database scan (D6's cross-database value-overlap pass)
// so adoption on a very large vault stays a bounded, one-shot command rather
// than an unbounded full-vault walk. 50 sibling databases comfortably covers
// every known Notidian vault's database count today; a vault that outgrows
// it can still adopt — the FK-candidate signal just narrows to the first 50
// databases the contextsIndex iterates, never a hard failure.
const DEFAULT_MAX_SIBLING_FOLDERS = 50;

// D6: gather every OTHER live database's per-field value sets, so
// typeProfileAdopt.ts's findForeignKeyCandidates can score value overlap the
// same way keyMatchResolver.ts's resolveKeyMatch matches a DECLARED
// reference — trim + string equality — but speculatively, over every field
// of every sibling database instead of one already-declared target.
export const gatherSiblingDatabaseFieldValues = (
  superstate: Superstate,
  excludeFolder: string,
  options: { maxSiblingFolders?: number; excludedKeys?: Set<string> } = {}
): SiblingDatabaseValues[] => {
  const maxSiblingFolders =
    options.maxSiblingFolders ?? DEFAULT_MAX_SIBLING_FOLDERS;
  const excludedKeys = options.excludedKeys ?? new Set<string>();
  const results: SiblingDatabaseValues[] = [];
  let consideredFolders = 0;

  for (const [folder, contextState] of superstate.contextsIndex) {
    if (folder == excludeFolder) continue;
    if (!contextState?.paths?.length) continue;
    if (consideredFolders >= maxSiblingFolders) break;
    consideredFolders++;

    const valuesByField = new Map<string, Set<string>>();
    for (const path of contextState.paths) {
      const frontmatter = superstate.pathsIndex.get(path)?.metadata?.property;
      if (!frontmatter) continue;
      for (const [key, value] of Object.entries(frontmatter)) {
        if (excludedKeys.has(key)) continue;
        const set = valuesByField.get(key) ?? new Set<string>();
        const raw = Array.isArray(value) ? value : [value];
        for (const item of raw) {
          if (item == null) continue;
          const trimmed = String(item).trim();
          if (trimmed) set.add(trimmed);
        }
        valuesByField.set(key, set);
      }
    }

    for (const [key, values] of valuesByField) {
      if (values.size == 0) continue;
      results.push({ targetFolder: folder, targetKey: key, values });
    }
  }

  return results;
};

// Resolves which folder database an "Adopt schema for this database" command
// invocation targets, from just the active path (the command-palette case has
// no space context to hand it directly — the hub-note-affordance case
// already knows its folder and does not need this). Accepts: the folder
// itself, its hub note, or a row file inside it.
export const resolveAdoptionTargetFolder = (
  superstate: Superstate,
  activePath: string | undefined | null
): string | null => {
  if (!activePath) return null;
  if (superstate.contextsIndex.has(activePath)) return activePath;

  for (const [folder, spaceState] of superstate.spacesIndex) {
    const space = spaceState?.space;
    if (!space || !superstate.contextsIndex.has(folder)) continue;
    const notePath = metadataPathForSpace(superstate, space);
    if (notePath && notePath == activePath) return folder;
  }

  const parent = superstate.spaceManager.parentPathForPath(activePath);
  if (parent && superstate.contextsIndex.has(parent)) return parent;
  return null;
};

const hubFrontmatterForFolder = (
  superstate: Superstate,
  folder: string
): Record<string, unknown> | null => {
  const space = superstate.spacesIndex.get(folder)?.space;
  if (!space) return null;
  const hubPath = metadataPathForSpace(superstate, space);
  if (!hubPath) return null;
  return superstate.pathsIndex.get(hubPath)?.metadata?.property ?? null;
};

// Assembles a full TypeProfileAdoptionDraft from the live index: the
// folder's own rows, its hub note's existing profile (if any — so already
// -declared fields never get redrafted), and every sibling database's field
// values (for FK candidate scoring). Returns null when `folder` is not a
// live, context-bearing Notidian database.
export const buildTypeProfileAdoptionDraft = (
  superstate: Superstate,
  folder: string
): TypeProfileAdoptionDraft | null => {
  const contextState = superstate.contextsIndex.get(folder);
  if (!contextState) return null;

  // Dedupe defensively: contextsIndex.paths has been observed to carry a
  // duplicate entry for a path across overlapping reload passes (e.g. a row
  // created just before a forced context re-settle). A duplicate would
  // double-count that row's values in the draft's stats without this.
  const paths = [...new Set(contextState.paths ?? [])];
  const frontmatterByPath = new Map(
    paths.map((path) => [
      path,
      superstate.pathsIndex.get(path)?.metadata?.property ?? {},
    ])
  );

  const existingProfile: NotidianTypeProfile | null = parseTypeProfile(
    hubFrontmatterForFolder(superstate, folder)
  );
  const excludedKeys = excludedFrontmatterPropertyNames(superstate.settings);
  const siblingDatabases = gatherSiblingDatabaseFieldValues(
    superstate,
    folder,
    { excludedKeys }
  );

  return draftTypeProfileAdoption({
    database: folder,
    paths,
    frontmatterByPath,
    excludedKeys: [...excludedKeys],
    existingProfile,
    siblingDatabases,
  });
};

export type ApplyTypeProfileAdoptionResult =
  | { ok: true; addedFieldNames: string[] }
  | {
      ok: false;
      addedFieldNames: never[];
      reason: "no-space" | "no-hub-path" | "write-failed";
    };

// The ONLY function in this module that writes. Callers must invoke it
// exclusively from a confirm handler (the preview modal's onConfirm) — this
// module never writes on its own initiative. Re-plans the merge against the
// hub note's CURRENT raw `fields:` map at write time (not a snapshot taken
// when the preview opened), so a field added elsewhere between preview and
// confirm is simply skipped, never clobbered (ADR-0056 D9 / ADR-0015 "must
// not silently write or delete frontmatter").
export const applyTypeProfileAdoptionDraft = async (
  superstate: Superstate,
  folder: string,
  draft: Pick<TypeProfileAdoptionDraft, "fields">
): Promise<ApplyTypeProfileAdoptionResult> => {
  if (draft.fields.length == 0) return { ok: true, addedFieldNames: [] };

  const space = superstate.spacesIndex.get(folder)?.space;
  if (!space) return { ok: false, addedFieldNames: [], reason: "no-space" };
  const hubPath = metadataPathForSpace(superstate, space);
  if (!hubPath)
    return { ok: false, addedFieldNames: [], reason: "no-hub-path" };

  const hubFrontmatter = superstate.pathsIndex.get(hubPath)?.metadata?.property;
  const mergePlan = planTypeProfileAdoptionMerge(
    hubFrontmatter?.["fields"],
    draft
  );
  if (!mergePlan.changed) return { ok: true, addedFieldNames: [] };

  const needsSchemaType =
    hubFrontmatter?.["schema_type"] != typeProfileSchemaType;
  const result = await saveFrontmatterProperties({
    superstate,
    path: hubPath,
    properties: {
      ...(needsSchemaType ? { schema_type: typeProfileSchemaType } : {}),
      fields: mergePlan.fields,
    },
    failureMessage: "Could not write the adopted schema to the hub note.",
  });

  return result.ok
    ? { ok: true, addedFieldNames: mergePlan.addedFieldNames }
    : { ok: false, addedFieldNames: [], reason: "write-failed" };
};
