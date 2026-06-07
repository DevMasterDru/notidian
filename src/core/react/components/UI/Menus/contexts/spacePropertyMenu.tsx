import i18n from "shared/i18n";

import { normalizedSortForType } from "core/utils/contexts/predicate/sort";
import {
  fieldWithPropertyHeaderIcon,
  fieldWithoutPropertyHeaderIcon,
  hasPropertyHeaderIcon,
} from "core/utils/contexts/propertyHeaderIcon";
import { canDeletePropertyColumn } from "core/utils/contexts/propertyColumnActions";
import { fieldForPropertyNameInput } from "core/utils/contexts/propertyNameValue";
import {
  propertyTypeLabelForField,
  propertyTypeOptionsForField,
  shouldShowMultiToggleForPropertyType,
} from "core/utils/contexts/propertyTypeMenu";
import { valueForPropertyTypeChange } from "core/utils/contexts/propertyTypeValue";
import { nameForField } from "core/utils/frames/frames";
import { SelectOption, SelectOptionType, Superstate } from "makemd-core";
import React, { useState } from "react";
import { fieldTypeForType, fieldTypes, stickerForField } from "schemas/mdb";
import { SpaceTableColumn } from "shared/types/mdb";
import { MenuObject } from "shared/types/menu";
import { Anchors, Rect } from "shared/types/Pos";
import {
  ColumnDataAnchorMode,
  ColumnHeaderDisplayMode,
  Sort,
} from "shared/types/predicate";
import { windowFromDocument } from "shared/utils/dom";
import StickerModal from "../../../../../../shared/components/StickerModal";
import { defaultMenu, menuSeparator } from "../menu/SelectionMenu";
import { PropertyDataAnchorMenuComponent } from "./PropertyDataAnchorMenu";
import { PropertyHeaderDisplayModeMenuComponent } from "./PropertyHeaderDisplayModeMenu";
import { PropertyValueComponent } from "./PropertyValue";

export const PropertyMenuComponent = (props: {
  superstate: Superstate;
  field: SpaceTableColumn;
  fields: SpaceTableColumn[];
  contextPath: string;
  options: string[];
  isSpace?: boolean;
  saveField: (field: SpaceTableColumn) => void;
  onSubmenu: (
    openSubmenu: (offset: Rect, onHide: () => void) => MenuObject
  ) => void;
  flex?: boolean;
  rowPath?: string;
}) => {
  const [field, setField] = useState(props.field);
  const selectedType = (_: string[], value: string[]) => {
    const newField = {
      ...field,
      type: value[0],
      value: valueForPropertyTypeChange({
        field,
        nextType: value[0],
        observedOptions: props.options,
      }),
    };
    setField(newField);
    props.saveField(newField);
  };
  const selectPropertyTypeMenu = (
    rect: Rect,
    win: Window,
    selectedType: (_: string[], value: string[]) => void
  ) => {
    return props.superstate.ui.openMenu(
      rect,
      {
        ui: props.superstate.ui,
        multi: false,
        editable: false,
        searchable: false,
        saveOptions: selectedType,
        value: [],
        showAll: true,
        options: propertyTypeOptionsForField(field)
          .map((f, i) => ({
            id: i + 1,
            name: f.label,
            value: f.type,
            icon: f.icon,
          })),
      },
      win
    );
  };

  const selectedValue = (value: string) => {
    const newField = { ...field, value: value };
    setField(newField);
    props.saveField(newField);
  };

  const toggleMulti = () => {
    const newField = {
      ...field,
      type:
        field.type == fieldType.multiType
          ? fieldType.type
          : fieldType.multiType,
    };
    setField(newField);
    props.saveField(newField);
  };
  const fieldType = fieldTypeForType(field.type, field.name) ?? fieldTypes[0];
  return (
    <>
      <li>
        <div
          className="mk-menu-option"
          onClick={(e) =>
            props.onSubmenu((rect, onHide) =>
              selectPropertyTypeMenu(
                rect,
                windowFromDocument(e.view.document),
                selectedType
              )
            )
          }
        >
          <span>{i18n.labels.propertyType}</span>
          <span>{propertyTypeLabelForField(field)}</span>
        </div>
      </li>

      {shouldShowMultiToggleForPropertyType(fieldType) ? (
        <div className="mk-menu-option">
          <span>{i18n.labels.multiple}</span>
          <input
            type="checkbox"
            checked={field.type == fieldType.multiType}
            onChange={() => toggleMulti()}
          ></input>
        </div>
      ) : (
        <></>
      )}

      <div className="mk-menu-separator"></div>
      <PropertyValueComponent
        superstate={props.superstate}
        name={field.name}
        table={field.table}
        fields={props.fields}
        fieldType={fieldType.type}
        isSpace={props.isSpace}
        value={field.value}
        contextPath={props.contextPath}
        saveValue={selectedValue}
        rowPath={props.rowPath}
      ></PropertyValueComponent>
    </>
  );
};

