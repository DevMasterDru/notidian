import {
  assembleCrossDatabaseView,
  crossDatabaseSourceColumn,
  normalizeCrossDatabaseSources,
} from "core/utils/contexts/crossDatabaseView";
import { normalizedSortForType } from "core/utils/contexts/predicate/sort";
import { defaultViewTypes } from "core/schemas/viewTypes";
import { Superstate } from "makemd-core";
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty } from "shared/types/mdb";
import { Predicate } from "shared/types/predicate";
import { mdbSchemaToFrameSchema } from "shared/utils/makemd/schema";
import {
  NotidianDeclaredView,
  parseDeclaredViews,
  selectDeclaredView,
} from "./notidianDeclaredView";
import {
  descriptorToFragmentPath,
  NotidianEmbedDescriptor,
} from "./notidianEmbed";

export type DeclaredViewInspection =
  | { kind: "none"; descriptor: NotidianEmbedDescriptor }
  | { kind: "error"; message: string }
  | {
      kind: "declaration";
      declaration: NotidianDeclaredView;
      targetPath: string;
    };

export type DeclaredViewRuntimeResult =
  | {
      ok: true;
      descriptor: NotidianEmbedDescriptor;
      predicateOverlay?: Partial<Predicate>;
    }
  | { ok: false; message: string };

export const inspectDeclaredViewForEmbed = ({
  superstate,
  sourcePath,
  descriptor,
}: {
  superstate: Superstate;
  sourcePath: string;
  descriptor: NotidianEmbedDescriptor;
}): DeclaredViewInspection => {
  if (descriptor.kind != "view") return { kind: "none", descriptor };

  let targetPath: string;
  try {
    targetPath = superstate.spaceManager.uriByString(
      descriptorToFragmentPath(descriptor),
      sourcePath
    )?.basePath;
  } catch (_error) {
    return { kind: "none", descriptor };
  }
  if (!targetPath) return { kind: "none", descriptor };

  const notePath = superstate.spacesIndex.get(targetPath)?.space?.notePath;
  if (!notePath) return { kind: "none", descriptor };
  const frontmatter = superstate.pathsIndex.get(notePath)?.metadata?.property;
  if (
    !frontmatter ||
    !Object.prototype.hasOwnProperty.call(frontmatter, "views")
  ) {
    return { kind: "none", descriptor };
  }

  const selection = selectDeclaredView(
    parseDeclaredViews(frontmatter.views),
    descriptor.id
  );
  if (selection.kind == "none") return { kind: "none", descriptor };
  if (selection.kind == "error") {
    return {
      kind: "error",
      message: `Declared view "${descriptor.id}" is invalid: ${selection.message}`,
    };
  }
  return {
    kind: "declaration",
    declaration: selection.declaration,
    targetPath,
  };
};

const tableColumns = async (
  superstate: Superstate,
  targetPath: string,
  tableId: string
): Promise<SpaceProperty[] | null> => {
  let schemas = superstate.contextsIndex.get(targetPath)?.schemas;
  if (!schemas?.some((schema) => schema.id == tableId)) {
    try {
      schemas = await superstate.spaceManager.tablesForSpace(targetPath);
    } catch (_error) {
      schemas = [];
    }
  }
  if (!schemas?.some((schema) => schema.id == tableId)) return null;

  try {
    const table = await superstate.spaceManager.readTable(targetPath, tableId);
    if (!table || table.schema?.id != tableId || !Array.isArray(table.cols)) {
      return null;
    }
    return table.cols;
  } catch (_error) {
    return null;
  }
};

const viewColumns = async (
  superstate: Superstate,
  targetPath: string,
  viewId: string,
  requireColumnTypes: boolean
): Promise<SpaceProperty[] | null> => {
  try {
    const frame = await superstate.spaceManager.readFrame(targetPath, viewId);
    if (!frame?.schema || frame.schema.id != viewId) return null;
    const schema = mdbSchemaToFrameSchema(frame.schema);
    if (schema?.type != "view") return null;

    const sources = normalizeCrossDatabaseSources(schema.def?.sources);
    if (sources.length > 1) {
      if (!requireColumnTypes) {
        return [
          { name: PathPropertyName, type: "fileprop", primary: "true" },
          ...Array.from(
            new Set(sources.flatMap((source) => Object.keys(source.fields)))
          ).map((name) => ({ name, type: "text" })),
          { name: crossDatabaseSourceColumn, type: "text" },
        ];
      }
      const loaded = await Promise.all(
        sources.map(async (source) => {
          try {
            const table = await superstate.spaceManager.readTable(
              source.context,
              source.db
            );
            return table ? { source, table } : null;
          } catch (_error) {
            return null;
          }
        })
      );
      if (loaded.some((entry) => entry == null)) return null;
      return assembleCrossDatabaseView(loaded as any).cols;
    }

    const tableId = schema.def?.db;
    if (!tableId) return null;
    return tableColumns(superstate, targetPath, tableId);
  } catch (_error) {
    return null;
  }
};

