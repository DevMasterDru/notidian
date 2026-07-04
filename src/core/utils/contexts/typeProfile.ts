import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { filterFnTypes } from "core/utils/contexts/predicate/filterFns/filterFnTypes";
import { defaultContextSchemaID } from "shared/schemas/context";
import { Filter } from "shared/types/predicate";
import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import { safelyParseJSON } from "shared/utils/json";

// Type Profiles (Notidian-5qr, Atlas Method ADR-0008): a database's hub note
// declares its schema in frontmatter — `schema_type: notidian_type_profile`
// plus a `fields:` map. This module is the pure planner layer (ADR-0015
// doctrine): parsing, hub→table apply plans, and table→hub mirror plans.
// No filesystem access; callers own all writes.

export const typeProfileSchemaType = "notidian_type_profile";

// v3 (ADR-0056, Notidian-loan.1): six new optional per-field declarations.
// None of these enforce anything by themselves in this build — enforcement is
// ADR-0057's validateRowPatch (Wave 1b) and a future Wave 2 write gate. This
// module only parses, plans (apply/mirror), and round-trips them.
export type TypeProfileEnum = { values: string[]; strict: boolean };
export type TypeProfileUnique = { scope: "database"; where?: Filter[] };
export type TypeProfileReference = {
  targetFolder: string;
  targetKey: string;
  onBrokenWrite: "block" | "warn";
  onReferencedChange: "warn" | "cascade-preview";
};
export type TypeProfileDerived = {
  kind: "template" | "lookup" | "rollup";
  spec: Record<string, unknown>;
  materialize: "none" | "frontmatter";
};

export type TypeProfileField = {
  name: string;
  kind: string;
  type: string;
  options?: string[];
  required?: boolean;
  value?: string;
  enum?: TypeProfileEnum;
  unique?: TypeProfileUnique;
  pattern?: string;
  title_binding?: boolean;
  empty?: "absent" | "empty-string";
  reference?: TypeProfileReference;
  derived?: TypeProfileDerived;
  // Forward-compat (ADR-0056): any raw field-def attribute this build does not
  // recognize is preserved verbatim so parse -> serialize never silently drops
  // schema authored by a newer build (or a typo the owner should see, not lose).
  // A KNOWN v3 attribute that is present but malformed is NOT carried here —
  // it degrades like `unknown-kind` does: a diagnostic issue, the attribute
  // dropped, same as today's kind-degrades-to-text precedent.
  extra?: Record<string, unknown>;
};

// Per-database invariant (ADR-0056 D8): row-local predicate rule expressed in
// the EXISTING Filter/predicate DSL (src/shared/types/predicate.ts) — no new
// rule language. `when` is an optional guard (absent/empty == applies to every
// row); `require` must all hold for the row to be valid.
export type Invariant = {
  when?: Filter[];
  require: Filter[];
  severity: "error" | "warn";
  message: string;
  autofix?: string;
};

export type TypeProfileIssue =
  | { reason: "missing-fields" }
  | { reason: "invalid-field"; field: string }
  | { reason: "unknown-kind"; field: string; kind: string }
  | { reason: "invalid-enum"; field: string }
  | { reason: "invalid-unique"; field: string }
  | { reason: "invalid-pattern"; field: string }
  | { reason: "invalid-title-binding"; field: string }
  | { reason: "invalid-empty-policy"; field: string }
  | { reason: "invalid-reference"; field: string }
  | { reason: "invalid-derived"; field: string }
  | { reason: "cyclic-derived"; field: string; cycle: string[] }
  | { reason: "invalid-filter"; path: string }
  | { reason: "unknown-filter-fn"; path: string; fn: string }
  | { reason: "invalid-invariant"; index: number }
  | { reason: "invalid-invariants-block" };

