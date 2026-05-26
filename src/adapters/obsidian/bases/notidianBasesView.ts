import * as ObsidianApi from "obsidian";
import {
  buildPageTitleRename,
  validatePageTitle,
} from "core/utils/contexts/pageTitle";
import { serializeTableClipboardGrid } from "core/utils/contexts/tableClipboard";

export const NOTIDIAN_BASES_VIEW_TYPE = "notidian-table";
const NOTIDIAN_BASES_BASE_VALUE_ATTR = "data-notidian-bases-base-value";
const NOTIDIAN_BASES_CONFLICT_ACTION = "frontmatter-conflict";

type BasesQueryControllerLike = Record<string, unknown>;

type BasesValueLike = {
  isEmpty?: () => boolean;
  toString?: () => string;
};

type BasesEntryLike = {
  file?: {
    name?: string;
    path?: string;
  };
  getValue?: (propertyId: string) => BasesValueLike | unknown;
};

type BasesEntryGroupLike = {
  key?: unknown;
  entries?: BasesEntryLike[];
};

type BasesQueryResultLike = {
  data?: BasesEntryLike[];
  groupedData?: BasesEntryGroupLike[];
  properties?: string[];
};

type BasesViewConfigLike = {
  get?: (key: string) => unknown;
  getAsPropertyId?: (key: string) => unknown;
  getDisplayName?: (propertyId: string) => string;
  getEvaluatedFormula?: (view: unknown, key: string) => unknown;
  getOrder?: () => string[];
  getSort?: () => unknown[];
  set?: (key: string, value: unknown) => unknown;
};

type BasesViewSnapshotSource = {
  config?: BasesViewConfigLike;
  data?: BasesQueryResultLike;
};

type RuntimeBasesView = BasesViewSnapshotSource & {
  app?: unknown;
};

type RuntimeBasesViewConstructor = new (
  controller: BasesQueryControllerLike
) => RuntimeBasesView;

type BasesViewRegistration = {
  name: string;
  icon: string;
  factory: (
    controller: BasesQueryControllerLike,
    containerEl: HTMLElement
  ) => unknown;
};

type BasesViewPlugin = {
  registerBasesView?: (
    viewType: string,
    registration: BasesViewRegistration
  ) => boolean | void;
};

export type NotidianBasesCellEditRequest = {
  path?: string;
  propertyId?: string;
  value: string;
  baseValue?: string;
  forceFrontmatterWrite?: boolean;
};

export type NotidianBasesCellEditPlan =
  | {
      ok: true;
      authority: "frontmatter";
      path: string;
      propertyId: string;
      propertyKey: string;
      value: string;
      baseValue?: string;
      forceFrontmatterWrite?: boolean;
    }
  | {
      ok: true;
      authority: "file-name";
      path: string;
      propertyId: string;
      title: string;
      newPath: string;
      value: string;
      changed: boolean;
    }
  | {
      ok: false;
      reason:
        | "missing-path"
        | "missing-property"
        | "read-only-property"
        | "empty"
        | "slash";
      path?: string;
      propertyId?: string;
    };

export type NotidianBasesStructuredPasteWrite = {
  rowIndex: number;
  columnIndex: number;
  request: NotidianBasesCellEditRequest;
};

export type NotidianBasesStructuredPasteSkippedReason =
  | "file-name-paste-unsupported"
  | "file-name-preflight-failed"
  | "missing-path"
  | "out-of-bounds"
  | "read-only-property"
  | NotidianBasesFileNamePreflightIssueReason;

export type NotidianBasesStructuredPasteSkipped = {
  rowIndex: number;
  columnIndex: number;
  reason: NotidianBasesStructuredPasteSkippedReason;
  value: string;
};

export type NotidianBasesStructuredPastePlan = {
  writes: NotidianBasesStructuredPasteWrite[];
  skipped: NotidianBasesStructuredPasteSkipped[];
};

export type NotidianBasesStructuredPastePlanParams = {
  properties: string[];
  rows: { path?: string; values?: string[] }[];
  startRowIndex: number;
  startColumnIndex: number;
  text: string;
};

export type NotidianBasesCellCoord = {
  rowIndex: number;
  columnIndex: number;
};

export type NotidianBasesCellSelection = {
  anchor: NotidianBasesCellCoord;
  focus: NotidianBasesCellCoord;
  active: NotidianBasesCellCoord;
};

export type NotidianBasesCellSelectionBounds = {
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
};

export type NotidianBasesSelectionPlanParams = {
  properties: string[];
  rows: { path?: string; values?: string[] }[];
  selection: NotidianBasesCellSelection;
};

export type NotidianBasesRowsWithVisibleBaseValuesParams = {
  properties: string[];
  rows: { path?: string; values?: string[] }[];
  baseValueForCell: (
    rowIndex: number,
    columnIndex: number
  ) => string | undefined;
};

export type NotidianBasesUndoEntry = {
  label: string;
  writes: NotidianBasesCellEditRequest[];
};

export type NotidianBasesFileNamePreflightIssueReason =
  | "duplicate-target"
  | "empty"
  | "missing-path"
  | "missing-property"
  | "read-only-property"
  | "slash"
  | "target-exists"
  | "target-source-conflict";

export type NotidianBasesFileNamePreflightIssue = {
  request: NotidianBasesCellEditRequest;
  reason: NotidianBasesFileNamePreflightIssueReason;
  newPath?: string;
};

export type NotidianBasesFileNamePreflightPlan = {
  path: string;
  newPath: string;
  value: string;
};

export type NotidianBasesFileNamePreflightResult = {
  ok: boolean;
  plans: NotidianBasesFileNamePreflightPlan[];
  issues: NotidianBasesFileNamePreflightIssue[];
};

type NotidianBasesStructuredPasteRequest = {
  startRowIndex: number;
  startColumnIndex: number;
  text: string;
};

type NotidianBasesStructuredPasteResult = {
  applied: number;
  failed: number;
  skipped: number;
  appliedWrites: NotidianBasesCellEditRequest[];
  failedWrites: {
    request: NotidianBasesCellEditRequest;
    error: unknown;
  }[];
};

type NotidianBasesViewAppLike = {
  vault?: {
    getAbstractFileByPath?: (path: string) => unknown;
  };
  metadataCache?: {
    getFileCache?: (
      file: unknown
    ) => { frontmatter?: Record<string, unknown> } | null | undefined;
  };
  fileManager?: {
    processFrontMatter?: (
      file: unknown,
      update: (frontmatter: Record<string, unknown>) => void
    ) => Promise<void> | void;
    renameFile?: (file: unknown, newPath: string) => Promise<void> | void;
  };
};

export class NotidianBasesFrontmatterConflictError extends Error {
  readonly reason = "frontmatter-conflict";
  readonly currentValue: string;
  readonly baseValue: string;
  readonly attemptedValue: string;

  constructor({
    currentValue,
    baseValue,
    attemptedValue,
  }: {
    currentValue: string;
    baseValue: string;
    attemptedValue: string;
  }) {
    super("Frontmatter changed outside Notidian. Reload before editing.");
    this.name = "NotidianBasesFrontmatterConflictError";
    this.currentValue = currentValue;
    this.baseValue = baseValue;
    this.attemptedValue = attemptedValue;
  }
}

type NotidianBasesRenderOptions = {
  writeCell?: (request: NotidianBasesCellEditRequest) => Promise<void>;
  pushUndoEntry?: (entry: NotidianBasesUndoEntry) => void;
  undoLast?: () => Promise<NotidianBasesStructuredPasteResult>;
  pathExists?: (path: string) => boolean;
};

