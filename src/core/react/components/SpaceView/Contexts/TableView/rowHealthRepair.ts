import { Superstate } from "makemd-core";
import {
  NotidianTypeProfile,
  parseTypeProfile,
  TypeProfileField,
} from "core/utils/contexts/typeProfile";

// Notidian-loan.5 (ADR-0057 D3/D5): pure(-ish) schema-resolution + repair-
// classification helpers for the row-health repair menu (wired from
// TableView.tsx, which owns the actual menu construction + funnel writes so
// applyValueEdits/the undo journal stay reachable through existing context —
// see that file's own comment at the menu call site). Kept separate from
// TableView.tsx so this decision logic is unit-testable without mounting React.
//
// `resolveDbTypeProfile` mirrors the Reconciler's OWN (private) schema
// resolution -- Reconciler.resolveDbSchema in core/superstate/reconciler.ts:
// spacesIndex -> the space's hub notePath -> pathsIndex's frontmatter ->
// parseTypeProfile. This reuses parseTypeProfile (the one real parser) rather
// than re-deriving schema parsing; the reconciler itself stays a read-only
// detection engine (ADR-0057 scope) with no obligation to expose schema shape
// on its own public API, so the tiny lookup glue is duplicated here exactly
// once, matching the same idiom cacheParsers.ts's `noteProfile` also uses.
export const resolveDbTypeProfile = (
  superstate: Superstate,
  dbPath: string | null | undefined
): NotidianTypeProfile | null => {
  if (!dbPath) return null;
  const notePath = superstate.spacesIndex.get(dbPath)?.space?.notePath;
  if (!notePath) return null;
  return (
    parseTypeProfile(superstate.pathsIndex.get(notePath)?.metadata?.property) ??
    null
  );
};

export const fieldFromSchema = (
  schema: NotidianTypeProfile | null | undefined,
  fieldName: string | null | undefined
): TypeProfileField | null => {
  if (!schema || !fieldName) return null;
  return schema.fields?.find((f) => f.name == fieldName) ?? null;
};

// ADR-0057 D5: an `empty-encoding` violation only has a funnel-safe ONE-CLICK
// autofix (write an explicit "") when the declared policy is "empty-string".
// A field policy of "absent" means the fix is REMOVING the key entirely --
// out of the write funnel's shape (a TableCellWrite always SETS a value; it
// has no "delete this key" verb) -- so it stays manual/text-only, same as
// this wave's other manual-only codes. `field == null` (schema unresolved,
// or the violation names a field the schema no longer declares) degrades to
// "not autofixable" -- never throws, never guesses a policy.
export const emptyEncodingIsAutofixable = (
  field: TypeProfileField | null | undefined
): boolean => field?.empty == "empty-string";

export const enumValuesForField = (
  field: TypeProfileField | null | undefined
): string[] => field?.enum?.values ?? [];