export type NotidianTypeProfile = {
  database?: string;
  fields: TypeProfileField[];
  // v2 (Notidian-egz): per-kind sub-schemas keyed by the `kind` discriminator
  // value. `fields` above is the materialized union (common + every kind); this
  // preserves which fields belong to which kind for future per-kind use
  // (templates, validation).
  kindFields: Record<string, TypeProfileField[]>;
  // v3 (ADR-0056 D8): the hub's declared per-database invariants, already
  // parsed into Filter-DSL structures. Only successfully-parsed invariants
  // appear here; malformed entries surface as `issues`, never silently.
  invariants: Invariant[];
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

// Same JSON-string tolerance as normalizeRawFields, for a top-level list
// (`invariants:`) instead of a map.
const normalizeRawList = (rawList: unknown): unknown[] | null => {
  const parsed =
    typeof rawList == "string" ? safelyParseJSON(rawList) : rawList;
  return Array.isArray(parsed) ? parsed : null;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value == "object" && !Array.isArray(value);

// ---------------------------------------------------------------------------
// Filter DSL reuse (ADR-0056 D8): `unique.where` and every invariant's
// `when`/`require` are the EXISTING `{field, fn, value, fType}` Filter shape
// (src/shared/types/predicate.ts), validated against the SAME `fn` registry
// every view's filter bar uses (filterFnTypes) — no new rule language, and an
// unrecognized `fn` is a loud parse diagnostic, never a silent no-op.
// ---------------------------------------------------------------------------

const knownFilterFns = new Set(Object.keys(filterFnTypes));

const parseFilter = (
  raw: unknown,
  path: string,
  issues: TypeProfileIssue[]
): Filter | null => {
  if (!isPlainObject(raw)) {
    issues.push({ reason: "invalid-filter", path });
    return null;
  }
  const { field, fn, value, fType } = raw;
  if (
    typeof field != "string" ||
    field.length == 0 ||
    typeof fn != "string" ||
    fn.length == 0 ||
    typeof value != "string" ||
    typeof fType != "string"
  ) {
    issues.push({ reason: "invalid-filter", path });
    return null;
  }
  if (!knownFilterFns.has(fn)) {
    issues.push({ reason: "unknown-filter-fn", path, fn });
    return null;
  }
  return { field, fn, value, fType };
};

// Parses a `Filter[]`. `ok` is false when ANY entry is malformed or references
// an unknown `fn` — the caller rejects the WHOLE list rather than silently
// running a subtly-weakened rule with the bad entry dropped (each bad entry
// still gets its own diagnostic above, in addition to the caller's own
// reject-the-parent issue).
const parseFilterList = (
  raw: unknown,
  path: string,
  issues: TypeProfileIssue[]
): { filters: Filter[]; ok: boolean } => {
  if (raw == null) return { filters: [], ok: true };
  if (!Array.isArray(raw)) {
    issues.push({ reason: "invalid-filter", path });
    return { filters: [], ok: false };
  }
  let ok = true;
  const filters: Filter[] = [];
  raw.forEach((entry, i) => {
    const parsed = parseFilter(entry, `${path}[${i}]`, issues);
    if (parsed) filters.push(parsed);
    else ok = false;
  });
  return { filters, ok };
};

// ---------------------------------------------------------------------------
// v3 per-field attribute parsers (ADR-0056 D1–D7). Each is independently
// optional and degrades to `undefined` + a diagnostic issue on a malformed
// shape — never throws, never silently accepts a garbage shape as valid.
// ---------------------------------------------------------------------------

const parseEnumAttr = (
  raw: unknown,
  fieldPath: string,
  issues: TypeProfileIssue[]
): TypeProfileEnum | undefined => {
  if (raw == null) return undefined;
  if (
    !isPlainObject(raw) ||
    !Array.isArray(raw.values) ||
    raw.values.length == 0 ||
    !raw.values.every((v: unknown) => typeof v == "string") ||
    typeof raw.strict != "boolean"
  ) {
    issues.push({ reason: "invalid-enum", field: fieldPath });
    return undefined;
  }
  return { values: raw.values as string[], strict: raw.strict as boolean };
};

const parseUniqueAttr = (
  raw: unknown,
  fieldPath: string,
  issues: TypeProfileIssue[]
): TypeProfileUnique | undefined => {
  if (raw == null) return undefined;
  if (!isPlainObject(raw) || raw.scope != "database") {
    issues.push({ reason: "invalid-unique", field: fieldPath });
    return undefined;
  }
  if (raw.where == null) return { scope: "database" };
  const { filters, ok } = parseFilterList(
    raw.where,
    `${fieldPath}.unique.where`,
    issues
  );
  if (!ok) {
    issues.push({ reason: "invalid-unique", field: fieldPath });
    return undefined;
  }
  return { scope: "database", where: filters };
};

const parsePatternAttr = (
  raw: unknown,
  fieldPath: string,
  issues: TypeProfileIssue[]
): string | undefined => {
  if (raw == null) return undefined;
  if (typeof raw != "string" || raw.length == 0) {
    issues.push({ reason: "invalid-pattern", field: fieldPath });
    return undefined;
  }
  try {
    // eslint-disable-next-line no-new
    new RegExp(raw);
  } catch {
    issues.push({ reason: "invalid-pattern", field: fieldPath });
    return undefined;
  }
  return raw;
};

const parseTitleBindingAttr = (
  raw: unknown,
  fieldPath: string,
  issues: TypeProfileIssue[]
): boolean | undefined => {
  if (raw == null) return undefined;
  if (typeof raw != "boolean") {
    issues.push({ reason: "invalid-title-binding", field: fieldPath });
    return undefined;
  }
  return raw;
};

const validEmptyPolicies = new Set(["absent", "empty-string"]);

const parseEmptyAttr = (
  raw: unknown,
  fieldPath: string,
  issues: TypeProfileIssue[]
): "absent" | "empty-string" | undefined => {
  if (raw == null) return undefined;
  if (typeof raw != "string" || !validEmptyPolicies.has(raw)) {
    issues.push({ reason: "invalid-empty-policy", field: fieldPath });
    return undefined;
  }
  return raw as "absent" | "empty-string";
};

const validOnBrokenWrite = new Set(["block", "warn"]);
const validOnReferencedChange = new Set(["warn", "cascade-preview"]);

const parseReferenceAttr = (
  raw: unknown,
  fieldPath: string,
  issues: TypeProfileIssue[]
): TypeProfileReference | undefined => {
  if (raw == null) return undefined;
  if (
    !isPlainObject(raw) ||
    typeof raw.targetFolder != "string" ||
    raw.targetFolder.length == 0 ||
    typeof raw.targetKey != "string" ||
    raw.targetKey.length == 0 ||
    typeof raw.onBrokenWrite != "string" ||
    !validOnBrokenWrite.has(raw.onBrokenWrite) ||
    typeof raw.onReferencedChange != "string" ||
    !validOnReferencedChange.has(raw.onReferencedChange)
  ) {
    issues.push({ reason: "invalid-reference", field: fieldPath });
    return undefined;
  }
  return {
    targetFolder: raw.targetFolder,
    targetKey: raw.targetKey,
    onBrokenWrite: raw.onBrokenWrite as "block" | "warn",
    onReferencedChange: raw.onReferencedChange as "warn" | "cascade-preview",
  };
};

const validDerivedKinds = new Set(["template", "lookup", "rollup"]);
const validMaterialize = new Set(["none", "frontmatter"]);

const parseDerivedAttr = (
  raw: unknown,
  fieldPath: string,
  issues: TypeProfileIssue[]
): TypeProfileDerived | undefined => {
  if (raw == null) return undefined;
  if (
    !isPlainObject(raw) ||
    typeof raw.kind != "string" ||
    !validDerivedKinds.has(raw.kind) ||
    !isPlainObject(raw.spec) ||
    typeof raw.materialize != "string" ||
    !validMaterialize.has(raw.materialize)
  ) {
    issues.push({ reason: "invalid-derived", field: fieldPath });
    return undefined;
  }
  return {
    kind: raw.kind as "template" | "lookup" | "rollup",
    spec: raw.spec,
    materialize: raw.materialize as "none" | "frontmatter",
  };
};

// Every raw field-def key this parser understands. Anything else on the def
// is forward-compat data, preserved verbatim on `.extra` (see TypeProfileField).
const knownFieldDefKeys = new Set([
  "kind",
  "options",
  "required",
  "value",
  "enum",
  "unique",
  "pattern",
  "title_binding",
  "empty",
  "reference",
  "derived",
]);

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
    const fieldPath = issuePrefix + name;
    const extraEntries = Object.entries(fieldDef).filter(
      ([key]) => !knownFieldDefKeys.has(key)
    );
    fields.push({
      name,
      kind,
      type,
      options: Array.isArray(fieldDef.options)
        ? fieldDef.options.map((option: unknown) => String(option))
        : undefined,
      required: fieldDef.required === true,
      value: fieldDef.value != null ? String(fieldDef.value) : undefined,
      enum: parseEnumAttr(fieldDef.enum, fieldPath, issues),
      unique: parseUniqueAttr(fieldDef.unique, fieldPath, issues),
      pattern: parsePatternAttr(fieldDef.pattern, fieldPath, issues),
      title_binding: parseTitleBindingAttr(
        fieldDef.title_binding,
        fieldPath,
        issues
      ),
      empty: parseEmptyAttr(fieldDef.empty, fieldPath, issues),
      reference: parseReferenceAttr(fieldDef.reference, fieldPath, issues),
      derived: parseDerivedAttr(fieldDef.derived, fieldPath, issues),
      ...(extraEntries.length > 0
        ? { extra: Object.fromEntries(extraEntries) }
        : {}),
    });
  }
  return fields;
};

