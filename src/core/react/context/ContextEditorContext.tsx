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
import {
  planPropertyColumnDelete,
  predicateColumnReferenceDeleteForColumn,
} from "core/utils/contexts/propertyColumnActions";
import { applyFrontmatterSchemaWritePlans } from "core/utils/contexts/notidianSchemaApply";
import { isTypeProfileMirrorableType } from "core/utils/contexts/typeProfileMirror";
import {
  createTypeProfileMirrorQueue,
  runSerializedTypeProfileMirror,
} from "core/utils/contexts/typeProfileMirrorQueue";
import {
  NotidianSchemaIssue,
  planDeleteFrontmatterProperty,
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
import { applyAssemblyLimit } from "core/utils/contexts/tableAssembly";
import {
  assembleCrossDatabaseView,
  filterCrossDatabaseLoadedSource,
  normalizeCrossDatabaseSources,
} from "core/utils/contexts/crossDatabaseView";
import { materializeComputedRelationColumns } from "core/utils/contexts/computedRelationColumns";
import { millisecondsUntilNextLocalDay } from "core/utils/contexts/rollupPeriod";
import { isRecurrenceFilterFn } from "core/utils/contexts/recurrenceOccurrence";
import { makeRowMatchesFilters } from "core/utils/contexts/predicate/rowMatchesFilters";
import { resolveOverlayFilters } from "core/utils/contexts/predicate/overlayFilters";
import {
  applyRenderPathPredicateProjection,
  stripRenderPathProjectionFromSave,
} from "core/utils/contexts/predicate/renderPathPredicateProjection";
import { sortReturnForCol } from "core/utils/contexts/predicate/sort";
import {
  buildRowTree,
  flattenVisibleTree,
  subItemAddRowsAfter,
  SubItemAddRow,
  RowTreeNode,
  nextCollapsedPaths,
  rootDescendantCounts,
  scopeRowsByFilter,
} from "core/utils/contexts/tableRowTree";
import { makeRelationLinkResolver } from "core/utils/contexts/relationResolver";
import { resolveSubItemsCol } from "core/utils/contexts/subItemsResolve";
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
import {
  CrossDatabaseSourceDefinition,
  FrameSchema,
} from "shared/types/mframe";
import { Predicate, Sort, SubItemsDisplay } from "shared/types/predicate";
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
  savePredicate: (predicate: Partial<Predicate>) => Promise<void>;
  source: string;
  crossDatabase: boolean;
  crossDatabaseSources: CrossDatabaseSourceDefinition[];
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
  deleteFrontmatterPropertyKey: (
    column: SpaceTableColumn,
    confirmDelete?: (message: string) => boolean
  ) => Promise<boolean>;
  newColumn: (column: SpaceTableColumn) => boolean;
  delColumn: (column: SpaceTableColumn) => void;
  searchString: string;
  setSearchString: React.Dispatch<React.SetStateAction<string>>;
  // Open toggle for the single view search (the filter-search SearchBar).
  // Shared here (ADR 0041) so the toolbar magnifier and the table's
  // Cmd/Ctrl+F open the same one search affordance — the table's keydown
  // handler lives in TableView, the input renders in FilterBar.
  searchActive: boolean;
  setSearchActive: React.Dispatch<React.SetStateAction<boolean>>;
  // The one open-only entry point for Search This View. The toolbar and keyboard
  // shortcut use this rather than independently toggling transient state.
  openViewSearch: () => void;
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
    writes: TableCellWrite[],
    options?: { allOrNothing?: boolean }
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
  subItemsInfo: Map<
    string,
    {
      depth: number;
      hasChildren: boolean;
      childCount: number;
      surfacedAsRoot: boolean;
      descendantCount?: number;
    }
  > | null;
  // Sub-item display mode (Notidian-5ond.4): "nested" | "flattened" |
  // "parents-only". Drives which affordances render.
  subItemsDisplay: SubItemsDisplay;
  // Frontmatter key of the configured parent-link column (= subItemsCol.name),
  // or null when sub-items is off — used by the "Add sub-item" row action to
  // write ONLY the child's parent link (ADR 0024 B1, one-way).
  subItemsField: string | null;
  // The tree/READ key for the same column (= name+table, what buildRowTree's
  // parentKey uses). Distinct from subItemsField (the bare WRITE key) because a
  // non-primary column's row-data key is name+table (ADR 0050 foundation seam).
  subItemsParentKey: string | null;
  collapsedSubItems: Set<string>;
  toggleSubItemCollapse: (path: string) => void;
  // Collapse / expand every parent at once (Notidian-5ond.3), persisted.
  setSubItemsCollapsedAll: (collapsed: boolean) => void;
  // Notion-style "+ New sub-item" rows (Notidian-gr8t): keyed by the path of the
  // row AFTER which the add-row(s) render (an expanded parent's last visible
  // descendant), valued by the ordered add-rows (deepest-first for nested
  // parents). null when sub-items is off, the flag is off, or in read mode.
  subItemAddRows: Map<string, SubItemAddRow[]> | null;
  // The FULL depth-first sub-items tree (Notidian-5ond.8 review): collapse-,
  // predicate.limit-, AND display-mode-independent (built in flattened mode too,
  // where the rendered tree is null). Non-destructive parent-delete resolves a
  // row's descendant set from THIS, never from filteredData (the visible
  // projection), so a parent whose descendants are hidden / limited away /
  // roots-only / flattened is never mistaken for a leaf and silently deleted.
  // null only when no sub-items parent column is configured.
  subItemsTreeNodes: RowTreeNode[] | null;
};