export type NotidianBasesViewSnapshot = {
  properties: string[];
  groups: {
    key: string;
    rows: {
      path?: string;
      values: string[];
    }[];
  }[];
  rowCount: number;
  diagnostics: string[];
};

export type NotidianBasesRuntimeCapabilities = {
  controllerKeys: string[];
  viewKeys: string[];
  configMethods: string[];
  dataShape: {
    hasData: boolean;
    hasGroupedData: boolean;
    properties: string[];
    ungroupedCount: number;
    groupCount: number;
    groupedRowCount: number;
  };
  firstEntry: {
    keys: string[];
    fileKeys: string[];
    filePath?: string;
    getValueType: string;
    valueMethods: string[];
  } | null;
  writeSurface: {
    entryHasSetValue: boolean;
    configHasSet: boolean;
    notes: string;
  };
};

type RuntimeCapabilitySource = {
  controller?: unknown;
  view: BasesViewSnapshotSource;
};

const FallbackBasesView = class implements RuntimeBasesView {
  data?: BasesQueryResultLike;
  config?: BasesViewConfigLike;

  constructor(_controller: BasesQueryControllerLike) {}
};

const RuntimeBasesViewBase = (
  (ObsidianApi as unknown as { BasesView?: RuntimeBasesViewConstructor }).BasesView ??
  FallbackBasesView
) as RuntimeBasesViewConstructor;

const sortedOwnKeys = (value: unknown): string[] =>
  value && typeof value === "object" ? Object.keys(value).sort() : [];

const methodNames = (value: unknown): string[] => {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return [];
  }

  const names = new Set<string>();
  let current: unknown = value;
  let depth = 0;
  while (
    current &&
    current !== Object.prototype &&
    depth < 4
  ) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      const member =
        descriptor && "value" in descriptor
          ? descriptor.value
          : (value as Record<string, unknown>)[name];
      if (typeof member === "function") names.add(name);
    }
    current = Object.getPrototypeOf(current);
    depth += 1;
  }

  return [...names].sort();
};

const valueToText = (value: unknown): string => {
  if (value == null) return "";

  const basesValue = value as BasesValueLike;
  if (typeof basesValue.isEmpty === "function" && basesValue.isEmpty()) {
    return "";
  }
  if (typeof basesValue.toString === "function") {
    return basesValue.toString();
  }
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);

  return String(value);
};

const fileNameWithoutMarkdownExtension = (fileName: string): string =>
  fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;

export const notidianBasesNotePropertyKey = (
  propertyId: string
): string | null => {
  const normalized = String(propertyId ?? "").trim();
  if (!normalized) return null;
  if (normalized.startsWith("file.") || normalized.startsWith("formula.")) {
    return null;
  }

  const propertyKey = normalized.startsWith("note.")
    ? normalized.slice("note.".length)
    : normalized;

  return propertyKey.trim().length > 0 ? propertyKey : null;
};

const notidianBasesIsFileNameProperty = (propertyId: string): boolean =>
  propertyId === "file.name";

export const notidianBasesParseTsv = (text: string): string[][] => {
  const normalized = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n$/, "");
  return normalized.split("\n").map((row) => row.split("\t"));
};

const notidianBasesIsStructuredPasteText = (text: string): boolean => {
  const matrix = notidianBasesParseTsv(text);
  return matrix.length > 1 || matrix.some((row) => row.length > 1);
};

const clampIndex = (value: number, max: number): number =>
  Math.max(0, Math.min(Number.isFinite(value) ? value : 0, Math.max(0, max)));

export const notidianBasesSelectionBounds = (
  selection: NotidianBasesCellSelection,
  rowCount: number,
  columnCount: number
): NotidianBasesCellSelectionBounds => {
  const anchorRow = clampIndex(selection.anchor.rowIndex, rowCount - 1);
  const focusRow = clampIndex(selection.focus.rowIndex, rowCount - 1);
  const anchorColumn = clampIndex(selection.anchor.columnIndex, columnCount - 1);
  const focusColumn = clampIndex(selection.focus.columnIndex, columnCount - 1);

  return {
    minRow: Math.min(anchorRow, focusRow),
    maxRow: Math.max(anchorRow, focusRow),
    minColumn: Math.min(anchorColumn, focusColumn),
    maxColumn: Math.max(anchorColumn, focusColumn),
  };
};

export const notidianBasesRowsWithVisibleBaseValues = ({
  properties,
  rows,
  baseValueForCell,
}: NotidianBasesRowsWithVisibleBaseValuesParams): {
  path?: string;
  values: string[];
}[] =>
  rows.map((row, rowIndex) => ({
    ...row,
    values: properties.map(
      (_property, columnIndex) =>
        baseValueForCell(rowIndex, columnIndex) ??
        row.values?.[columnIndex] ??
        ""
    ),
  }));

export const notidianBasesClipboardTextForSelection = ({
  rows,
  selection,
}: Omit<NotidianBasesSelectionPlanParams, "properties">): string => {
  const columnCount = rows.reduce(
    (count, row) => Math.max(count, row.values?.length ?? 0),
    0
  );
  const bounds = notidianBasesSelectionBounds(
    selection,
    rows.length,
    columnCount
  );
  const grid: string[][] = [];

  for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
    const values: string[] = [];
    for (let column = bounds.minColumn; column <= bounds.maxColumn; column++) {
      values.push(rows[row]?.values?.[column] ?? "");
    }
    grid.push(values);
  }

  return serializeTableClipboardGrid(grid);
};

export const notidianBasesStructuredCutPlan = ({
  properties,
  rows,
  selection,
}: NotidianBasesSelectionPlanParams): NotidianBasesStructuredPastePlan => {
  const writes: NotidianBasesStructuredPasteWrite[] = [];
  const skipped: NotidianBasesStructuredPasteSkipped[] = [];
  const bounds = notidianBasesSelectionBounds(
    selection,
    rows.length,
    properties.length
  );

  for (let rowIndex = bounds.minRow; rowIndex <= bounds.maxRow; rowIndex++) {
    for (
      let columnIndex = bounds.minColumn;
      columnIndex <= bounds.maxColumn;
      columnIndex++
    ) {
      const row = rows[rowIndex];
      const propertyId = properties[columnIndex];
      const value = row?.values?.[columnIndex] ?? "";

      if (!row || !propertyId) {
        skipped.push({
          rowIndex,
          columnIndex,
          reason: "out-of-bounds",
          value,
        });
        continue;
      }

      if (!notidianBasesNotePropertyKey(propertyId)) {
        skipped.push({
          rowIndex,
          columnIndex,
          reason: "read-only-property",
          value,
        });
        continue;
      }

      if (!row.path) {
        skipped.push({
          rowIndex,
          columnIndex,
          reason: "missing-path",
          value,
        });
        continue;
      }

      writes.push({
        rowIndex,
        columnIndex,
        request: {
          path: row.path,
          propertyId,
          baseValue: value,
          value: "",
        },
      });
    }
  }

  return { writes, skipped };
};