// ---------------------------------------------------------------------------
// Invariants (ADR-0056 D8): a per-database `invariants:` list, parsed into
// the Filter-DSL shape. Malformed entries are rejected WHOLE (never a
// silently-weakened partial rule) with a diagnostic; well-formed siblings in
// the same list still parse.
// ---------------------------------------------------------------------------

const validSeverities = new Set(["error", "warn"]);

const parseInvariant = (
  raw: unknown,
  index: number,
  issues: TypeProfileIssue[]
): Invariant | null => {
  if (!isPlainObject(raw)) {
    issues.push({ reason: "invalid-invariant", index });
    return null;
  }
  const path = `invariants[${index}]`;
  let ok = true;

  let when: Filter[] | undefined;
  if (raw.when != null) {
    const parsedWhen = parseFilterList(raw.when, `${path}.when`, issues);
    if (!parsedWhen.ok) ok = false;
    when = parsedWhen.filters;
  }

  const parsedRequire = parseFilterList(raw.require, `${path}.require`, issues);
  if (!parsedRequire.ok || parsedRequire.filters.length == 0) ok = false;

  if (typeof raw.severity != "string" || !validSeverities.has(raw.severity))
    ok = false;
  if (typeof raw.message != "string" || raw.message.length == 0) ok = false;

  let autofix: string | undefined;
  if (raw.autofix != null) {
    if (typeof raw.autofix == "string" && raw.autofix.length > 0)
      autofix = raw.autofix;
    else ok = false;
  }

  if (!ok) {
    issues.push({ reason: "invalid-invariant", index });
    return null;
  }

  return {
    ...(when && when.length > 0 ? { when } : {}),
    require: parsedRequire.filters,
    severity: raw.severity as "error" | "warn",
    message: raw.message as string,
    ...(autofix ? { autofix } : {}),
  };
};

