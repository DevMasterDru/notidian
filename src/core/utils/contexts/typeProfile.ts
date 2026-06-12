import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { defaultContextSchemaID } from "shared/schemas/context";
import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import { safelyParseJSON } from "shared/utils/json";

// Type Profiles (Notidian-5qr, Atlas Method ADR-0008): a database's hub note
// declares its schema in frontmatter — `schema_type: notidian_type_profile`
// plus a `fields:` map. This module is the pure planner layer (ADR-0015
// doctrine): parsing, hub→table apply plans, and table→hub mirror plans.
// No filesystem access; callers own all writes.

export const typeProfileSchemaType = "notidian_type_profile";

export type TypeProfileField = {
  name: string;
  kind: string;
  type: string;
  options?: string[];
  required?: boolean;
  value?: string;
};

export type TypeProfileIssue =
  | { reason: "missing-fields" }
  | { reason: "invalid-field"; field: string }
  | { reason: "unknown-kind"; field: string; kind: string };

export type NotidianTypeProfile = {
  database?: string;
  fields: TypeProfileField[];
  issues: TypeProfileIssue[];
};

const kindToTypeMap: Record<string, string> = {
  text: "text",
  select: "option",
  date: "date",
  number: "number",
  checkbox: "boolean",
  link: "link",
  url: "link",
  password: "password",
};

export const typeProfileKindForType = (type: string): string => {
  if (!type) return "text";
  if (type == "password") return "password";
  if (type.startsWith("option")) return "select";
  if (type.startsWith("date")) return "date";
  if (type == "number") return "number";
  if (type == "boolean") return "checkbox";
  if (type.startsWith("link")) return "link";
  return "text";
};

const normalizeRawFields = (
  rawFields: unknown
): Record<string, unknown> | null => {
  // Obsidian's metadata cache can surface nested YAML as a JSON string.
  const parsed =
    typeof rawFields == "string" ? safelyParseJSON(rawFields) : rawFields;
  if (!parsed || typeof parsed != "object" || Array.isArray(parsed))
    return null;
  return parsed as Record<string, unknown>;
};

export const parseTypeProfile = (
  frontmatter: Record<string, any> | null | undefined
): NotidianTypeProfile | null => {
  if (!frontmatter || frontmatter["schema_type"] != typeProfileSchemaType)
    return null;
  const database =
    typeof frontmatter["slug"] == "string"
      ? frontmatter["slug"]
      : typeof frontmatter["database"] == "string"
      ? frontmatter["database"]
      : undefined;
  const issues: TypeProfileIssue[] = [];
  const rawFields = normalizeRawFields(frontmatter["fields"]);
  if (!rawFields) {
    return { database, fields: [], issues: [{ reason: "missing-fields" }] };
  }
  const fields: TypeProfileField[] = [];
  for (const [name, def] of Object.entries(rawFields)) {
    if (!name) continue;
    const fieldDef =
      def && typeof def == "object" && !Array.isArray(def)
        ? (def as Record<string, any>)
        : null;
    if (!fieldDef) {
      issues.push({ reason: "invalid-field", field: name });
      continue;
    }
    const kind =
      typeof fieldDef.kind == "string" && fieldDef.kind.length > 0
        ? fieldDef.kind
        : "text";
    let type = kindToTypeMap[kind];
    if (!type) {
      issues.push({ reason: "unknown-kind", field: name, kind });
      type = "text";
    }
    fields.push({
      name,
      kind,
      type,
      options: Array.isArray(fieldDef.options)
        ? fieldDef.options.map((option: unknown) => String(option))
        : undefined,
      required: fieldDef.required === true,
      value: fieldDef.value != null ? String(fieldDef.value) : undefined,
    });
  }
  return { database, fields, issues };
};

type OptionEntry = { name: string; value: string; color?: string };

const existingOptionEntries = (col: SpaceProperty): OptionEntry[] => {
  const config = safelyParseJSON(col.value);
  if (config && Array.isArray(config.options))
    return config.options
      .filter((option: unknown) => option && typeof option == "object")
      .map((option: Record<string, any>) => ({
        name: String(option.name ?? option.value ?? ""),
        value: String(option.value ?? option.name ?? ""),
        ...(option.color != null ? { color: option.color } : {}),
      }));
  return [];
};