export const notidianBasesStructuredPastePlan = ({
  properties,
  rows,
  startRowIndex,
  startColumnIndex,
  text,
}: NotidianBasesStructuredPastePlanParams): NotidianBasesStructuredPastePlan => {
  const writes: NotidianBasesStructuredPasteWrite[] = [];
  const skipped: NotidianBasesStructuredPasteSkipped[] = [];
  const matrix = notidianBasesParseTsv(text);

  matrix.forEach((pasteRow, pasteRowIndex) => {
    pasteRow.forEach((value, pasteColumnIndex) => {
      const rowIndex = startRowIndex + pasteRowIndex;
      const columnIndex = startColumnIndex + pasteColumnIndex;
      const row = rows[rowIndex];
      const propertyId = properties[columnIndex];

      if (!row || !propertyId) {
        skipped.push({
          rowIndex,
          columnIndex,
          reason: "out-of-bounds",
          value,
        });
        return;
      }

      if (notidianBasesIsFileNameProperty(propertyId)) {
        writes.push({
          rowIndex,
          columnIndex,
          request: {
            path: row.path,
            propertyId,
            baseValue: row.values?.[columnIndex],
            value,
          },
        });
        return;
      }

      if (!notidianBasesNotePropertyKey(propertyId)) {
        skipped.push({
          rowIndex,
          columnIndex,
          reason: "read-only-property",
          value,
        });
        return;
      }

      if (!row.path) {
        skipped.push({
          rowIndex,
          columnIndex,
          reason: "missing-path",
          value,
        });
        return;
      }

      writes.push({
        rowIndex,
        columnIndex,
        request: {
          path: row.path,
          propertyId,
          baseValue: row.values?.[columnIndex],
          value,
        },
      });
    });
  });

  return { writes, skipped };
};