export const parseInvariants = (
  rawInvariants: unknown,
  issues: TypeProfileIssue[]
): Invariant[] => {
  if (rawInvariants == null) return [];
  const list = normalizeRawList(rawInvariants);
  if (!list) {
    issues.push({ reason: "invalid-invariants-block" });
    return [];
  }
  const invariants: Invariant[] = [];
  list.forEach((entry, i) => {
    const parsed = parseInvariant(entry, i, issues);
    if (parsed) invariants.push(parsed);
  });
  return invariants;
};

// ---------------------------------------------------------------------------
// Derived-field cycle detection (ADR-0056 D7, ADR-0055 D5): a `derived, kind:
// "template"` field's spec.template may reference OTHER fields on the same
// row via `{fieldName}` (ADR-0055 D1's local-interpolation syntax); the
// cross-DB `{fk->Folder.key:field}` form is NOT tracked here — resolving it
// needs another database's profile, which is out of this pure module's reach
// (a future consumer's job, not this parser's). This pass only rejects a
// SAME-PROFILE cycle among template-kind derived fields — a DAG, per ADR-0055
// D5 — never a cross-profile one (that needs the Wave-4 dependency index,
// ADR-0058 D4).
// ---------------------------------------------------------------------------

const localTemplateRefs = (
  template: string,
  knownNames: Set<string>
): string[] => {
  const refs = new Set<string>();
  const re = /\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template))) {
    const token = match[1];
    if (token.includes("->")) continue; // cross-DB lookup syntax, not local.
    if (knownNames.has(token)) refs.add(token);
  }
  return [...refs];
};

