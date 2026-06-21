import classNames from "classnames";
import { PathCrumb } from "core/react/components/UI/Crumbs/PathCrumb";
import { showNewPropertyMenu } from "core/react/components/UI/Menus/contexts/newSpacePropertyMenu";
import { showPropertyVisibilityMenu } from "core/react/components/UI/Menus/contexts/propertyVisibilityMenu";
import { showPropertyMenu } from "core/react/components/UI/Menus/contexts/spacePropertyMenu";
import { TableDirectionMenuComponent } from "core/react/components/UI/Menus/contexts/TableDirectionMenu";
import {
  defaultMenu,
  menuInput,
  menuSeparator,
} from "core/react/components/UI/Menus/menu/SelectionMenu";
import { showSpaceAddMenu } from "core/react/components/UI/Menus/navigator/showSpaceAddMenu";
import {
  DatePickerTimeMode,
  showDatePickerMenu,
} from "core/react/components/UI/Menus/properties/datePickerMenu";
import { showLinkMenu } from "core/react/components/UI/Menus/properties/linkMenu";
import { showSetValueMenu } from "core/react/components/UI/Menus/properties/propertyMenu";
import { showSpacesMenu } from "core/react/components/UI/Menus/properties/selectSpaceMenu";
import { openContextCreateItemModal } from "core/react/components/UI/Modals/ContextCreateItemModal";
import { CsvImportModal } from "core/react/components/UI/Modals/CsvImportModal";
import { executeCsvImport } from "core/utils/contexts/tableCsvImportRuntime";
import { pageTitleFromPath } from "core/utils/contexts/pageTitle";
import {
  enableSubItemsWithColumn,
  addSubItemChildrenColumn,
} from "core/utils/contexts/subItemsSetup";
import { repairSubItemLinks } from "core/utils/contexts/subItemLinkRepair";
import { PathPropertyName } from "shared/types/context";
import { ContextEditorContext } from "core/react/context/ContextEditorContext";
import { tableToCsv } from "core/utils/contexts/tableCsv";
import { FramesMDBContext } from "core/react/context/FramesMDBContext";
import { PathContext } from "core/react/context/PathContext";
import { SpaceContext } from "core/react/context/SpaceContext";
import { parseFieldValue } from "core/schemas/parseFieldValue";
import { filterFnLabels } from "core/utils/contexts/predicate/filterFns/filterFnLabels";
import { filterFnTypes } from "core/utils/contexts/predicate/filterFns/filterFnTypes";
import {
  defaultPredicateFnForType,
  defaultPredicateForSchema,
  predicateFnsForType,
} from "core/utils/contexts/predicate/predicate";
import { sortFnTypes } from "core/utils/contexts/predicate/sort";
import { displayPropertyForPredicate } from "core/utils/contexts/rowDisplayLabel";
import {
  listItemPropsToMenuState,
  menuStateToVisibleProperties,
  shouldShowListItemPropertyPicker,
} from "core/utils/contexts/listItemProperties";
import { deriveInlineControlActiveState } from "core/utils/contexts/viewSettings";
import { discoverFrontmatterPropertiesFromPathStates } from "core/utils/properties/allProperties";
import { formatDate } from "core/utils/date";
import { nameForField } from "core/utils/frames/frames";
import { isPhone } from "core/utils/ui/screen";
import { isString } from "lodash";
import { SelectOption, SelectOptionType, Superstate } from "makemd-core";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { fieldTypeForField, stickerForField } from "schemas/mdb";
import i18n from "shared/i18n";
import { defaultContextSchemaID } from "shared/schemas/context";
import { FrameEditorMode } from "shared/types/frameExec";
import { SpaceProperty, SpaceTableColumn } from "shared/types/mdb";
import { Rect } from "shared/types/Pos";
import {
  Filter,
  Predicate,
  Sort,
  TableDirection,
} from "shared/types/predicate";
import { windowFromDocument } from "shared/utils/dom";
import { parseMultiString } from "utils/parsers";
import { parseMDBStringValue } from "utils/properties";
import { serializeMultiString } from "utils/serializers";
import { ContextTitle } from "./ContextTitle";
import { ListSelector } from "./ListSelector";
import { SearchBar } from "./SearchBar";