export const notidianBasesPreflightFileNameWrites = ({
  writes,
  pathExists = () => false,
}: {
  writes: NotidianBasesCellEditRequest[];
  pathExists?: (path: string) => boolean;
}): NotidianBasesFileNamePreflightResult => {
  const fileNameWrites = writes.filter((write) =>
    notidianBasesIsFileNameProperty(String(write.propertyId ?? ""))
  );
  const sourcePaths = new Set(
    fileNameWrites
      .map((write) => String(write.path ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
  const seenTargets = new Set<string>();
  const plans: NotidianBasesFileNamePreflightPlan[] = [];
  const issues: NotidianBasesFileNamePreflightIssue[] = [];

  for (const request of fileNameWrites) {
    const plan = notidianBasesCellEditPlan(request);
    if (plan.ok !== true) {
      issues.push({
        request,
        reason: plan.reason,
      });
      continue;
    }
    if (plan.authority !== "file-name" || !plan.changed) continue;

    const targetKey = plan.newPath.toLowerCase();
    const sourceKey = plan.path.toLowerCase();
    if (seenTargets.has(targetKey)) {
      issues.push({
        request,
        reason: "duplicate-target",
        newPath: plan.newPath,
      });
      continue;
    }
    seenTargets.add(targetKey);

    if (sourcePaths.has(targetKey) && targetKey !== sourceKey) {
      issues.push({
        request,
        reason: "target-source-conflict",
        newPath: plan.newPath,
      });
      continue;
    }

    if (pathExists(plan.newPath) && targetKey !== sourceKey) {
      issues.push({
        request,
        reason: "target-exists",
        newPath: plan.newPath,
      });
      continue;
    }

    plans.push({
      path: plan.path,
      newPath: plan.newPath,
      value: plan.value,
    });
  }

  return {
    ok: issues.length === 0,
    plans,
    issues,
  };
};

export const notidianBasesCreateUndoEntry = ({
  label,
  writes,
}: NotidianBasesUndoEntry): NotidianBasesUndoEntry => {
  const inverseWrites = writes.flatMap((write) => {
    const propertyId = String(write.propertyId ?? "").trim();
    if (write.baseValue === undefined || write.baseValue === write.value) {
      return [];
    }

    if (notidianBasesIsFileNameProperty(propertyId)) {
      try {
        const renamedPath = write.path
          ? buildPageTitleRename(write.path, write.value).newPath
          : undefined;
        if (!renamedPath) return [];
        return [
          {
            path: renamedPath,
            propertyId,
            baseValue: write.value,
            value: write.baseValue,
          },
        ];
      } catch (_error) {
        return [];
      }
    }

    if (!notidianBasesNotePropertyKey(propertyId)) return [];

    return [
      {
        path: write.path,
        propertyId,
        baseValue: write.value,
        value: write.baseValue,
      },
    ];
  });

  return {
    label,
    writes: inverseWrites.reverse(),
  };
};

export const notidianBasesCellEditPlan = ({
  path,
  propertyId,
  value,
  baseValue,
  forceFrontmatterWrite,
}: NotidianBasesCellEditRequest): NotidianBasesCellEditPlan => {
  const normalizedPropertyId = String(propertyId ?? "").trim();
  if (!normalizedPropertyId) {
    return {
      ok: false,
      reason: "missing-property",
    };
  }

  const normalizedPath = String(path ?? "").trim();
  if (!normalizedPath) {
    return {
      ok: false,
      reason: "missing-path",
      propertyId: normalizedPropertyId,
    };
  }

  if (notidianBasesIsFileNameProperty(normalizedPropertyId)) {
    const validation = validatePageTitle(value);
    if (validation.ok === false) {
      return {
        ok: false,
        reason: validation.reason,
        path: normalizedPath,
        propertyId: normalizedPropertyId,
      };
    }

    const rename = buildPageTitleRename(normalizedPath, validation.title);
    return {
      ok: true,
      authority: "file-name",
      path: normalizedPath,
      propertyId: normalizedPropertyId,
      title: rename.title,
      newPath: rename.newPath,
      value: validation.title,
      changed: rename.oldPath !== rename.newPath,
    };
  }

  const propertyKey = notidianBasesNotePropertyKey(normalizedPropertyId);
  if (!propertyKey) {
    return {
      ok: false,
      reason: "read-only-property",
      path: normalizedPath,
      propertyId: normalizedPropertyId,
    };
  }

  return {
    ok: true,
    authority: "frontmatter",
    path: normalizedPath,
    propertyId: normalizedPropertyId,
    propertyKey,
    value: String(value ?? ""),
    baseValue: baseValue === undefined ? undefined : String(baseValue ?? ""),
    forceFrontmatterWrite,
  };
};

const notidianBasesCurrentFrontmatterValue = (
  app: NotidianBasesViewAppLike | undefined,
  file: unknown,
  propertyKey: string
): string | undefined => {
  const frontmatter = app?.metadataCache?.getFileCache?.(file)?.frontmatter;
  if (!frontmatter || !(propertyKey in frontmatter)) return undefined;
  return valueToText(frontmatter[propertyKey]);
};

const notidianBasesConflictFromError = (
  error: unknown
): NotidianBasesFrontmatterConflictError | null => {
  if (error instanceof NotidianBasesFrontmatterConflictError) return error;
  const conflict = error as
    | {
        reason?: unknown;
        currentValue?: unknown;
        baseValue?: unknown;
        attemptedValue?: unknown;
      }
    | undefined;
  if (conflict?.reason !== "frontmatter-conflict") return null;
  return new NotidianBasesFrontmatterConflictError({
    currentValue: String(conflict.currentValue ?? ""),
    baseValue: String(conflict.baseValue ?? ""),
    attemptedValue: String(conflict.attemptedValue ?? ""),
  });
};

const notidianBasesConflictTitle = (
  conflict: NotidianBasesFrontmatterConflictError
): string =>
  [
    conflict.message,
    `Current: ${conflict.currentValue}`,
    `Table had: ${conflict.baseValue}`,
    `Attempted: ${conflict.attemptedValue}`,
  ].join("\n");

export const writeNotidianBasesCellEdit = async (
  app: NotidianBasesViewAppLike | undefined,
  edit: NotidianBasesCellEditPlan
): Promise<void> => {
  if (edit.ok !== true) {
    throw new Error(`Cannot write skipped Bases cell edit: ${edit.reason}`);
  }

  const file = app?.vault?.getAbstractFileByPath?.(edit.path);
  if (!file) {
    throw new Error(
      `Cannot write Bases cell edit; file not found: ${edit.path}`
    );
  }

  const fileRecord = file as { extension?: unknown; path?: unknown };
  const extension = String(fileRecord.extension ?? "").toLowerCase();
  const filePath = String(fileRecord.path ?? edit.path).toLowerCase();
  if (extension && extension !== "md") {
    throw new Error(
      `Cannot write Bases cell edit to non-Markdown file: ${edit.path}`
    );
  }
  if (!extension && !filePath.endsWith(".md")) {
    throw new Error(
      `Cannot write Bases cell edit to non-Markdown file: ${edit.path}`
    );
  }

  if (edit.authority === "file-name") {
    if (!edit.changed) return;

    const existingTarget = app?.vault?.getAbstractFileByPath?.(edit.newPath);
    const isCaseOnlyRename = edit.newPath.toLowerCase() === edit.path.toLowerCase();
    if (existingTarget && !isCaseOnlyRename) {
      throw new Error(
        `Cannot rename Bases file cell; target already exists: ${edit.newPath}`
      );
    }

    const renameFile = app?.fileManager?.renameFile;
    if (typeof renameFile !== "function") {
      throw new Error(
        "Obsidian fileManager.renameFile is required for Bases file-name edits."
      );
    }

    await renameFile.call(app?.fileManager, file, edit.newPath);
    return;
  }

  const currentValue = notidianBasesCurrentFrontmatterValue(
    app,
    file,
    edit.propertyKey
  );
  if (
    !edit.forceFrontmatterWrite &&
    edit.baseValue !== undefined &&
    currentValue !== undefined &&
    currentValue !== edit.baseValue
  ) {
    throw new NotidianBasesFrontmatterConflictError({
      currentValue,
      baseValue: edit.baseValue,
      attemptedValue: edit.value,
    });
  }

  const processFrontMatter = app?.fileManager?.processFrontMatter;
  if (typeof processFrontMatter !== "function") {
    throw new Error(
      "Obsidian fileManager.processFrontMatter is required for Bases cell edits."
    );
  }

  await processFrontMatter.call(
    app?.fileManager,
    file,
    (frontmatter: Record<string, unknown>) => {
      frontmatter[edit.propertyKey] = edit.value;
    }
  );
};

const entryValueText = (
  entry: BasesEntryLike,
  propertyId: string
): string => {
  const value =
    typeof entry.getValue === "function" ? entry.getValue(propertyId) : undefined;
  const text = valueToText(value);
  if (text.length > 0) return text;

  if (propertyId === "file.name" && entry.file?.name) {
    return fileNameWithoutMarkdownExtension(entry.file.name);
  }
  if (propertyId === "file.path" && entry.file?.path) {
    return entry.file.path;
  }

  return text;
};

const propertiesFromView = (
  view: BasesViewSnapshotSource,
  diagnostics: string[]
): string[] => {
  const order = view.config?.getOrder?.();
  if (Array.isArray(order) && order.length > 0) return order;

  const properties = view.data?.properties;
  if (Array.isArray(properties) && properties.length > 0) return properties;

  diagnostics.push(
    "No visible Bases properties were available; rendering file names only."
  );
  return ["file.name"];
};

const groupsFromData = (
  data: BasesQueryResultLike | undefined
): BasesEntryGroupLike[] => {
  if (Array.isArray(data?.groupedData)) return data.groupedData;
  if (Array.isArray(data?.data)) {
    return [
      {
        key: "",
        entries: data.data,
      },
    ];
  }
  return [];
};

const firstEntryFromData = (
  data: BasesQueryResultLike | undefined
): BasesEntryLike | undefined => {
  if (Array.isArray(data?.data) && data.data.length > 0) return data.data[0];
  if (Array.isArray(data?.groupedData)) {
    for (const group of data.groupedData) {
      if (Array.isArray(group.entries) && group.entries.length > 0) {
        return group.entries[0];
      }
    }
  }
  return undefined;
};

export const notidianBasesRuntimeCapabilities = ({
  controller,
  view,
}: RuntimeCapabilitySource): NotidianBasesRuntimeCapabilities => {
  const data = view.data;
  const properties = Array.isArray(data?.properties) ? data.properties : [];
  const groupedData = Array.isArray(data?.groupedData) ? data.groupedData : [];
  const firstEntry = firstEntryFromData(data);
  const firstProperty = properties[0] ?? "file.name";
  const firstValue =
    firstEntry && typeof firstEntry.getValue === "function"
      ? firstEntry.getValue(firstProperty)
      : undefined;
  const entryMethods = methodNames(firstEntry);
  const configMethods = methodNames(view.config);

  return {
    controllerKeys: sortedOwnKeys(controller),
    viewKeys: sortedOwnKeys(view),
    configMethods,
    dataShape: {
      hasData: Array.isArray(data?.data),
      hasGroupedData: Array.isArray(data?.groupedData),
      properties,
      ungroupedCount: Array.isArray(data?.data) ? data.data.length : 0,
      groupCount: groupedData.length,
      groupedRowCount: groupedData.reduce(
        (count, group) =>
          count + (Array.isArray(group.entries) ? group.entries.length : 0),
        0
      ),
    },
    firstEntry: firstEntry
      ? {
          keys: sortedOwnKeys(firstEntry),
          fileKeys: sortedOwnKeys(firstEntry.file),
          filePath: firstEntry.file?.path,
          getValueType: typeof firstEntry.getValue,
          valueMethods: methodNames(firstValue),
        }
      : null,
    writeSurface: {
      entryHasSetValue: entryMethods.includes("setValue"),
      configHasSet: configMethods.includes("set"),
      notes:
        "No documented Bases cell-write API is assumed. Notidian writes must route through file/frontmatter authorities until a runtime write surface is proven.",
    },
  };
};

export const notidianBasesViewSnapshot = (
  view: BasesViewSnapshotSource
): NotidianBasesViewSnapshot => {
  const diagnostics: string[] = [];
  const properties = propertiesFromView(view, diagnostics);
  const groups = groupsFromData(view.data).map((group) => {
    const entries = Array.isArray(group.entries) ? group.entries : [];
    return {
      key: group.key == null ? "" : String(group.key),
      rows: entries.map((entry) => ({
        path: entry.file?.path,
        values: properties.map((propertyId) =>
          entryValueText(entry, propertyId)
        ),
      })),
    };
  });

  return {
    properties,
    groups,
    rowCount: groups.reduce((count, group) => count + group.rows.length, 0),
    diagnostics,
  };
};

const renderHeaderCell = (rowEl: HTMLElement, text: string): void => {
  rowEl.createEl("th", { text });
};

const renderReadOnlyCell = (
  rowEl: HTMLElement,
  propertyId: string,
  text: string,
  rowIndex: number,
  columnIndex: number
): HTMLElement => {
  return rowEl.createEl("td", {
    attr: {
      "data-property-id": propertyId,
      "data-editable": "false",
      "data-row-index": String(rowIndex),
      "data-column-index": String(columnIndex),
      [NOTIDIAN_BASES_BASE_VALUE_ATTR]: text,
    },
    text,
  });
};

const renderEditableCell = (
  rowEl: HTMLElement,
  path: string,
  propertyId: string,
  rowIndex: number,
  columnIndex: number,
  text: string,
  writeCell: (request: NotidianBasesCellEditRequest) => Promise<void>,
  pushUndoEntry: ((entry: NotidianBasesUndoEntry) => void) | undefined,
  focusTable: () => void,
  onAppliedWrite: (
    rowIndex: number,
    columnIndex: number,
    request: NotidianBasesCellEditRequest
  ) => void,
  showConflict: (
    rowIndex: number,
    columnIndex: number,
    request: NotidianBasesCellEditRequest,
    error: unknown
  ) => boolean,
  pasteCells?: (
    request: NotidianBasesStructuredPasteRequest
  ) => Promise<NotidianBasesStructuredPasteResult>
): HTMLElement => {
  const cellEl = rowEl.createEl("td", {
    attr: {
      "data-property-id": propertyId,
      "data-editable": "true",
      "data-row-index": String(rowIndex),
      "data-column-index": String(columnIndex),
      [NOTIDIAN_BASES_BASE_VALUE_ATTR]: text,
    },
  });
  const editorEl = cellEl.createSpan({
    cls: "notidian-bases-table-view__cell-editor",
    text,
  });
  editorEl.setAttribute("contenteditable", "true");
  editorEl.setAttribute("spellcheck", "false");

  let commitPromise: Promise<void> | null = null;
  const getBaseValue = (): string =>
    cellEl.getAttribute(NOTIDIAN_BASES_BASE_VALUE_ATTR) ?? "";
  const setBaseValue = (value: string): void => {
    cellEl.setAttribute(NOTIDIAN_BASES_BASE_VALUE_ATTR, value);
  };
  const clearState = (): void => {
    cellEl.removeAttribute("data-edit-state");
    cellEl.removeAttribute("data-edit-action");
    cellEl.removeAttribute("title");
    cellEl
      .querySelector(".notidian-bases-table-view__cell-actions")
      ?.remove();
  };
  const commit = async (): Promise<void> => {
    if (commitPromise) return commitPromise;

    const previousValue = getBaseValue();
    const nextValue = editorEl.textContent ?? "";
    if (nextValue === previousValue) return;

    commitPromise = (async () => {
      cellEl.setAttribute("data-edit-state", "pending");
      const request = {
        path,
        propertyId,
        value: nextValue,
        baseValue: previousValue,
      };
      try {
        await writeCell(request);
        setBaseValue(nextValue);
        onAppliedWrite(rowIndex, columnIndex, request);
        cellEl.setAttribute("data-edit-state", "applied");
        pushUndoEntry?.(
          notidianBasesCreateUndoEntry({
            label: "Edit cell",
            writes: [request],
          })
        );
      } catch (error) {
        if (showConflict(rowIndex, columnIndex, request, error)) return;

        cellEl.setAttribute("data-edit-state", "failed");
        cellEl.setAttribute(
          "title",
          String((error as { message?: unknown })?.message ?? error)
        );
        editorEl.textContent = previousValue;
      } finally {
        commitPromise = null;
      }
    })();

    return commitPromise;
  };

  editorEl.addEventListener("focus", clearState);
  editorEl.addEventListener("blur", () => {
    void commit();
  });
  editorEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    editorEl.blur();
    focusTable();
  });
  editorEl.addEventListener("paste", (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!pasteCells || !notidianBasesIsStructuredPasteText(text)) return;

    event.preventDefault();
    editorEl.blur();
    focusTable();
    void pasteCells({
      startRowIndex: rowIndex,
      startColumnIndex: columnIndex,
      text,
    });
  });

  return cellEl;
};

