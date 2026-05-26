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
  getOrder?: () => string[];
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

const FallbackBasesView = class implements RuntimeBasesView {
  data?: BasesQueryResultLike;
  config?: BasesViewConfigLike;

  constructor(_controller: BasesQueryControllerLike) {}
};

const RuntimeBasesViewBase = (
  (ObsidianApi as unknown as { BasesView?: RuntimeBasesViewConstructor }).BasesView ??
  FallbackBasesView
) as RuntimeBasesViewConstructor;

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

const renderCell = (rowEl: HTMLElement, text: string): void => {
  rowEl.createEl("td", { text });
};

const renderSnapshot = (
  containerEl: HTMLElement,
  snapshot: NotidianBasesViewSnapshot
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
      for (const value of row.values) {
        renderCell(rowEl, value);
      }
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

  constructor(
    controller: BasesQueryControllerLike,
    parentEl: HTMLElement
  ) {
    super(controller);
    this.containerEl = parentEl.createDiv("notidian-bases-table-view");
  }

  public onDataUpdated(): void {
    renderSnapshot(this.containerEl, notidianBasesViewSnapshot(this));
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
        new NotidianBasesView(controller, containerEl),
    }) !== false
  );
};
