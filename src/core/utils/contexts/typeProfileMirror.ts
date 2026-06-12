import {
  parseTypeProfile,
  planTypeProfileMirror,
  TypeProfileSchemaChange,
} from "core/utils/contexts/typeProfile";
import { saveFrontmatterProperties } from "core/utils/properties/frontmatterWrite";
import { Superstate } from "makemd-core";

// The schema state the serializer threads forward across a burst of mirror
// writes so consecutive writes build on each other instead of all reading the
// same pre-write maps (lost update, same class as Notidian-lg1).
export type TypeProfileSchemaState = {
  fields: Record<string, unknown>;
  kindFields: Record<string, unknown>;
};

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
  // The schema state this mirror leaves in place (post-write maps, or the
  // unchanged current maps when nothing was written). null when no valid
  // profile/note was resolved.
  state: TypeProfileSchemaState | null;
};

// Table→hub direction of the two-way Type Profile sync (Notidian-5qr, kind-aware
// in Notidian-egz): mirror a Notidian schema write into the hub note's `fields`
// or the owning `kind_fields` sub-schema. No-ops unless the space's hub already
// declares a profile — Notidian never creates one uninvited. Mirror failures
// surface as a notice and never roll back the table write.
//
// baseOverride lets the per-context serializer feed the previous mirror's
// resulting maps in, so a metadata-cache lag between consecutive writes cannot
// resurrect a stale map and clobber an earlier change.
export const mirrorSchemaChangeToTypeProfile = async (
  superstate: Superstate,
  contextPath: string,
  change: TypeProfileSchemaChange,
  baseOverride?: TypeProfileSchemaState | null
): Promise<TypeProfileMirrorResult> => {
  const notePath = superstate.spacesIndex.get(contextPath)?.space?.notePath;
  if (!notePath) return { ok: false, state: null };
  const frontmatter = superstate.pathsIndex.get(notePath)?.metadata?.property;
  const profile = parseTypeProfile(frontmatter);
  if (!profile) return { ok: false, state: null };
  const effective = {
    ...frontmatter,
    fields: baseOverride ? baseOverride.fields : frontmatter?.["fields"],
    kind_fields: baseOverride
      ? baseOverride.kindFields
      : frontmatter?.["kind_fields"],
  };
  const plan = planTypeProfileMirror(effective, change);
  const nextState: TypeProfileSchemaState = {
    fields: plan.fields ?? plan.currentFields,
    kindFields: plan.kindFields ?? plan.currentKindFields,
  };
  if (!plan.changed) return { ok: true, state: nextState };
  const properties: Record<string, unknown> = {};
  if (plan.fields) properties.fields = plan.fields;
  if (plan.kindFields) properties.kind_fields = plan.kindFields;
  const result = await saveFrontmatterProperties({
    superstate,
    path: notePath,
    properties,
    failureMessage:
      "Could not mirror the schema change to the database hub note.",
  });
  return result.ok ? { ok: true, state: nextState } : { ok: false, state: null };
};