const baseColumns = (
  superstate: Superstate,
  targetPath: string,
  declaration: NotidianDeclaredView,
  requireColumnTypes: boolean
): Promise<SpaceProperty[] | null> =>
  declaration.base.kind == "table"
    ? tableColumns(superstate, targetPath, declaration.base.id)
    : viewColumns(
        superstate,
        targetPath,
        declaration.base.id,
        requireColumnTypes
      );

const hasRichProjection = (declaration: NotidianDeclaredView): boolean =>
  declaration.sort !== undefined ||
  declaration.groupBy !== undefined ||
  declaration.columns !== undefined ||
  declaration.limit !== undefined ||
  declaration.kind !== undefined;

const richProjection = (
  declaration: NotidianDeclaredView,
  columns: SpaceProperty[]
): { ok: true; predicate: Partial<Predicate> } | { ok: false; message: string } => {
  const predicate: Partial<Predicate> = {};
  const available = columns.filter((column) => column.hidden != "true");
  const byName = new Map(available.map((column) => [column.name, column]));
  const requireField = (field: string): SpaceProperty | null =>
    byName.get(field) ?? null;

  if (declaration.sort !== undefined) {
    const sort = [];
    for (const entry of declaration.sort) {
      const column = requireField(entry.field);
      if (!column) {
        return {
          ok: false,
          message: `Declared view "${declaration.id}" uses hidden or unknown sort field "${entry.field}".`,
        };
      }
      const fn = normalizedSortForType(
        column.type,
        entry.direction == "desc"
      );
      if (!fn) {
        return {
          ok: false,
          message: `Declared view "${declaration.id}" cannot sort field "${entry.field}" of type "${column.type}".`,
        };
      }
      sort.push({ field: entry.field, fn });
    }
    predicate.sort = sort;
  }

  if (declaration.groupBy !== undefined) {
    for (const field of declaration.groupBy) {
      if (!requireField(field)) {
        return {
          ok: false,
          message: `Declared view "${declaration.id}" uses hidden or unknown groupBy field "${field}".`,
        };
      }
    }
    predicate.groupBy = declaration.groupBy;
  }

  if (declaration.columns !== undefined) {
    for (const field of declaration.columns) {
      if (!requireField(field)) {
        return {
          ok: false,
          message: `Declared view "${declaration.id}" uses hidden, system, or unknown column "${field}".`,
        };
      }
    }
    predicate.colsOrder = declaration.columns;
    predicate.colsHidden = available
      .map((column) => column.name)
      .filter((field) => !declaration.columns?.includes(field));
  }

  if (declaration.limit !== undefined) predicate.limit = declaration.limit;

  if (declaration.kind !== undefined) {
    const layout = defaultViewTypes[declaration.kind];
    if (!layout) {
      return {
        ok: false,
        message: `Declared view "${declaration.id}" uses unsupported display kind "${declaration.kind}".`,
      };
    }
    predicate.view = layout.view;
    predicate.listView = layout.listView;
    predicate.listGroup = layout.listGroup;
    predicate.listItem = layout.listItem;
  }

  return { ok: true, predicate };
};

export const resolveDeclaredViewForEmbed = async ({
  superstate,
  descriptor,
  inspection,
}: {
  superstate: Superstate;
  descriptor: NotidianEmbedDescriptor;
  inspection: DeclaredViewInspection;
}): Promise<DeclaredViewRuntimeResult> => {
  if (inspection.kind == "none") {
    return { ok: true, descriptor: inspection.descriptor };
  }
  if (inspection.kind == "error") {
    return { ok: false, message: inspection.message };
  }

  const rich = hasRichProjection(inspection.declaration);
  const columns = await baseColumns(
    superstate,
    inspection.targetPath,
    inspection.declaration,
    rich
  );
  if (!columns) {
    return {
      ok: false,
      message: `Declared view "${inspection.declaration.id}" has a missing native ${inspection.declaration.base.kind} base "${inspection.declaration.base.id}".`,
    };
  }

  const filters = [
    ...(inspection.declaration.where ?? []),
    ...(descriptor.where ?? []),
  ];
  const fields = new Set(columns.map((column) => column.name));
  const unknownField = filters.find((filter) => !fields.has(filter.field));
  if (unknownField) {
    return {
      ok: false,
      message: `Declared view "${inspection.declaration.id}" uses unknown field "${unknownField.field}".`,
    };
  }

  const resolved: NotidianEmbedDescriptor = {
    ...descriptor,
    kind: inspection.declaration.base.kind,
    id: inspection.declaration.base.id,
  };
  if (filters.length > 0) resolved.where = filters;
  else delete resolved.where;

  const predicateOverlay: Partial<Predicate> = {};
  if (filters.length > 0) predicateOverlay.filters = filters;
  if (rich) {
    const projected = richProjection(inspection.declaration, columns);
    if (projected.ok === false) {
      return { ok: false, message: projected.message };
    }
    Object.assign(predicateOverlay, projected.predicate);
  }

  return {
    ok: true,
    descriptor: resolved,
    ...(Object.keys(predicateOverlay).length > 0 ? { predicateOverlay } : {}),
  };
};
