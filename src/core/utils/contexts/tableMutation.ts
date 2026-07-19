import _ from "lodash";
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty, SpaceTable, SpaceTableSchema } from "shared/types/mdb";
import { TableMutationOperation } from "shared/types/spaceManager";

export class TableMutationConflict extends Error {
  constructor(public readonly target: string) {
    super(`Concurrent table mutation conflict at ${target}`);
    this.name = "TableMutationConflict";
  }
}

const mergeObjectDelta = <T extends Record<string, any>>(base: T, desired: T, current: T, target: string): T => {
  const merged = { ...current };
  for (const key of new Set([...Object.keys(base ?? {}), ...Object.keys(desired ?? {})])) {
    if (_.isEqual(base?.[key], desired?.[key])) continue;
    if (!_.isEqual(current?.[key], base?.[key]) && !_.isEqual(current?.[key], desired?.[key])) {
      throw new TableMutationConflict(`${target}.${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(desired, key)) (merged as Record<string, any>)[key] = desired[key];
    else delete (merged as Record<string, any>)[key];
  }
  return merged as T;
};

const indexedRecords = <T extends Record<string, any>>(
  records: T[], identity: (record: T) => string, target: string,
): Map<string, T> => {
  const indexed = new Map<string, T>();
  for (const record of records) {
    const id = identity(record);
    if (!id || indexed.has(id)) throw new TableMutationConflict(`${target}[${id || "<empty>"}]`);
    indexed.set(id, record);
  }
  return indexed;
};

const mergeRecords = <T extends Record<string, any>>(
  base: T[], desired: T[], current: T[], identity: (record: T) => string, target: string,
): T[] => {
  const baseById = indexedRecords(base, identity, `${target}.base`);
  const desiredById = indexedRecords(desired, identity, `${target}.desired`);
  const currentById = indexedRecords(current, identity, `${target}.current`);
  const mergedById = new Map<string, T>();

  for (const [id, before] of baseById) {
    const wanted = desiredById.get(id);
    const concurrent = currentById.get(id);
    if (!wanted) {
      if (concurrent && !_.isEqual(concurrent, before)) throw new TableMutationConflict(`${target}[${id}]`);
      continue;
    }
    if (!concurrent) {
      if (!_.isEqual(wanted, before)) throw new TableMutationConflict(`${target}[${id}]`);
      continue;
    }
    mergedById.set(id, mergeObjectDelta(before, wanted, concurrent, `${target}[${id}]`));
  }

  for (const wanted of desired) {
    const id = identity(wanted);
    if (baseById.has(id)) continue;
    const concurrent = currentById.get(id);
    if (concurrent) throw new TableMutationConflict(`${target}[${id}]`);
    mergedById.set(id, wanted);
  }

  const next = desired.flatMap(record => {
    const merged = mergedById.get(identity(record));
    return merged ? [merged] : [];
  });
  for (const concurrent of current) {
    const id = identity(concurrent);
    if (!baseById.has(id) && !desiredById.has(id)) next.push(concurrent);
  }
  return next;
};

const rowIdentity = (row: Record<string, any>): string => String(row[PathPropertyName] ?? "");
const colIdentity = (schemaId: string | undefined) => (col: SpaceProperty): string => {
  const name = String(col.name ?? "");
  if (!name) return "";
  return `${String(col.schemaId ?? schemaId ?? "")}:${name}`;
};

const assertTableIdentities = (table: SpaceTable, target: string): void => {
  indexedRecords(table.rows ?? [], rowIdentity, `${target}.rows`);
  indexedRecords(table.cols ?? [], colIdentity(table.schema?.id), `${target}.cols`);
};

export const applyTableMutation = (current: SpaceTable, operation: TableMutationOperation): SpaceTable => {
  assertTableIdentities(current, "current");
  if (operation.kind === "transform") {
    const transformed = operation.apply(current);
    assertTableIdentities(transformed, "desired");
    return transformed;
  }
  const { base, desired } = operation;
  assertTableIdentities(base, "base");
  assertTableIdentities(desired, "desired");
  const baseSchemaId = String(base.schema?.id ?? "");
  const desiredSchemaId = String(desired.schema?.id ?? "");
  const currentSchemaId = String(current.schema?.id ?? "");
  if (
    !baseSchemaId ||
    desiredSchemaId !== baseSchemaId ||
    currentSchemaId !== baseSchemaId
  ) {
    throw new TableMutationConflict("schema.id");
  }
  const columnIdentity = colIdentity(baseSchemaId);
  return {
    ...current,
    schema: mergeObjectDelta(
      (base.schema ?? {}) as SpaceTableSchema,
      (desired.schema ?? {}) as SpaceTableSchema,
      (current.schema ?? {}) as SpaceTableSchema,
      "schema",
    ),
    cols: mergeRecords(base.cols ?? [], desired.cols ?? [], current.cols ?? [], columnIdentity, "cols"),
    rows: mergeRecords(base.rows ?? [], desired.rows ?? [], current.rows ?? [], rowIdentity, "rows"),
  };
};