const mergedOptionValue = (
  col: SpaceProperty,
  hubOptions: string[]
): string | null => {
  const existing = existingOptionEntries(col);
  const existingValues = existing.map((option) => option.value);
  // Hub options lead (hub order is canonical); table-local extras follow.
  const merged: OptionEntry[] = [
    ...hubOptions.map(
      (option) =>
        existing.find((entry) => entry.value == option) ?? {
          name: option,
          value: option,
        }
    ),
    ...existing.filter((entry) => !hubOptions.includes(entry.value)),
  ];
  if (
    merged.length == existing.length &&
    merged.every((option, i) => option.value == existingValues[i])
  )
    return null;
  const config = safelyParseJSON(col.value);
  const baseConfig =
    config && typeof config == "object" && !Array.isArray(config) ? config : {};
  return JSON.stringify({ ...baseConfig, options: merged });
};

export type TypeProfileApplyPlan = {
  changed: boolean;
  cols: SpaceProperty[];
};

export const planTypeProfileApply = (
  profile: NotidianTypeProfile | null,
  table: Pick<SpaceTable, "cols" | "schema"> | null
): TypeProfileApplyPlan => {
  const sourceCols = table?.cols ?? [];
  if (!profile || profile.fields.length == 0 || !table)
    return { changed: false, cols: sourceCols };
  const schemaId = table.schema?.id ?? defaultContextSchemaID;
  let changed = false;
  const cols = sourceCols.map((col) => {
    const field = profile.fields.find(
      (f) => f.name.toLowerCase() == col.name.toLowerCase()
    );
    if (!field) return col;
    let next = col;
    // The hub profile owns the kind for frontmatter-backed columns; observed
    // row values may have inferred a weaker type (e.g. text for a select).
    if (
      col.source == frontmatterPropertySource &&
      col.type != field.type &&
      !col.type.startsWith(field.type + "-")
    ) {
      next = { ...next, type: field.type };
      changed = true;
    }
    if (field.options && next.type.startsWith("option")) {
      const refreshedValue = mergedOptionValue(next, field.options);
      if (refreshedValue != null) {
        next = { ...next, value: refreshedValue };
        changed = true;
      }
    }
    return next;
  });
  const colNames = new Set(sourceCols.map((col) => col.name.toLowerCase()));
  for (const field of profile.fields) {
    if (colNames.has(field.name.toLowerCase())) continue;
    cols.push({
      name: field.name,
      type: field.type,
      value:
        field.type == "option" && field.options
          ? JSON.stringify({
              options: field.options.map((option) => ({
                name: option,
                value: option,
              })),
            })
          : "",
      schemaId,
      source: frontmatterPropertySource,
    });
    colNames.add(field.name.toLowerCase());
    changed = true;
  }
  return { changed, cols };
};

export type TypeProfileSchemaChange =
  | { kind: "add-column"; name: string; type: string }
  | { kind: "rename-key"; oldName: string; newName: string }
  | { kind: "add-option"; name: string; option: string };

export type TypeProfileMirrorPlan = {
  changed: boolean;
  fields: Record<string, unknown>;
};

// Table→hub mirror: produce the hub's next `fields` map for a Notidian
// schema write. Preserves unknown field attributes and map order; reports
// no change when the hub already reflects the write (echo/loop prevention).
export const planFieldsMirror = (
  rawFields: unknown,
  change: TypeProfileSchemaChange
): TypeProfileMirrorPlan => {
  const fields = normalizeRawFields(rawFields);
  if (!fields) return { changed: false, fields: {} };
  const findKey = (name: string) =>
    Object.keys(fields).find((key) => key.toLowerCase() == name.toLowerCase());

  if (change.kind == "add-column") {
    if (findKey(change.name)) return { changed: false, fields };
    return {
      changed: true,
      fields: {
        ...fields,
        [change.name]: { kind: typeProfileKindForType(change.type) },
      },
    };
  }

  if (change.kind == "rename-key") {
    const oldKey = findKey(change.oldName);
    if (!oldKey || findKey(change.newName)) return { changed: false, fields };
    const renamed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      renamed[key == oldKey ? change.newName : key] = value;
    }
    return { changed: true, fields: renamed };
  }

  const fieldKey = findKey(change.name);
  if (!fieldKey) return { changed: false, fields };
  const fieldDef = fields[fieldKey];
  if (!fieldDef || typeof fieldDef != "object" || Array.isArray(fieldDef))
    return { changed: false, fields };
  const options = Array.isArray((fieldDef as Record<string, any>).options)
    ? (fieldDef as Record<string, any>).options.map((option: unknown) =>
        String(option)
      )
    : [];
  if (options.includes(change.option)) return { changed: false, fields };
  return {
    changed: true,
    fields: {
      ...fields,
      [fieldKey]: { ...(fieldDef as Record<string, any>), options: [...options, change.option] },
    },
  };
};
