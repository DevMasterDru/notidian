import { Filter } from "shared/types/predicate";

export type NotidianEmbedKind = "table" | "view";

export type NotidianEmbedDescriptor = {
  target: string;
  kind: NotidianEmbedKind;
  id: string;
  height?: number;
  title?: boolean;
  editable?: boolean;
  // ADR-0066 (Topic Hub) v1 view mechanism / Notidian-ioxi: an optional
  // conjunctive (AND) filter overlay declared by `where:` lines in the embed
  // block. READ-PATH ONLY — these filters narrow which rows the referenced base
  // view renders and must NEVER be persisted back into the view's schema /
  // views.mdb (the Wave-3 write firewall). Absent when no `where:` line is
  // present, so a where-less block stays byte-identical to the legacy descriptor.
  where?: Filter[];
};

export type NotidianEmbedDescriptorInput = {
  target?: unknown;
  kind?: unknown;
  id?: unknown;
  height?: unknown;
  title?: unknown;
  editable?: unknown;
  table?: unknown;
  view?: unknown;
  // Raw `where:` clause text. Multiple `where:` lines accumulate here as a
  // string[] (each is one conjunctive clause); a single line may also arrive as
  // a bare string. Normalized into Filter[] by normalizeNotidianEmbedDescriptor.
  where?: unknown;
};

// where-clause operator -> filter registry mapping (Notidian-ioxi). Each `fn`
// MUST be a real key of `filterFnTypes` (filterReturnForCol looks the fn up
// there; an unknown fn fails OPEN per ADR-0034 and would silently never filter),
// and each `fType` mirrors that registry entry's `valueType` — the shipped
// convention (Notidian-l12a). The parity of this map against the live registry
// is locked offline by notidianEmbed.where.test.ts so a future registry rename
// can't silently turn an overlay into a no-op. `fType` is inert at eval for
// literal overlay values (filterReturnForCol only reads it for the 'property'
// dynamic-lookup case); it is carried for correctness + FilterBar value-editor
// hinting. Relative-date tokens ('7d','2w','1m','1y') flow through withinLast/
// olderThan (Notidian-l12a) unchanged.
export const OVERLAY_OP_MAP: Record<string, { fn: string; fType: string }> = {
  "=": { fn: "is", fType: "text" },
  "!=": { fn: "isNot", fType: "text" },
  ">": { fn: "isGreatThan", fType: "number" },
  "<": { fn: "isLessThan", fType: "number" },
  includes: { fn: "include", fType: "text" },
  withinLast: { fn: "withinLast", fType: "date" },
  olderThan: { fn: "olderThan", fType: "date" },
};

// Word operators are matched as whitespace-delimited tokens so a field or value
// that merely CONTAINS the substring is never mistaken for the operator.
export const WHERE_WORD_OPERATORS = ["withinLast", "olderThan", "includes"] as const;
// Symbolic operators. '!=' is tested before '=' so the '=' inside it is not
// latched onto a longer-operator clause.
export const WHERE_SYMBOL_OPERATORS = ["!=", "=", ">", "<"] as const;

type WhereClauseParts = { field: string; op: string; value: string };

const splitWhereClause = (raw: string): WhereClauseParts | null => {
  const clause = raw.trim();
  if (clause.length == 0) return null;

  for (const op of WHERE_WORD_OPERATORS) {
    const match = new RegExp(`\\s${op}\\s`, "u").exec(clause);
    if (match != null && match.index > 0) {
      const field = clause.slice(0, match.index).trim();
      const value = clause.slice(match.index + match[0].length).trim();
      if (field.length == 0 || value.length == 0) return null;
      return { field, op, value };
    }
  }

  for (const op of WHERE_SYMBOL_OPERATORS) {
    let idx = clause.indexOf(op);
    // Don't let '=' split a leading '!=' that had no field (e.g. "!= Gidi"):
    // its '!=' branch already skipped for lack of a field, so bail here too.
    if (op == "=" && idx > 0 && clause.charAt(idx - 1) == "!") idx = -1;
    if (idx > 0) {
      const field = clause.slice(0, idx).trim();
      const value = clause.slice(idx + op.length).trim();
      if (field.length == 0 || value.length == 0) return null;
      return { field, op, value };
    }
  }

  return null;
};