const renderSnapshot = (
  containerEl: HTMLElement,
  snapshot: NotidianBasesViewSnapshot,
  options: NotidianBasesRenderOptions = {}
): void => {
  containerEl.empty();
  const flatRows = snapshot.groups.flatMap((group) => group.rows);

  const headerEl = containerEl.createDiv({
    cls: "notidian-bases-table-view__header",
  });
  headerEl.createEl("strong", { text: "Notidian Table" });
  headerEl.createSpan({
    cls: "notidian-bases-table-view__count",
    text: `${snapshot.rowCount} rows`,
  });

  for (const diagnostic of snapshot.diagnostics) {
    containerEl.createDiv({
      cls: "notidian-bases-table-view__diagnostic",
      text: diagnostic,
    });
  }

  const tableEl = containerEl.createEl("table", {
    cls: "notidian-bases-table-view__table",
    attr: {
      tabindex: "0",
    },
  });
  const dataRowEls: HTMLElement[] = [];
  const rowPaths = flatRows.map((row) => row.path);
  let cellSelection: NotidianBasesCellSelection | null = null;
  const cellAt = (
    rowIndex: number,
    columnIndex: number
  ): HTMLElement | undefined =>
    dataRowEls[rowIndex]?.children[columnIndex] as HTMLElement | undefined;
  const editorForCell = (cellEl: HTMLElement | undefined): HTMLElement | null =>
    cellEl?.querySelector(".notidian-bases-table-view__cell-editor") ?? null;
  const clearCellActions = (cellEl: HTMLElement | undefined): void => {
    if (!cellEl) return;
    cellEl.removeAttribute("data-edit-action");
    cellEl
      .querySelector(".notidian-bases-table-view__cell-actions")
      ?.remove();
  };
  const setCellState = (
    rowIndex: number,
    columnIndex: number,
    state: "pending" | "applied" | "failed" | "skipped",
    title?: string
  ): void => {
    const cellEl = cellAt(rowIndex, columnIndex);
    if (!cellEl) return;
    cellEl.setAttribute("data-edit-state", state);
    if (state !== "skipped") clearCellActions(cellEl);
    if (title) {
      cellEl.setAttribute("title", title);
    } else {
      cellEl.removeAttribute("title");
    }
  };
  const clearCellState = (
    rowIndex: number,
    columnIndex: number
  ): void => {
    const cellEl = cellAt(rowIndex, columnIndex);
    if (!cellEl) return;
    cellEl.removeAttribute("data-edit-state");
    cellEl.removeAttribute("title");
    clearCellActions(cellEl);
  };
  const setCellText = (
    rowIndex: number,
    columnIndex: number,
    text: string
  ): void => {
    const editorEl = editorForCell(cellAt(rowIndex, columnIndex));
    if (editorEl) editorEl.textContent = text;
  };
  const setCellBaseValue = (
    rowIndex: number,
    columnIndex: number,
    value: string
  ): void => {
    cellAt(rowIndex, columnIndex)?.setAttribute(
      NOTIDIAN_BASES_BASE_VALUE_ATTR,
      value
    );
  };
  const setRowPath = (rowIndex: number, path: string | undefined): void => {
    rowPaths[rowIndex] = path;
    const rowEl = dataRowEls[rowIndex];
    if (!rowEl) return;
    if (path) {
      rowEl.setAttribute("data-path", path);
    } else {
      rowEl.removeAttribute("data-path");
    }
  };
  const currentRows = (): { path?: string; values?: string[] }[] =>
    flatRows.map((row, rowIndex) => ({
      ...row,
      path: rowPaths[rowIndex],
    }));
  const visibleRowsWithBaseValues = (): { path?: string; values: string[] }[] =>
    notidianBasesRowsWithVisibleBaseValues({
      properties: snapshot.properties,
      rows: currentRows(),
      baseValueForCell: (rowIndex, columnIndex) =>
        cellAt(rowIndex, columnIndex)?.getAttribute(
          NOTIDIAN_BASES_BASE_VALUE_ATTR
        ) ?? undefined,
    });
  const selectionBounds = (): NotidianBasesCellSelectionBounds | null =>
    cellSelection
      ? notidianBasesSelectionBounds(
          cellSelection,
          flatRows.length,
          snapshot.properties.length
        )
      : null;
  const updateSelectionAttributes = (): void => {
    const bounds = selectionBounds();
    for (let row = 0; row < flatRows.length; row++) {
      for (let column = 0; column < snapshot.properties.length; column++) {
        const cellEl = cellAt(row, column);
        if (!cellEl) continue;
        cellEl.removeAttribute("data-selected");
        cellEl.removeAttribute("data-active-cell");
        if (!bounds) continue;
        const selected =
          row >= bounds.minRow &&
          row <= bounds.maxRow &&
          column >= bounds.minColumn &&
          column <= bounds.maxColumn;
        if (selected) cellEl.setAttribute("data-selected", "true");
        if (
          cellSelection?.active.rowIndex === row &&
          cellSelection?.active.columnIndex === column
        ) {
          cellEl.setAttribute("data-active-cell", "true");
        }
      }
    }

    if (bounds) {
      containerEl.setAttribute(
        "data-notidian-bases-selection",
        JSON.stringify(bounds)
      );
    } else {
      containerEl.removeAttribute("data-notidian-bases-selection");
    }
  };
  const selectCell = (
    rowIndex: number,
    columnIndex: number,
    extend = false
  ): void => {
    const coord = { rowIndex, columnIndex };
    cellSelection =
      extend && cellSelection
        ? {
            ...cellSelection,
            focus: coord,
            active: coord,
          }
        : {
            anchor: coord,
            focus: coord,
            active: coord,
        };
    updateSelectionAttributes();
  };
  const moveSelection = (
    direction: "up" | "down" | "left" | "right",
    extend = false
  ): void => {
    if (!cellSelection) return;
    const active = cellSelection.active;
    const rowIndex =
      direction === "up"
        ? active.rowIndex - 1
        : direction === "down"
        ? active.rowIndex + 1
        : active.rowIndex;
    const columnIndex =
      direction === "left"
        ? active.columnIndex - 1
        : direction === "right"
        ? active.columnIndex + 1
        : active.columnIndex;
    const next = {
      rowIndex: clampIndex(rowIndex, flatRows.length - 1),
      columnIndex: clampIndex(columnIndex, snapshot.properties.length - 1),
    };

    cellSelection = extend
      ? {
          ...cellSelection,
          focus: next,
          active: next,
        }
      : {
          anchor: next,
          focus: next,
          active: next,
        };
    updateSelectionAttributes();
    cellAt(next.rowIndex, next.columnIndex)?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  };
  const bindCellSelection = (
    cellEl: HTMLElement,
    rowIndex: number,
    columnIndex: number
  ): void => {
    cellEl.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement | null)?.closest("button")) return;
      selectCell(rowIndex, columnIndex, event.shiftKey);
    });
    cellEl.addEventListener("mouseenter", (event) => {
      if ((event.buttons & 1) !== 1 || !cellSelection) return;
      selectCell(rowIndex, columnIndex, true);
    });
  };
  const hasNativeTextSelection = (): boolean => {
    const selection = window.getSelection?.();
    if (!selection || selection.toString().length === 0) return false;
    const anchorNode = selection.anchorNode;
    return Boolean(anchorNode && tableEl.contains(anchorNode));
  };
  const writeClipboardText = (text: string): void => {
    containerEl.setAttribute("data-notidian-bases-last-copy", text);
    tableEl.setAttribute("data-notidian-bases-copy-state", "applied");
    void navigator.clipboard?.writeText?.(text)?.catch(() => {
      tableEl.setAttribute("data-notidian-bases-copy-state", "failed");
    });
  };
  const copySelection = (): string | null => {
    if (!cellSelection) return null;
    const text = notidianBasesClipboardTextForSelection({
      rows: visibleRowsWithBaseValues(),
      selection: cellSelection,
    });
    writeClipboardText(text);
    return text;
  };
  const renamePlanForRequest = (
    request: NotidianBasesCellEditRequest
  ): Extract<NotidianBasesCellEditPlan, { authority: "file-name" }> | null => {
    if (!notidianBasesIsFileNameProperty(String(request.propertyId ?? ""))) {
      return null;
    }
    const plan = notidianBasesCellEditPlan(request);
    return plan.ok === true && plan.authority === "file-name" ? plan : null;
  };
  const applySuccessfulWriteToRenderedRow = (
    rowIndex: number,
    _columnIndex: number,
    request: NotidianBasesCellEditRequest
  ): void => {
    const renamePlan = renamePlanForRequest(request);
    if (renamePlan?.changed) {
      setRowPath(rowIndex, renamePlan.newPath);
    }
  };
  const targetForRequest = (
    request: NotidianBasesCellEditRequest
  ): { rowIndex: number; columnIndex: number } | null => {
    const path = String(request.path ?? "");
    const propertyId = String(request.propertyId ?? "");
    const rowIndex = rowPaths.findIndex((rowPath) => rowPath === path);
    const columnIndex = snapshot.properties.indexOf(propertyId);
    if (rowIndex < 0 || columnIndex < 0) return null;
    return { rowIndex, columnIndex };
  };
  const pushUndoForWrites = (
    label: string,
    writes: NotidianBasesCellEditRequest[]
  ): void => {
    options.pushUndoEntry?.(
      notidianBasesCreateUndoEntry({
        label,
        writes,
      })
    );
  };
  const showConflict = (
    rowIndex: number,
    columnIndex: number,
    request: NotidianBasesCellEditRequest,
    error: unknown
  ): boolean => {
    const conflict = notidianBasesConflictFromError(error);
    if (!conflict) return false;

    const cellEl = cellAt(rowIndex, columnIndex);
    const editorEl = editorForCell(cellEl);
    if (!cellEl || !editorEl) return true;

    clearCellActions(cellEl);
    editorEl.textContent = conflict.baseValue;
    cellEl.setAttribute("data-edit-state", "skipped");
    cellEl.setAttribute("data-edit-action", NOTIDIAN_BASES_CONFLICT_ACTION);
    cellEl.setAttribute("title", notidianBasesConflictTitle(conflict));

    const actionsEl = cellEl.createDiv({
      cls: "notidian-bases-table-view__cell-actions",
    });
    actionsEl.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });
    const reloadButton = actionsEl.createEl("button", {
      cls: "notidian-bases-table-view__cell-action",
      text: "Reload",
      attr: {
        type: "button",
        title: "Reload current file value",
      },
    });
    reloadButton.addEventListener("click", (event) => {
      event.stopPropagation();
      editorEl.textContent = conflict.currentValue;
      setCellBaseValue(rowIndex, columnIndex, conflict.currentValue);
      clearCellState(rowIndex, columnIndex);
    });

    const applyButton = actionsEl.createEl("button", {
      cls: "notidian-bases-table-view__cell-action",
      text: "Apply anyway",
      attr: {
        type: "button",
        title: "Apply this value to the file",
      },
    });
    applyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const forcedRequest: NotidianBasesCellEditRequest = {
        ...request,
        baseValue: conflict.currentValue,
        value: conflict.attemptedValue,
        forceFrontmatterWrite: true,
      };
      void (async () => {
        setCellState(rowIndex, columnIndex, "pending");
        try {
          await options.writeCell?.(forcedRequest);
          setCellText(rowIndex, columnIndex, conflict.attemptedValue);
          setCellBaseValue(rowIndex, columnIndex, conflict.attemptedValue);
          applySuccessfulWriteToRenderedRow(rowIndex, columnIndex, forcedRequest);
          clearCellActions(cellEl);
          setCellState(rowIndex, columnIndex, "applied");
          pushUndoForWrites("Apply cell", [forcedRequest]);
        } catch (applyError) {
          if (showConflict(rowIndex, columnIndex, forcedRequest, applyError)) {
            return;
          }
          setCellState(
            rowIndex,
            columnIndex,
            "failed",
            String((applyError as { message?: unknown })?.message ?? applyError)
          );
        }
      })();
    });

    return true;
  };
  const pasteCells =
    options.writeCell &&
    (async ({
      startRowIndex,
      startColumnIndex,
      text,
    }: NotidianBasesStructuredPasteRequest): Promise<NotidianBasesStructuredPasteResult> => {
      const plan = notidianBasesStructuredPastePlan({
        properties: snapshot.properties,
        rows: visibleRowsWithBaseValues(),
        startRowIndex,
        startColumnIndex,
        text,
      });
      const result: NotidianBasesStructuredPasteResult = {
        applied: 0,
        failed: 0,
        skipped: plan.skipped.length,
        appliedWrites: [],
        failedWrites: [],
      };
      const fileNameWrites = plan.writes.filter((write) =>
        notidianBasesIsFileNameProperty(String(write.request.propertyId ?? ""))
      );
      const fileNameIssueRequests = new Set<NotidianBasesCellEditRequest>();
      let executableWrites = plan.writes;
      if (fileNameWrites.length > 0) {
        const preflight = notidianBasesPreflightFileNameWrites({
          writes: fileNameWrites.map((write) => write.request),
          pathExists: options.pathExists,
        });
        if (!preflight.ok) {
          executableWrites = plan.writes.filter(
            (write) =>
              !notidianBasesIsFileNameProperty(
                String(write.request.propertyId ?? "")
              )
          );
          for (const issue of preflight.issues) {
            fileNameIssueRequests.add(issue.request);
            const write = fileNameWrites.find(
              (candidate) => candidate.request === issue.request
            );
            if (!write) continue;
            setCellState(
              write.rowIndex,
              write.columnIndex,
              "skipped",
              issue.reason
            );
            result.skipped += 1;
          }
          for (const write of fileNameWrites) {
            if (fileNameIssueRequests.has(write.request)) continue;
            setCellState(
              write.rowIndex,
              write.columnIndex,
              "skipped",
              "file-name-preflight-failed"
            );
            result.skipped += 1;
          }
        }
      }
      const orderedWrites = [
        ...executableWrites.filter((write) =>
          notidianBasesIsFileNameProperty(String(write.request.propertyId ?? ""))
        ),
        ...executableWrites.filter(
          (write) =>
            !notidianBasesIsFileNameProperty(
              String(write.request.propertyId ?? "")
            )
        ),
      ];
      const renamedPathByOriginalPath = new Map<string, string>();

      tableEl.setAttribute("data-notidian-bases-paste-state", "pending");
      for (const skipped of plan.skipped) {
        setCellState(
          skipped.rowIndex,
          skipped.columnIndex,
          "skipped",
          skipped.reason
        );
      }

      for (const write of orderedWrites) {
        setCellState(write.rowIndex, write.columnIndex, "pending");
        const request =
          write.request.path && renamedPathByOriginalPath.has(write.request.path)
            ? {
                ...write.request,
                path: renamedPathByOriginalPath.get(write.request.path),
              }
            : write.request;
        try {
          const renamePlan = renamePlanForRequest(request);
          await options.writeCell?.(request);
          setCellText(
            write.rowIndex,
            write.columnIndex,
            request.value
          );
          setCellState(write.rowIndex, write.columnIndex, "applied");
          setCellBaseValue(
            write.rowIndex,
            write.columnIndex,
            request.value
          );
          if (renamePlan?.changed) {
            renamedPathByOriginalPath.set(renamePlan.path, renamePlan.newPath);
          }
          applySuccessfulWriteToRenderedRow(
            write.rowIndex,
            write.columnIndex,
            request
          );
          result.applied += 1;
          result.appliedWrites.push(request);
        } catch (error) {
          if (
            showConflict(
              write.rowIndex,
              write.columnIndex,
              request,
              error
            )
          ) {
            result.skipped += 1;
            continue;
          }

          setCellState(
            write.rowIndex,
            write.columnIndex,
            "failed",
            String((error as { message?: unknown })?.message ?? error)
          );
          result.failed += 1;
          result.failedWrites.push({ request, error });
        }
      }

      pushUndoForWrites("Paste cells", result.appliedWrites);

      const state =
        result.failed > 0
          ? "failed"
          : result.applied > 0
          ? "applied"
          : "skipped";
      tableEl.setAttribute("data-notidian-bases-paste-state", state);
      containerEl.setAttribute(
        "data-notidian-bases-last-paste",
        JSON.stringify(result)
      );
      return result;
    });
  const cutSelection = async (): Promise<void> => {
    if (!options.writeCell || !cellSelection) return;
    copySelection();

    const plan = notidianBasesStructuredCutPlan({
      properties: snapshot.properties,
      rows: visibleRowsWithBaseValues(),
      selection: cellSelection,
    });
    const result: NotidianBasesStructuredPasteResult = {
      applied: 0,
      failed: 0,
      skipped: plan.skipped.length,
      appliedWrites: [],
      failedWrites: [],
    };

    tableEl.setAttribute("data-notidian-bases-cut-state", "pending");
    for (const skipped of plan.skipped) {
      setCellState(
        skipped.rowIndex,
        skipped.columnIndex,
        "skipped",
        skipped.reason
      );
    }

    for (const write of plan.writes) {
      setCellState(write.rowIndex, write.columnIndex, "pending");
      try {
        await options.writeCell(write.request);
        setCellText(write.rowIndex, write.columnIndex, "");
        setCellBaseValue(write.rowIndex, write.columnIndex, "");
        setCellState(write.rowIndex, write.columnIndex, "applied");
        result.applied += 1;
        result.appliedWrites.push(write.request);
      } catch (error) {
        if (
          showConflict(
            write.rowIndex,
            write.columnIndex,
            write.request,
            error
          )
        ) {
          result.skipped += 1;
          continue;
        }

        setCellState(
          write.rowIndex,
          write.columnIndex,
          "failed",
          String((error as { message?: unknown })?.message ?? error)
        );
        result.failed += 1;
        result.failedWrites.push({ request: write.request, error });
      }
    }

    pushUndoForWrites("Cut cells", result.appliedWrites);

    const state =
      result.failed > 0
        ? "failed"
        : result.applied > 0
        ? "applied"
        : "skipped";
    tableEl.setAttribute("data-notidian-bases-cut-state", state);
    containerEl.setAttribute(
      "data-notidian-bases-last-cut",
      JSON.stringify(result)
    );
  };
  const undoLast = async (): Promise<void> => {
    if (!options.undoLast) return;

    tableEl.setAttribute("data-notidian-bases-undo-state", "pending");
    const result = await options.undoLast();
    for (const request of result.appliedWrites) {
      const target = targetForRequest(request);
      if (!target) continue;
      setCellText(target.rowIndex, target.columnIndex, request.value);
      setCellBaseValue(target.rowIndex, target.columnIndex, request.value);
      applySuccessfulWriteToRenderedRow(
        target.rowIndex,
        target.columnIndex,
        request
      );
      setCellState(target.rowIndex, target.columnIndex, "applied");
    }
    for (const failed of result.failedWrites) {
      const target = targetForRequest(failed.request);
      if (!target) continue;
      if (
        showConflict(
          target.rowIndex,
          target.columnIndex,
          failed.request,
          failed.error
        )
      ) {
        continue;
      }
      setCellState(
        target.rowIndex,
        target.columnIndex,
        "failed",
        String((failed.error as { message?: unknown })?.message ?? failed.error)
      );
    }

    const state =
      result.failed > 0 ? "failed" : result.applied > 0 ? "applied" : "skipped";
    tableEl.setAttribute("data-notidian-bases-undo-state", state);
    containerEl.setAttribute(
      "data-notidian-bases-last-undo",
      JSON.stringify({
        applied: result.applied,
        failed: result.failed,
        skipped: result.skipped,
      })
    );
  };
  tableEl.addEventListener("keydown", (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const key = event.key.toLowerCase();
    const shortcut = event.metaKey || event.ctrlKey;

    if (shortcut && (key === "c" || key === "x")) {
      if (target?.isContentEditable && hasNativeTextSelection()) return;
      if (!cellSelection) return;
      event.preventDefault();
      if (key === "c") {
        copySelection();
      } else {
        void cutSelection();
      }
      return;
    }

    if (target?.isContentEditable) return;

    const direction =
      event.key === "ArrowUp"
        ? "up"
        : event.key === "ArrowDown"
        ? "down"
        : event.key === "ArrowLeft"
        ? "left"
        : event.key === "ArrowRight"
        ? "right"
        : null;
    if (direction && cellSelection && !shortcut) {
      event.preventDefault();
      moveSelection(direction, event.shiftKey);
      return;
    }

    if (!shortcut) return;
    if (event.shiftKey || key !== "z") return;

    event.preventDefault();
    void undoLast();
  });

  const theadEl = tableEl.createEl("thead");
  const headerRowEl = theadEl.createEl("tr");
  for (const property of snapshot.properties) {
    renderHeaderCell(headerRowEl, property);
  }

  const tbodyEl = tableEl.createEl("tbody");
  let rowIndex = 0;
  for (const group of snapshot.groups) {
    if (group.key) {
      const groupRowEl = tbodyEl.createEl("tr", {
        cls: "notidian-bases-table-view__group",
      });
      groupRowEl.createEl("th", {
        attr: { colspan: String(snapshot.properties.length) },
        text: group.key,
      });
    }

    for (const row of group.rows) {
      const rowEl = tbodyEl.createEl("tr");
      const currentRowIndex = rowIndex;
      rowEl.setAttribute("data-row-index", String(currentRowIndex));
      if (row.path) rowEl.setAttribute("data-path", row.path);
      dataRowEls[currentRowIndex] = rowEl;
      row.values.forEach((value, index) => {
        const propertyId = snapshot.properties[index] ?? "";
        if (
          row.path &&
          options.writeCell &&
          (notidianBasesNotePropertyKey(propertyId) ||
            notidianBasesIsFileNameProperty(propertyId))
        ) {
          const cellEl = renderEditableCell(
            rowEl,
            row.path,
            propertyId,
            currentRowIndex,
            index,
            value,
            options.writeCell,
            options.pushUndoEntry,
            () => tableEl.focus(),
            applySuccessfulWriteToRenderedRow,
            showConflict,
            pasteCells || undefined
          );
          bindCellSelection(cellEl, currentRowIndex, index);
          return;
        }

        bindCellSelection(
          renderReadOnlyCell(
            rowEl,
            propertyId,
            value,
            currentRowIndex,
            index
          ),
          currentRowIndex,
          index
        );
      });
      rowIndex += 1;
    }
  }

  if (snapshot.rowCount === 0) {
    containerEl.createDiv({
      cls: "notidian-bases-table-view__empty",
      text: "No rows",
    });
  }
};

