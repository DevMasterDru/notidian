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
  // v2 (Notidian-egz): per-kind sub-schemas keyed by the `kind` discriminator
  // value. `fields` above is the materialized union (common + every kind); this
  // preserves which fields belong to which kind for future per-kind use
  // (templates, validation).
  kindFields: Record<string, TypeProfileField[]>;
  issues: TypeProfileIssue[];
};

const kindToTypeMap: Record<string, string> = {
  text: "text",
  select: "option",
  multi_select: "option-multi",
  date: "date",
  number: "number",
  checkbox: "boolean",
  link: "link",
  url: "link",
  // v2: relations live as [[links]] in frontmatter; the full rollup behavior
  // arrives with Notidian-9ln. Until then `link` is the closest file-backed kind
  // so relation columns still round-trip their links instead of degrading to
  // plain text.
  relation: "link",
  path: "text",
  password: "password",
};

export const typeProfileKindForType = (type: string): string => {
  if (!type) return "text";
  if (type == "password") return "password";
  if (type.startsWith("option-multi")) return "multi_select";
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

// Parse one `name -> field-def` map into typed fields, recording issues for
// invalid defs and unknown kinds (which degrade to text, never throw).
const parseFieldsMap = (
  rawFields: Record<string, unknown>,
  issues: TypeProfileIssue[],
  issuePrefix = ""
): TypeProfileField[] => {
  const fields: TypeProfileField[] = [];
  for (const [name, def] of Object.entries(rawFields)) {
    if (!name) continue;
    const fieldDef =
      def && typeof def == "object" && !Array.isArray(def)
        ? (def as Record<string, any>)
        : null;
    if (!fieldDef) {
      issues.push({ reason: "invalid-field", field: issuePrefix + name });
      continue;
    }
    const kind =
      typeof fieldDef.kind == "string" && fieldDef.kind.length > 0
        ? fieldDef.kind
        : "text";
    let type = kindToTypeMap[kind];
    if (!type) {
      issues.push({ reason: "unknown-kind", field: issuePrefix + name, kind });
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
  return fields;
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

  const commonRaw = normalizeRawFields(frontmatter["fields"]);
  const common = commonRaw ? parseFieldsMap(commonRaw, issues) : [];

  // v2 (Notidian-egz): kind_fields maps each `kind` discriminator value to its
  // own field sub-schema. The table shares one column set across rows, so the
  // materialized columns are the union of common fields + every kind's fields.
  const kindFields: Record<string, TypeProfileField[]> = {};
  const kindFieldsRaw = normalizeRawFields(frontmatter["kind_fields"]);
  if (!kindFieldsRaw && frontmatter["kind_fields"] != null) {
    // Present but not a usable map (e.g. a scalar) — surface it instead of
    // silently dropping the entire per-kind schema block.
    issues.push({ reason: "invalid-field", field: "kind_fields" });
  }
  if (kindFieldsRaw) {
    for (const [kindName, kindDef] of Object.entries(kindFieldsRaw)) {
      const kindMap = normalizeRawFields(kindDef);
      if (!kindMap) {
        issues.push({
          reason: "invalid-field",
          field: "kind_fields." + kindName,
        });
        continue;
      }
      kindFields[kindName] = parseFieldsMap(
        kindMap,
        issues,
        "kind_fields." + kindName + "."
      );
    }
  }

  // Union, deduped by lowercased name: common fields win, then kinds in
  // declaration order (first occurrence wins on a name collision).
  const fields: TypeProfileField[] = [];
  const seen = new Set<string>();
  const addUnique = (list: TypeProfileField[]) => {
    for (const field of list) {
      const key = field.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      fields.push(field);
    }
  };
  addUnique(common);
  for (const list of Object.values(kindFields)) addUnique(list);

  if (fields.length == 0) {
    issues.push({ reason: "missing-fields" });
    return { database, fields: [], kindFields, issues };
  }
  return { database, fields, kindFields, issues };
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
        field.type.startsWith("option") && field.options
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

// v2 kind-aware mirror (Notidian-egz). planFieldsMirror only touches the
// top-level `fields` map; a column materialized from `kind_fields` would then
// be invisible to the mirror, so a rename done from the table never reaches the
// hub and the apply path re-materializes the old key as a duplicate on reload.
// This planner locates which map owns the field (common `fields`, or a specific
// kind in `kind_fields`) and rewrites the right one, returning whichever map(s)
// changed plus the current normalized maps for the serializer to thread.
export type TypeProfileMirrorWrite = {
  changed: boolean;
  fields?: Record<string, unknown>;
  kindFields?: Record<string, unknown>;
  currentFields: Record<string, unknown>;
  currentKindFields: Record<string, unknown>;
};

const findMapKey = (map: Record<string, unknown>, name: string) =>
  Object.keys(map).find((key) => key.toLowerCase() == name.toLowerCase());

const addOptionToDef = (
  map: Record<string, unknown>,
  key: string,
  option: string
): Record<string, unknown> | null => {
  const def = map[key];
  if (!def || typeof def != "object" || Array.isArray(def)) return null;
  const options = Array.isArray((def as Record<string, any>).options)
    ? (def as Record<string, any>).options.map((o: unknown) => String(o))
    : [];
  if (options.includes(option)) return null;
  return {
    ...map,
    [key]: { ...(def as Record<string, any>), options: [...options, option] },
  };
};

const renameMapKey = (
  map: Record<string, unknown>,
  oldKey: string,
  newName: string
): Record<string, unknown> => {
  const renamed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map))
    renamed[key == oldKey ? newName : key] = value;
  return renamed;
};

export const planTypeProfileMirror = (
  frontmatter: Record<string, any> | null | undefined,
  change: TypeProfileSchemaChange
): TypeProfileMirrorWrite => {
  const fields = normalizeRawFields(frontmatter?.["fields"]) ?? {};
  const kindFields = normalizeRawFields(frontmatter?.["kind_fields"]) ?? {};
  const base = { currentFields: fields, currentKindFields: kindFields };

  // Locate the kind that owns a field name, if any.
  const findOwningKind = (
    name: string
  ): { kind: string; map: Record<string, unknown>; key: string } | null => {
    for (const [kindName, kindDef] of Object.entries(kindFields)) {
      const kindMap = normalizeRawFields(kindDef);
      if (!kindMap) continue;
      const key = findMapKey(kindMap, name);
      if (key) return { kind: kindName, map: kindMap, key };
    }
    return null;
  };

  if (change.kind == "add-column") {
    // A brand-new table column has no kind — it mirrors to common `fields`.
    // No-op if it already exists anywhere (common or kind-owned).
    if (findMapKey(fields, change.name) || findOwningKind(change.name))
      return { changed: false, ...base };
    return {
      changed: true,
      fields: {
        ...fields,
        [change.name]: { kind: typeProfileKindForType(change.type) },
      },
      ...base,
    };
  }

  if (change.kind == "rename-key") {
    // Avoid collisions: no-op if the new name already exists anywhere.
    if (findMapKey(fields, change.newName) || findOwningKind(change.newName))
      return { changed: false, ...base };
    const fieldsKey = findMapKey(fields, change.oldName);
    // A name can appear in BOTH common fields and one or more kinds. The rename
    // must update every map that holds it — otherwise the unrenamed copy stops
    // colliding on the next parse and resurfaces as a duplicate column.
    const owningKinds: Array<{ kind: string; map: Record<string, unknown>; key: string }> =
      [];
    for (const [kindName, kindDef] of Object.entries(kindFields)) {
      const kindMap = normalizeRawFields(kindDef);
      if (!kindMap) continue;
      const key = findMapKey(kindMap, change.oldName);
      if (key) owningKinds.push({ kind: kindName, map: kindMap, key });
    }
    if (!fieldsKey && owningKinds.length == 0) return { changed: false, ...base };
    const out: TypeProfileMirrorWrite = { changed: true, ...base };
    if (fieldsKey) out.fields = renameMapKey(fields, fieldsKey, change.newName);
    if (owningKinds.length > 0) {
      const nextKindFields = { ...kindFields };
      for (const owner of owningKinds)
        nextKindFields[owner.kind] = renameMapKey(
          owner.map,
          owner.key,
          change.newName
        );
      out.kindFields = nextKindFields;
    }
    return out;
  }

  // add-option
  const fieldsKey = findMapKey(fields, change.name);
  if (fieldsKey) {
    const next = addOptionToDef(fields, fieldsKey, change.option);
    return next ? { changed: true, fields: next, ...base } : { changed: false, ...base };
  }
  const owner = findOwningKind(change.name);
  if (owner) {
    const next = addOptionToDef(owner.map, owner.key, change.option);
    return next
      ? {
          changed: true,
          kindFields: { ...kindFields, [owner.kind]: next },
          ...base,
        }
      : { changed: false, ...base };
  }
  return { changed: false, ...base };
};