// A single (non-discriminated) result shape on purpose: this project compiles
// with strictNullChecks OFF, where narrowing a boolean-literal discriminated
// union's FALSE branch (`if (!result.ok) { result.message }`) does not work.
// Both payload fields are optional and read directly — `filter` is set iff
// `ok`, `message` iff `!ok`.
export type WhereClauseParseResult = {
  ok: boolean;
  filter?: Filter;
  message?: string;
};

// Parse a single `where:` clause ("field <operator> value") into a Filter.
export const parseWhereClause = (raw: string): WhereClauseParseResult => {
  const parts = splitWhereClause(raw);
  if (parts == null) {
    return {
      ok: false,
      message: `where clause must be "field <operator> value" (got "${raw.trim()}")`,
    };
  }
  const mapping = OVERLAY_OP_MAP[parts.op];
  if (mapping == null) {
    // Unreachable while WHERE_*_OPERATORS stay a subset of OVERLAY_OP_MAP keys
    // (locked by test); kept total so op-list drift can never emit a filter
    // whose fn is not in the registry.
    return { ok: false, message: `unsupported where operator "${parts.op}"` };
  }
  return {
    ok: true,
    filter: {
      field: parts.field,
      fn: mapping.fn,
      value: parts.value,
      fType: mapping.fType,
    },
  };
};

const parseWhereFilters = (
  value: unknown,
  errors: NotidianEmbedDescriptorError[]
): Filter[] => {
  if (value == null) return [];
  const clauses = Array.isArray(value)
    ? value
    : typeof value == "string"
    ? [value]
    : [];
  const filters: Filter[] = [];
  for (const clause of clauses) {
    if (typeof clause != "string") {
      errors.push({ field: "where", message: "where clause must be text" });
      continue;
    }
    const result = parseWhereClause(clause);
    if (result.ok && result.filter) {
      filters.push(result.filter);
    } else {
      errors.push({
        field: "where",
        message: result.message ?? "invalid where clause",
      });
    }
  }
  return filters;
};

export type NotidianEmbedDescriptorError = {
  field: string;
  message: string;
};

export type NotidianEmbedParseResult =
  | {
      ok: true;
      descriptor: NotidianEmbedDescriptor;
    }
  | {
      ok: false;
      errors: NotidianEmbedDescriptorError[];
    };