export class NotidianBasesView extends RuntimeBasesViewBase {
  readonly type = NOTIDIAN_BASES_VIEW_TYPE;
  private containerEl: HTMLElement;
  private controller: BasesQueryControllerLike;
  private obsidianApp: NotidianBasesViewAppLike | undefined;
  private undoStack: NotidianBasesUndoEntry[] = [];

  constructor(
    controller: BasesQueryControllerLike,
    parentEl: HTMLElement,
    app?: NotidianBasesViewAppLike
  ) {
    super(controller);
    this.controller = controller;
    this.obsidianApp = app;
    this.containerEl = parentEl.createDiv("notidian-bases-table-view");
  }

  private writeCell = async (
    request: NotidianBasesCellEditRequest
  ): Promise<void> => {
    const plan = notidianBasesCellEditPlan(request);
    if (plan.ok !== true) {
      throw new Error(`Cannot write Bases cell edit: ${plan.reason}`);
    }
    await writeNotidianBasesCellEdit(this.obsidianApp, plan);
  };

  private pushUndoEntry = (entry: NotidianBasesUndoEntry): void => {
    if (entry.writes.length === 0) return;
    this.undoStack = [...this.undoStack, entry].slice(-20);
    this.containerEl.setAttribute(
      "data-notidian-bases-undo-depth",
      String(this.undoStack.length)
    );
  };