const PropertyHeaderNameMenuComponent = (props: {
  superstate: Superstate;
  field: SpaceTableColumn;
  name: string;
  saveName: (value: string) => void;
  saveField: (field: SpaceTableColumn) => void;
  preserveColumnWidth?: () => void;
  hide: () => void;
}) => {
  const [name, setName] = useState(props.name);
  const hasConfiguredIcon = hasPropertyHeaderIcon(props.field);

  const commitName = () => {
    props.saveName(name);
  };

  const selectIcon = (e: React.MouseEvent) => {
    e.stopPropagation();
    props.preserveColumnWidth?.();
    props.superstate.ui.openPalette(
      <StickerModal
        ui={props.superstate.ui}
        selectedSticker={(emoji) => {
          props.preserveColumnWidth?.();
          props.saveField(fieldWithPropertyHeaderIcon(props.field, emoji));
        }}
        resetSticker={() => {
          props.preserveColumnWidth?.();
          props.saveField(fieldWithoutPropertyHeaderIcon(props.field));
        }}
        canResetSticker={hasConfiguredIcon}
      />,
      windowFromDocument(e.view.document)
    );
    props.hide();
  };

  return (
    <div className="mk-property-header-name-menu">
      <button
        type="button"
        className="mk-property-header-name-icon-button"
        aria-label={i18n.menu.setIcon}
        onClick={selectIcon}
      >
        <span
          className="mk-property-header-name-icon"
          dangerouslySetInnerHTML={{
            __html: props.superstate.ui.getSticker(stickerForField(props.field)),
          }}
        ></span>
      </button>
      <input
        type="text"
        value={name}
        onKeyDown={(e) => {
          if (e.key == "Enter") {
            commitName();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.stopPropagation()}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
      />
    </div>
  );
};
type PropertyMenuProps = {
  superstate: Superstate;
  rect: Rect;
  win: Window;
  editable: boolean;
  options: string[];
  field: SpaceTableColumn;
  fields: SpaceTableColumn[];
  contextPath: string;
  saveField: (field: SpaceTableColumn) => void;
  hide?: (column: SpaceTableColumn, hidden: boolean) => void;
  deleteColumn?: (property: SpaceTableColumn) => void;
  sortColumn?: (sort: Sort) => void;
  freezeColumn?: () => void;
  unfreezeColumns?: () => void;
  renamePropertyKey?: (event: React.MouseEvent) => void;
  deleteFrontmatterProperty?: (event: React.MouseEvent) => void;
  headerDisplayMode?: ColumnHeaderDisplayMode;
  setHeaderDisplayMode?: (mode: ColumnHeaderDisplayMode) => void;
  dataAnchorMode?: ColumnDataAnchorMode;
  setDataAnchorMode?: (mode: ColumnDataAnchorMode) => void;
  preserveColumnWidth?: () => void;
  frozenColumnCount?: number;
  hidden?: boolean;
  editCode?: () => void;
  anchor?: Anchors;
  flex?: boolean;
  rowPath?: string;
  isSpace?: boolean;
};
export const showPropertyMenu = (
  props: PropertyMenuProps,
  onHide?: () => void,
  isSubmenu?: boolean
) => {
  const {
    superstate,
    rect,
    editable,
    options,
    field,
    fields,
    contextPath,
    saveField,
    flex,
    rowPath,
    isSpace,
    hide,
    deleteColumn,
    sortColumn,
    freezeColumn,
    unfreezeColumns,
    renamePropertyKey,
    deleteFrontmatterProperty,
    headerDisplayMode = "adaptive",
    setHeaderDisplayMode,
    dataAnchorMode = "auto",
    setDataAnchorMode,
    preserveColumnWidth,
    frozenColumnCount,
    editCode,
    hidden,
  } = props;

  const saveName = (value: string) => {
    saveField(fieldForPropertyNameInput({ field, value, editable }));
  };
  const menuOptions: SelectOption[] = [];

  if (!flex) {
    menuOptions.push({
      name: "",
      type: SelectOptionType.Custom,
      fragment: (props: { hide: () => void }) => (
        <PropertyHeaderNameMenuComponent
          superstate={superstate}
          field={field}
          name={nameForField(field) ?? ""}
          saveName={saveName}
          saveField={saveField}
          preserveColumnWidth={preserveColumnWidth}
          hide={props.hide}
        />
      ),
    });
  }
  menuOptions.push(menuSeparator);
  if (editable) {
    menuOptions.push({
      name: "",
      type: SelectOptionType.Custom,
      fragment: (props: {
        hide: () => void;
        onSubmenu: (
          openSubmenu: (offset: Rect, onHide: () => void) => MenuObject
        ) => void;
      }) => (
        <PropertyMenuComponent
          superstate={superstate}
          field={field}
          fields={fields}
          contextPath={contextPath}
          options={options}
          isSpace={isSpace}
          saveField={saveField}
          onSubmenu={props.onSubmenu}
          flex={flex}
          rowPath={rowPath}
        ></PropertyMenuComponent>
      ),
    });
  }

  if (!flex) {
    menuOptions.push(menuSeparator);
    if (setHeaderDisplayMode) {
      menuOptions.push({
        name: "",
        type: SelectOptionType.Custom,
        fragment: (props: { hide: () => void }) => (
          <PropertyHeaderDisplayModeMenuComponent
            headerDisplayMode={headerDisplayMode}
            setHeaderDisplayMode={setHeaderDisplayMode}
            hide={props.hide}
          />
        ),
      });
    }
    if (setDataAnchorMode) {
      menuOptions.push({
        name: "",
        type: SelectOptionType.Custom,
        fragment: (props: { hide: () => void }) => (
          <PropertyDataAnchorMenuComponent
            dataAnchorMode={dataAnchorMode}
            setDataAnchorMode={setDataAnchorMode}
            hide={props.hide}
          />
        ),
      });
    }
    if (setHeaderDisplayMode || setDataAnchorMode) {
      menuOptions.push(menuSeparator);
    }
  }
  const sortableString = normalizedSortForType(field.type, false);

  if (sortableString && sortColumn) {
    menuOptions.push({
      name: i18n.menu.sortAscending,
      icon: "ui//sort-asc",
      onClick: () => {
        sortColumn({
          field: field.name + field.table,
          fn: sortableString,
        });
      },
    });
    menuOptions.push({
      name: i18n.menu.sortDescending,
      icon: "ui//sort-desc",
      onClick: () => {
        sortColumn({
          field: field.name + field.table,
          fn: normalizedSortForType(field.type, true),
        });
      },
    });
  }

  menuOptions.push(menuSeparator);
  if (freezeColumn) {
    menuOptions.push({
      name: i18n.menu.freezeUpToColumn,
      icon: "ui//pin",
      onClick: () => {
        freezeColumn();
      },
    });
  }
  if ((frozenColumnCount ?? 0) > 0 && unfreezeColumns) {
    menuOptions.push({
      name: i18n.menu.unfreezeColumns,
      icon: "ui//pin-off",
      onClick: () => {
        unfreezeColumns();
      },
    });
  }

  menuOptions.push(menuSeparator);
  if (hide) {
    if (!hidden) {
      menuOptions.push({
        name: i18n.menu.hideProperty,
        icon: "ui//eye-off",
        onClick: () => {
          hide(field, true);
        },
      });
    } else {
      menuOptions.push({
        name: i18n.menu.unhideProperty,
        icon: "ui//eye",
        onClick: () => {
          hide(field, false);
        },
      });
    }
  }
  if (editable) {
    if (renamePropertyKey) {
      menuOptions.push({
        name: i18n.menu.renamePropertyKey,
        icon: "ui//pencil",
        onClick: (e: React.MouseEvent) => {
          renamePropertyKey(e);
        },
      });
    }
    if (editCode) {
      menuOptions.push({
        name: i18n.menu.editCode,
        icon: "ui//code",
        onClick: () => {
          editCode();
        },
      });
    }
    if (deleteFrontmatterProperty) {
      menuOptions.push({
        name: i18n.menu.deleteProperty,
        icon: "ui//trash",
        onClick: (e: React.MouseEvent) => {
          deleteFrontmatterProperty(e);
        },
      });
    } else if (deleteColumn && canDeletePropertyColumn(field)) {
      menuOptions.push({
        name: i18n.menu.deleteProperty,
        icon: "ui//trash",
        onClick: () => {
          deleteColumn(field);
        },
      });
    }
  }

  const menu = superstate.ui.openMenu(
    rect,
    defaultMenu(superstate.ui, menuOptions),
    props.win,
    props.anchor,
    onHide
  );
  return menu;
};