const detectDerivedCycles = (
  fields: TypeProfileField[],
  issues: TypeProfileIssue[]
): void => {
  const knownNames = new Set(fields.map((f) => f.name));
  const graph = new Map<string, string[]>();
  for (const field of fields) {
    if (
      field.derived?.kind == "template" &&
      typeof field.derived.spec.template == "string"
    ) {
      graph.set(
        field.name,
        localTemplateRefs(field.derived.spec.template, knownNames)
      );
    }
  }

  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const reported = new Set<string>();

  const visit = (name: string): void => {
    if (state.get(name) == "done") return;
    if (state.get(name) == "visiting") {
      const cycleStart = stack.indexOf(name);
      const cycle = [...stack.slice(cycleStart), name];
      for (const member of cycle) {
        if (reported.has(member)) continue;
        reported.add(member);
        issues.push({ reason: "cyclic-derived", field: member, cycle });
      }
      return;
    }
    state.set(name, "visiting");
    stack.push(name);
    for (const dep of graph.get(name) ?? []) visit(dep);
    stack.pop();
    state.set(name, "done");
  };

  for (const name of graph.keys()) visit(name);
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

  // v3 (ADR-0056 D8/D7): parse the per-database invariants block and detect
  // same-profile derived-template cycles. Both only ever push diagnostics —
  // never throw, never block the rest of the profile from parsing.
  detectDerivedCycles(fields, issues);
  const invariants = parseInvariants(frontmatter["invariants"], issues);

  if (fields.length == 0) {
    issues.push({ reason: "missing-fields" });
    return { database, fields: [], kindFields, invariants, issues };
  }
  return { database, fields, kindFields, invariants, issues };
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
  // Guard (Notidian-9vp): if the column's own options config is present but
  // unparseable, skip the merge rather than treating it as empty. Otherwise the
  // corrupt JSON would be overwritten with hub-only options, silently dropping
  // any table-local extra options + their colors. A genuinely empty/absent value
  // still falls through to seed the hub options.
  if (
    typeof col.value == "string" &&
    col.value.trim() != "" &&
    safelyParseJSON(col.value) == null
  ) {
    return null;
  }
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

// Per-database template defaults (Notidian-drv): the frontmatter a new row in a
// profiled database should start with — each field's declared `value` default
// (e.g. Infrastructure's `database: infrastructure`). Only fields with a
// non-empty default are seeded; empty/required-without-default fields are left
// for the user. Pure — the caller writes these to the new file's frontmatter.
export const newRowFrontmatterFromProfile = (
  profile: NotidianTypeProfile | null
): Record<string, string> => {
  const defaults: Record<string, string> = {};
  if (!profile) return defaults;
  for (const field of profile.fields) {
    if (field.value != null && field.value.length > 0)
      defaults[field.name] = field.value;
  }
  return defaults;
};

// Reconstructs the raw per-field def object a TypeProfileField was parsed
// from (ADR-0056: "unknown attrs must round-trip untouched"). Pure inverse of
// parseFieldsMap's per-field branch — used to prove byte-stable round-trip
// for every v3 attribute, and available to a future serializer that writes a
// hub note's `fields`/`kind_fields` map. `required` is only emitted when
// true (parseFieldsMap always normalizes an absent/false declaration to
// `false`, so there is no way to distinguish "declared false" from "absent"
// once parsed — emitting only on `true` matches the common authoring case and
// keeps a v1/v2 profile's untouched fields serializing back to their
// original shorter form). `title_binding` is different: parseTitleBindingAttr
// keeps `false` distinct from absent/undefined post-parse, so its gate must
// be `!= null` (like `value`), not truthy — a truthy gate would silently
// collapse an authored `title_binding: false` into "absent".
export const serializeTypeProfileField = (
  field: TypeProfileField
): Record<string, unknown> => ({
  kind: field.kind,
  ...(field.options ? { options: field.options } : {}),
  ...(field.required ? { required: true } : {}),
  ...(field.value != null ? { value: field.value } : {}),
  ...(field.enum ? { enum: field.enum } : {}),
  ...(field.unique ? { unique: field.unique } : {}),
  ...(field.pattern ? { pattern: field.pattern } : {}),
  ...(field.title_binding != null
    ? { title_binding: field.title_binding }
    : {}),
  ...(field.empty ? { empty: field.empty } : {}),
  ...(field.reference ? { reference: field.reference } : {}),
  ...(field.derived ? { derived: field.derived } : {}),
  ...(field.extra ?? {}),
});

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