export const ContextEditorContext = createContext<ContextEditorContextProps>({
  dbSchema: null,
  views: [],
  source: "",
  crossDatabase: false,
  crossDatabaseSources: [],
  sortedColumns: [],
  filteredData: [],
  contextTable: {},
  editMode: 0,
  setEditMode: () => null,
  selectedRows: [],
  selectRows: () => null,
  setContextTable: () => null,
  predicate: null,
  savePredicate: async () => undefined,
  saveDB: () => null,
  hideColumn: () => null,
  saveColumn: () => false,
  renameFrontmatterPropertyKey: async () => false,
  deleteFrontmatterPropertyKey: async () => false,
  newColumn: () => false,
  sortColumn: () => null,
  delColumn: () => null,
  searchString: "",
  setSearchString: () => null,
  searchActive: false,
  setSearchActive: () => null,
  openViewSearch: () => null,
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
  subItemsDisplay: "nested",
  subItemsField: null,
  subItemsParentKey: null,
  collapsedSubItems: new Set(),
  toggleSubItemCollapse: () => null,
  setSubItemsCollapsedAll: () => null,
  subItemAddRows: null,
  subItemsTreeNodes: null,
});

const frontmatterRenameIssueMessage = ({
  issue,
  oldKey,
  newKey,
  conflictCount,
  caseVariantCount,
}: {
  issue: NotidianSchemaIssue;
  oldKey: string;
  newKey: string;
  conflictCount: number;
  caseVariantCount: number;
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
    case "case-variant-frontmatter-key":
      return `Cannot rename "${oldKey}" to "${newKey}" because ${caseVariantCount} file${
        caseVariantCount == 1 ? "" : "s"
      } already contain a differently-cased spelling of "${
        issue.requestedKey
      }" ("${issue.foundKey}"). First occurrence: ${issue.path}.`;
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

const frontmatterDeleteIssueMessage = ({
  issue,
  key,
}: {
  issue: NotidianSchemaIssue;
  key: string;
}): string => {
  switch (issue.reason) {
    case "empty-key":
      return "Property key cannot be empty.";
    case "missing-source-column":
      return `Could not find the frontmatter-backed column "${key}".`;
    case "same-key":
    case "duplicate-column":
    case "frontmatter-conflict":
    case "case-variant-frontmatter-key":
      return `Could not delete frontmatter property "${key}".`;
  }
};

const frontmatterDeleteConfirmationMessage = ({
  key,
  totalFiles,
  affectedFiles,
  untouchedFiles,
  caseVariantFiles,
  caseVariantExample,
}: {
  key: string;
  totalFiles: number;
  affectedFiles: number;
  untouchedFiles: number;
  // Notidian-1e93: files whose key is a case-variant spelling of the deleted
  // column (e.g. "State" for column "state"). Surfaced as its own line so a
  // human confirming the delete sees these orphaned-casing removals distinctly
  // rather than having them vanish into the "do not contain this key" tally.
  caseVariantFiles: number;
  caseVariantExample?: string;
}): string =>
  [
    `Delete frontmatter property "${key}"?`,
    "",
    `${affectedFiles} file${
      affectedFiles == 1 ? "" : "s"
    } will permanently remove this YAML key.`,
    ...(caseVariantFiles > 0
      ? [
          `${caseVariantFiles} of those store it under a different capitalization${
            caseVariantExample ? ` (e.g. "${caseVariantExample}")` : ""
          } — those spellings will also be removed.`,
        ]
      : []),
    `${untouchedFiles} of ${totalFiles} file${
      totalFiles == 1 ? "" : "s"
    } do not contain this key.`,
    "",
    "The column will also be hidden from this Notidian view.",
  ].join("\n");

export const ContextEditorProvider: React.FC<
  React.PropsWithChildren<{
    superstate: Superstate;
    source?: string;
    // ADR-0062 — render-path declared-view projection. Filters are applied
    // conjunctively; explicitly declared rich values replace the corresponding
    // native values for rendering only. The save path strips every projected
    // key before state or schema persistence.
    predicateOverlay?: Partial<Predicate>;
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
  const [computedRelationEpoch, setComputedRelationEpoch] = useState(0);
  const refreshComputedRelations = useRef(
    _.debounce(() => setComputedRelationEpoch((value) => value + 1), 50)
  );

  const [searchString, setSearchString] = useState<string>(null);
  const [searchActive, setSearchActive] = useState<boolean>(false);
  const openViewSearch = () => setSearchActive(true);
  const [predicate, setPredicate] = useState<Predicate>(null);
  const overlayEnabled =
    props.superstate.settings?.renderPathViewOverlays !== false;
  const projectedPredicate = useMemo(
    () =>
      applyRenderPathPredicateProjection({
        base: predicate,
        overlay: props.predicateOverlay,
        enabled: overlayEnabled,
      }),
    [predicate, props.predicateOverlay, overlayEnabled]
  );
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [editMode, setEditMode] = useState<number>(0);
  // Sub-items collapse state (Notidian-pv4), PERSISTED per view in
  // predicate.subItems.collapsed (Notidian-5ond.3) so it survives reloads/sync.
  // Keyed by resolved row path; empty = everything expanded. The toggle +
  // collapse-all writers are defined after savePredicate (below).
  const collapsedSubItems = useMemo(
    () => new Set(predicate?.subItems?.collapsed ?? []),
    [predicate?.subItems?.collapsed]
  );
  const contextPath =
    props.source ?? frameSchema?.def?.context ?? spaceInfo?.path;

  const crossDatabaseSources = useMemo(
    () => normalizeCrossDatabaseSources(frameSchema?.def?.sources),
    [frameSchema?.def?.sources]
  );
  const crossDatabase =
    props.superstate.settings?.crossDatabaseSavedViews !== false &&
    crossDatabaseSources.length > 1;
  const crossDatabaseContexts = useMemo(
    () => new Set(crossDatabaseSources.map((source) => source.context)),
    [crossDatabaseSources]
  );
  const notifiedCrossDatabaseIssues = useRef(new Set<string>());
  useEffect(() => {
    notifiedCrossDatabaseIssues.current.clear();
  }, [frameSchema?.def?.sources]);
  const hasComputedRelationColumns =
    props.superstate.settings?.periodScopedRollups !== false &&
    (tableData?.cols ?? []).some(
      (column) => column?.type == "rollup" || column?.type == "backlink"
    );
  const hasRecurrenceFilters =
    props.superstate.settings?.recurrenceAwareFilters !== false &&
    [
      ...(predicate?.filters ?? []),
      ...(props.superstate.settings?.renderPathViewOverlays !== false
        ? (props.predicateOverlay?.filters ?? [])
        : []),
    ].some((filter) => isRecurrenceFilterFn(filter.fn));
  const hasCurrentPeriodDependencies =
    hasComputedRelationColumns || hasRecurrenceFilters;

  useEffect(() => {
    if (!hasCurrentPeriodDependencies) return;
    const timeout = window.setTimeout(
      () => setComputedRelationEpoch((value) => value + 1),
      millisecondsUntilNextLocalDay()
    );
    return () => window.clearTimeout(timeout);
  }, [hasCurrentPeriodDependencies, computedRelationEpoch, contextPath]);

  const notifyCrossDatabaseReadOnly = () =>
    props.superstate.ui.notify(
      "Cross-database views are read-only. Edit the source database instead."
    );

  const dbSchema: SpaceTableSchema = useMemo(() => {
    if (crossDatabase) return { ...defaultContextDBSchema };
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
  }, [crossDatabase, frameSchema, schemaTable]);
  const views = useMemo(() => {
    const _views = frameSchemas.filter(
      (f) => f.type == "view" && f.def.db == dbSchema?.id
    );
    return _views.length > 0 ? _views : frameSchema ? [frameSchema] : [];
  }, [frameSchemas, frameSchema, dbSchema]);

  const defaultSchema = defaultContextTable;

  const contexts = useMemo(
    () => (crossDatabase ? [] : (spaceCache?.contexts ?? [])),
    [crossDatabase, spaceCache]
  );
  const loadTables = async () => {
    let schemas: SpaceTableSchema[];

    if (crossDatabase) {
      schemas = [{ ...defaultContextDBSchema }];
    } else {

    // SpaceManager handles MKit preview mode internally
    schemas = props.superstate.contextsIndex.get(contextPath)?.schemas;

    if (!schemas) {
      try {
        schemas = await spaceManager.tablesForSpace(contextPath);
      } catch (error) {
        schemas = [];
      }
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
    if (crossDatabase) {
      return Promise.all(
        crossDatabaseSources.map(async (source) => {
          try {
            const sourceTable = await spaceManager.readTable(
              source.context,
              source.db
            );
            if (!sourceTable) return null;
            return filterCrossDatabaseLoadedSource(
              { source, table: sourceTable },
              spaceManager,
              undefined,
              props.superstate.settings?.recurrenceAwareFilters !== false
            );
          } catch (_error) {
            return null;
          }
        })
      ).then((loaded) => {
        const results = loaded.filter(Boolean) as Array<
          NonNullable<(typeof loaded)[number]>
        >;
        for (const result of results) {
          if (!result.issue) continue;
          const issueKey = `${result.issue.sourceContext}\0${result.issue.sourceDb}\0${result.issue.message}`;
          if (notifiedCrossDatabaseIssues.current.has(issueKey)) continue;
          notifiedCrossDatabaseIssues.current.add(issueKey);
          props.superstate.ui.notify(result.issue.message);
        }
        updateTable(
          assembleCrossDatabaseView(results.map((result) => result.loaded))
        );
      });
    }
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
    // Capture the latest closures and flush once on the trailing edge so a
    // burst collapses to a single read-back. A "tables" reload supersedes a
    // pending "primary" recompute (loadTables already re-reads the primary
    // table); a "primary" request never downgrades a pending "tables" one.
    const scheduleReload = (kind: "tables" | "primary", run: () => void) => {
      if (kind === "tables" || pendingReloadRef.current?.kind !== "tables") {
        pendingReloadRef.current = { kind, run };
      }
      flushReload.current();
    };
    const refreshMDB = (payload: { path: string }) => {
      if (
        payload.path == contextPath ||
        (crossDatabase && crossDatabaseContexts.has(payload.path))
      ) {
        scheduleReload("tables", () => loadTables());
      } else {
        const tag = Object.keys(contextTable).find(
          (t) => spaceManager.spaceInfoForPath(t)?.path == payload.path
        );
        if (tag) loadContextFields(tag);
      }
    };
    const refreshPath = (payload: { path: string }) => {
      if (hasComputedRelationColumns) refreshComputedRelations.current();
      if (
        payload.path == contextPath ||
        (crossDatabase && crossDatabaseContexts.has(payload.path))
      ) {
        scheduleReload("tables", () => loadTables());
      } else if (
        dbSchema?.primary == "true" &&
        tableData?.rows.some((f) => f[PathPropertyName] == payload.path)
      ) {
        const schemaToRecompute = dbSchema;
        scheduleReload("primary", () => retrieveCachedTable(schemaToRecompute));
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
  }, [
    contextTable,
    dbSchema,
    retrieveCachedTable,
    spaceInfo,
    tableData,
    hasComputedRelationColumns,
  ]);

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
  // Coalesce the reactive reindex storm. A paste/undo/redo across M rows writes
  // frontmatter per-row; each write fires its own metadata-cache callback which
  // dispatches BOTH `pathStateUpdated` (-> retrieveCachedTable, a full primary
  // readTable + context-field reloads) AND, for a primary file-context,
  // `contextStateUpdated` for THIS contextPath (-> loadTables). Un-coalesced
  // that is O(M) full recomputes, which hangs the table on large DBs (the "slow
  // paste / undo-redo hangs" report). One trailing executor collapses a whole
  // burst into a SINGLE read-back: a "tables" reload (loadTables) supersedes a
  // "primary" recompute (retrieveCachedTable) because loadTables already
  // re-reads the primary table (directly when schemas are unchanged — the
  // steady-state edit case — else via the dbSchema effect), so a burst firing
  // BOTH vectors does one read, not two. Only the read-BACK is deferred
  // (~100ms); the write path (runSerializedContextEdit / the pathsIndex conflict
  // gate — Notidian-lg1) is untouched, so no last-write-wins / stale-snapshot
  // regression. bd Notidian (reindex-storm).
  const pendingReloadRef = useRef<
    null | { kind: "tables" | "primary"; run: () => void }
  >(null);
  const flushReload = useRef(
    _.debounce(() => {
      const pending = pendingReloadRef.current;
      pendingReloadRef.current = null;
      if (pending) pending.run();
    }, 100)
  );
  // Notidian-oxjk: coalesce the IMPERATIVE saveDB read-back the same way the
  // reactive reindex storm above is coalesced. A burst of saveDB writes (rapid
  // undo/redo, multi-row paste) each optimistically repaints via updateTable
  // immediately, so collapsing the authoritative reloadContext to ONE trailing
  // read-back removes the duplicate O(N) full recomputes that hung the table.
  // Only the read-BACK is deferred (~100ms); saveTable (the write) is awaited
  // inline, so no last-write-wins / stale-snapshot regression. The reload target
  // rides a ref so a context switch can never fire a read for the OLD space.
  const saveDBReloadTargetRef = useRef(spaceInfo);
  saveDBReloadTargetRef.current = spaceInfo;
  const flushSaveDBReload = useRef(
    _.debounce(() => {
      const target = saveDBReloadTargetRef.current;
      if (target)
        props.superstate.reloadContext(target, {
          force: true,
          calculate: true,
        });
    }, 100)
  );
  // Cancel any pending read-back when the context identity (path or schema)
  // changes or the provider unmounts, so a stale closure captured before the
  // switch can never run a read for the OLD context and write it into the NEW
  // provider state — the fresh context reloads via its own dbSchema effect.
  useEffect(
    () => () => {
      flushReload.current.cancel();
      pendingReloadRef.current = null;
      flushSaveDBReload.current.cancel();
      refreshComputedRelations.current.cancel();
    },
    [contextPath, dbSchema?.id]
  );
  useEffect(() => {
    if (!tableData || !dbSchema) return;
    if (crossDatabase) return;
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
        const desired = { ...f, cols: [...(f.cols ?? []), ...freshDiscovered] };
        return props.superstate.spaceManager
          .mutateTable(contextPath, dbSchema.id, { kind: "merge", base: f, desired }, true)
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
    if (crossDatabase) {
      notifyCrossDatabaseReadOnly();
      return;
    }
    if (spaceInfo.readOnly) return;
    updateTable(newTable);
    await props.superstate.spaceManager.mutateTable(
      contextPath,
      newTable.schema.id,
      { kind: "merge", base: tableData, desired: newTable },
      true,
    );
    // Coalesced trailing read-back (Notidian-oxjk) instead of an immediate
    // per-call reloadContext: a burst of saveDB writes collapses to ONE recompute.
    flushSaveDBReload.current();
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

    if (props.superstate.settings?.periodScopedRollups === false)
      return computedData;
    return materializeComputedRelationColumns({
      rows: computedData,
      columns: tableData?.cols ?? [],
      superstate: props.superstate,
      contextPath,
    });
  }, [
    tableData,
    contextTable,
    cols,
    dbSchema,
    pathState,
    contextPath,
    computedRelationEpoch,
    props.superstate.settings?.periodScopedRollups,
  ]);

  useEffect(() => {
    if (tableData) {
      for (const c of contexts) {
        loadContextFields(c);
      }
    }
  }, [tableData]);

  const saveContextDB = async (newTable: SpaceTable, space: string) => {
    if (crossDatabase) return;
    const base = contextTable[space];
    if (!base) return;
    await spaceManager.mutateTable(space, newTable.schema.id, { kind: "merge", base, desired: newTable }, true).then((f) =>
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
          !(projectedPredicate?.colsHidden ?? []).some(
            (c) => c == f.name + f.table
          )
      )
      .sort(
        (a, b) =>
          (projectedPredicate?.colsOrder ?? []).findIndex(
            (x) => x == a.name + a.table
          ) -
          (projectedPredicate?.colsOrder ?? []).findIndex(
            (x) => x == b.name + b.table
          )
      );
  }, [cols, projectedPredicate]);
  // Per-row predicate-filter match (Notidian-5ond.5): the flat path AND the
  // hierarchy-aware scope seam share the EXACT same match. Extracted into the
  // pure, co-located-tested makeRowMatchesFilters helper (Notidian-iguu) so the
  // null-spaceCache crash class (regression for 6ba6f3d / 5ond.5) is locked at
  // the integration seam, including the tags-synthesis shim and the nullish
  // spaceCache?.properties plumbing. Behavior is byte-identical to the prior
  // inlined reduce.
  // ADR-0066 / Notidian-ioxi: fold the render-path declared-view overlay
  // (props.predicateOverlay — a notidian embed `where:` block or a frame node's
  // predicate prop) into the per-row match CONJUNCTIVELY. Rich projected values
  // use projectedPredicate at their read seams, while this filter merge remains
  // the row-visibility seam. Neither route reaches native predicate state or
  // saveSchema (pinned by the overlayFirewall DOM test).
  // Gated by the renderPathViewOverlays kill-switch (default-ON): when off, the
  // base filters pass through byte-for-byte unchanged (legacy).
  const overlayFilters = props.predicateOverlay?.filters;
  const rowMatchesFilters = useMemo(
    () =>
      makeRowMatchesFilters({
        filters: resolveOverlayFilters({
          base: predicate?.filters,
          overlay: overlayFilters,
          enabled: overlayEnabled,
        }),
        cols,
        spaceManager,
        // spaceCache (= spaceState) can be null during load / for some views;
        // null-safe so the call never throws "Cannot read properties of null
        // (reading 'properties')" — pinned by rowMatchesFilters.test.ts.
        properties: spaceCache?.properties,
        enableRecurrenceFilters:
          props.superstate.settings?.recurrenceAwareFilters !== false,
      }),
    [
      predicate?.filters,
      overlayFilters,
      overlayEnabled,
      cols,
      spaceManager,
      spaceCache?.properties,
      props.superstate.settings?.recurrenceAwareFilters,
    ]
  );
  const rowMatchesSearch = useMemo(
    () => (f: DBRow) =>
      searchString?.length > 0
        ? matchAny(searchString).test(
            Object.keys(f)
              .filter((g) => g.charAt(0) != "_")
              .map((g) => f[g])
              .join("|")
          )
        : true,
    [searchString]
  );
  // Search + sort applied to ALL rows, predicate-filter OMITTED — the candidate
  // universe the scope seam closes over. The hierarchy-aware scopes need to see
  // non-matching rows (a parent kept because a child matched), so search runs
  // BEFORE scope but the predicate filter does not.
  const sortedAllData = useMemo(
    () =>
      data.filter(rowMatchesSearch).sort((a, b) => {
        return (projectedPredicate?.sort ?? []).reduce((p, c) => {
          return p == 0
            ? sortReturnForCol(
                cols.find((col) => col.name + col.table == c.field),
                c,
                a,
                b
              )
            : p;
        }, 0);
      }),
    [data, rowMatchesSearch, projectedPredicate?.sort, cols]
  );
  // The flat path's data — byte-identical to before (Array.filter preserves the
  // sorted order): the predicate-passing rows in sort order.
  const filteredSortedData = useMemo(
    () => sortedAllData.filter(rowMatchesFilters),
    [sortedAllData, rowMatchesFilters]
  );

  // Sub-items (Notidian-pv4): the parent-link column the tree follows, if the
  // view configured one and it still exists. Resolved to the live column so the
  // data key (col.name) and link resolver match the relations/rollup runtime.
  const subItemsCol = useMemo(
    // CONSUMPTION GATE (bd Notidian-8k9b): resolve to null off the primary files
    // schema so a stale `subItems.field` persisted by the pre-fix ungated
    // designate path can never render a dead flat tree, an inline
    // "+ New sub-item" affordance, or a delete subtree off-primary — every
    // sub-items consumer derives from this one column, so gating here neutralizes
    // the whole dead surface in one seam (mirrors the syncContextRow
    // materialization gate).
    () => resolveSubItemsCol(predicate?.subItems?.field, cols, dbSchema?.id),
    [predicate?.subItems?.field, cols, dbSchema?.id]
  );

  // The rows fed to the tree, after filter-scope (Notidian-5ond.5). At the
  // default scope this is filteredSortedData verbatim (a NO-OP for existing
  // views); the hierarchy-aware scopes close over sortedAllData (search+sort,
  // predicate-filter not yet applied) so a non-matching parent/child can be
  // pulled in. flattened mode never builds the tree, so scope is inert there.
  const scopedTreeRows = useMemo(() => {
    if (!subItemsCol) return null;
    // Flattened renders flat (no tree), so skip the scope + tree machinery
    // entirely — the flat path uses filteredSortedData (review nit).
    if ((predicate?.subItems?.display ?? "nested") === "flattened") return null;
    const scope = predicate?.subItems?.filterScope ?? "parentsAndSubItems";
    if (scope === "parentsAndSubItems") return filteredSortedData;
    return scopeRowsByFilter({
      rows: sortedAllData,
      matches: rowMatchesFilters,
      parentKey: subItemsCol.name + subItemsCol.table,
      pathKey: PathPropertyName,
      resolveLink: makeRelationLinkResolver(props.superstate),
      scope,
    });
  }, [
    subItemsCol,
    predicate?.subItems?.filterScope,
    predicate?.subItems?.display,
    filteredSortedData,
    sortedAllData,
    rowMatchesFilters,
    props.superstate,
  ]);

  // Full delete-decision tree (Notidian-5ond.8 review). buildRowTree over the
  // COMPLETE eligible row set, INDEPENDENT of display mode, collapse, and
  // predicate.limit — the authoritative answer to "what is beneath this row" for
  // non-destructive parent-delete. Distinct from subItemsFullTree below, which is
  // null in flattened display (rendering skips the tree there); delete-correctness
  // must hold in EVERY display mode (a flattened parent still has descendants whose
  // parent link breaks on delete), so this is built whenever a parent column is
  // configured. Uses filteredSortedData (the pre-limit visible set) when the scope
  // machinery is inert (flattened / default scope), else scopedTreeRows.
  const subItemsDeleteTreeNodes = useMemo(() => {
    if (!subItemsCol) return null;
    const rows = scopedTreeRows ?? filteredSortedData;
    if (!rows) return null;
    return buildRowTree({
      rows,
      parentKey: subItemsCol.name + subItemsCol.table,
      pathKey: PathPropertyName,
      resolveLink: makeRelationLinkResolver(props.superstate),
    });
  }, [subItemsCol, scopedTreeRows, filteredSortedData, props.superstate]);

  // The full depth-first tree (collapse-independent), so collapse-all can target
  // EVERY parent — even ones currently hidden under a collapsed ancestor.
  const subItemsFullTree = useMemo(() => {
    if (!subItemsCol || !scopedTreeRows) return null;
    return buildRowTree({
      rows: scopedTreeRows,
      // Row data keys context-table columns as name+table (primary cols use
      // name, since their table is ""), so the universal accessor is name+table.
      parentKey: subItemsCol.name + subItemsCol.table,
      pathKey: PathPropertyName,
      // Shared relation resolver (e1u): canonicalize a parent [[link]] to the
      // child rows' real paths via the link index, so basename/bare wikilinks match.
      resolveLink: makeRelationLinkResolver(props.superstate),
    });
  }, [subItemsCol, scopedTreeRows, props.superstate]);

  // Depth-first tree nodes with collapsed subtrees hidden. Null when sub-items is
  // off (the table stays a flat list).
  // Sub-item display mode (Notidian-5ond.4): "nested" (default tree),
  // "flattened" (no tree — global sort wins, rendered flat), "parents-only"
  // (roots only, with a descendant count).
  const subItemsDisplay = predicate?.subItems?.display ?? "nested";

  const subItemsNodes = useMemo(() => {
    if (!subItemsFullTree) return null;
    if (subItemsDisplay === "flattened") return null; // flat: use filteredSortedData
    if (subItemsDisplay === "parents-only")
      return subItemsFullTree.filter((n) => n.depth === 0);
    return flattenVisibleTree(
      subItemsFullTree,
      collapsedSubItems,
      PathPropertyName
    );
  }, [subItemsFullTree, collapsedSubItems, subItemsDisplay]);

  // Total descendant count per root (parents-only badge).
  const subItemDescendantCounts = useMemo(() => {
    if (!subItemsFullTree || subItemsDisplay !== "parents-only") return null;
    return rootDescendantCounts(subItemsFullTree, PathPropertyName);
  }, [subItemsFullTree, subItemsDisplay]);

  // Every parent path in the view (for collapse-all). Stable regardless of the
  // current collapse state, so collapse-all is idempotent and complete.
  const allSubItemParentPaths = useMemo(
    () =>
      (subItemsFullTree ?? [])
        .filter((n) => n.hasChildren)
        .map((n) => String(n.row[PathPropertyName] ?? "")),
    [subItemsFullTree]
  );

  // Per-row tree info (depth + hasChildren) keyed by resolved path, for the
  // table's indentation and expand/collapse chevron. Null when sub-items is off.
  const subItemsInfo = useMemo(() => {
    if (!subItemsNodes) return null;
    const info = new Map<
      string,
      {
        depth: number;
        hasChildren: boolean;
        childCount: number;
        surfacedAsRoot: boolean;
        // parents-only (Notidian-5ond.4): total descendants beneath this root.
        descendantCount?: number;
      }
    >();
    for (const node of subItemsNodes) {
      const path = String(node.row[PathPropertyName] ?? "");
      info.set(path, {
        depth: node.depth,
        hasChildren: node.hasChildren,
        childCount: node.childCount,
        surfacedAsRoot: node.surfacedAsRoot,
        descendantCount: subItemDescendantCounts?.get(path),
      });
    }
    return info;
  }, [subItemsNodes, subItemDescendantCounts]);

  // Notion-style "+ New sub-item" insertion points (Notidian-gr8t), computed from
  // the SAME visible nodes that drive subItemsInfo so it is consistent with the
  // rendered tree by construction. Gated: flag ON (default), sub-items active, and
  // NOT read mode (no create affordance in read-only views).
  const subItemAddRows = useMemo(() => {
    if (!subItemsNodes) return null;
    // Only the nested tree renders descendants, so "+ New sub-item" rows (drawn
    // after an expanded parent's children) only make sense there.
    if (subItemsDisplay !== "nested") return null;
    if (readMode || spaceInfo?.readOnly) return null;
    if (props.superstate.settings?.subItemAddRow === false) return null;
    return subItemAddRowsAfter(
      subItemsNodes,
      collapsedSubItems,
      PathPropertyName
    );
  }, [
    subItemsNodes,
    subItemsDisplay,
    collapsedSubItems,
    readMode,
    spaceInfo?.readOnly,
    props.superstate.settings?.subItemAddRow,
  ]);

  const filteredData = useMemo(() => {
    const base = subItemsNodes
      ? subItemsNodes.map((n) => n.row)
      : filteredSortedData;
    // Apply the predicate.limit over the FULLY-assembled set (0/undefined/NaN/
    // negative => show all). Extracted to the pure tableAssembly seam
    // (Notidian-yjg3) so the limit math is locked offline and identical
    // byte-for-byte to the inline `limit > 0 ? base.slice(0, limit) : base` it
    // replaced — this is the contract the 8h9 virtualization flag-gate preserves.
    return applyAssemblyLimit(base, projectedPredicate?.limit);
  }, [subItemsNodes, filteredSortedData, projectedPredicate?.limit]);

  const updateRow = async (row: DBRow, index: number) => {
    if (crossDatabase) {
      notifyCrossDatabaseReadOnly();
      return;
    }
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
    writes: TableCellWrite[],
    options: { allOrNothing?: boolean } = {}
  ): Promise<TableEditTransactionResult> => {
    if (crossDatabase) {
      notifyCrossDatabaseReadOnly();
      return {
        ok: false,
        applied: 0,
        skipped: writes.map((write) => ({
          write,
          reason: "read-only-projection" as const,
        })),
        failed: [] as TableEditTransactionResult["failed"],
      };
    }
    // Serialize per-context value transactions and thread the latest root table
    // into the next, so two concurrent edits sharing one rendered snapshot do not
    // last-write-wins. bd Notidian-lg1.
    return runSerializedContextEdit(
      editSerializerRef.current,
      tableData,
      ({
        tableData: latestTable,
        contextTables: latestContexts,
        onRootTableSaved,
        onContextTableSaved,
        sessionEditedKeys,
      }) =>
        executeTableValueWrites({
          writes,
          tableData: latestTable,
          sessionEditedKeys,
          // Read linked-context source tables from the threaded snapshot, not the
          // render closure, so a chained edit sees the prior edit's saved context
          // fragment (no last-write-wins on Notidian-owned columns). bd
          // Notidian-0jvd.
          contextTable: latestContexts,
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
          saveContextDB: async (nextTable, contextKey) => {
            // Thread the saved context fragment forward so the next chained edit
            // rebuilds from it. bd Notidian-0jvd.
            onContextTableSaved(contextKey, nextTable);
            await saveContextDB(nextTable, contextKey);
          },
          contextKeyForTable: tagSpacePathFromTag,
          allOrNothing: options.allOrNothing,
        }),
      contextTable
    );
  };

  const applyValueEdits = async (
    writes: TableCellWrite[],
    options?: { allOrNothing?: boolean }
  ): Promise<TableEditTransactionResult> => executeValueWrites(writes, options);

  const reloadContextData = async (): Promise<void> => {
    // An explicit authoritative reload supersedes any pending coalesced saveDB
    // read-back (Notidian-oxjk), so we never re-read the same context twice.
    flushSaveDBReload.current.cancel();
    if (crossDatabase) {
      await Promise.all(
        crossDatabaseSources.map((source) =>
          props.superstate.reloadContextByPath?.(source.context, {
            force: true,
            calculate: true,
          })
        )
      );
      if (dbSchema) await retrieveCachedTable(dbSchema);
      return;
    }
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
    if (crossDatabase) {
      props.superstate.ui.notify(
        "Cross-database views are read-only. Rename the file in its source database."
      );
      return null;
    }
    return renamePageTitleForRow({
      row,
      value,
      contextPath,
      superstate: props.superstate,
    });
  };
  const applyTableEdits = async (writes: TablePasteWrite[]) => {
    if (crossDatabase) {
      notifyCrossDatabaseReadOnly();
      return {
        ok: false,
        applied: 0,
        skipped: writes.map((write) => ({
          write,
          reason: "read-only-projection" as const,
        })),
        failed: [] as TableEditTransactionResult["failed"],
      };
    }
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

  const savePredicate = async (
    newPredicate: Partial<Predicate>,
    options?: { optimistic?: boolean }
  ) => {
    const defPredicate = defaultPredicateForSchema(dbSchema);
    const nativePredicate = stripRenderPathProjectionFromSave({
      candidate: newPredicate,
      overlay: props.predicateOverlay,
      enabled: overlayEnabled,
    });
    const pred = {
      ...(predicate ?? defPredicate),
      ...nativePredicate,
    };
    // Pass dbSchema.id so an orphaned off-primary subItems config auto-heals on
    // save (bd Notidian-sas8) — closes the "unclearable off-primary" gap left by
    // the primary-only FilterBar Sub-items menu gate.
    const cleanedPredicate = validatePredicate(pred, defPredicate, dbSchema?.id);

    const optimistic = options?.optimistic !== false;
    if (optimistic) setPredicate(cleanedPredicate);
    if (frameSchema) {
      await saveSchema({
        ...frameSchema,
        predicate: JSON.stringify(cleanedPredicate),
      });
    } else {
      await saveSchema({
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
    if (!optimistic) setPredicate(cleanedPredicate);
  };

  // Sub-items collapse writers (Notidian-5ond.3): persist into
  // predicate.subItems.collapsed via savePredicate so the tree state survives
  // reloads. No-ops when sub-items isn't configured for this view.
  const toggleSubItemCollapse = (path: string) => {
    if (!predicate?.subItems?.field) return;
    savePredicate({
      subItems: {
        ...predicate.subItems,
        collapsed: nextCollapsedPaths(predicate.subItems.collapsed, path),
      },
    });
  };
  const setSubItemsCollapsedAll = (collapsed: boolean) => {
    if (!predicate?.subItems?.field) return;
    savePredicate({
      subItems: {
        ...predicate.subItems,
        collapsed: collapsed ? allSubItemParentPaths : [],
      },
    });
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
    // Auto-heal an orphaned off-primary subItems config on load (bd
    // Notidian-sas8): a non-primary schema id drops the stale field that the
    // consumption gate keeps inert but the menu can no longer clear.
    const newPredicate = validatePredicate(
      safelyParseJSON(predicateStr),
      defPredicate,
      dbSchema?.id
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
    if (crossDatabase) {
      notifyCrossDatabaseReadOnly();
      return false;
    }
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
      const caseVariants = plan.issues.filter(
        (issue) => issue.reason == "case-variant-frontmatter-key"
      );
      const issue = plan.issues[0];
      if (issue) {
        props.superstate.ui.notify(
          frontmatterRenameIssueMessage({
            issue,
            oldKey: column.name,
            newKey: normalizedNewKey,
            conflictCount: conflicts.length,
            caseVariantCount: caseVariants.length,
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
        // Reachable only in type shape, not at runtime: a "case-variant"
        // fileState always accompanies a "case-variant-frontmatter-key"
        // issue, which makes plan.canApplyAutomatically false and returns
        // above before this reduce ever runs.
        "case-variant": 0,
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

    await savePredicate({
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
      colsHeaderDisplay: {
        ...(predicate?.colsHeaderDisplay ?? {}),
        [normalizedNewKey + column.table]:
          predicate?.colsHeaderDisplay?.[column.name + column.table],
        [column.name + column.table]: undefined,
      },
      colsDataAnchor: {
        ...(predicate?.colsDataAnchor ?? {}),
        [normalizedNewKey + column.table]:
          predicate?.colsDataAnchor?.[column.name + column.table],
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
    }, { optimistic: false });

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

  const deleteFrontmatterPropertyKey = async (
    column: SpaceTableColumn,
    confirmDelete?: (message: string) => boolean
  ): Promise<boolean> => {
    if (crossDatabase) {
      notifyCrossDatabaseReadOnly();
      return false;
    }
    if (!isFrontmatterBackedProperty(column) || column.table != "") {
      props.superstate.ui.notify(
        "Only root frontmatter-backed columns can delete YAML keys."
      );
      return false;
    }

    const paths = uniq(
      tableData.rows
        .map((row) => row[PathPropertyName])
        .filter((path): path is string => typeof path == "string")
        .map(
          (path) =>
            props.superstate.spaceManager.resolvePath(path, pathState?.path) ??
            path
        )
    );
    const buildDeletePlan = () =>
      planDeleteFrontmatterProperty({
        table: tableData,
        key: column.name,
        mode: "delete-frontmatter",
        paths,
        frontmatterByPath: new Map(
          paths.map((path) => [
            path,
            props.superstate.pathsIndex.get(path)?.metadata?.property ?? {},
          ])
        ),
      });
    let plan = buildDeletePlan();

    if (plan.issues.length > 0) {
      const issue = plan.issues[0];
      props.superstate.ui.notify(
        frontmatterDeleteIssueMessage({
          issue,
          key: column.name,
        })
      );
      return false;
    }

    if (plan.requiresConfirmation) {
      if (!confirmDelete) {
        props.superstate.ui.notify(
          "Deleting a frontmatter key requires confirmation."
        );
        return false;
      }

      const confirmed = confirmDelete(
        frontmatterDeleteConfirmationMessage({
          key: column.name,
          totalFiles: paths.length,
          affectedFiles: plan.affectedFiles.length,
          untouchedFiles: paths.length - plan.affectedFiles.length,
          caseVariantFiles: plan.caseVariantFiles.length,
          caseVariantExample: plan.caseVariantFiles[0]?.foundKeys[0],
        })
      );
      if (!confirmed) return false;
    }

    const latestPlan = buildDeletePlan();
    if (
      latestPlan.issues.length > 0 ||
      !isEqual(latestPlan.affectedFiles, plan.affectedFiles) ||
      !isEqual(latestPlan.frontmatterWrites, plan.frontmatterWrites)
    ) {
      props.superstate.ui.notify(
        "Frontmatter changed while preparing the delete. Review and run the delete again."
      );
      await reloadContextData();
      return false;
    }
    plan = latestPlan;

    const applyResult = await applyFrontmatterSchemaWritePlans({
      writes: plan.frontmatterWrites,
      saveProperties: (path, properties) =>
        saveFrontmatterProperties({
          superstate: props.superstate,
          path,
          properties,
          failureMessage: "Could not delete frontmatter property.",
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
        `Could not delete frontmatter property at ${failed.path}.`
      );
      await reloadContextData();
      return false;
    }

    const tablePreview = {
      ...plan.tablePreview,
      rows: plan.tablePreview.rows.map((row) => {
        const { [column.name]: _value, ...rest } = row;
        return rest;
      }),
    };

    savePredicate(
      predicateColumnReferenceDeleteForColumn({
        predicate,
        column,
      })
    );
    await saveDB(tablePreview);
    await reloadContextData();
    props.superstate.ui.notify(
      `Deleted "${column.name}" from ${applyResult.applied} file${
        applyResult.applied == 1 ? "" : "s"
      } and hid the column.`
    );
    return true;
  };

  const delColumn = (column: SpaceTableColumn) => {
    if (crossDatabase) {
      notifyCrossDatabaseReadOnly();
      return;
    }
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
    if (crossDatabase) {
      notifyCrossDatabaseReadOnly();
      return false;
    }
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
        colsHeaderDisplay: {
          ...(predicate?.colsHeaderDisplay ?? {}),
          [column.name + column.table]:
            predicate?.colsHeaderDisplay?.[oldColumn.name + oldColumn.table],
          [oldColumn.name + oldColumn.table]: undefined,
        },
        colsDataAnchor: {
          ...(predicate?.colsDataAnchor ?? {}),
          [column.name + column.table]:
            predicate?.colsDataAnchor?.[oldColumn.name + oldColumn.table],
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
        crossDatabase,
        crossDatabaseSources,
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
        predicate: projectedPredicate,
        savePredicate,
        saveColumn,
        renameFrontmatterPropertyKey,
        hideColumn,
        sortColumn,
        delColumn,
        newColumn,
        searchString,
        setSearchString,
        searchActive,
        setSearchActive,
        openViewSearch,
        updateValue,
        applyTableEdits,
        applyValueEdits,
        reloadContextData,
        renameRowTitle,
        deleteFrontmatterPropertyKey,
        updateFieldValue,
        editMode,
        setEditMode,
        data,
        updateRow,
        subItemsInfo,
        subItemsDisplay,
        subItemsField: subItemsCol?.name ?? null,
        subItemsParentKey: subItemsCol
          ? subItemsCol.name + subItemsCol.table
          : null,
        collapsedSubItems,
        toggleSubItemCollapse,
        setSubItemsCollapsedAll,
        subItemAddRows,
        subItemsTreeNodes: subItemsDeleteTreeNodes,
      }}
    >
      {props.children}
    </ContextEditorContext.Provider>
  );
};
