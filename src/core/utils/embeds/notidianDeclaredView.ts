import { Filter } from "shared/types/predicate";
import { NotidianEmbedKind, parseWhereClause } from "./notidianEmbed";

export type NotidianDeclaredView = {
  id: string;
  base: {
    kind: NotidianEmbedKind;
    id: string;
  };
  where?: Filter[];
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  groupBy?: string[];
  columns?: string[];
  limit?: number;
  kind?: string;
};

export type DeclaredViewsParseResult = {
  declarations: NotidianDeclaredView[];
  globalErrors: string[];
  errorsById: Record<string, string[]>;
};

export type DeclaredViewSelection =
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "declaration"; declaration: NotidianDeclaredView };

const DECLARATION_KEYS = new Set([
  "id",
  "base",
  "where",
  "sort",
  "groupBy",
  "columns",
  "limit",
  "kind",
]);
const BASE_KEYS = new Set(["kind", "id"]);
const SORT_KEYS = new Set(["field", "direction"]);
const DECLARATION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == "object" && !Array.isArray(value);

const cleanString = (value: unknown): string =>
  typeof value == "string" ? value.trim() : "";

const parseFieldList = (
  value: unknown,
  key: "groupBy" | "columns",
  errors: string[]
): string[] | undefined => {
  if (!Array.isArray(value)) {
    errors.push(`${key} must be an ordered list`);
    return undefined;
  }
  const fields: string[] = [];
  for (const candidate of value) {
    const field = cleanString(candidate);
    if (!field) {
      errors.push(`${key} fields must be non-empty text`);
      continue;
    }
    if (fields.includes(field)) {
      errors.push(`${key} contains duplicate field "${field}"`);
      continue;
    }
    fields.push(field);
  }
  return fields;
};

const parseSort = (
  value: unknown,
  errors: string[]
): Array<{ field: string; direction: "asc" | "desc" }> | undefined => {
  if (!Array.isArray(value)) {
    errors.push("sort must be an ordered list");
    return undefined;
  }
  const sort: Array<{ field: string; direction: "asc" | "desc" }> = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      errors.push("sort entries must be objects");
      continue;
    }
    const unknownKeys = Object.keys(candidate).filter(
      (key) => !SORT_KEYS.has(key)
    );
    if (unknownKeys.length > 0) {
      errors.push(`unknown sort key "${unknownKeys[0]}"`);
      continue;
    }
    const field = cleanString(candidate.field);
    const direction = cleanString(candidate.direction);
    if (!field) {
      errors.push("sort field is required");
      continue;
    }
    if (direction != "asc" && direction != "desc") {
      errors.push("sort direction must be asc or desc");
      continue;
    }
    if (sort.some((entry) => entry.field == field)) {
      errors.push(`sort contains duplicate field "${field}"`);
      continue;
    }
    sort.push({ field, direction });
  }
  return sort;
};

const addError = (
  errorsById: Record<string, string[]>,
  id: string,
  message: string
) => {
  if (!id) return;
  errorsById[id] = [...(errorsById[id] ?? []), message];
};

const cycleMembers = (declarations: NotidianDeclaredView[]): Set<string> => {
  const byId = new Map(declarations.map((declaration) => [declaration.id, declaration]));
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const members = new Set<string>();

  const visit = (id: string) => {
    const current = state.get(id);
    if (current == "visited") return;
    if (current == "visiting") {
      const start = stack.lastIndexOf(id);
      stack.slice(start).forEach((member) => members.add(member));
      return;
    }

    state.set(id, "visiting");
    stack.push(id);
    const declaration = byId.get(id);
    const next =
      declaration?.base.kind == "view" && byId.has(declaration.base.id)
        ? declaration.base.id
        : null;
    if (next) visit(next);
    stack.pop();
    state.set(id, "visited");
  };

  declarations.forEach((declaration) => visit(declaration.id));
  return members;
};