export const FilterBar = (props: {
  superstate: Superstate;
  showTitle?: boolean;
  setView?: (view: string) => void;
  minMode?: boolean;
}) => {
  const { spaceState: spaceCache } = useContext(SpaceContext);
  const { readMode } = useContext(PathContext);
  const {
    source,
    dbSchema,
    cols,
    filteredData,
    setSearchString,
    setEditMode,
    predicate,
    savePredicate,
    hideColumn,
    delColumn,
    saveColumn,
    reloadContextData,
    setSubItemsCollapsedAll,
    subItemsField,
    subItemsParentKey,
    // The single view search's open toggle (ADR 0041). Shared via context so
    // the table's Cmd/Ctrl+F can open this same SearchBar.
    searchActive,
    setSearchActive,
  } = useContext(ContextEditorContext);

  const { frameSchema, saveSchema, setFrameSchema } =
    useContext(FramesMDBContext);

  const properties = spaceCache?.propertyTypes ?? [];
  const propertiesForPredicate = async (
    _predicate: Predicate,
    frame: "listView" | "listGroup" | "listItem"
  ) => {
    if (_predicate.view == "table") return [];
    if (
      _predicate.view == "day" ||
      _predicate.view == "week" ||
      _predicate.view == "month"
    ) {
      if (frame != "listView") return [];
      return [
        {
          name: "start",
          type: "option",
          value: JSON.stringify({
            alias: i18n.labels.startTimeProperty,
            source: `$properties`,
            sourceProps: {
              type: "date",
            },
            required: true,
          }),
        },
        {
          name: "end",
          type: "option",
          value: JSON.stringify({
            alias: i18n.labels.endTimeProperty,
            source: `$properties`,
            sourceProps: {
              type: "date",
            },
          }),
        },
        {
          name: "repeat",
          type: "option",
          value: JSON.stringify({
            alias: "Repeat Property",
            source: `$properties`,
            sourceProps: {
              type: "object",
              typeName: i18n.labels.repeat,
            },
          }),
        },
        {
          name: "startOfDay",
          type: "number",
          value: JSON.stringify({
            alias: i18n.labels.startOfDay,
          }),
        },
        {
          name: "endOfDay",
          type: "number",
          value: JSON.stringify({
            alias: i18n.labels.endOfDay,
          }),
        },
        {
          name: "date",
          type: "date",
          value: JSON.stringify({
            alias: "Start Date",
          }),
        },
        {
          name: "hideHeader",
          type: "boolean",
          value: JSON.stringify({
            alias: "Hide Header",
          }),
        },
        {
          name: "showHours",
          type: "boolean",
          value: JSON.stringify({
            alias: "Show Hours",
          }),
        },
      ];
    }
    let path = _predicate?.[frame];
    if (!path || path.length == 0) {
      if (frame == "listView") {
        path = "spaces://$kit/#*listView";
      }
      if (frame == "listGroup") {
        path = "spaces://$kit/#*listGroup";
      }
      if (frame == "listItem") {
        path = "spaces://$kit/#*rowItem";
      }
    }
    const uri = props.superstate.spaceManager.uriByString(path);
    if (uri.authority == "$kit") {
      const node = props.superstate.kitFrames.get(uri.ref)?.node;
      if (!node) return [];
      return Object.keys(node.types)
        .map((f) => ({
          type: node.types[f],
          name: f,
          attrs: JSON.stringify(node.propsAttrs?.[f]),
          schemaId: node.schemaId,
          value: JSON.stringify(node.propsValue?.[f]),
        }))
        .filter((f) => !f.name.startsWith("_"));
    }
    return props.superstate.spaceManager
      .readFrame(uri.path, uri.ref)
      .then((g) => g?.cols.filter((f) => !f.name.startsWith("_")) ?? []);
  };

  const filteredCols = cols.filter((f) => f.hidden != "true");
  // View-settings inline bar IA (bd Notidian-vrmf), DEFAULT-ON / KILL-SWITCH.
  // Declared early so both the render and the showViewOptionsMenu closure read
  // the same value. When ON, the inline controls' active indicator comes from
  // one pure helper (deriveInlineControlActiveState) and the 3-knobs menu drops
  // the duplicated Filter/Sort entries (single home: inline). When OFF, the
  // inline buttons fall back to their legacy per-call `predicate?.x.length > 0`
  // expressions and the menu re-lists Filter/Sort — byte-for-byte legacy IA.
  const inlineBarEnabled =
    props.superstate.settings.viewSettingsInlineBar !== false;
  const [expanded, setExpanded] = useState(false);
  const saveViewType = (type: string) => {
    if (type == "table") {
      savePredicate({
        view: "table",
        listView: "",
        listGroup: "",
        listItem: "",
      });
    }
    if (type == "flow") {
      savePredicate({
        view: "list",
        listView: "spaces://$kit/#*listView",
        listGroup: "spaces://$kit/#*listGroup",
        listItem: "spaces://$kit/#*flowListItem",
      });
    }
    if (type == "list") {
      savePredicate({
        view: "list",
        listView: "spaces://$kit/#*listView",
        listGroup: "spaces://$kit/#*listGroup",
        listItem: "spaces://$kit/#*rowItem",
      });
    }
    if (type == "details") {
      savePredicate({
        view: "list",
        listView: "spaces://$kit/#*listView",
        listGroup: "spaces://$kit/#*listGroup",
        listItem: "spaces://$kit/#*detailItem",
      });
    }
    if (type == "board") {
      savePredicate({
        view: "list",
        listView: "spaces://$kit/#*columnView",
        listGroup: "spaces://$kit/#*columnGroup",
        listItem: "spaces://$kit/#*cardListItem",
      });
    }
    if (type == "cards") {
      savePredicate({
        view: "list",
        listView: "spaces://$kit/#*listView",
        listGroup: "spaces://$kit/#*gridGroup",
        listItem: "spaces://$kit/#*cardsListItem",
      });
    }
    if (type == "catalog") {
      savePredicate({
        view: "list",
        listView: "spaces://$kit/#*listView",
        listGroup: "spaces://$kit/#*rowGroup",
        listItem: "spaces://$kit/#*coverListItem",
      });
    }
    if (type == "gallery") {
      savePredicate({
        view: "list",
        listView: "spaces://$kit/#*listView",
        listGroup: "spaces://$kit/#*masonryGroup",
        listItem: "spaces://$kit/#*imageListItem",
      });
    }
    if (type == "calendar") {
      savePredicate({
        view: "list",
        listView: "spaces://$kit/#*calendarView",
        listGroup: "spaces://$kit/#*dateGroup",
        listItem: "spaces://$kit/#*eventItem",
      });
    }
  };

  const clearFilters = () => {
    savePredicate({
      filters: [],
      sort: [],
    });
  };
  const removeFilter = (filter: Filter, index: number) => {
    const pred = predicate ?? defaultPredicateForSchema(dbSchema);
    const newFilters = [...pred.filters.filter((f, i) => i != index)];
    savePredicate({
      filters: newFilters,
    });
  };

  type LayoutType = {
    name: string;
    icon: string;
    view: string;
    listView: string;
    listGroup: string;
    listItem: string;
  };

  const defaultViewTypes: Record<string, LayoutType> = {
    table: {
      name: i18n.menu.tableView,
      icon: "ui//table",
      view: "table",
      listView: "",
      listGroup: "",
      listItem: "",
    },
    list: {
      name: i18n.menu.listView,
      icon: "ui//list",
      view: "list",
      listView: "spaces://$kit/#*listView",
      listGroup: "spaces://$kit/#*listGroup",
      listItem: "spaces://$kit/#*rowItem",
    },
    details: {
      name: i18n.menu.detailsView,
      icon: "ui//layout-grid",
      view: "list",
      listView: "spaces://$kit/#*listView",
      listGroup: "spaces://$kit/#*listGroup",
      listItem: "spaces://$kit/#*detailItem",
    },
    board: {
      name: i18n.menu.boardView,
      icon: "ui//square-kanban",
      view: "list",
      listView: "spaces://$kit/#*columnView",
      listGroup: "spaces://$kit/#*columnGroup",
      listItem: "spaces://$kit/#*cardListItem",
    },

    cards: {
      name: i18n.menu.cardView,
      icon: "ui//layout-dashboard",
      view: "list",
      listView: "spaces://$kit/#*listView",
      listGroup: "spaces://$kit/#*gridGroup",
      listItem: "spaces://$kit/#*cardsListItem",
    },
    catalog: {
      name: i18n.menu.catalogView,
      icon: "ui//gallery-horizontal-end",
      view: "list",
      listView: "spaces://$kit/#*listView",
      listGroup: "spaces://$kit/#*rowGroup",
      listItem: "spaces://$kit/#*coverListItem",
    },
    gallery: {
      name: i18n.menu.galleryView,
      icon: "ui//layout-dashboard",
      view: "list",
      listView: "spaces://$kit/#*listView",
      listGroup: "spaces://$kit/#*masonryGroup",
      listItem: "spaces://$kit/#*imageListItem",
    },
    flow: {
      name: i18n.menu.flowView,
      icon: "ui//edit",
      view: "list",
      listView: "spaces://$kit/#*listView",
      listGroup: "spaces://$kit/#*listGroup",
      listItem: "spaces://$kit/#*flowListItem",
    },
    day: {
      name: "Day View",
      icon: "ui//calendar",
      view: "day",
      listView: "",
      listGroup: "",
      listItem: "",
    },
    week: {
      name: "Week View",
      icon: "ui//calendar",
      view: "week",
      listView: "",
      listGroup: "",
      listItem: "",
    },
    month: {
      name: "Month View",
      icon: "ui//calendar",
      view: "month",
      listView: "",
      listGroup: "",
      listItem: "",
    },
    // calendar: {
    //   name: i18n.menu.calendarView,
    //   icon: "ui//calendar",
    //   view: "list",
    //   listView: "spaces://$kit/#*calendarView",
    //   listGroup: "spaces://$kit/#*dateGroup",
    //   listItem: "spaces://$kit/#*eventItem",
    // },
    // calendarDay: {
    //   name: i18n.menu.dayView,
    //   icon: "ui//calendar",
    //   view: "list",
    //   listView: "spaces://$kit/#*calendarView",
    //   listGroup: "spaces://$kit/#*dateGroup",
    //   listItem: "spaces://$kit/#*eventItem",
    // },
  };
  const showLayoutMenu = (e: React.MouseEvent) => {
    // Anchor to the bound button, not the clicked SVG child (Notidian-i23).
    const offset = e.currentTarget.getBoundingClientRect();
    const menuOptions: SelectOption[] = [];

    Object.keys(defaultViewTypes).forEach((c) => {
      const layout = defaultViewTypes[c];
      menuOptions.push({
        name: layout.name,
        icon: layout.icon,
        onClick: (e) => {
          savePredicate({
            view: layout.view,
            listView: layout.listView,
            listGroup: layout.listGroup,
            listItem: layout.listItem,
          });
        },
      });
    });
    if (props.superstate.settings.experimental) {
      menuOptions.push({
        name: i18n.menu.customView,
        icon: "ui//brush",
        onClick: (e) => {
          setEditMode(FrameEditorMode.Group);
        },
      });
    }

    return props.superstate.ui.openMenu(
      offset,
      defaultMenu(props.superstate.ui, menuOptions),
      windowFromDocument(e.view.document)
    );
  };

  const selectSource = (offset: Rect, win: Window) => {
    return showSpacesMenu(offset, win, props.superstate, (link: string) => {
      const newSchema = {
        ...frameSchema,
        name: frameSchema.name,
        def: {
          db: defaultContextSchemaID,
          context: link,
        },
        type: "view",
      };
      saveSchema(newSchema).then((f) => setFrameSchema(newSchema));
    });
  };

  const selectList = (offset: Rect, win: Window) => {
    const schemas = props.superstate.contextsIndex.get(source)?.schemas;
    if (!schemas) return;
    const options: SelectOption[] = schemas.map((f) => ({
      name: f.name,
      value: f.id,
      onClick: (e) => {
        const newSchema = {
          ...frameSchema,
          name: frameSchema.name,
          def: {
            db: f.id,
            context: source,
          },
          type: "view",
        };
        saveSchema(newSchema).then((f) => setFrameSchema(newSchema));
      },
    }));
    return props.superstate.ui.openMenu(
      offset,
      defaultMenu(props.superstate.ui, options),
      win
    );
  };

  const [listViewOptions, setListViewOptions] = useState<SpaceProperty[]>([]);
  const [listGroupOptions, setListGroupOptions] = useState<SpaceProperty[]>([]);
  const [listItemOptions, setListItemOptions] = useState<SpaceProperty[]>([]);

  useEffect(() => {
    propertiesForPredicate(predicate, "listView").then((f) =>
      setListViewOptions(f)
    );
    propertiesForPredicate(predicate, "listGroup").then((f) =>
      setListGroupOptions(f)
    );
    propertiesForPredicate(predicate, "listItem").then((f) =>
      setListItemOptions(f)
    );
  }, [predicate]);

  const optionsMenuRef = useRef(null);
  // Export the current view (visible columns in display order, filtered rows)
  // to a CSV file in the space folder (Notidian-7gg). Additive — it only writes
  // a new .csv; existing data is untouched.
  const exportViewToCsv = async () => {
    // Only folder-backed databases have a real write target; tag/builtin spaces
    // are virtual `spaces://` URIs.
    if (!spaceCache?.path || spaceCache.path.startsWith("spaces://")) {
      props.superstate.ui.notify(
        "CSV export is only available for folder-backed databases."
      );
      return;
    }
    const hidden = predicate?.colsHidden ?? [];
    const order = predicate?.colsOrder ?? [];
    const keyOf = (col: { name: string; table?: string }) =>
      col.name + (col.table ?? "");
    const visible = (cols ?? []).filter((col) => !hidden.includes(keyOf(col)));
    // Respect the user's column order (colsOrder), unlisted columns trailing.
    visible.sort((a, b) => {
      const ia = order.indexOf(keyOf(a));
      const ib = order.indexOf(keyOf(b));
      if (ia == -1 && ib == -1) return 0;
      if (ia == -1) return 1;
      if (ib == -1) return -1;
      return ia - ib;
    });
    const columns = visible.map((col) => ({ key: keyOf(col), name: col.name }));
    const rows = (filteredData ?? []) as Record<string, unknown>[];
    if (columns.length == 0 || rows.length == 0) {
      props.superstate.ui.notify("Nothing to export in this view.");
      return;
    }
    const csv = tableToCsv({ columns, rows });
    const baseName = (
      (frameSchema?.name && frameSchema.name.length > 0
        ? frameSchema.name
        : spaceCache?.name) ?? "export"
    ).replace(/[\\/]/g, "-");
    const path = `${spaceCache.path}/${baseName} export.csv`;
    try {
      await props.superstate.spaceManager.writeToPath(path, csv);
      props.superstate.ui.notify(
        `Exported ${rows.length} row${
          rows.length == 1 ? "" : "s"
        } to ${path}.`
      );
    } catch (e) {
      props.superstate.ui.notify("CSV export failed.");
    }
  };

  const importCsvFile = (win: Window) => {
    // Same folder-backed guard as export: virtual spaces:// have no file target.
    if (!spaceCache?.path || spaceCache.path.startsWith("spaces://")) {
      props.superstate.ui.notify(
        "CSV import is only available for folder-backed databases."
      );
      return;
    }
    const space = props.superstate.spacesIndex.get(spaceCache.path);
    if (!space) {
      props.superstate.ui.notify("Could not resolve the target database.");
      return;
    }
    // Headers map to primary-table columns by name; collisions are previewed
    // against the rows already in view (execution auto-renames regardless).
    const existingColumnNames = (cols ?? [])
      .filter((c) => (c.table ?? "") == "")
      .map((c) => c.name);
    const existingRowTitles = (filteredData ?? [])
      .map((r) => {
        const p = r[PathPropertyName];
        return typeof p == "string" ? pageTitleFromPath(p) : null;
      })
      .filter((x): x is string => !!x);
    props.superstate.ui.openModal(
      "Import from CSV",
      <CsvImportModal
        superstate={props.superstate}
        existingColumnNames={existingColumnNames}
        existingRowTitles={existingRowTitles}
        onImport={async (plan) => {
          const result = await executeCsvImport({
            superstate: props.superstate,
            space,
            plan,
            cols: cols ?? [],
          });
          await reloadContextData();
          props.superstate.ui.notify(
            `Imported ${result.created} row${
              result.created == 1 ? "" : "s"
            }${result.failed > 0 ? ` (${result.failed} failed)` : ""}.`
          );
        }}
      />,
      win
    );
  };

  const showViewOptionsMenu = async (
    e?: React.MouseEvent,
    update?: boolean
  ) => {
    const menuOptions: SelectOption[] = [];

    if (!readMode) {
      menuOptions.push(
        menuInput(
          frameSchema.name ?? "",
          (value) => saveSchema({ ...frameSchema, name: value }),
          ""
        )
      );
      menuOptions.push(menuSeparator);

      menuOptions.push({
        name: i18n.menu.properties,
        icon: "ui//list",
        type: SelectOptionType.Submenu,

        onSubmenu: (offset, onHide) => {
          return showPropertyEditMenu(
            offset,
            windowFromDocument(e.view.document),
            onHide
          );
        },
      });
    }
    // De-dup / single home (bd Notidian-vrmf): Group-By already moved to a
    // dedicated inline toolbar button (Notidian-nmr) and is not re-listed here.
    // When the inline view-settings bar is enabled (default-ON kill-switch
    // `viewSettingsInlineBar`), Filter and Sort likewise have their SINGLE HOME
    // inline, so they are dropped from this 3-knobs overflow menu — no control
    // appears both inside AND outside the menu. The KILL-SWITCH (flag OFF)
    // restores the legacy duplication: Sort By + Filters reappear here.
    if (!inlineBarEnabled) {
      menuOptions.push({
        name: i18n.menu.sortBy,
        icon: "ui//sort-desc",
        type: SelectOptionType.Submenu,
        onSubmenu: (offset, onHide) => {
          return showSortMenu(
            offset,
            windowFromDocument(e.view.document),
            onHide
          );
        },
      });
      menuOptions.push({
        name: i18n.menu.filters,
        icon: "ui//filter",
        type: SelectOptionType.Submenu,
        onSubmenu: (rect, onHide) => {
          return showAddFilterMenu(
            rect,
            windowFromDocument(e.view.document),
            onHide
          );
        },
      });

      menuOptions.push(menuSeparator);
    }
    menuOptions.push({
      name: predicate?.chart?.visible ? "Hide chart" : "Show chart",
      icon: "ui//bar-chart",
      onClick: () => {
        savePredicate({
          chart: {
            visible: !predicate?.chart?.visible,
            groupKey: predicate?.chart?.groupKey ?? "",
            aggregate: predicate?.chart?.aggregate ?? "count",
            valueKey: predicate?.chart?.valueKey,
          },
        });
      },
    });
    // Sub-items, whole surface (bd Notidian-8k9b): gated to the PRIMARY files
    // schema. The tree only forms when each child's parent link materializes into
    // its row, and that materialization (filesystemAdapter syncContextRow) runs
    // ONLY for schema == defaultContextSchemaID. On a non-files/custom db table no
    // parent link is ever written back, so designating a column (or reusing an
    // existing eligible one) would set predicate.subItems.field and render the
    // chevron/indent/+Add affordance while the tree stays permanently flat — a
    // silent dead feature. We therefore hide the entire Sub-items block off-primary
    // (the entry AND its display/scope/collapse/repair/add-children dependents),
    // not just the "Turn on sub-items" create option — mirroring the offerCreate
    // gate and the row-menu "Add sub-item" gate (rowContextMenu.tsx). Hiding the
    // whole entry (vs. a dead-end "None") avoids both an empty submenu and an
    // orphaned active config surfacing display/scope submenus where it can't work.
    if (dbSchema?.id == defaultContextSchemaID) {
    menuOptions.push({
      name: "Sub-items",
      icon: "ui//rows",
      type: SelectOptionType.Disclosure,
      value: predicate?.subItems?.field
        ? (filteredCols.find(
            (f) => f.name + f.table == predicate.subItems.field
          )?.name ?? predicate.subItems.field)
        : i18n.menu.none,
      onClick: (e) => {
        // Anchor the submenu to the menu row (currentTarget), not the clicked
        // glyph within it (Notidian-i23).
        const offset = e.currentTarget.getBoundingClientRect();
        // Sub-items follows a relation/link column whose links point at each
        // row's parent row in THIS table — a self-relation. Only primary-table
        // columns (table == "") qualify; a linked-context column points at
        // another space's rows and can never form the tree.
        const eligible = filteredCols.filter(
          (f) =>
            (f.table ?? "") == "" &&
            (f.type?.startsWith("link") || f.type?.startsWith("context"))
        );
        // Front-door (bd Notidian-xqxc): when there is no column to designate,
        // the submenu would dead-end at "None" — sub-items could never be turned
        // on. Offer a one-click "Turn on sub-items" that creates a
        // frontmatter-backed parent-link column AND sets the predicate in one
        // action. DEFAULT-ON / KILL-SWITCH: settings.subItemsSetup === false
        // restores the byte-for-byte legacy submenu.
        //
        // The primary-files-schema gate now lives on the whole Sub-items block
        // above (bd Notidian-8k9b) — the created link column, and equally any
        // reused/designated eligible column, only round-trips when saveColumn
        // frontmatter-materializes the row's parent link, which happens solely on
        // dbSchema.id == defaultContextSchemaID. So offerCreate no longer repeats
        // the schema check: it is only reached on the primary schema.
        const offerCreate =
          props.superstate.settings.subItemsSetup && eligible.length === 0;
        props.superstate.ui.openMenu(
          offset,
          {
            ui: props.superstate.ui,
            multi: false,
            editable: false,
            value: predicate?.subItems?.field
              ? [predicate.subItems.field]
              : [""],
            options: [
              { name: i18n.menu.none, value: "" },
              ...(offerCreate
                ? [
                    {
                      name: i18n.menu.turnOnSubItems,
                      icon: "ui//plus",
                      value: "__create__",
                    },
                  ]
                : []),
              ...eligible.map((f) => ({
                name: f.name + f.table,
                icon: stickerForField(f),
                value: f.name + f.table,
              })),
            ],
            saveOptions: (_: string[], value: string[]) => {
              // One-click create-and-enable through the single front-door helper.
              if (value[0] == "__create__") {
                enableSubItemsWithColumn({
                  cols,
                  saveColumn,
                  savePredicate,
                  currentSubItems: predicate?.subItems,
                  schemaId: dbSchema?.id,
                });
                return;
              }
              const field = value[0] ?? "";
              // Spread the existing subItems so re-picking the parent column
              // keeps the view's display/filterScope/collapsed keys (ADR 0050);
              // clearing the field disables sub-items entirely.
              savePredicate({
                subItems: field
                  ? { ...predicate?.subItems, field }
                  : undefined,
              });
            },
            searchable: false,
            showAll: true,
          },
          windowFromDocument(e.view.document)
        );
      },
    });
    // Expand/collapse all sub-items (Notidian-5ond.3) — only when sub-items is
    // active for this view. Collapse state persists in predicate.subItems.collapsed.
    if (predicate?.subItems?.field) {
      // Display mode (Notidian-5ond.4): nested tree / flattened / parents-only.
      const displayMode = predicate.subItems.display ?? "nested";
      const displayLabel: Record<string, string> = {
        nested: i18n.menu.subItemsNested,
        flattened: i18n.menu.subItemsFlattened,
        "parents-only": i18n.menu.subItemsParentsOnly,
      };
      menuOptions.push({
        name: i18n.menu.subItemsDisplay,
        icon: "ui//layout-list",
        type: SelectOptionType.Disclosure,
        value: displayLabel[displayMode],
        onClick: (e) => {
          const offset = e.currentTarget.getBoundingClientRect();
          props.superstate.ui.openMenu(
            offset,
            {
              ui: props.superstate.ui,
              multi: false,
              editable: false,
              searchable: false,
              showAll: true,
              value: [displayMode],
              options: [
                { name: i18n.menu.subItemsNested, value: "nested" },
                { name: i18n.menu.subItemsFlattened, value: "flattened" },
                { name: i18n.menu.subItemsParentsOnly, value: "parents-only" },
              ],
              saveOptions: (_: string[], value: string[]) => {
                // validateSubItems drops display==="nested" so the stored
                // predicate stays clean; spread keeps field/filterScope/collapsed.
                savePredicate({
                  subItems: {
                    ...predicate.subItems,
                    display: value[0] as any,
                  },
                });
              },
            },
            windowFromDocument(e.view.document)
          );
        },
      });
      // Filter scope (Notidian-5ond.5): how the view's filters interact with the
      // hierarchy. Inert in flattened mode (no tree to scope), so hide it there.
      if (displayMode !== "flattened") {
        const filterScope =
          predicate.subItems.filterScope ?? "parentsAndSubItems";
        const scopeLabel: Record<string, string> = {
          parentsAndSubItems: i18n.menu.subItemsScopeParentsAndSubItems,
          parents: i18n.menu.subItemsScopeParents,
          subItems: i18n.menu.subItemsScopeSubItems,
        };
        menuOptions.push({
          name: i18n.menu.subItemsScope,
          icon: "ui//filter",
          type: SelectOptionType.Disclosure,
          value: scopeLabel[filterScope],
          onClick: (e) => {
            const offset = e.currentTarget.getBoundingClientRect();
            props.superstate.ui.openMenu(
              offset,
              {
                ui: props.superstate.ui,
                multi: false,
                editable: false,
                searchable: false,
                showAll: true,
                value: [filterScope],
                options: [
                  {
                    name: i18n.menu.subItemsScopeParentsAndSubItems,
                    value: "parentsAndSubItems",
                  },
                  { name: i18n.menu.subItemsScopeParents, value: "parents" },
                  { name: i18n.menu.subItemsScopeSubItems, value: "subItems" },
                ],
                saveOptions: (_: string[], value: string[]) => {
                  savePredicate({
                    subItems: {
                      ...predicate.subItems,
                      filterScope: value[0] as any,
                    },
                  });
                },
              },
              windowFromDocument(e.view.document)
            );
          },
        });
      }
      menuOptions.push({
        name: i18n.menu.collapseAllSubItems,
        icon: "ui//chevrons-down-up",
        onClick: () => setSubItemsCollapsedAll(true),
      });
      menuOptions.push({
        name: i18n.menu.expandAllSubItems,
        icon: "ui//chevrons-up-down",
        onClick: () => setSubItemsCollapsedAll(false),
      });
      // Heal pre-fix bare parent links (Notidian-4xza): re-qualify any child whose
      // parent link is orphaned but uniquely matches an in-table parent.
      if (subItemsField && subItemsParentKey) {
        menuOptions.push({
          name: i18n.menu.repairSubItemLinks,
          icon: "ui//tool",
          onClick: async () => {
            const { repaired } = await repairSubItemLinks({
              superstate: props.superstate,
              rows: filteredData,
              subItemsField,
              parentKey: subItemsParentKey,
            });
            props.superstate.ui.notify(
              repaired > 0
                ? `Repaired ${repaired} sub-item link${repaired === 1 ? "" : "s"}`
                : "No sub-item links needed repair"
            );
          },
        });
        // One-click read-only "Children" backlink column (Notidian-bk7e): the
        // relation a percent rollup aggregates over for "% of children done".
        menuOptions.push({
          name: i18n.menu.addChildrenColumn,
          icon: "ui//links-coming-in",
          onClick: () => {
            const { created, name } = addSubItemChildrenColumn({
              cols,
              saveColumn,
              subItemsField,
              schemaId: dbSchema?.id,
            });
            props.superstate.ui.notify(
              name
                ? created
                  ? `Added "${name}" children column`
                  : `"${name}" children column already exists`
                : "Could not add children column"
            );
          },
        });
      }
    }
    } // end primary-files-schema gate for the Sub-items block (bd Notidian-8k9b)
    menuOptions.push({
      name: "Import from CSV",
      icon: "ui//upload",
      onClick: (e) => {
        importCsvFile(windowFromDocument(e.view.document));
      },
    });
    menuOptions.push({
      name: "Export to CSV",
      icon: "ui//download",
      onClick: () => {
        void exportViewToCsv();
      },
    });

    menuOptions.push({
      name: i18n.labels.limit,
      icon: "ui//hash",
      type: SelectOptionType.Disclosure,
      value:
        predicate?.limit > 0 ? predicate.limit.toString() : i18n.labels.showAll,
      onClick: (e) => {
        // Anchor the submenu to the menu row (currentTarget), not the clicked
        // glyph within it (Notidian-i23).
        const offset = e.currentTarget.getBoundingClientRect();
        const limitOptions = [0, 10, 25, 50, 100, 200, 500];
        const currentLimit = predicate?.limit?.toString() ?? "0";

        // Include current limit in options if it's not already there
        const allOptions = limitOptions.includes(predicate?.limit)
          ? limitOptions
          : [...limitOptions, predicate?.limit].sort((a, b) => a - b);

        props.superstate.ui.openMenu(
          offset,
          {
            ui: props.superstate.ui,
            multi: false,
            editable: true,
            value: [currentLimit],
            options: allOptions.map((limit) => ({
              name: limit === 0 ? i18n.labels.showAll : limit.toString(),
              value: limit.toString(),
            })),
            saveOptions: (_: string[], value: string[]) => {
              const limitValue = parseInt(value[0]) || 0;
              savePredicate({
                limit: limitValue >= 0 ? limitValue : 0,
              });
            },
            placeholder: "Enter a number or select",
            searchable: true,
            showAll: true,
          },
          windowFromDocument(e.view.document)
        );
      },
    });

    menuOptions.push({
      name: "",
      type: SelectOptionType.Custom,
      fragment: (props: { hide: () => void }) => (
        <TableDirectionMenuComponent
          tableDirection={predicate?.tableDirection ?? "ltr"}
          setTableDirection={(tableDirection: TableDirection) =>
            savePredicate({ tableDirection })
          }
          hide={props.hide}
        />
      ),
    });

    menuOptions.push(menuSeparator);

    const sourceSpace = props.superstate.spacesIndex.get(source);
    menuOptions.push({
      name: i18n.labels.source,
      icon: "ui//table",
      type: SelectOptionType.Disclosure,
      value: sourceSpace.name,
      onSubmenu: (rect, onHide) => {
        return selectSource(rect, windowFromDocument(e.view.document));
      },
    });

    const table = dbSchema.name;
    menuOptions.push({
      name: i18n.labels.list,
      icon: "ui//table",
      type: SelectOptionType.Disclosure,
      value: table,
      onSubmenu: (rect, onHide) => {
        return selectList(rect, windowFromDocument(e.view.document));
      },
    });

    menuOptions.push(menuSeparator);

    const savePropValue = (
      type: "listGroupProps" | "listViewProps" | "listItemProps",
      prop: string,
      value: string
    ) => {
      savePredicate({
        [type]: {
          ...predicate[type],
          [prop]: value,
        },
      });
    };
    if (dbSchema?.primary == "true") {
      const displayProperty = displayPropertyForPredicate(predicate);
      const persistedDisplayOptions = filteredCols.filter(
        (f) => f.primary != "true" && !f.table
      );
      // Frontmatter keys that were never persisted as columns are equally
      // valid display properties (labels resolve from the frontmatter cache).
      const displayPropertyOptions = [
        ...persistedDisplayOptions,
        ...discoverFrontmatterPropertiesFromPathStates(
          props.superstate.pathsIndex,
          [...(props.superstate.spacesMap.getInverse(spaceCache.path) ?? [])],
          props.superstate.settings,
          [...filteredCols, ...persistedDisplayOptions]
        ),
      ];
      menuOptions.push({
        name: i18n.menu.displayProperty,
        icon: "ui//type",
        type: SelectOptionType.Disclosure,
        value: displayProperty ?? i18n.menu.none,
        onClick: (e) => {
          // Anchor the submenu to the menu row (currentTarget), not the clicked
          // glyph within it (Notidian-i23).
          const offset = e.currentTarget.getBoundingClientRect();
          props.superstate.ui.openMenu(
            offset,
            {
              ui: props.superstate.ui,
              multi: false,
              editable: false,
              value: [displayProperty ?? ""],
              options: [
                {
                  name: i18n.menu.none,
                  value: "",
                  icon: "ui//file",
                },
                ...displayPropertyOptions.map((f) => ({
                  name: f.name,
                  value: f.name,
                  icon: stickerForField(f),
                })),
              ],
              saveOptions: (_: string[], value: string[]) => {
                savePropValue(
                  "listViewProps",
                  "displayProperty",
                  value[0] ?? ""
                );
              },
              placeholder: i18n.labels.propertyItemSelectPlaceholder,
              searchable: true,
              showAll: true,
            },
            windowFromDocument(e.view.document)
          );
        },
      });
      // bd Notidian-543/sxs1: per-item display-property picker (Notion
      // "Properties" parity). Surface it on EVERY fieldsView-based layout that
      // actually renders the full `_properties` array — Cards, Board, and
      // Details (cardsListItem/cardListItem/detailItem) — not just the plain
      // list. The picker is keyed on `predicate.listItem` (the frame), NOT
      // `predicate.view` (every fieldsView layout shares view=="list"), so the
      // gate excludes layouts where it would be a dead control (rowItem plain
      // list, cover/image/flow which render specific named fields). The render
      // half (applyListItemVisibleProperties on the `_properties` chokepoint) is
      // already live and itself view-agnostic; this only widens the menu trigger.
      if (shouldShowListItemPropertyPicker(predicate)) {
        menuOptions.push({
          name: i18n.menu.itemProperties,
          icon: "ui//list",
          type: SelectOptionType.Submenu,
          onSubmenu: (rect, onHide) => {
            return showItemPropertiesMenu(
              rect,
              windowFromDocument(e.view.document),
              onHide
            );
          },
        });
      }
    }
    listViewOptions.forEach((f) => {
      menuOptions.push({
        name: nameForField(f),
        icon: stickerForField(f),
        type: SelectOptionType.Disclosure,
        value: predicate.listViewProps?.[f.name],
        onClick: (e) => {
          showSetValueMenu(
            // Anchor to the menu row, not the clicked glyph (Notidian-i23).
            e.currentTarget.getBoundingClientRect(),
            windowFromDocument(e.view.document),
            props.superstate,
            predicate.listViewProps?.[f.name],
            f,
            (value) =>
              savePropValue(
                "listViewProps",
                f.name,
                parseMDBStringValue(f.type, value, true)
              ),
            spaceCache.path,
            dbSchema.id
          );
        },
      });
    });
    listGroupOptions.forEach((f) => {
      menuOptions.push({
        name: nameForField(f),
        icon: stickerForField(f),
        type: SelectOptionType.Disclosure,
        value: predicate.listGroupProps?.[f.name],
        onClick: (e) => {
          showSetValueMenu(
            // Anchor to the menu row, not the clicked glyph (Notidian-i23).
            e.currentTarget.getBoundingClientRect(),
            windowFromDocument(e.view.document),
            props.superstate,
            predicate.listGroupProps?.[f.name],
            f,

            (value) =>
              savePropValue(
                "listGroupProps",
                f.name,
                parseMDBStringValue(f.type, value, true)
              ),
            spaceCache.path,
            dbSchema.id
          );
        },
      });
    });
    listItemOptions.forEach((f) => {
      menuOptions.push({
        name: nameForField(f),
        icon: stickerForField(f),
        type: SelectOptionType.Disclosure,
        value: predicate.listItemProps?.[f.name],
        onClick: (e) => {
          showSetValueMenu(
            // Anchor to the menu row, not the clicked glyph (Notidian-i23).
            e.currentTarget.getBoundingClientRect(),
            windowFromDocument(e.view.document),
            props.superstate,
            predicate.listItemProps?.[f.name],
            f,
            (value) =>
              savePropValue(
                "listItemProps",
                f.name,
                parseMDBStringValue(f.type, value, true)
              ),
            spaceCache.path,
            dbSchema.id
          );
        },
      });
    });

    if (update) {
      optionsMenuRef.current?.update(
        defaultMenu(props.superstate.ui, menuOptions)
      );
      return;
    }
    // Anchor to the bound button (currentTarget), NOT the clicked node
    // (e.target). The toolbar buttons render their icon via
    // dangerouslySetInnerHTML SVG, so e.target resolves to whichever SVG child
    // (svg/path/g) the pointer landed on — each with a different rect — making
    // the menu jump to the click position (Notidian-i23). currentTarget is
    // always the <button> this handler is bound to, so the anchor is stable.
    const offset = e.currentTarget.getBoundingClientRect();
    optionsMenuRef.current = props.superstate.ui.openMenu(
      offset,
      defaultMenu(props.superstate.ui, menuOptions),
      windowFromDocument(e.view.document),
      null,
      () => {
        optionsMenuRef.current = null;
      }
    );
  };

  useEffect(() => {
    if (optionsMenuRef.current) {
      showViewOptionsMenu(null, true);
    }
  }, [predicate]);

  const addSort = (_: string[], sort: string[]) => {
    const field = sort[0];
    const fieldObject = filteredCols.find((f) => f.name + f.table == field);
    const fieldType = fieldTypeForField(fieldObject);
    if (fieldType) {
      const type = defaultPredicateFnForType(fieldType, sortFnTypes);
      const newSort: Sort = {
        field,
        fn: type,
      };
      savePredicate({
        sort: [
          ...(predicate?.sort.filter((s) => s.field != newSort.field) ?? []),
          newSort,
        ],
      });
    }
  };

  const saveGroupBy = (_: string[], groupBy: string[]) => {
    savePredicate({
      groupBy: groupBy,
    });
  };

  const removeSort = (sort: Sort) => {
    const newSort = [
      ...(predicate?.sort ?? []).filter((f) => f.field != sort.field),
    ];
    savePredicate({
      sort: newSort,
    });
  };
  const addFilter = (field: string) => {
    const fieldObject = filteredCols.find((f) => f.name + f.table == field);
    const fieldType = fieldTypeForField(fieldObject);
    if (fieldType) {
      const type = defaultPredicateFnForType(fieldType, filterFnTypes);
      if (!type) return;
      const newFilter: Filter =
        fieldType == "boolean"
          ? {
              field,
              fn: type,
              fType: filterFnTypes[type].valueType,
              value: "true",
            }
          : {
              field,
              fn: type,
              fType: filterFnTypes[type].valueType,
              value: "",
            };
      savePredicate({
        filters: [...(predicate?.filters ?? []), newFilter],
      });
    }
  };

  const changeSortMenu = (e: React.MouseEvent, sort: Sort) => {
    // Anchor to the bound element, not the clicked child (Notidian-i23).
    const offset = e.currentTarget.getBoundingClientRect();
    const saveSort = (_: string[], newType: string[]) => {
      const type = newType[0];
      const newSort: Sort = {
        ...sort,
        fn: type,
      };
      savePredicate({
        sort: [
          ...(predicate?.sort ?? []).filter((s) => s.field != newSort.field),
          newSort,
        ],
      });
    };
    const fieldObject = filteredCols.find(
      (f) => f.name + f.table == sort.field
    );
    const fieldType = fieldTypeForField(fieldObject);
    const sortsForType = predicateFnsForType(fieldType, sortFnTypes);
    props.superstate.ui.openMenu(
      offset,
      {
        ui: props.superstate.ui,
        multi: false,
        editable: false,
        value: [],
        options: sortsForType.map((f) => ({
          name: sortFnTypes[f].label,
          value: f,
        })),
        saveOptions: saveSort,
        placeholder: i18n.labels.sortItemSelectPlaceholder,
        searchable: false,
        showAll: true,
      },
      windowFromDocument(e.view.document)
    );
  };

  const changeFilterMenu = (
    e: React.MouseEvent,
    filter: Filter,
    index: number
  ) => {
    // Anchor to the bound element, not the clicked child (Notidian-i23).
    const offset = e.currentTarget.getBoundingClientRect();
    const saveFilter = (_: string[], newType: string[]) => {
      const type = newType[0];
      const newFilter: Filter = {
        ...filter,
        fn: type,
        fType: filterFnTypes[type].valueType,
      };
      savePredicate({
        filters: (predicate?.filters ?? []).map((s, i) =>
          i == index ? newFilter : s
        ),
      });
    };
    const field = filteredCols.find((f) => f.name + f.table == filter.field);
    const fieldType = fieldTypeForField(field);
    const filtersForType = predicateFnsForType(fieldType, filterFnTypes);
    props.superstate.ui.openMenu(
      offset,
      {
        ui: props.superstate.ui,
        multi: false,
        editable: false,
        value: [],
        options: filtersForType.map((f) => ({
          name: filterFnLabels[f],
          value: f,
        })),
        saveOptions: saveFilter,
        placeholder: i18n.labels.filterItemSelectPlaceholder,
        searchable: false,
        showAll: true,
      },
      windowFromDocument(e.view.document)
    );
  };

  const showAddFilterMenu = (offset: Rect, win: Window, onHide: () => void) => {
    const options: SelectOption[] = filteredCols
      .filter(
        (f) =>
          f.type == "fileprop" ||
          predicateFnsForType(f.type, filterFnTypes).length > 0
      )
      .map((f) => ({
        name: f.name + f.table,
        value: f.name + f.table,
        icon: stickerForField(f),
        onClick: (e) => {
          addFilter(f.name + f.table);
        },
      }));
    options.push(menuSeparator);

    options.push({
      name: i18n.menu.clearFilters,
      icon: "ui//x-square",
      onClick: (e) => {
        clearFilters();
      },
    });

    return props.superstate.ui.openMenu(
      offset,
      {
        ui: props.superstate.ui,
        multi: false,
        editable: false,
        value: [],
        options: options,
        placeholder: i18n.labels.propertyItemSelectPlaceholder,
        searchable: true,
        showAll: true,
      },
      win,
      null,
      onHide
    );
  };
  const showSortMenu = (offset: Rect, win: Window, onHide: () => void) => {
    return props.superstate.ui.openMenu(
      offset,
      {
        ui: props.superstate.ui,
        multi: false,
        editable: false,
        value: [],
        options: filteredCols.map((f) => ({
          name: f.name + f.table,
          icon: stickerForField(f),
          value: f.name + f.table,
        })),
        saveOptions: addSort,
        placeholder: i18n.labels.sortItemSelectPlaceholder,
        searchable: true,
        showAll: true,
      },
      win,
      "right",
      onHide
    );
  };

  const saveField = (field: SpaceTableColumn, oldField: SpaceTableColumn) => {
    if (field.name.length > 0) {
      if (
        field.name != oldField.name ||
        field.type != oldField.type ||
        field.value != oldField.value ||
        field.attrs != oldField.attrs
      ) {
        const saveResult = saveColumn(field, oldField);
      }
    }
  };

  const saveNewField = (source: string, field: SpaceProperty) => {
    return saveColumn({ ...field, table: "" });
  };

  const showPropertyEditMenu = (
    offset: Rect,
    win: Window,
    onHide: () => void
  ) => {
    const showPropertyEditorMenu = (
      f: SpaceTableColumn,
      offset: Rect,
      onHide: () => void
    ) => {
      return showPropertyMenu(
        {
          superstate: props.superstate,
          rect: offset,
          editable: f.primary != "true",
          win,
          options: [],
          field: f,
          fields: filteredCols,
          contextPath: spaceCache.path,
          saveField: (newField) => saveField(newField, f),
          hide: hideColumn,
          deleteColumn: delColumn,
          hidden: predicate?.colsHidden.includes(f.name + f.table),
        },
        onHide,
        true
      );
    };
    return showPropertyVisibilityMenu(
      props.superstate,
      offset,
      win,
      {
        cols: filteredCols,
        colsOrder: predicate?.colsOrder ?? [],
        colsHidden: predicate?.colsHidden ?? [],
        savePredicate,
        editProperty: (col, rect) =>
          showPropertyEditorMenu(col, rect, () => null),
        newProperty: (rect) =>
          showNewPropertyMenu(
            props.superstate,
            rect,
            win,
            {
              spaces: [],
              fields: [],
              saveField: saveNewField,
              schemaId: dbSchema.id,
              contextPath: spaceCache.path,
            },
            () => null
          ),
      },
      onHide
    );
  };

  // bd Notidian-543 (flag-gated): per-item display-property picker for LIST view
  // (Notion "Properties" parity). Reuses showPropertyVisibilityMenu unchanged by
  // adapting between its (colsHidden/colsOrder) contract and the allowlist stored
  // in predicate.listItemProps.visibleProperties. The render half is gated behind
  // the default-ON kill-switch listItemPropertyPicker setting; this menu only ever writes
  // VIEW CONFIG (listItemProps) via savePredicate — never row data (ADR 0016).
  const showItemPropertiesMenu = (
    offset: Rect,
    win: Window,
    onHide: () => void
  ) => {
    const menuCols = filteredCols.filter((f) => f.primary != "true");
    const seed = listItemPropsToMenuState(menuCols, predicate);
    // Translate the visibility menu's saved (colsHidden/colsOrder) into the
    // allowlist and persist it under listItemProps — never colsHidden/colsOrder
    // (those drive the TABLE column visibility, a different concern).
    const saveItemProperties = (next: Partial<Predicate>) => {
      const colsHidden = next.colsHidden ?? seed.colsHidden;
      const colsOrder = next.colsOrder ?? seed.colsOrder;
      const visibleProperties = menuStateToVisibleProperties(menuCols, {
        colsHidden,
        colsOrder,
      });
      savePredicate({
        listItemProps: {
          ...predicate.listItemProps,
          visibleProperties,
        },
      });
    };
    return showPropertyVisibilityMenu(
      props.superstate,
      offset,
      win,
      {
        cols: menuCols,
        colsOrder: seed.colsOrder,
        colsHidden: seed.colsHidden,
        savePredicate: saveItemProperties,
        // Part A (Notidian-r6oj): per-row "Remove property" uses the SAME
        // delColumn the table-column header menu uses (see showPropertyEditMenu),
        // so deletion semantics are identical — a Notidian-owned column is
        // removed from the MDB schema + rows; a frontmatter-backed column shows
        // no remove button (the menu gates on canDeletePropertyColumn). This
        // touches the database (column existence), distinct from the allowlist
        // that saveItemProperties persists as VIEW CONFIG (ADR 0016).
        deleteColumn: delColumn,
        // Part B (Notidian-r6oj): make the "+ New Property" row reachable from
        // the Item Properties picker on Cards/Board/Details — mirror the table
        // path's newProperty wiring exactly so new properties persist via the
        // same durable saveColumn path.
        newProperty: (rect) =>
          showNewPropertyMenu(
            props.superstate,
            rect,
            win,
            {
              spaces: [],
              fields: [],
              saveField: saveNewField,
              schemaId: dbSchema.id,
              contextPath: spaceCache.path,
            },
            () => null
          ),
      },
      onHide
    );
  };

  const showGroupByMenu = (offset: Rect, win: Window, onHide: () => void) => {
    return props.superstate.ui.openMenu(
      offset,
      {
        ui: props.superstate.ui,
        multi: false,
        editable: false,
        value: [],
        options: filteredCols.map((f) => ({
          name: f.name + f.table,
          icon: stickerForField(f),
          value: f.name + f.table,
        })),
        saveOptions: saveGroupBy,
        placeholder: i18n.labels.propertyItemSelectPlaceholder,
        searchable: false,
        showAll: true,
      },
      win,
      "right",
      onHide
    );
  };

  const selectFilterValue = (
    e: React.MouseEvent,
    filter: Filter,
    index: number
  ) => {
    switch (filter.fType ?? filterFnTypes[filter.fn].valueType) {
      case "property":
        {
          savePredicate({
            filters: (predicate?.filters ?? []).map((s, i) =>
              i == index ? filter : s
            ),
          });
        }
        break;
      case "text":
      case "number":
        {
          savePredicate({
            filters: (predicate?.filters ?? []).map((s, i) =>
              i == index ? filter : s
            ),
          });
        }
        break;
      case "date": {
        const saveValue = (date: Date) => {
          const newFilter: Filter = {
            ...filter,
            value: date ? formatDate(props.superstate.settings, date) : "",
          };
          savePredicate({
            filters: (predicate?.filters ?? []).map((s, i) =>
              i == index ? newFilter : s
            ),
          });
        };
        // Anchor to the bound element, not the clicked child (Notidian-i23).
        const offset = e.currentTarget.getBoundingClientRect();

        const date = new Date(filter.value);
        showDatePickerMenu(
          props.superstate.ui,
          offset,
          windowFromDocument(e.view.document),
          date.getTime() ? date : null,
          saveValue,
          DatePickerTimeMode.None
        );
        break;
      }
      case "link":
        {
          const col = cols.find((f) => f.name + f.table == filter.field);
          if (col?.type.startsWith("context")) {
            const space = parseFieldValue(col.value, col.type)?.space;
            if (!space) return;

            const contextData = props.superstate.getSpaceItems(space) ?? [];
            // Anchor to the bound element, not the clicked child (Notidian-i23).
            const offset = e.currentTarget.getBoundingClientRect();
            props.superstate.ui.openMenu(
              offset,
              {
                ui: props.superstate.ui,
                multi: false,
                editable: false,
                value: parseMultiString(filter.value),
                options:
                  contextData.map((f) => ({
                    name: f.name,
                    value: f.path,
                  })) ?? [],
                saveOptions: (options: string[], values: string[]) => {
                  const newFilter: Filter = {
                    ...filter,
                    value: values[0],
                  };
                  savePredicate({
                    filters: (predicate?.filters ?? []).map((s, i) =>
                      i == index ? newFilter : s
                    ),
                  });
                },
                placeholder: i18n.labels.optionItemSelectPlaceholder,
                searchable: true,
                showAll: true,
              },
              windowFromDocument(e.view.document)
            );
            return;
          }
          const saveValue = (link: string) => {
            const newFilter: Filter = {
              ...filter,
              value: link,
            };
            savePredicate({
              filters: (predicate?.filters ?? []).map((s, i) =>
                i == index ? newFilter : s
              ),
            });
          };
          // Anchor to the bound element, not the clicked child (Notidian-i23).
          const offset = e.currentTarget.getBoundingClientRect();
          showLinkMenu(
            offset,
            windowFromDocument(e.view.document),
            props.superstate,
            (link) => {
              if (isString(link)) {
                saveValue(link);
              }
            },
            { multi: true }
          );
          e.stopPropagation();
        }
        break;
      case "list":
        {
          const col = cols.find((f) => f.name + f.table == filter.field);
          const saveOptions = (options: string[], values: string[]) => {
            const newFilter: Filter = {
              ...filter,
              value: serializeMultiString(values),
            };
            savePredicate({
              filters: (predicate?.filters ?? []).map((s, i) =>
                i == index ? newFilter : s
              ),
            });
          };
          if (col.type.startsWith("option")) {
            // Anchor to the bound element, not the clicked child (Notidian-i23).
            const offset = e.currentTarget.getBoundingClientRect();
            const options = parseFieldValue(col.value, col.type).options;

            props.superstate.ui.openMenu(
              offset,
              {
                ui: props.superstate.ui,
                multi: true,
                editable: false,
                value: parseMultiString(filter.value),
                options: options ?? [],
                saveOptions,
                placeholder: i18n.labels.optionItemSelectPlaceholder,
                searchable: true,
                showAll: true,
              },
              windowFromDocument(e.view.document)
            );
          } else if (col.type.startsWith("context")) {
            const space = parseFieldValue(col.value, col.type)?.space;
            if (!space) return;
            const contextData = props.superstate.getSpaceItems(space) ?? [];
            // Anchor to the bound element, not the clicked child (Notidian-i23).
            const offset = e.currentTarget.getBoundingClientRect();
            props.superstate.ui.openMenu(
              offset,
              {
                ui: props.superstate.ui,
                multi: true,
                editable: false,
                value: parseMultiString(filter.value),
                options:
                  contextData.map((f) => ({
                    name: f.name,
                    value: f.path,
                  })) ?? [],
                saveOptions,
                placeholder: i18n.labels.optionItemSelectPlaceholder,
                searchable: true,
                showAll: true,
              },
              windowFromDocument(e.view.document)
            );
          } else if (col.type.startsWith("link")) {
            // Anchor to the bound element, not the clicked child (Notidian-i23).
            const offset = e.currentTarget.getBoundingClientRect();
            showLinkMenu(
              offset,
              windowFromDocument(e.view.document),
              props.superstate,
              (link: string[]) => {
                saveOptions(link, link);
              },
              { multi: true, value: parseMultiString(filter.value) }
            );
            e.stopPropagation();
          } else if (col.type.startsWith("tags")) {
            const contextData = props.superstate.spaceManager.readTags();
            // Anchor to the bound element, not the clicked child (Notidian-i23).
            const offset = e.currentTarget.getBoundingClientRect();
            props.superstate.ui.openMenu(
              offset,
              {
                ui: props.superstate.ui,
                multi: true,
                editable: false,
                value: parseMultiString(filter.value),
                options:
                  contextData.map((f) => ({
                    name: f,
                    value: f,
                  })) ?? [],
                saveOptions,
                placeholder: i18n.labels.tagItemSelectPlaceholder,
                searchable: true,
                showAll: true,
              },
              windowFromDocument(e.view.document)
            );
          }
        }
        break;
    }
  };
  const missingOptions = useMemo(
    () => [
      ...listGroupOptions.filter(
        (f) =>
          parseFieldValue(f.value, f.type).required &&
          !(predicate.listGroupProps?.[f.name]?.length > 0)
      ),
      ...listViewOptions.filter(
        (f) =>
          parseFieldValue(f.value, f.type).required &&
          !(predicate.listViewProps?.[f.name]?.length > 0)
      ),
      ...listItemOptions.filter(
        (f) =>
          parseFieldValue(f.value, f.type).required &&
          !(predicate.listItemProps?.[f.name]?.length > 0)
      ),
    ],
    [listGroupOptions, listViewOptions, listItemOptions, predicate]
  );
  // Per-control active flags for the inline view-settings bar (bd Notidian-vrmf).
  // `inlineBarEnabled` is declared up top (read by showViewOptionsMenu too).
  const inlineActive = deriveInlineControlActiveState(predicate, searchActive);
  // The flag-gated active flags the inline render reads. OFF preserves the exact
  // legacy expressions so the kill-switch restores prior rendering.
  const filterInlineActive = inlineBarEnabled
    ? inlineActive.filter
    : predicate?.filters.length > 0;
  const sortInlineActive = inlineBarEnabled
    ? inlineActive.sort
    : predicate?.sort.length > 0;
  const groupByInlineActive = inlineBarEnabled
    ? inlineActive.groupBy
    : predicate?.groupBy.length > 0;
  const searchInlineActive = inlineBarEnabled
    ? inlineActive.search
    : searchActive;
  return (
    <>
      {props.minMode ? (
        <div className="mk-view-config">
          <SearchBar
            superstate={props.superstate}
            setSearchString={setSearchString}
            closeSearch={() => setSearchActive(false)}
          ></SearchBar>

          <button
            className="mk-toolbar-button"
            onClick={(e) => {
              // Anchor to the button, not the clicked SVG child (Notidian-i23).
              const rect = e.currentTarget.getBoundingClientRect();

              showSortMenu(rect, windowFromDocument(e.view.document), null);
            }}
            dangerouslySetInnerHTML={{
              __html: props.superstate.ui.getSticker("ui//sort-desc"),
            }}
          ></button>
          {/* Group-By toolbar button in minMode too (Notidian-nmr), so the
              Filter/Sort/Group-By trio stays consistent across modes. */}
          <button
            className="mk-toolbar-button"
            aria-label="Group By"
            title="Group By"
            onClick={(e) => {
              // Anchor to the button, not the clicked SVG child (Notidian-i23).
              const rect = e.currentTarget.getBoundingClientRect();

              showGroupByMenu(rect, windowFromDocument(e.view.document), null);
            }}
            dangerouslySetInnerHTML={{
              __html: props.superstate.ui.getSticker("ui//columns"),
            }}
          ></button>
          <button
            className="mk-toolbar-button"
            onClick={(e) => {
              // Anchor to the button, not the clicked SVG child (Notidian-i23).
              const rect = e.currentTarget.getBoundingClientRect();

              showAddFilterMenu(
                rect,
                windowFromDocument(e.view.document),
                null
              );
            }}
            dangerouslySetInnerHTML={{
              __html: props.superstate.ui.getSticker("ui//filter"),
            }}
          ></button>
        </div>
      ) : (
        <>
          {props.showTitle && (expanded || props.setView) && (
            <div className="mk-context-config">
              <ContextTitle superstate={props.superstate}></ContextTitle>

              <span></span>

              {dbSchema?.id == defaultContextSchemaID &&
                !spaceCache.space.readOnly && (
                  <>
                    <button
                      className="mk-button-new"
                      onClick={(e) => {
                        if (props.superstate.settings.contextCreateUseModal) {
                          openContextCreateItemModal(
                            props.superstate,
                            spaceCache.path,
                            dbSchema?.id,
                            frameSchema?.id,
                            windowFromDocument(e.view.document)
                          );
                        } else {
                          showSpaceAddMenu(
                            props.superstate,
                            // Anchor to the button, not the clicked SVG child
                            // (Notidian-i23).
                            e.currentTarget.getBoundingClientRect(),
                            windowFromDocument(e.view.document),
                            spaceCache,
                            true
                          );
                        }
                      }}
                      dangerouslySetInnerHTML={{
                        __html: props.superstate.ui.getSticker("ui//plus"),
                      }}
                    ></button>
                  </>
                )}
            </div>
          )}
          <div className="mk-view-config">
            {!expanded ? (
              props.setView ? (
                <ListSelector
                  superstate={props.superstate}
                  expanded={false}
                  setView={props.setView}
                ></ListSelector>
              ) : (
                <div className="mk-context-config">
                  <ContextTitle superstate={props.superstate}></ContextTitle>

                  <span></span>
                </div>
              )
            ) : (
              <></>
            )}

            {
              <div className="mk-view-options">
                <span></span>
                {(isPhone(props.superstate.ui) || !searchActive) && (
                  <button
                    className={classNames(
                      "mk-toolbar-button",
                      "mk-view-search-toggle",
                      searchInlineActive && "mk-active"
                    )}
                    aria-label={i18n.labels.searchView}
                    title={i18n.labels.searchViewTooltip}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSearchActive((f) => !f);
                    }}
                    dangerouslySetInnerHTML={{
                      __html: props.superstate.ui.getSticker("ui//search"),
                    }}
                  ></button>
                )}
                {!isPhone(props.superstate.ui) && searchActive && (
                  <SearchBar
                    superstate={props.superstate}
                    setSearchString={setSearchString}
                    closeSearch={() => setSearchActive(false)}
                  ></SearchBar>
                )}

                {/* ADR 0041 (Notidian-z8q): the standalone quick-find (⌕)
                    toolbar button was removed to consolidate to ONE view
                    search. The magnifier search above is now the single search
                    affordance, and Cmd/Ctrl+F opens it (TableView.onKeyDown ->
                    setSearchActive). ADR 0042 (Notidian-fws1) then deleted the
                    now-unreachable highlight-on-match engine outright at the
                    owner's request — no dormant quick-find machinery remains. */}
                {/* Inline view-settings bar (Notidian-vrmf, building on the
                    Notidian-ddk Filter/Sort + Notidian-nmr Group-By inline
                    moves): the Filter/Sort/Group-By trio is the SINGLE HOME for
                    those controls — they are exposed inline beside the 3-knobs
                    button (using the unused horizontal space) and intentionally
                    removed from the 3-knobs menu when the inline bar is enabled
                    (de-dup). Each control reuses the same add menu and persists
                    via savePredicate (no new data authority); its active
                    indicator (mk-active + accent underline) is derived from one
                    pure helper (deriveInlineControlActiveState) so the owner sees
                    at a glance which settings are applied. The grouping div is
                    tagged so the live DOM / jsdom can assert the inline-home set.

                    KILL-SWITCH: the whole bar — the .mk-view-settings-bar
                    wrapper, the .mk-view-setting* classes, the data-mk-* /
                    aria-pressed attributes AND the net-new accent-underline CSS
                    (FilterBar.css ::after, scoped to data-mk-inline-bar="on") —
                    is gated behind inlineBarEnabled. OFF renders the exact legacy
                    bare buttons (mk-toolbar-button + conditional mk-active, no
                    wrapper, no net-new markup or visual), so viewSettingsInlineBar
                    =false restores byte-for-byte the prior Notidian-ddk/-nmr IA
                    (and the menu de-dup above reverts too). */}
                {inlineBarEnabled ? (
                  <div
                    className="mk-view-settings-bar"
                    data-mk-inline-bar="on"
                  >
                    <button
                      className={classNames(
                        "mk-toolbar-button",
                        "mk-view-setting",
                        "mk-view-setting--filter",
                        filterInlineActive && "mk-active"
                      )}
                      data-mk-control="filter"
                      data-mk-active={filterInlineActive ? "true" : "false"}
                      aria-label="Filter"
                      aria-pressed={filterInlineActive ? "true" : "false"}
                      title="Filter"
                      onClick={(e) => {
                        e.stopPropagation();
                        showAddFilterMenu(
                          e.currentTarget.getBoundingClientRect(),
                          windowFromDocument(e.view.document),
                          null
                        );
                      }}
                      dangerouslySetInnerHTML={{
                        __html: props.superstate.ui.getSticker("ui//filter"),
                      }}
                    ></button>
                    <button
                      className={classNames(
                        "mk-toolbar-button",
                        "mk-view-setting",
                        "mk-view-setting--sort",
                        sortInlineActive && "mk-active"
                      )}
                      data-mk-control="sort"
                      data-mk-active={sortInlineActive ? "true" : "false"}
                      aria-label="Sort"
                      aria-pressed={sortInlineActive ? "true" : "false"}
                      title="Sort"
                      onClick={(e) => {
                        e.stopPropagation();
                        showSortMenu(
                          e.currentTarget.getBoundingClientRect(),
                          windowFromDocument(e.view.document),
                          null
                        );
                      }}
                      dangerouslySetInnerHTML={{
                        __html: props.superstate.ui.getSticker("ui//sort-desc"),
                      }}
                    ></button>
                    <button
                      className={classNames(
                        "mk-toolbar-button",
                        "mk-view-setting",
                        "mk-view-setting--group-by",
                        groupByInlineActive && "mk-active"
                      )}
                      data-mk-control="groupBy"
                      data-mk-active={groupByInlineActive ? "true" : "false"}
                      aria-label="Group By"
                      aria-pressed={groupByInlineActive ? "true" : "false"}
                      title="Group By"
                      onClick={(e) => {
                        e.stopPropagation();
                        showGroupByMenu(
                          e.currentTarget.getBoundingClientRect(),
                          windowFromDocument(e.view.document),
                          null
                        );
                      }}
                      dangerouslySetInnerHTML={{
                        __html: props.superstate.ui.getSticker("ui//columns"),
                      }}
                    ></button>
                  </div>
                ) : (
                  <>
                    {/* Legacy IA (Notidian-ddk Filter/Sort + Notidian-nmr
                        Group-By): bare toolbar buttons, direct children of
                        .mk-view-options, with only the legacy .mk-active
                        background highlight (no wrapper, no .mk-view-setting*
                        classes, no data-mk-* / aria-pressed, no accent
                        underline). This is the exact pre-vrmf markup that the
                        kill-switch restores. */}
                    <button
                      className={classNames(
                        "mk-toolbar-button",
                        filterInlineActive && "mk-active"
                      )}
                      aria-label="Filter"
                      title="Filter"
                      onClick={(e) => {
                        e.stopPropagation();
                        showAddFilterMenu(
                          e.currentTarget.getBoundingClientRect(),
                          windowFromDocument(e.view.document),
                          null
                        );
                      }}
                      dangerouslySetInnerHTML={{
                        __html: props.superstate.ui.getSticker("ui//filter"),
                      }}
                    ></button>
                    <button
                      className={classNames(
                        "mk-toolbar-button",
                        sortInlineActive && "mk-active"
                      )}
                      aria-label="Sort"
                      title="Sort"
                      onClick={(e) => {
                        e.stopPropagation();
                        showSortMenu(
                          e.currentTarget.getBoundingClientRect(),
                          windowFromDocument(e.view.document),
                          null
                        );
                      }}
                      dangerouslySetInnerHTML={{
                        __html: props.superstate.ui.getSticker("ui//sort-desc"),
                      }}
                    ></button>
                    <button
                      className={classNames(
                        "mk-toolbar-button",
                        groupByInlineActive && "mk-active"
                      )}
                      aria-label="Group By"
                      title="Group By"
                      onClick={(e) => {
                        e.stopPropagation();
                        showGroupByMenu(
                          e.currentTarget.getBoundingClientRect(),
                          windowFromDocument(e.view.document),
                          null
                        );
                      }}
                      dangerouslySetInnerHTML={{
                        __html: props.superstate.ui.getSticker("ui//columns"),
                      }}
                    ></button>
                  </>
                )}
                <button
                  className="mk-toolbar-button"
                  onClick={(e) => showLayoutMenu(e)}
                  dangerouslySetInnerHTML={{
                    __html: props.superstate.ui.getSticker("ui//layout"),
                  }}
                ></button>
                <button
                  className="mk-toolbar-button"
                  onClick={(e) => showViewOptionsMenu(e)}
                  dangerouslySetInnerHTML={{
                    __html: props.superstate.ui.getSticker("ui//view-options"),
                  }}
                ></button>
              </div>
            }
          </div>
          {isPhone(props.superstate.ui) && searchActive && (
            <SearchBar
              superstate={props.superstate}
              setSearchString={setSearchString}
            ></SearchBar>
          )}
        </>
      )}
      {missingOptions.length > 0 && (
        <div className="mk-view-config-warning">
          {missingOptions.map((f) => (
            <div key={f.name}>{nameForField(f)}</div>
          ))}
          {i18n.labels.areRequiredForThisLayout}
        </div>
      )}

      {(predicate?.filters.length > 0 ||
        predicate?.sort.length > 0 ||
        predicate?.groupBy.length > 0) && (
        <div className="mk-filter-bar">
          {predicate.groupBy.length > 0 && (
            <div className="mk-filter">
              <span>{i18n.menu.groupBy}</span>
              <span
                onClick={(e) =>
                  showGroupByMenu(
                    // Anchor to the bound span, not the clicked child
                    // (Notidian-i23).
                    e.currentTarget.getBoundingClientRect(),
                    windowFromDocument(e.view.document),
                    null
                  )
                }
              >
                {predicate.groupBy[0]}
              </span>
              <div
                onClick={() => saveGroupBy(null, [])}
                dangerouslySetInnerHTML={{
                  __html: props.superstate.ui.getSticker("ui//close"),
                }}
              ></div>
            </div>
          )}
          {(predicate?.sort ?? []).map((f, i) => (
            <div key={i} className="mk-filter">
              <span>{f.field}</span>
              <span onClick={(e) => changeSortMenu(e, f)}>
                {sortFnTypes[f.fn].label}
              </span>
              <div
                onClick={() => removeSort(f)}
                dangerouslySetInnerHTML={{
                  __html: props.superstate.ui.getSticker("ui//close"),
                }}
              ></div>
            </div>
          ))}
          {(predicate?.filters ?? []).map((f, i) => (
            <div key={i} className="mk-filter">
              <span>{f.field}</span>
              <span onClick={(e) => changeFilterMenu(e, f, i)}>
                {filterFnLabels[f.fn]}
              </span>
              <FilterValueSpan
                superstate={props.superstate}
                fieldType={cols.find((c) => c.name + c.table == f.field)?.type}
                filter={f}
                selectFilterValue={(e, f) => selectFilterValue(e, f, i)}
              ></FilterValueSpan>
              {properties.length > 0 && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    props.superstate.ui.openMenu(
                      e.currentTarget.getBoundingClientRect(),
                      {
                        ui: props.superstate.ui,
                        multi: false,
                        editable: false,
                        value: [],
                        options: properties.map((f) => ({
                          name: f.name,
                          value: f.name,
                          section: f.type,
                        })),
                        saveOptions: (_, value) =>
                          selectFilterValue(
                            e,
                            {
                              ...f,
                              fType: "property",
                              value: value[0] as any,
                            },
                            i
                          ),
                        placeholder: i18n.labels.contextItemSelectPlaceholder,
                        searchable: true,
                        showAll: true,
                        sections: [],
                        showSections: false,
                      },
                      windowFromDocument(e.view.document)
                    );
                  }}
                >
                  <div
                    className="mk-icon-xsmall"
                    dangerouslySetInnerHTML={{
                      __html: props.superstate.ui.getSticker("ui//plug"),
                    }}
                  ></div>
                </span>
              )}
              <div
                onClick={() => removeFilter(f, i)}
                dangerouslySetInnerHTML={{
                  __html: props.superstate.ui.getSticker("ui//close"),
                }}
              ></div>
            </div>
          ))}
          {(predicate?.filters ?? []).length > 0 && (
            <div
              className="mk-filter-add"
              onClick={(e) => {
                // Anchor to the bound element, not the clicked SVG/text child
                // (Notidian-i23).
                const offset = e.currentTarget.getBoundingClientRect();
                showAddFilterMenu(
                  offset,
                  windowFromDocument(e.view.document),
                  null
                );
              }}
            >
              <span>
                <span
                  className="mk-icon-xsmall"
                  dangerouslySetInnerHTML={{
                    __html: props.superstate.ui.getSticker("ui//plus"),
                  }}
                ></span>
                {i18n.buttons.addFilter}
              </span>
            </div>
          )}
          <span></span>
        </div>
      )}
    </>
  );
};

