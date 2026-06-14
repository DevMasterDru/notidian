import { matchAny } from "core/react/components/UI/Menus/menu/concerns/matchers";
import { parseFieldValue } from "core/schemas/parseFieldValue";
import {
  createSpace,
  pinPathToSpaceAtIndex,
} from "core/superstate/utils/spaces";
import {
  discoverFrontmatterPropertiesFromPathStates,
  isFrontmatterBackedProperty,
  shouldImportFrontmatterColumns,
  shouldWriteContextPropertyToFrontmatter,
} from "core/utils/properties/allProperties";
import { saveFrontmatterProperties } from "core/utils/properties/frontmatterWrite";
import { createNewRow } from "core/utils/contexts/optionValuesForColumn";
import { buildRowUpdateWrites } from "core/utils/contexts/rowUpdateWrites";
import {
  createContextEditSerializerState,
  runSerializedContextEdit,
} from "core/utils/contexts/contextEditSerializer";
import {
  executeBulkPageTitleRename,
  renamePageTitleForRow,
} from "core/utils/contexts/pageTitleRename";
import { planPropertyColumnDelete } from "core/utils/contexts/propertyColumnActions";
import { applyFrontmatterSchemaWritePlans } from "core/utils/contexts/notidianSchemaApply";
import { isTypeProfileMirrorableType } from "core/utils/contexts/typeProfileMirror";
import {
  createTypeProfileMirrorQueue,
  runSerializedTypeProfileMirror,
} from "core/utils/contexts/typeProfileMirrorQueue";
import {
  NotidianSchemaIssue,
  planRenameFrontmatterProperty,
} from "core/utils/contexts/notidianSchema";
import {
  applyTableEditPathOverrides,
  combineTableEditTransactionResults,
  emptyTableEditTransactionResult,
  executeTableValueWrites,
  TableCellWrite,
  TableEditTransactionResult,
} from "core/utils/contexts/tableEditTransaction";
import { TablePasteWrite } from "core/utils/contexts/tablePastePlan";
import { filterReturnForCol } from "core/utils/contexts/predicate/filter";
import { sortReturnForCol } from "core/utils/contexts/predicate/sort";
import {
  buildRowTree,
  flattenVisibleTree,
} from "core/utils/contexts/tableRowTree";
import { makeRelationLinkResolver } from "core/utils/contexts/relationResolver";
import { serializeOptionValue } from "core/utils/serializer";
import { tagSpacePathFromTag } from "core/utils/strings";
import _, { isEqual } from "lodash";
import { Superstate } from "makemd-core";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { defaultContextTable, fieldTypeForField } from "schemas/mdb";
import i18n from "shared/i18n";
import {
  defaultContextDBSchema,
  defaultContextSchemaID,
} from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import {
  DBRow,
  DBRows,
  DBTable,
  SpaceProperty,
  SpaceTable,
  SpaceTableColumn,
  SpaceTableSchema,
  SpaceTables,
} from "shared/types/mdb";
import { FrameSchema } from "shared/types/mframe";
import { Predicate, Sort } from "shared/types/predicate";
import { uniq, uniqueNameFromString } from "shared/utils/array";
import { safelyParseJSON } from "shared/utils/json";
import { removeTrailingSlashFromFolder } from "shared/utils/paths";
import { sanitizeColumnName } from "shared/utils/sanitizers";
import { parseMultiString, parseProperty } from "utils/parsers";
import { parseMDBStringValue } from "utils/properties";
import {
  defaultPredicateForSchema,
  validatePredicate,
} from "../../utils/contexts/predicate/predicate";
import { FramesMDBContext } from "./FramesMDBContext";
import { SpaceContext } from "./SpaceContext";
import { useSpaceManager } from "./SpaceManagerContext";
import { PathContext } from "./PathContext";
type ContextEditorContextProps = {
  dbSchema: SpaceTableSchema;
  sortedColumns: SpaceTableColumn[];
  views: FrameSchema[];
  filteredData: DBRows;
  contextTable: SpaceTables;
  setContextTable: React.Dispatch<React.SetStateAction<SpaceTables>>;
  editMode: number;
  setEditMode: React.Dispatch<React.SetStateAction<number>>;
  selectedRows: string[];
  selectRows: (lastSelected: string, rows: string[]) => void;
  predicate: Predicate;
  savePredicate: (predicate: Partial<Predicate>) => void;
  source: string;
  hideColumn: (column: SpaceTableColumn, hidden: boolean) => void;
  sortColumn: (sort: Sort) => void;
  saveColumn: (
    column: SpaceTableColumn,
    oldColumn?: SpaceTableColumn
  ) => boolean;
  renameFrontmatterPropertyKey: (
    column: SpaceTableColumn,
    newKey: string,
    confirmRename?: (message: string) => boolean
  ) => Promise<boolean>;
  newColumn: (column: SpaceTableColumn) => boolean;
  delColumn: (column: SpaceTableColumn) => void;
  searchString: string;
  setSearchString: React.Dispatch<React.SetStateAction<string>>;
  // Quick find (Notidian-r20) is a separate view-layer affordance from the
  // row-hiding filter search above. Only the open toggle is shared here so the
  // filter-bar button and the table's Cmd/Ctrl+F open the same bar; the matches,
  // active index, and query live in TableView where the rows + DOM are.
  findOpen: boolean;
  setFindOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tableData: SpaceTable;
  cols: SpaceTableColumn[];
  saveDB: (table: SpaceTable) => void;
  data: DBRows;
  updateRow: (row: DBRow, index: number) => Promise<void>;
  updateValue: (
    column: string,
    value: string,
    table: string,
    index: number,
    path?: string
  ) => Promise<TableEditTransactionResult>;
  applyTableEdits: (
    writes: TablePasteWrite[]
  ) => Promise<TableEditTransactionResult>;
  applyValueEdits: (
    writes: TableCellWrite[]
  ) => Promise<TableEditTransactionResult>;
  reloadContextData: () => Promise<void>;
  renameRowTitle: (row: DBRow, value: string) => Promise<string | null>;
  updateFieldValue: (
    column: string,
    fieldValue: string,
    value: string,
    table: string,
    index: number,
    path?: string
  ) => Promise<TableEditTransactionResult>;
  // Sub-items (Notidian-pv4): per-row tree info for the table's indentation +
  // expand/collapse chevron, keyed by resolved path; null when the view has no
  // sub-items parent column configured (the table renders flat).
  subItemsInfo: Map<string, { depth: number; hasChildren: boolean }> | null;
  collapsedSubItems: Set<string>;
  toggleSubItemCollapse: (path: string) => void;
};