export const parseDeclaredViews = (value: unknown): DeclaredViewsParseResult => {
  const result: DeclaredViewsParseResult = {
    declarations: [],
    globalErrors: [],
    errorsById: {},
  };

  if (!Array.isArray(value)) {
    result.globalErrors.push("views must be an ordered list");
    return result;
  }

  const counts = new Map<string, number>();

  for (const candidate of value) {
    if (!isRecord(candidate)) {
      result.globalErrors.push("every views entry must have an id");
      continue;
    }
    const id = cleanString(candidate.id);
    const errors: string[] = [];

    if (!id) {
      result.globalErrors.push("every views entry must have an id");
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);

    if (!DECLARATION_ID.test(id)) {
      errors.push("declared view id must be a lowercase slug");
    }

    const unknownKeys = Object.keys(candidate).filter(
      (key) => !DECLARATION_KEYS.has(key)
    );
    if (unknownKeys.length > 0) {
      errors.push(`unknown declaration key "${unknownKeys[0]}"`);
    }

    const rawBase = candidate.base;
    const baseKind = isRecord(rawBase) ? cleanString(rawBase.kind) : "";
    const baseId = isRecord(rawBase) ? cleanString(rawBase.id) : "";
    if (!isRecord(rawBase)) {
      errors.push("base must be an object");
    } else {
      const unknownBaseKeys = Object.keys(rawBase).filter(
        (key) => !BASE_KEYS.has(key)
      );
      if (unknownBaseKeys.length > 0) {
        errors.push(`unknown base key "${unknownBaseKeys[0]}"`);
      }
      if (baseKind != "table" && baseKind != "view") {
        errors.push("base kind must be table or view");
      }
      if (!baseId) errors.push("base id is required");
    }

    let where: Filter[] | undefined;
    if (Object.prototype.hasOwnProperty.call(candidate, "where")) {
      if (!Array.isArray(candidate.where)) {
        errors.push("where must be an ordered list");
      } else {
        const filters: Filter[] = [];
        for (const clause of candidate.where) {
          if (typeof clause != "string") {
            errors.push("where clause must be text");
            continue;
          }
          const parsed = parseWhereClause(clause);
          if (!parsed.ok || !parsed.filter) {
            errors.push(parsed.message ?? "invalid where clause");
            continue;
          }
          filters.push(parsed.filter);
        }
        where = filters;
      }
    }

    const sort = Object.prototype.hasOwnProperty.call(candidate, "sort")
      ? parseSort(candidate.sort, errors)
      : undefined;
    const groupBy = Object.prototype.hasOwnProperty.call(candidate, "groupBy")
      ? parseFieldList(candidate.groupBy, "groupBy", errors)
      : undefined;
    const columns = Object.prototype.hasOwnProperty.call(candidate, "columns")
      ? parseFieldList(candidate.columns, "columns", errors)
      : undefined;

    let limit: number | undefined;
    if (Object.prototype.hasOwnProperty.call(candidate, "limit")) {
      if (
        typeof candidate.limit != "number" ||
        !Number.isInteger(candidate.limit) ||
        candidate.limit <= 0
      ) {
        errors.push("limit must be a positive integer");
      } else {
        limit = candidate.limit;
      }
    }

    let kind: string | undefined;
    if (Object.prototype.hasOwnProperty.call(candidate, "kind")) {
      kind = cleanString(candidate.kind);
      if (!kind) errors.push("kind must be non-empty text");
    }

    errors.forEach((message) => addError(result.errorsById, id, message));
    if (errors.length > 0) continue;

    const declaration: NotidianDeclaredView = {
      id,
      base: { kind: baseKind as NotidianEmbedKind, id: baseId },
    };
    if (where && where.length > 0) declaration.where = where;
    if (sort) declaration.sort = sort;
    if (groupBy) declaration.groupBy = groupBy;
    if (columns) declaration.columns = columns;
    if (limit != null) declaration.limit = limit;
    if (kind) declaration.kind = kind;
    result.declarations.push(declaration);
  }

  for (const [id, count] of counts) {
    if (count > 1) addError(result.errorsById, id, `duplicate declared view id "${id}"`);
  }
  for (const id of cycleMembers(result.declarations)) {
    addError(result.errorsById, id, `declared view base cycle includes "${id}"`);
  }

  return result;
};

export const selectDeclaredView = (
  parsed: DeclaredViewsParseResult,
  id: string
): DeclaredViewSelection => {
  if (parsed.globalErrors.length > 0) {
    return { kind: "error", message: parsed.globalErrors.join("; ") };
  }
  const errors = parsed.errorsById[id];
  if (errors?.length > 0) {
    return { kind: "error", message: errors.join("; ") };
  }
  const declaration = parsed.declarations.find((candidate) => candidate.id == id);
  return declaration
    ? { kind: "declaration", declaration }
    : { kind: "none" };
};
