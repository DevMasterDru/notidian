import * as ObsidianApi from "obsidian";

export const NOTIDIAN_BASES_VIEW_TYPE = "notidian-table";

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
};

export type NotidianBasesCellEditPlan =
  | {
      ok: true;
      path: string;
      propertyId: string;
      propertyKey: string;
      value: string;
    }
  | {
      ok: false;
      reason: "missing-path" | "missing-property" | "read-only-property";
      path?: string;
      propertyId?: string;
    };

type NotidianBasesViewAppLike = {
  vault?: {
    getAbstractFileByPath?: (path: string) => unknown;
  };
  fileManager?: {
    processFrontMatter?: (
      file: unknown,
      update: (frontmatter: Record<string, unknown>) => void
    ) => Promise<void> | void;
  };
};

type NotidianBasesRenderOptions = {
  writeCell?: (request: NotidianBasesCellEditRequest) => Promise<void>;
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

export const notidianBasesCellEditPlan = ({
  path,
  propertyId,
  value,
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
    path: normalizedPath,
    propertyId: normalizedPropertyId,
    propertyKey,
    value: String(value ?? ""),
  };
};

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
  text: string
): void => {
  rowEl.createEl("td", {
    attr: {
      "data-property-id": propertyId,
      "data-editable": "false",
    },
    text,
  });
};

const renderEditableCell = (
  rowEl: HTMLElement,
  path: string,
  propertyId: string,
  text: string,
  writeCell: (request: NotidianBasesCellEditRequest) => Promise<void>
): void => {
  const cellEl = rowEl.createEl("td", {
    attr: {
      "data-property-id": propertyId,
      "data-editable": "true",
    },
  });
  const editorEl = cellEl.createSpan({
    cls: "notidian-bases-table-view__cell-editor",
    text,
  });
  editorEl.setAttribute("contenteditable", "true");
  editorEl.setAttribute("spellcheck", "false");

  let previousValue = text;
  let commitPromise: Promise<void> | null = null;
  const clearState = (): void => {
    cellEl.removeAttribute("data-edit-state");
    cellEl.removeAttribute("title");
  };
  const commit = async (): Promise<void> => {
    if (commitPromise) return commitPromise;

    const nextValue = editorEl.textContent ?? "";
    if (nextValue === previousValue) return;

    commitPromise = (async () => {
      cellEl.setAttribute("data-edit-state", "pending");
      try {
        await writeCell({
          path,
          propertyId,
          value: nextValue,
        });
        previousValue = nextValue;
        cellEl.setAttribute("data-edit-state", "applied");
      } catch (error) {
        editorEl.textContent = previousValue;
        cellEl.setAttribute("data-edit-state", "failed");
        cellEl.setAttribute(
          "title",
          String((error as { message?: unknown })?.message ?? error)
        );
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
  });
};

const renderSnapshot = (
  containerEl: HTMLElement,
  snapshot: NotidianBasesViewSnapshot,
  options: NotidianBasesRenderOptions = {}
): void => {
  containerEl.empty();

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
  });
  const theadEl = tableEl.createEl("thead");
  const headerRowEl = theadEl.createEl("tr");
  for (const property of snapshot.properties) {
    renderHeaderCell(headerRowEl, property);
  }

  const tbodyEl = tableEl.createEl("tbody");
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
      if (row.path) rowEl.setAttribute("data-path", row.path);
      row.values.forEach((value, index) => {
        const propertyId = snapshot.properties[index] ?? "";
        if (
          row.path &&
          options.writeCell &&
          notidianBasesNotePropertyKey(propertyId)
        ) {
          renderEditableCell(
            rowEl,
            row.path,
            propertyId,
            value,
            options.writeCell
          );
          return;
        }

        renderReadOnlyCell(rowEl, propertyId, value);
      });
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