export const ContextEditorContext = createContext<ContextEditorContextProps>({
  dbSchema: null,
  views: [],
  source: "",
  sortedColumns: [],
  filteredData: [],
  contextTable: {},
  editMode: 0,
  setEditMode: () => null,
  selectedRows: [],
  selectRows: () => null,
  setContextTable: () => null,
  predicate: null,
  savePredicate: () => null,
  saveDB: () => null,
  hideColumn: () => null,
  saveColumn: () => false,
  renameFrontmatterPropertyKey: async () => false,
  newColumn: () => false,
  sortColumn: () => null,
  delColumn: () => null,
  searchString: "",
  setSearchString: () => null,
  findOpen: false,
  setFindOpen: () => null,
  data: [],
  applyTableEdits: async () => emptyTableEditTransactionResult(),
  applyValueEdits: async () => emptyTableEditTransactionResult(),
  reloadContextData: async () => undefined,
  updateValue: async () => emptyTableEditTransactionResult(),
  renameRowTitle: () => null,
  updateFieldValue: async () => emptyTableEditTransactionResult(),
  updateRow: () => null,
  tableData: null,
  cols: [],
  subItemsInfo: null,
  collapsedSubItems: new Set(),
  toggleSubItemCollapse: () => null,
});

const frontmatterRenameIssueMessage = ({
  issue,
  oldKey,
  newKey,
  conflictCount,
}: {
  issue: NotidianSchemaIssue;
  oldKey: string;
  newKey: string;
  conflictCount: number;
}): string => {
  switch (issue.reason) {
    case "empty-key":
      return "Property key cannot be empty.";
    case "same-key":
      return "The new property key must be different from the current key.";
    case "missing-source-column":
      return `Could not find the frontmatter-backed column "${oldKey}".`;
    case "duplicate-column":
      return `A column named "${issue.existingKey}" already exists.`;
    case "frontmatter-conflict":
      return `Cannot rename "${oldKey}" to "${newKey}" because ${conflictCount} file${
        conflictCount == 1 ? "" : "s"
      } already contain both keys with different values. First conflict: ${
        issue.path
      }.`;
  }
};

const frontmatterRenameConfirmationMessage = ({
  oldKey,
  newKey,
  totalFiles,
  moveCount,
  duplicateRemovalCount,
  existingTargetCount,
  untouchedCount,
}: {
  oldKey: string;
  newKey: string;
  totalFiles: number;
  moveCount: number;
  duplicateRemovalCount: number;
  existingTargetCount: number;
  untouchedCount: number;
}): string =>
  [
    `Rename frontmatter property "${oldKey}" to "${newKey}"?`,
    "",
    `${moveCount} file${moveCount == 1 ? "" : "s"} will copy the old value to the new key, then remove the old key.`,
    `${duplicateRemovalCount} file${
      duplicateRemovalCount == 1 ? "" : "s"
    } already have equal values and will only remove the old duplicate key.`,
    `${existingTargetCount} file${
      existingTargetCount == 1 ? "" : "s"
    } already use the new key and will not be changed.`,
    `${untouchedCount} of ${totalFiles} file${
      totalFiles == 1 ? "" : "s"
    } do not contain either key.`,
  ].join("\n");

export const ContextEditorProvider: React.FC<
  React.PropsWithChildren<{
    superstate: Superstate;
    source?: string;
  }>
