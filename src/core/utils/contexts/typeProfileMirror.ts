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

// Table→hub direction of the two-way Type Profile sync (Notidian-5qr):
// mirror a Notidian schema write into the hub note's `fields` map. No-ops
// unless the space's hub already declares a profile — Notidian never creates
// one uninvited. Mirror failures surface as a notice and never roll back the
// table write.
export const mirrorSchemaChangeToTypeProfile = async (
  superstate: Superstate,
  contextPath: string,
  change: TypeProfileSchemaChange
): Promise<boolean> => {
  const notePath = superstate.spacesIndex.get(contextPath)?.space?.notePath;
  if (!notePath) return false;
  const frontmatter = superstate.pathsIndex.get(notePath)?.metadata?.property;
  const profile = parseTypeProfile(frontmatter);
  if (!profile) return false;
  const plan = planFieldsMirror(frontmatter["fields"], change);
  if (!plan.changed) return false;
  const result = await saveFrontmatterProperties({
    superstate,
    path: notePath,
    properties: { fields: plan.fields },
    failureMessage:
      "Could not mirror the schema change to the database hub note.",
  });
  return result.ok;
};