const parseStringField = (value: unknown): string | undefined => {
  if (typeof value != "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseBooleanField = (
  value: unknown,
  field: string,
  errors: NotidianEmbedDescriptorError[]
): boolean | undefined => {
  if (value == null || value === "") return undefined;
  if (typeof value == "boolean") return value;
  if (typeof value == "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized == "true") return true;
    if (normalized == "false") return false;
  }
  errors.push({ field, message: `${field} must be true or false` });
  return undefined;
};

const parseHeightField = (
  value: unknown,
  errors: NotidianEmbedDescriptorError[]
): number | undefined => {
  if (value == null || value === "") return undefined;
  const height =
    typeof value == "number"
      ? value
      : typeof value == "string"
      ? Number(value.trim())
      : Number.NaN;

  if (Number.isFinite(height) && height > 0) {
    return height;
  }

  errors.push({ field: "height", message: "height must be a positive number" });
  return undefined;
};

const normalizeTarget = (target: string): string => {
  if (target == "/") return "";
  return target.replace(/\/+$/u, "");
};

const parseKind = (
  input: NotidianEmbedDescriptorInput,
  errors: NotidianEmbedDescriptorError[]
): NotidianEmbedKind | undefined => {
  const explicitKind = parseStringField(input.kind)?.toLowerCase();
  const table = parseStringField(input.table);
  const view = parseStringField(input.view);

  if (explicitKind != null) {
    if (explicitKind == "table" || explicitKind == "view") {
      return explicitKind;
    }
    errors.push({ field: "kind", message: "kind must be table or view" });
    return undefined;
  }

  if (table != null && view != null) {
    errors.push({
      field: "kind",
      message: "kind is required when both table and view are provided",
    });
    return undefined;
  }

  if (table != null) return "table";
  if (view != null) return "view";

  errors.push({ field: "kind", message: "kind must be table or view" });
  return undefined;
};

const parseId = (
  input: NotidianEmbedDescriptorInput,
  kind: NotidianEmbedKind | undefined,
  errors: NotidianEmbedDescriptorError[]
): string | undefined => {
  const id = parseStringField(input.id);
  if (id != null) return id;

  const shorthand =
    kind == "table"
      ? parseStringField(input.table)
      : kind == "view"
      ? parseStringField(input.view)
      : undefined;

  if (shorthand != null) return shorthand;

  errors.push({ field: "id", message: "id is required" });
  return undefined;
};

export const parseNotidianEmbedBlockFields = (
  body: string
): NotidianEmbedDescriptorInput => {
  return body.split(/\r?\n/u).reduce<NotidianEmbedDescriptorInput>(
    (fields, line) => {
      const trimmed = line.trim();
      if (trimmed.length == 0 || trimmed.startsWith("#")) return fields;

      const separator = trimmed.indexOf(":");
      if (separator == -1) return fields;

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (key.length == 0) return fields;

      // `where:` may repeat — each line is one conjunctive clause. Accumulate
      // ALL of them into an array instead of letting the plain object-key
      // assignment clobber every prior clause with the last one.
      if (key == "where") {
        const existing = Array.isArray(fields.where)
          ? (fields.where as string[])
          : [];
        return { ...fields, where: [...existing, value] };
      }

      return { ...fields, [key]: value };
    },
    {}
  );
};

export const normalizeNotidianEmbedDescriptor = (
  input: NotidianEmbedDescriptorInput
): NotidianEmbedParseResult => {
  const errors: NotidianEmbedDescriptorError[] = [];
  const target = parseStringField(input.target);
  if (target == null) {
    errors.push({ field: "target", message: "target is required" });
  }

  const kind = parseKind(input, errors);
  const id = parseId(input, kind, errors);
  const height = parseHeightField(input.height, errors);
  const title = parseBooleanField(input.title, "title", errors);
  const editable = parseBooleanField(input.editable, "editable", errors);
  const where = parseWhereFilters(input.where, errors);

  if (errors.length > 0 || target == null || kind == null || id == null) {
    return { ok: false, errors };
  }

  const descriptor: NotidianEmbedDescriptor = {
    target: normalizeTarget(target),
    kind,
    id,
    title: title ?? true,
    editable: editable ?? false,
  };

  if (height != null) {
    descriptor.height = height;
  }

  // Only attach `where` when clauses were actually declared, so a where-less
  // block produces a descriptor byte-identical to the pre-overlay shape.
  if (where.length > 0) {
    descriptor.where = where;
  }

  return { ok: true, descriptor };
};

export const parseNotidianEmbedBlock = (
  body: string
): NotidianEmbedParseResult => {
  return normalizeNotidianEmbedDescriptor(parseNotidianEmbedBlockFields(body));
};

export const parseLegacyNotidianEmbedRef = (
  ref: string
): NotidianEmbedParseResult => {
  const match = /^(.*)\/#([\^*])([^#]+)$/u.exec(ref.trim());
  if (match == null) {
    return {
      ok: false,
      errors: [{ field: "ref", message: "ref must include #^table or #*view" }],
    };
  }

  const [, target, marker, id] = match;
  return normalizeNotidianEmbedDescriptor({
    target: target == "" ? "/" : target,
    kind: marker == "^" ? "table" : "view",
    id,
  });
};

export const descriptorToFragmentPath = (
  descriptor: Pick<NotidianEmbedDescriptor, "target" | "kind" | "id">
): string => {
  const marker = descriptor.kind == "table" ? "^" : "*";
  const target = normalizeTarget(descriptor.target.trim());
  return `${target}/#${marker}${descriptor.id}`;
};

export const serializeNotidianEmbedBlock = (
  descriptor: NotidianEmbedDescriptor
): string => {
  const lines = [
    "```notidian",
    `target: ${descriptor.target}`,
    `kind: ${descriptor.kind}`,
    `id: ${descriptor.id}`,
  ];

  if (descriptor.height != null) {
    lines.push(`height: ${descriptor.height}`);
  }

  lines.push(
    `title: ${descriptor.title ?? true}`,
    `editable: ${descriptor.editable ?? false}`,
    "```"
  );

  return lines.join("\n");
};