> = (props) => {
  const { frameSchemas, saveSchema, frameSchema } =
    useContext(FramesMDBContext);

    const {
      pathState
    } = useContext(PathContext)
  const {
    spaceInfo,
    readMode,
    spaceState: spaceCache,
  } = useContext(SpaceContext);

  // Use the SpaceManager context (handles MKit preview mode internally)
  const spaceManager = useSpaceManager() || props.superstate.spaceManager;

  const [schemaTable, setSchemaTable] = useState<DBTable>(null);
  const [contextTable, setContextTable] = useState<SpaceTables>({});
  const [tableData, setTableData] = useState<SpaceTable>(null);

  const [searchString, setSearchString] = useState<string>(null);
  const [findOpen, setFindOpen] = useState<boolean>(false);
  const [predicate, setPredicate] = useState<Predicate>(null);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [editMode, setEditMode] = useState<number>(0);
  // Sub-items (Notidian-pv4): parent rows the user has collapsed in the tree.
  // View UI state, not persisted; empty = everything expanded.
  const [collapsedSubItems, setCollapsedSubItems] = useState<Set<string>>(
    () => new Set()
  );
  const toggleSubItemCollapse = useCallback((path: string) => {
    setCollapsedSubItems((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const contextPath =
    props.source ?? frameSchema?.def?.context ?? spaceInfo?.path;

  const dbSchema: SpaceTableSchema = useMemo(() => {
    if (frameSchema && frameSchema.def?.db) {
      if (schemaTable)
        return schemaTable?.rows.find(
          (f) => f.id == frameSchema.def.db
        ) as SpaceTableSchema;
      return {
        id: frameSchema.def.db,
        ...defaultContextDBSchema,
      };
    }
    return null;
  }, [frameSchema, schemaTable]);
  const views = useMemo(() => {
    const _views = frameSchemas.filter(
      (f) => f.type == "view" && f.def.db == dbSchema?.id
    );
    return _views.length > 0 ? _views : frameSchema ? [frameSchema] : [];
  }, [frameSchemas, frameSchema, dbSchema]);

  const defaultSchema = defaultContextTable;

  const contexts = useMemo(() => spaceCache?.contexts ?? [], [spaceCache]);
  const loadTables = async () => {
    let schemas: SpaceTableSchema[];

    // SpaceManager handles MKit preview mode internally
    schemas = props.superstate.contextsIndex.get(contextPath)?.schemas;

    if (!schemas) {
      try {
        schemas = await spaceManager.tablesForSpace(contextPath);
      } catch (error) {
        schemas = [];
      }
    }

    if (schemas && !isEqual(schemaTable?.rows, schemas)) {
      setSchemaTable(() => ({
        ...defaultSchema,
        rows: schemas,
      }));
    } else {
      if (dbSchema) {
        retrieveCachedTable(dbSchema);
      }
    }
  };

  useEffect(() => {
    if (dbSchema) retrieveCachedTable(dbSchema);
  }, [dbSchema]);

  const loadContextFields = useCallback(async (space: string) => {
    spaceManager.contextForSpace(space).then((f) => {
      setContextTable((t) => ({
        ...t,
        [space]: f,
      }));
    });
  }, []);
  const retrieveCachedTable = (newSchema: SpaceTableSchema): Promise<void> => {
    // SpaceManager handles MKit data internally
    return spaceManager
      .readTable(contextPath, newSchema.id)
      .then((f) => {
        if (f) {
          if (newSchema.primary) {
            for (const c of contexts) {
              loadContextFields(tagSpacePathFromTag(c));
            }
          }
          for (const c of f.cols) {
            if (c.type.startsWith("context")) {
              const value = parseFieldValue(c.value, c.type);
              if (value.space) loadContextFields(value.space);
            }
          }
          updateTable(f);
        } else {
        }
      })
      .catch((error) => {});
  };
  const updateTable = (newTable: SpaceTable) => {
    setTableData(newTable);
    setContextTable((t) => ({
      ...t,
      [contextPath]: newTable,
    }));
    // calculateTableData(newTable);
  };
  useEffect(() => {
    const refreshMDB = (payload: { path: string }) => {
      if (payload.path == contextPath) {
        loadTables();
      } else {
        const tag = Object.keys(contextTable).find(
          (t) => spaceManager.spaceInfoForPath(t)?.path == payload.path
        );
        if (tag) loadContextFields(tag);
      }
    };
    const refreshPath = (payload: { path: string }) => {
      if (payload.path == contextPath) {
        loadTables();
      } else if (
        dbSchema?.primary == "true" &&
        tableData?.rows.some((f) => f[PathPropertyName] == payload.path)
      ) {
        retrieveCachedTable(dbSchema);
      }
    };
    props.superstate.eventsDispatcher.addListener(
      "contextStateUpdated",
      refreshMDB
    );
    props.superstate.eventsDispatcher.addListener(
      "spaceStateUpdated",
      refreshMDB
    );

    props.superstate.eventsDispatcher.addListener(
      "pathStateUpdated",
      refreshPath
    );

    return () => {
      props.superstate.eventsDispatcher.removeListener(
        "contextStateUpdated",
        refreshMDB
      );
      props.superstate.eventsDispatcher.removeListener(
        "spaceStateUpdated",
        refreshMDB
      );

      props.superstate.eventsDispatcher.removeListener(
        "pathStateUpdated",
        refreshPath
      );
    };
  }, [contextTable, dbSchema, retrieveCachedTable, spaceInfo, tableData]);

  useEffect(() => {
    loadTables();
  }, [spaceInfo, frameSchema, props.source, spaceManager]);

  // Notion-style default columns: a fresh PRIMARY file context whose persisted
  // table still has only the default File/Created columns imports the
  // discovered frontmatter keys as persisted columns once. After the save the
  // persisted table no longer has only default columns, so the gate stays
  // closed on every later load; the ref dedupes attempts while mounted.
  const frontmatterImportAttempts = useRef(new Set<string>());
  const editSerializerRef = useRef(createContextEditSerializerState());
  // Serializes Type Profile mirror writes so a burst of schema edits (notably
  // add-option, which fires one mirror per new option) cannot lose updates to
  // the hub `fields` map (Notidian-miy).
  const typeProfileMirrorRef = useRef(createTypeProfileMirrorQueue());
  useEffect(() => {
    if (!tableData || !dbSchema) return;
    if (readMode || spaceInfo?.readOnly) return;
    const spaceState = props.superstate.spacesIndex.get(contextPath);
    if (!spaceState || spaceState.type == "tag") return;
    const paths = [
      ...(props.superstate.spacesMap.getInverse(contextPath) ?? []),
    ];
    const discovered = discoverFrontmatterPropertiesFromPathStates(
      props.superstate.pathsIndex,
      paths,
      props.superstate.settings,
      tableData.cols ?? [],
      dbSchema.id
    );
    if (
      !shouldImportFrontmatterColumns(
        dbSchema,
        tableData.cols ?? [],
        discovered.length
      )
    )
      return;
    const attemptKey = `${contextPath}//${dbSchema.id}`;
    if (frontmatterImportAttempts.current.has(attemptKey)) return;
    frontmatterImportAttempts.current.add(attemptKey);
    props.superstate.spaceManager
      .readTable(contextPath, dbSchema.id)
      .then((f) => {
        if (!f) return;
        // Re-discover against the freshly read persisted columns so a
        // concurrent import or user edit cannot duplicate columns.
        const freshDiscovered = discoverFrontmatterPropertiesFromPathStates(
          props.superstate.pathsIndex,
          paths,
          props.superstate.settings,
          f.cols ?? [],
          dbSchema.id
        );
        if (
          !shouldImportFrontmatterColumns(
            dbSchema,
            f.cols ?? [],
            freshDiscovered.length
          )
        )
          return;
        return props.superstate.spaceManager
          .saveTable(
            contextPath,
            { ...f, cols: [...(f.cols ?? []), ...freshDiscovered] },
            true
          )
          .then(() =>
            props.superstate.reloadContextByPath(contextPath, {
              force: true,
              calculate: true,
            })
          );
      })
      .catch(() => {});
  }, [tableData, dbSchema]);

  const saveDB = async (newTable: SpaceTable) => {
    if (spaceInfo.readOnly) return;
    updateTable(newTable);
    await props.superstate.spaceManager
      .saveTable(contextPath, newTable, true)
      .then((f) =>
        props.superstate.reloadContext(spaceInfo, {
          force: true,
          calculate: true,
        })
      );
  };

  const cols: SpaceTableColumn[] = useMemo(
    () =>
      tableData
        ? [
            ...(tableData.cols.map((f) => ({ ...f, table: "" })) ?? []),
            ...(dbSchema?.primary == "true"
              ? contexts.reduce(
                  (p, c) => [
                    ...p,
                    ...(contextTable[tagSpacePathFromTag(c)]?.cols
                      .filter((f) => f.primary != "true")
                      .map((f) => ({ ...f, table: c })) ?? []),
                  ],
                  []
                )
              : []),
          ].filter((f) => f)
        : [],
    [tableData, contextTable, contexts, dbSchema]
  );

  
  const data: DBRows = useMemo(() => {
    const computedData =
      tableData?.rows?.map((r, index) => ({
        _index: index.toString(),
        ...r,
        ...(r[PathPropertyName]
          ? {
              [PathPropertyName]: spaceManager.resolvePath(
                r[PathPropertyName],
                pathState?.path
              ),
            }
          : {}),
        ...contexts.reduce((p, c) => {
          const contextRowIndexByPath: number =
            contextTable[tagSpacePathFromTag(c)]?.rows.findIndex(
              (f) => f[PathPropertyName] == r[PathPropertyName]
            ) ?? -1;
          const contextRowsByPath: DBRow =
            contextTable[tagSpacePathFromTag(c)]?.rows[contextRowIndexByPath] ??
            {};
          const contextRowsWithKeysAppended: DBRow = Object.keys(
            contextRowsByPath
          ).reduce((pa, ca) => ({ ...pa, [ca + c]: contextRowsByPath[ca] }), {
            ["_index" + c]: contextRowIndexByPath.toString(),
          });
          return { ...p, ...contextRowsWithKeysAppended };
        }, {}),
      })) ?? [];

    return computedData;
  }, [tableData, contextTable, cols, dbSchema, pathState]);

  useEffect(() => {
    if (tableData) {
      for (const c of contexts) {
        loadContextFields(c);
      }
    }
  }, [tableData]);

  const saveContextDB = async (newTable: SpaceTable, space: string) => {
    await spaceManager.saveTable(space, newTable, true).then((f) =>
      props.superstate.reloadContextByPath(space, {
        force: true,
        calculate: true,
      })
    );
  };
  // const getSchema = (
  //   _schemaTable: FrameSchema[],
  //   _dbSchema: SpaceTableSchema,
  //   _currentSchema?: FrameSchema
  // ): FrameSchema => {
  //   let _schema;
  //   if (props.schema) {
  //     _schema = _schemaTable.find((f) => f.id == props.schema);
  //   } else {
  //     _schema =
  //       _currentSchema?.def?.db == _dbSchema.id
  //         ? _schemaTable.find((f) => f.id == _currentSchema.id)
  //         : _schemaTable.find((f) => f.def?.db == _dbSchema.id) ??
  //           ({
  //             ..._dbSchema,
  //             id: uniqueNameFromString(
  //               _dbSchema.id + "View",
  //               _schemaTable.map((f) => f.id)
  //             ),
  //             type: "view",
  //             def: { db: _dbSchema.id },
  //             predicate: JSON.stringify(
  //               _dbSchema.primary == "true"
  //                 ? defaultPredicate
  //                 : defaultTablePredicate
  //             ),
  //           } as FrameSchema);
  //   }
  //   return _schema;
  // };
  const sortedColumns = useMemo(() => {
    return cols
      .filter(
        (f) =>
          f.hidden != "true" &&
          !(predicate?.colsHidden ?? []).some((c) => c == f.name + f.table)
      )
      .sort(
        (a, b) =>
          (predicate?.colsOrder ?? []).findIndex((x) => x == a.name + a.table) -
          (predicate?.colsOrder ?? []).findIndex((x) => x == b.name + b.table)
      );
  }, [cols, predicate]);
  const filteredSortedData = useMemo(() => {
    return data
      .filter((f) => {
        return (predicate?.filters ?? []).reduce((p, c) => {
          const row = cols.some(
            (f) =>
              f.schemaId == defaultContextSchemaID &&
              f.name.toLowerCase() == "tags"
          )
            ? {
                ...f,
                [f.name]: (
                  spaceManager.getPathState(f[PathPropertyName])?.tags ?? []
                ).join(", "),
              }
            : f;
          return p
            ? filterReturnForCol(
                cols.find((col) => col.name + col.table == c.field),
                c,
                row,
                spaceCache.properties
              )
            : p;
        }, true);
      })
      .filter((f) =>
        searchString?.length > 0
          ? matchAny(searchString).test(
              Object.keys(f)
                .filter((g) => g.charAt(0) != "_")
                .map((g) => f[g])
                .join("|")
            )
          : true
      )
      .sort((a, b) => {
        return (predicate?.sort ?? []).reduce((p, c) => {
          return p == 0
            ? sortReturnForCol(
                cols.find((col) => col.name + col.table == c.field),
                c,
                a,
                b
              )
            : p;
        }, 0);
      });
  }, [predicate, data, cols, searchString]);

  // Sub-items (Notidian-pv4): the parent-link column the tree follows, if the
  // view configured one and it still exists. Resolved to the live column so the
  // data key (col.name) and link resolver match the relations/rollup runtime.
  const subItemsCol = useMemo(() => {
    const field = predicate?.subItems?.field;
    if (!field) return null;
    return cols.find((c) => c.name + c.table == field) ?? null;
  }, [predicate?.subItems?.field, cols]);

  // Depth-first tree nodes over the filtered+sorted rows, with collapsed
  // subtrees hidden. Null when sub-items is off (the table stays a flat list).
  const subItemsNodes = useMemo(() => {
    if (!subItemsCol) return null;
    const nodes = buildRowTree({
      rows: filteredSortedData,
      // Row data keys context-table columns as name+table (primary cols use
      // name, since their table is ""), so the universal accessor is name+table.
      parentKey: subItemsCol.name + subItemsCol.table,
      pathKey: PathPropertyName,
      // Shared relation resolver (e1u): canonicalize a parent [[link]] to the
      // child rows' real paths via the link index, so basename/bare wikilinks match.
      resolveLink: makeRelationLinkResolver(props.superstate),
    });
    return flattenVisibleTree(nodes, collapsedSubItems, PathPropertyName);
  }, [subItemsCol, filteredSortedData, collapsedSubItems, props.superstate]);

  // Per-row tree info (depth + hasChildren) keyed by resolved path, for the
  // table's indentation and expand/collapse chevron. Null when sub-items is off.
  const subItemsInfo = useMemo(() => {
    if (!subItemsNodes) return null;
    const info = new Map<string, { depth: number; hasChildren: boolean }>();
    for (const node of subItemsNodes) {
      info.set(String(node.row[PathPropertyName] ?? ""), {
        depth: node.depth,
        hasChildren: node.hasChildren,
      });
    }
    return info;
  }, [subItemsNodes]);

  const filteredData = useMemo(() => {
    const base = subItemsNodes
      ? subItemsNodes.map((n) => n.row)
      : filteredSortedData;
    // Apply limit if set (0 means show all)
    if (predicate?.limit > 0) {
      return base.slice(0, predicate.limit);
    }
    return base;
  }, [subItemsNodes, filteredSortedData, predicate?.limit]);

  const updateRow = async (row: DBRow, index: number) => {
    const spaceState = props.superstate.spacesIndex.get(
      contextPath ?? spaceCache.path
    );
    if (index == -1) {
      if (dbSchema?.id == defaultContextSchemaID) {
        const actualIndex = data.findIndex(
          (f) => f[PathPropertyName] == row[PathPropertyName]
        );
        if (actualIndex == -1) {
          const name = row[PathPropertyName];
          const path = props.superstate.pathsIndex.get(name);
          if (path) {
            await pinPathToSpaceAtIndex(
              props.superstate,
              spaceState,
              path.path
            );
          } else {
            const newPath =
              removeTrailingSlashFromFolder(spaceState.path) + "/" + name;

            await createSpace(props.superstate, newPath, {});
          }
          const changedCols = Object.keys(row).filter(
            (f) => f != PathPropertyName
          );
          const frontmatterChanges = changedCols.reduce((p, c) => {
            const col = cols.find((f) => f.name == c);
            if (
              !col ||
              !shouldWriteContextPropertyToFrontmatter(col)
            ) {
              return p;
            }

            return {
              ...p,
              [c]: parseMDBStringValue(col.type, row[c], true),
            };
          }, {});
          if (Object.keys(frontmatterChanges).length > 0) {
            const writeResult = await saveFrontmatterProperties({
              superstate: props.superstate,
              path: row?.[PathPropertyName],
              properties: frontmatterChanges,
            });
            if (!writeResult.ok) return;
          }
          saveDB(createNewRow(tableData, row));
          return;
        }
        await updateRow(row, actualIndex);
        return;
      }
      saveDB(createNewRow(tableData, row));
      return;
    }
    const currentData = data[index];
    if (!currentData) {
      // Index out of bounds, treat as new row
      saveDB(createNewRow(tableData, row));
      return;
    }
    // Route ordinary value changes through the authority-aware transaction so
    // calendar/modal/header edits get the same stale-frontmatter conflict gate,
    // MDB stripping, and undo as table cell edits. Title (PathPropertyName)
    // changes are excluded — they must use the rename transaction. bd Notidian-f2l.
    const writes = buildRowUpdateWrites(row, currentData, cols, index);
    if (writes.length > 0) {
      await executeValueWrites(writes);
    }
  };

  const executeValueWrites = async (
    writes: TableCellWrite[]
  ): Promise<TableEditTransactionResult> => {
    // Serialize per-context value transactions and thread the latest root table
    // into the next, so two concurrent edits sharing one rendered snapshot do not
    // last-write-wins. bd Notidian-lg1.
    return runSerializedContextEdit(
      editSerializerRef.current,
      tableData,
      ({ tableData: latestTable, onRootTableSaved }) =>
        executeTableValueWrites({
          writes,
          tableData: latestTable,
          contextTable,
          dbSchemaId: dbSchema?.id,
          contextPath,
          resolvePath: (path, source) =>
            props.superstate.spaceManager.resolvePath(path, source),
          shouldWritePropertyToFrontmatter:
            shouldWriteContextPropertyToFrontmatter,
          parseValue: (column, value) =>
            parseMDBStringValue(fieldTypeForField(column), value, true),
          currentFrontmatterValue: ({ path, column }) => {
            const pathState = props.superstate.pathsIndex.get(path);
            if (!pathState) return undefined;
            return parseProperty(
              column.name,
              pathState.metadata?.property?.[column.name],
              column.type
            );
          },
          saveFrontmatterProperties: ({ path, properties }) =>
            saveFrontmatterProperties({
              superstate: props.superstate,
              path,
              properties,
            }),
          saveDB: async (nextTable) => {
            onRootTableSaved(nextTable);
            await saveDB(nextTable);
          },
          saveContextDB,
          contextKeyForTable: tagSpacePathFromTag,
        })
    );
  };

  const applyValueEdits = async (
    writes: TableCellWrite[]
  ): Promise<TableEditTransactionResult> => executeValueWrites(writes);

  const reloadContextData = async (): Promise<void> => {
    if (props.superstate.reloadContextByPath) {
      await props.superstate.reloadContextByPath(contextPath, {
        force: true,
        calculate: true,
      });
    } else if (spaceInfo) {
      await props.superstate.reloadContext(spaceInfo, {
        force: true,
        calculate: true,
      });
    }
    if (dbSchema) await retrieveCachedTable(dbSchema);
  };

  const updateValue = async (
    column: string,
    value: string,
    table: string,
    index: number,
    path?: string
  ) => {
    return executeValueWrites([
      {
        rowId: index.toString(),
        columnId: column + table,
        columnName: column,
        table,
        value,
        path,
      },
    ]);
  };
  const renameRowTitle = async (row: DBRow, value: string) => {
    return renamePageTitleForRow({
      row,
      value,
      contextPath,
      superstate: props.superstate,
    });
  };
  const applyTableEdits = async (writes: TablePasteWrite[]) => {
    const fileWrites = writes.filter((write) => write.authority == "file");
    let valueWrites = writes.filter((write) => write.authority != "file");
    const results: TableEditTransactionResult[] = [];

    if (fileWrites.length > 0) {
      const result = await executeBulkPageTitleRename({
        items: fileWrites.map((write) => {
          const row =
            data.find((row) => row._index == write.rowId) ??
            tableData.rows[parseInt(write.rowId)];
          return {
            row: write.path
              ? ({ ...(row ?? {}), [PathPropertyName]: write.path } as DBRow)
              : row,
            value: write.value,
          };
        }),
        contextPath,
        superstate: props.superstate,
      });

      // Resolve the old path for a file write the same way the rename items were
      // built, so applied/failed entries can be correlated back to writes.
      const oldPathForFileWrite = (write: TablePasteWrite): string | undefined =>
        write.path ??
        (
          data.find((r) => r._index == write.rowId) ??
          tableData.rows[parseInt(write.rowId)]
        )?.[PathPropertyName];

      if (result.ok == false) {
        // Partial success: some renames reached final paths, the rest failed.
        // Classify FAILED writes from result.failures explicitly (a no-op title
        // write that didn't change is neither applied nor failed — it must not be
        // dropped). Report only the failures as failed (so undo captures the
        // applied renames) and retarget the applied rows. bd Notidian-79s.
        const key = (oldPath: string | undefined, value: string) =>
          `${oldPath ?? ""}\u0000${value}`;
        const failedKeys = new Set(
          result.failures.map((fail) => key(fail.row?.[PathPropertyName], fail.value))
        );
        const appliedByKey = new Map(
          result.applied.map((a) => [key(a.oldPath, a.value), a.newPath])
        );
        const failedFileWrites: TablePasteWrite[] = [];
        const overrideMap = new Map<string, string>();
        for (const write of fileWrites) {
          const k = key(oldPathForFileWrite(write), write.value);
          if (failedKeys.has(k)) {
            failedFileWrites.push(write);
          } else if (appliedByKey.has(k)) {
            overrideMap.set(write.rowId, appliedByKey.get(k) as string);
          }
        }
        results.push({
          ok: false,
          applied: fileWrites.length - failedFileWrites.length,
          skipped: [],
          failed: failedFileWrites.map((write) => ({
            write,
            reason: "file-rename-failed" as const,
          })),
        });
        // Drop value writes for failed-rename rows (their file is not at the new
        // path); retarget value writes for applied renames.
        const failedRowIds = new Set(failedFileWrites.map((w) => w.rowId));
        valueWrites = applyTableEditPathOverrides(
          valueWrites.filter((w) => !failedRowIds.has(w.rowId)),
          overrideMap
        );
      } else {
        results.push({
          ok: true,
          applied: fileWrites.length,
          skipped: [],
          failed: [],
        });
        valueWrites = applyTableEditPathOverrides(
          valueWrites,
          new Map(
            fileWrites.map((write, index) => [write.rowId, result.paths[index]])
          )
        );
      }
    }

    if (valueWrites.length > 0) {
      results.push(await executeValueWrites(valueWrites));
    }

    return results.length > 0
      ? combineTableEditTransactionResults(...results)
      : emptyTableEditTransactionResult();
  };
  const sortColumn = (sort: Sort) => {
    savePredicate({
      sort: [sort],
    });
  };

  const hideColumn = (col: SpaceTableColumn, hidden: boolean) => {
    savePredicate({
      colsHidden: hidden
        ? [
            ...predicate.colsHidden.filter((s) => s != col.name + col.table),
            col.name + col.table,
          ]
        : predicate.colsHidden.filter((s) => s != col.name + col.table),
    });
  };
  const updateFieldValue = async (
    column: string,
    fieldValue: string,
    value: string,
    table: string,
    index: number,
    path?: string
  ) => {
    return executeValueWrites([
      {
        rowId: index.toString(),
        columnId: column + table,
        columnName: column,
        table,
        value,
        path,
        fieldValue,
      },
    ]);
  };
  const syncAllProperties = async (f: SpaceTable) => {
    const paths = f.rows.map((f) => f[PathPropertyName]);

    const getPathProperties = async (
      paths: string[],
      fmKeys: SpaceProperty[]
    ): Promise<DBTable> => {
      let rows: DBTable = {
        uniques: [],
        cols: fmKeys.map((f) => f.name),
        rows: [],
      };
      for (const c of paths) {
        const properties =
          props.superstate.pathsIndex.get(c)?.metadata.property;
        rows = {
          uniques: [],
          cols: fmKeys.map((f) => f.name),
          rows: [
            ...rows.rows,
            {
              [PathPropertyName]: c,
              ...(properties
                ? fmKeys.reduce((p, c) => {
                    const value = parseProperty(
                      c.name,
                      properties[c.name],
                      c.type
                    );
                    if (value?.length > 0) return { ...p, [c.name]: value };
                    return p;
                  }, {})
                : {}),
            },
          ],
        };
      }

      return rows;
    };

    const pathPropertiesTable = await getPathProperties(
      paths,
      f.cols.filter((f) => !f.type.includes("file"))
    );
    const newRows = f.rows.map((r) => {
      const fmRow = pathPropertiesTable.rows.find(
        (f) => f[PathPropertyName] == r[PathPropertyName]
      );
      if (fmRow) {
        return {
          ...r,
          ...fmRow,
        };
      }
      return r;
    });

    const rowsChanged = !_.isEqual(newRows, tableData?.rows);
    const colsChanged = !_.isEqual(tableData?.cols, f.cols);
    if (rowsChanged || colsChanged) {
      saveDB({
        ...f,
        rows: newRows,
      });
    }
  };

  useEffect(() => {
    if (frameSchema) {
      parsePredicate(frameSchema.predicate);
    }
  }, [frameSchema]);

  const selectRows = (lastSelected: string, rows: string[]) => {
    setSelectedRows(rows);
    if (!(dbSchema?.primary == "true")) return;
    if (lastSelected) {
      const path = tableData.rows[parseInt(lastSelected)]?.[PathPropertyName];
      if (path) props.superstate.ui.setActivePath(path);
    } else {
      props.superstate.ui.setActivePath(contextPath);
    }
  };

  const savePredicate = (newPredicate: Partial<Predicate>) => {
    const defPredicate = defaultPredicateForSchema(dbSchema);
    const pred = {
      ...(predicate ?? defPredicate),
      ...newPredicate,
    };
    const cleanedPredicate = validatePredicate(pred, defPredicate);

    if (frameSchema) {
      saveSchema({
        ...frameSchema,
        predicate: JSON.stringify(cleanedPredicate),
      });
    } else {
      saveSchema({
        id: uniqueNameFromString(
          dbSchema.id + "View",
          frameSchemas.map((f) => f.id)
        ),
        name: dbSchema.name + " View",
        type: "view",
        def: { db: dbSchema.id },
        predicate: JSON.stringify(cleanedPredicate),
      });
    }
    setPredicate(cleanedPredicate);
  };
  useEffect(() => {
    if (predicate)
      setPredicate((p) => ({
        ...p,
        colsOrder: uniq([
          ...p.colsOrder,
          ...cols
            .filter((f) => f.hidden != "true")
            .map((c) => c.name + c.table),
        ]),
      }));
  }, [cols]);

  const parsePredicate = (predicateStr: string) => {
    const defPredicate = defaultPredicateForSchema(dbSchema);
    const newPredicate = validatePredicate(
      safelyParseJSON(predicateStr),
      defPredicate
    );
    setPredicate({
      ...newPredicate,
      colsOrder: uniq([
        ...newPredicate.colsOrder,
        ...cols.filter((f) => f.hidden != "true").map((c) => c.name + c.table),
      ]),
    });
  };

  const renameFrontmatterPropertyKey = async (
    column: SpaceTableColumn,
    newKey: string,
    confirmRename?: (message: string) => boolean
  ): Promise<boolean> => {
    if (spaceInfo?.readOnly) return false;
    if (!tableData || !isFrontmatterBackedProperty(column) || column.table) {
      return false;
    }

    const normalizedNewKey = sanitizeColumnName(newKey.trim());
    const paths = uniq(
      (tableData.rows ?? [])
        .map((row) => row?.[PathPropertyName])
        .filter(Boolean)
        .map(
          (path) =>
            props.superstate.spaceManager.resolvePath(path, pathState?.path) ??
            path
        )
    );
    const buildRenamePlan = () =>
      planRenameFrontmatterProperty({
        table: tableData,
        oldKey: column.name,
        newKey: normalizedNewKey,
        paths,
        frontmatterByPath: new Map(
          paths.map((path) => [
            path,
            props.superstate.pathsIndex.get(path)?.metadata?.property ?? {},
          ])
        ),
      });
    let plan = buildRenamePlan();

    if (!plan.canApplyAutomatically) {
      const conflicts = plan.issues.filter(
        (issue) => issue.reason == "frontmatter-conflict"
      );
      const issue = plan.issues[0];
      if (issue) {
        props.superstate.ui.notify(
          frontmatterRenameIssueMessage({
            issue,
            oldKey: column.name,
            newKey: normalizedNewKey,
            conflictCount: conflicts.length,
          })
        );
      }
      return false;
    }

    if (!confirmRename) {
      props.superstate.ui.notify(
        "Renaming a frontmatter key requires confirmation."
      );
      return false;
    }

    const stateCounts = plan.fileStates.reduce(
      (counts, fileState) => ({
        ...counts,
        [fileState.state]: counts[fileState.state] + 1,
      }),
      {
        "old-only": 0,
        "both-same": 0,
        "new-only": 0,
        neither: 0,
        "both-conflict": 0,
      }
    );

    const confirmed = confirmRename(
      frontmatterRenameConfirmationMessage({
        oldKey: column.name,
        newKey: normalizedNewKey,
        totalFiles: paths.length,
        moveCount: stateCounts["old-only"],
        duplicateRemovalCount: stateCounts["both-same"],
        existingTargetCount: stateCounts["new-only"],
        untouchedCount: stateCounts.neither,
      })
    );
    if (!confirmed) return false;

    const latestPlan = buildRenamePlan();
    if (
      !latestPlan.canApplyAutomatically ||
      !isEqual(latestPlan.fileStates, plan.fileStates) ||
      !isEqual(latestPlan.automaticWrites, plan.automaticWrites)
    ) {
      props.superstate.ui.notify(
        "Frontmatter changed while preparing the rename. Review and run the rename again."
      );
      await reloadContextData();
      return false;
    }
    plan = latestPlan;

    const applyResult = await applyFrontmatterSchemaWritePlans({
      writes: plan.automaticWrites,
      saveProperties: (path, properties) =>
        saveFrontmatterProperties({
          superstate: props.superstate,
          path,
          properties,
          failureMessage: "Could not rename frontmatter property.",
        }),
      deleteProperty: async (path, key) => {
        try {
          await props.superstate.spaceManager.deleteProperty(path, key);
          return { ok: true };
        } catch (error) {
          return { ok: false, error };
        }
      },
    });

    if (!applyResult.ok) {
      const failed = applyResult.failed[0];
      props.superstate.ui.notify(
        `Could not rename frontmatter property at ${failed.path}.`
      );
      await reloadContextData();
      return false;
    }

    const tablePreview = {
      ...plan.tablePreview,
      rows: plan.tablePreview.rows.map((row) => {
        const { [column.name]: oldValue, ...rest } = row;
        return oldValue === undefined
          ? rest
          : { ...rest, [normalizedNewKey]: oldValue };
      }),
    };

    savePredicate({
      filters: (predicate?.filters ?? []).map((filter) =>
        filter.field == column.name + column.table
          ? { ...filter, field: normalizedNewKey + column.table }
          : filter
      ),
      sort: (predicate?.sort ?? []).map((sort) =>
        sort.field == column.name + column.table
          ? { ...sort, field: normalizedNewKey + column.table }
          : sort
      ),
      groupBy: (predicate?.groupBy ?? []).map((field) =>
        field == column.name + column.table
          ? normalizedNewKey + column.table
          : field
      ),
      colsHidden: (predicate?.colsHidden ?? []).map((field) =>
        field == column.name + column.table
          ? normalizedNewKey + column.table
          : field
      ),
      colsOrder: (predicate?.colsOrder ?? []).map((field) =>
        field == column.name + column.table
          ? normalizedNewKey + column.table
          : field
      ),
      colsSize: {
        ...(predicate?.colsSize ?? {}),
        [normalizedNewKey + column.table]:
          predicate?.colsSize?.[column.name + column.table],
        [column.name + column.table]: undefined,
      },
      colsCalc: {
        ...(predicate?.colsCalc ?? {}),
        [normalizedNewKey + column.table]:
          predicate?.colsCalc?.[column.name + column.table],
        [column.name + column.table]: undefined,
      },
      // Chart + sub-items also reference a column; remap them on rename so the
      // reference does not go stale (chart would empty, sub-items would flatten).
      chart: predicate?.chart
        ? {
            ...predicate.chart,
            groupKey:
              predicate.chart.groupKey == column.name + column.table
                ? normalizedNewKey + column.table
                : predicate.chart.groupKey,
            valueKey:
              predicate.chart.valueKey == column.name + column.table
                ? normalizedNewKey + column.table
                : predicate.chart.valueKey,
          }
        : undefined,
      subItems:
        predicate?.subItems?.field == column.name + column.table
          ? { ...predicate.subItems, field: normalizedNewKey + column.table }
          : predicate?.subItems,
    });

    await saveDB(tablePreview);
    if (dbSchema?.id == defaultContextSchemaID) {
      void runSerializedTypeProfileMirror(
        typeProfileMirrorRef.current,
        props.superstate,
        contextPath,
        {
          kind: "rename-key",
          oldName: column.name,
          newName: normalizedNewKey,
        }
      );
    }
    await reloadContextData();
    props.superstate.ui.notify(
      `Renamed "${column.name}" to "${normalizedNewKey}" in ${applyResult.applied} file${
        applyResult.applied == 1 ? "" : "s"
      }.`
    );
    return true;
  };

  const delColumn = (column: SpaceTableColumn) => {
    let mdbtable: SpaceTable;
    const table = column.table;
    if (table == "") {
      mdbtable = tableData;
    } else if (contextTable[tagSpacePathFromTag(table)]) {
      mdbtable = contextTable[tagSpacePathFromTag(table)];
    }
    const deletePlan = planPropertyColumnDelete(mdbtable, column);
    if (deletePlan.action == "hide") {
      hideColumn(column, true);
      return;
    }
    const newTable = deletePlan.table;
    if (table == "") {
      saveDB(newTable);
    } else if (contextTable[tagSpacePathFromTag(table)]) {
      saveContextDB(newTable, tagSpacePathFromTag(table));
    }
  };
  const newColumn = (col: SpaceTableColumn): boolean => {
    return saveColumn(col);
  };
  const saveColumn = (
    newColumn: SpaceTableColumn,
    oldColumn?: SpaceTableColumn
  ): boolean => {
    let mdbtable: SpaceTable;
    const column = {
      ...newColumn,
      name: sanitizeColumnName(newColumn.name),
    };
    const table = column.table;
    if (table == "" || table == contextPath) {
      mdbtable = tableData;
    } else if (contextTable[tagSpacePathFromTag(table)]) {
      mdbtable = contextTable[tagSpacePathFromTag(table)];
    }

    if (column.name == "") {
      props.superstate.ui.notify(i18n.notice.noPropertyName);
      return false;
    }
    if (
      (!oldColumn &&
        mdbtable.cols.find(
          (f) => f.name.toLowerCase() == column.name.toLowerCase()
        )) ||
      (oldColumn &&
        oldColumn.name != column.name &&
        mdbtable.cols.find(
          (f) => f.name.toLowerCase() == column.name.toLowerCase()
        ))
    ) {
      props.superstate.ui.notify(i18n.notice.duplicatePropertyName);
      return false;
    }
    if (
      !oldColumn &&
      newColumn.schemaId == defaultContextSchemaID &&
      newColumn.type.startsWith("option")
    ) {
      const allOptions = uniq(
        [...(props.superstate.spacesMap.getInverse(contextPath) ?? [])].flatMap(
          (f) =>
            parseMultiString(
              props.superstate.pathsIndex.get(f)?.metadata?.property?.[
                newColumn.name
              ]
            ) ?? []
        )
      );
      const values = serializeOptionValue(
        allOptions.map((f) => ({ value: f, name: f })),
        {}
      );
      column.value = values;
    }
    const oldFieldIndex = oldColumn
      ? mdbtable.cols.findIndex((f) => f.name == oldColumn.name)
      : -1;
    const newFields: SpaceProperty[] =
      oldFieldIndex == -1
        ? [...mdbtable.cols, column]
        : mdbtable.cols.map((f, i) => (i == oldFieldIndex ? column : f));
    const newTable = {
      ...mdbtable,
      cols: newFields,
      rows: mdbtable.rows.map((f) =>
        oldColumn
          ? {
              ...f,
              [column.name]: f[oldColumn.name],
              oldColumn: undefined,
            }
          : f
      ),
    };

    if (oldColumn)
      savePredicate({
        filters: (predicate?.filters ?? []).map((f) =>
          f.field == oldColumn.name + oldColumn.table
            ? { ...f, field: column.name + column.table }
            : f
        ),
        sort: (predicate?.sort ?? []).map((f) =>
          f.field == oldColumn.name + oldColumn.table
            ? { ...f, field: column.name + column.table }
            : f
        ),
        groupBy: (predicate?.groupBy ?? []).map((f) =>
          f == oldColumn.name + oldColumn.table ? column.name + column.table : f
        ),
        colsHidden: (predicate?.colsHidden ?? []).map((f) =>
          f == oldColumn.name + oldColumn.table ? column.name + column.table : f
        ),
        colsOrder: (predicate?.colsOrder ?? []).map((f) =>
          f == oldColumn.name + oldColumn.table ? column.name + column.table : f
        ),
        colsSize: {
          ...(predicate?.colsSize ?? {}),
          [column.name + column.table]:
            predicate?.colsSize?.[oldColumn.name + oldColumn.table],
          [oldColumn.name + oldColumn.table]: undefined,
        },
        colsCalc: {
          ...(predicate?.colsCalc ?? {}),
          [column.name + column.table]:
            predicate?.colsCalc?.[oldColumn.name + oldColumn.table],
          [oldColumn.name + oldColumn.table]: undefined,
        },
        chart: predicate?.chart
          ? {
              ...predicate.chart,
              groupKey:
                predicate.chart.groupKey == oldColumn.name + oldColumn.table
                  ? column.name + column.table
                  : predicate.chart.groupKey,
              valueKey:
                predicate.chart.valueKey == oldColumn.name + oldColumn.table
                  ? column.name + column.table
                  : predicate.chart.valueKey,
            }
          : undefined,
        subItems:
          predicate?.subItems?.field == oldColumn.name + oldColumn.table
            ? { ...predicate.subItems, field: column.name + column.table }
            : predicate?.subItems,
      });
    if (table == "") {
      if (dbSchema.id == defaultContextSchemaID) {
        syncAllProperties(newTable);
      } else {
        saveDB(newTable);
      }
    } else if (contextTable[tagSpacePathFromTag(table)]) {
      saveContextDB(newTable, tagSpacePathFromTag(table));
    }

    if (
      table == "" &&
      dbSchema?.id == defaultContextSchemaID &&
      isTypeProfileMirrorableType(column.type)
    ) {
      if (!oldColumn) {
        void runSerializedTypeProfileMirror(
          typeProfileMirrorRef.current,
          props.superstate,
          contextPath,
          {
            kind: "add-column",
            name: column.name,
            type: column.type,
          }
        );
      } else if (
        oldColumn.name == column.name &&
        column.type.startsWith("option") &&
        oldColumn.value != column.value
      ) {
        const optionValues = (value: string) => {
          const options = safelyParseJSON(value)?.options;
          return Array.isArray(options)
            ? options.map((option: { value?: string; name?: string }) =>
                String(option?.value ?? option?.name ?? "")
              )
            : [];
        };
        const previous = optionValues(oldColumn.value);
        for (const option of optionValues(column.value).filter(
          (option) => option.length > 0 && !previous.includes(option)
        )) {
          void runSerializedTypeProfileMirror(
            typeProfileMirrorRef.current,
            props.superstate,
            contextPath,
            {
              kind: "add-option",
              name: column.name,
              option,
            }
          );
        }
      }
    }

    return true;
  };

  return (
    <ContextEditorContext.Provider
      value={{
        source: contextPath,
        views,
        cols,
        saveDB,
        filteredData,
        dbSchema,
        tableData,
        selectedRows,
        selectRows,
        sortedColumns,
        contextTable,
        setContextTable,
        predicate,
        savePredicate,
        saveColumn,
        renameFrontmatterPropertyKey,
        hideColumn,
        sortColumn,
        delColumn,
        newColumn,
        searchString,
        setSearchString,
        findOpen,
        setFindOpen,
        updateValue,
        applyTableEdits,
        applyValueEdits,
        reloadContextData,
        renameRowTitle,
        updateFieldValue,
        editMode,
        setEditMode,
        data,
        updateRow,
        subItemsInfo,
        collapsedSubItems,
        toggleSubItemCollapse,
      }}
    >
      {props.children}
    </ContextEditorContext.Provider>
  );
};