  private undoLast = async (): Promise<NotidianBasesStructuredPasteResult> => {
    const entry = this.undoStack.pop();
    this.containerEl.setAttribute(
      "data-notidian-bases-undo-depth",
      String(this.undoStack.length)
    );

    const result: NotidianBasesStructuredPasteResult = {
      applied: 0,
      failed: 0,
      skipped: entry ? 0 : 1,
      appliedWrites: [],
      failedWrites: [],
    };
    if (!entry) return result;

    for (const request of entry.writes) {
      try {
        await this.writeCell(request);
        result.applied += 1;
        result.appliedWrites.push(request);
      } catch (error) {
        result.failed += 1;
        result.failedWrites.push({ request, error });
      }
    }

    return result;
  };

  public onDataUpdated(): void {
    const capabilities = notidianBasesRuntimeCapabilities({
      controller: this.controller,
      view: this,
    });
    this.containerEl.setAttribute(
      "data-notidian-bases-capabilities",
      JSON.stringify(capabilities)
    );
    renderSnapshot(this.containerEl, notidianBasesViewSnapshot(this), {
      writeCell: this.obsidianApp ? this.writeCell : undefined,
      pushUndoEntry: this.obsidianApp ? this.pushUndoEntry : undefined,
      undoLast: this.obsidianApp ? this.undoLast : undefined,
      pathExists: this.obsidianApp
        ? (path: string) =>
            Boolean(this.obsidianApp?.vault?.getAbstractFileByPath?.(path))
        : undefined,
    });
  }
}

export const registerNotidianBasesView = (
  plugin: unknown
): boolean => {
  const basesPlugin = plugin as BasesViewPlugin | null;
  const registerBasesView = basesPlugin?.registerBasesView;
  if (typeof registerBasesView !== "function") return false;

  return (
    registerBasesView.call(plugin, NOTIDIAN_BASES_VIEW_TYPE, {
      name: "Notidian Table",
      icon: "lucide-table-2",
      factory: (
        controller: BasesQueryControllerLike,
        containerEl: HTMLElement
      ) =>
        new NotidianBasesView(
          controller,
          containerEl,
          (plugin as { app?: NotidianBasesViewAppLike })?.app
        ),
    }) !== false
  );
};