export const FilterValueSpan = (props: {
  superstate: Superstate;
  filter: Filter;
  selectFilterValue: (e: React.MouseEvent, f: Filter) => void;
  fieldType: string;
}) => {
  const { filter, selectFilterValue, fieldType } = props;
  const fnType = filterFnTypes[filter.fn];
  const [value, setValue] = useState(filter.value);

  useEffect(() => setValue(filter.value), [filter.value]);
  if (filter.fType == "property") {
    return <span>{filter.value}</span>;
  }
  if (!fieldType || !fnType || fnType.valueType == "none") {
    return <></>;
  } else if (fnType.valueType == "text" || fnType.valueType == "number") {
    return (
      <input
        type="text"
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={(e) => {
          selectFilterValue(null, { ...filter, value });
        }}
        onKeyDown={(e) => {
          if (e.key == "Escape") {
            setValue(filter.value);
            e.currentTarget.blur();
          }
          if (e.key == "Enter") {
            e.currentTarget.blur();
          }
        }}
        value={value}
      ></input>
    );
  } else if (
    fieldType.startsWith("option") ||
    fieldType.startsWith("context") ||
    fieldType.startsWith("link") ||
    fieldType.startsWith("tag")
  ) {
    const options = parseMultiString(filter.value);
    return (
      <span onClick={(e) => selectFilterValue(e, filter)}>
        {options.length == 0
          ? i18n.labels.select
          : options.map((f, i) =>
              fieldType.startsWith("option") ? (
                <span key={i}>{f}</span>
              ) : (
                <PathCrumb
                  superstate={props.superstate}
                  key={i}
                  path={f}
                  onClick={() => {}}
                ></PathCrumb>
              )
            )}
      </span>
    );
  } else if (!filter.value || filter.value.length == 0) {
    return (
      <span onClick={(e) => selectFilterValue(e, filter)}>
        {i18n.labels.select}
      </span>
    );
  }
  return (
    <span onClick={(e) => selectFilterValue(e, filter)}>{filter.value}</span>
  );
};
