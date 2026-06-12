import {
  parseTypeProfile,
  planFieldsMirror,
  TypeProfileSchemaChange,
} from "core/utils/contexts/typeProfile";
import { saveFrontmatterProperties } from "core/utils/properties/frontmatterWrite";
import { Superstate } from "makemd-core";

// Only ordinary value kinds mirror into a hub Type Profile; computed,
// relation, and layout column types stay table-local.
const mirrorableTypePrefixes = [
  "text",
  "password",
  "option",
  "date",
  "number",
  "boolean",
  "link",
];

export const isTypeProfileMirrorableType = (type: string): boolean =>
  mirrorableTypePrefixes.some(
    (prefix) => type == prefix || type.startsWith(prefix + "-")
  );

export type TypeProfileMirrorResult = {
  ok: boolean;
  // The hub `fields` map this mirror leaves in place (the post-write map, or the
  // unchanged current map when there was nothing to write). null when no valid
  // profile/note was resolved. The serializer threads this into the next mirror
  // so rapid consecutive schema writes build on each other instead of all
  // reading the same pre-write map (lost update, same class as Notidian-lg1).
  fields: Record<string, unknown> | null;
};

// Table→hub direction of the two-way Type Profile sync (Notidian-5qr):
// mirror a Notidian schema write into the hub note's `fields` map. No-ops
// unless the space's hub already declares a profile — Notidian never creates
// one uninvited. Mirror failures surface as a notice and never roll back the
// table write.
//
// baseFieldsOverride lets the per-context serializer feed the previous mirror's
// resulting `fields` map in, so a metadata-cache lag between consecutive writes
// cannot resurrect a stale map and clobber an earlier change.
export const mirrorSchemaChangeToTypeProfile = async (
  superstate: Superstate,
  contextPath: string,
  change: TypeProfileSchemaChange,
  baseFieldsOverride?: Record<string, unknown> | null
): Promise<TypeProfileMirrorResult> => {
  const notePath = superstate.spacesIndex.get(contextPath)?.space?.notePath;
  if (!notePath) return { ok: false, fields: null };
  const frontmatter = superstate.pathsIndex.get(notePath)?.metadata?.property;
  const profile = parseTypeProfile(frontmatter);
  if (!profile) return { ok: false, fields: null };
  const base =
    baseFieldsOverride != null ? baseFieldsOverride : frontmatter["fields"];
  const plan = planFieldsMirror(base, change);
  if (!plan.changed) return { ok: true, fields: plan.fields };
  const result = await saveFrontmatterProperties({
    superstate,
    path: notePath,
    properties: { fields: plan.fields },
    failureMessage:
      "Could not mirror the schema change to the database hub note.",
  });
  return result.ok
    ? { ok: true, fields: plan.fields }
    : { ok: false, fields: null };
};
