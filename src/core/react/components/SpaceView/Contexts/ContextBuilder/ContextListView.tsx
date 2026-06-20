import React, { useContext, useMemo, useState } from "react";

import { ContextEditorContext } from "core/react/context/ContextEditorContext";
import { parseFieldValue } from "core/schemas/parseFieldValue";
import { Superstate } from "makemd-core";

import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { NoteView } from "core/react/components/PathView/NoteView";
import { CollapseToggle } from "core/react/components/UI/Toggles/CollapseToggle";
import { CollapseToggleSmall } from "core/react/components/UI/Toggles/CollapseToggleSmall";
import { createSubItemRow } from "core/utils/contexts/subItemCreate";
import { FrameInstanceContext } from "core/react/context/FrameInstanceContext";
import { PathContext } from "core/react/context/PathContext";
import i18n from "shared/i18n";
import { SpaceContext } from "core/react/context/SpaceContext";
import { filterFnTypes } from "core/utils/contexts/predicate/filterFns/filterFnTypes";
import {
  displayPropertyForPredicate,
  resolveRowDisplayLabel,
} from "core/utils/contexts/rowDisplayLabel";
import {
  expandableRowNotePath,
  listItemSupportsRowExpansion,
  toggleRowExpansion,
} from "core/utils/contexts/rowExpansion";
import { applyListItemVisibleProperties } from "core/utils/contexts/listItemProperties";
import { ensureArray, tagSpacePathFromTag } from "core/utils/strings";
import { SelectOption } from "makemd-core";
import { parseMultiString } from "utils/parsers";
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { FrameEditorMode } from "shared/types/frameExec";
import { DBRow } from "shared/types/mdb";
import { ActionProp, FrameTreeProp } from "shared/types/mframe";
import { URI } from "shared/types/path";
import { Pos, Rect } from "shared/types/Pos";
import { uniq } from "shared/utils/array";
import { ContextInfiniteScroll } from "./ContextInfiniteScroll";
import { ContextListInstance } from "./ContextListInstance";
import { FrameContainerView } from "./FrameContainerView";
import { useSpaceManager } from "core/react/context/SpaceManagerContext";
export const PLACEHOLDER_ID = "_placeholder";
type Items = Record<string, DBRow[]>;
export type ContextListSections = "listItem" | "listGroup" | "listView";
export const ContextListView = (props: {
  superstate: Superstate;
  containerRef: React.RefObject<HTMLDivElement>;
  editSection: ContextListSections;
  selectedIndexes: string[];
  setSelectedIndexes: (index: string[]) => void;
  groupURI: URI;
  itemURI: URI;
  flattenedItems: React.MutableRefObject<Record<string, [string, DBRow, Pos]>>;
}) => {
  const {
    editSection,
    selectedIndexes,
    setSelectedIndexes,
    groupURI,
    itemURI,
    flattenedItems,
  } = props;
  const spaceManager = useSpaceManager() || props.superstate.spaceManager;
  const { readMode } = useContext(PathContext);
  const { spaceInfo, spaceState } = useContext(SpaceContext);
  const {
    predicate,
    filteredData: data,
    editMode,
    sortedColumns,
    contextTable,
    cols,
    dbSchema,
    source,
    subItemsInfo,
    subItemsField,
    collapsedSubItems,
    toggleSubItemCollapse,
    subItemAddRows,
  } = useContext(ContextEditorContext);

  // "+ New sub-item" affordance (Notidian-gr8t) → the single one-way create path.
  const onCreateSubItem = React.useCallback(
    (parentPath: string) => {
      if (!subItemsField || !source || !dbSchema?.id) return;
      void createSubItemRow({
        superstate: props.superstate,
        contextPath: source,
        schema: dbSchema.id,
        subItemsField,
        parentPath,
      });
    },
    [subItemsField, source, dbSchema?.id, props.superstate]
  );

  const [pageId, setPageId] = useState(1);
  const pageLength = 25;
  // ADR 0016 v1: toggle-row open state is per-session React state, never persisted
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const { instance } = useContext(FrameInstanceContext);

  const groupBy =
    predicate?.groupBy?.length > 0
      ? cols.find((f) => f.name + f.table == predicate.groupBy[0])
      : null;

  const groupByOptions = useMemo(() => {
    const groupByOptions =
      instance?.state[instance?.root?.id].props?.groupOptions;
    if (groupByOptions) {
      return ensureArray(groupByOptions);
    }
    if (!groupBy) {
      return [""];
    }
    
    // Check if it's a multi-value field
    const isMultiField = groupBy.type?.endsWith('-multi') || groupBy.type === 'tags';
    
    const options: string[] = uniq([
      "",
      ...(parseFieldValue(groupBy.value, groupBy.type)?.options ?? []).map(
        (f: SelectOption) => f.value
      ),
      ...data.reduce(
        (p, c) => {
          const value = c[groupBy.name + groupBy.table];
          if (isMultiField && value) {
            // Parse multi-string values and add each option individually
            return [...p, ...parseMultiString(value)];
          }
          return [...p, value ?? ""];
        },
        []
      ),
    ]) as string[];
    
    // Sort to ensure empty string (None category) appears last
    const sortedOptions = options.sort((a, b) => {
      if (a === "" && b !== "") return 1;  // Move empty string to end
      if (a !== "" && b === "") return -1; // Keep non-empty before empty
      return 0; // Maintain relative order for other items
    });
    
    return sortedOptions;
  }, [groupBy, data, instance]);

  const groupByFilter = useMemo(() => {
    const filter = instance?.state[instance?.root?.id].props?.groupFilter;
    return filterFnTypes[filter] ?? filterFnTypes.is;
  }, [instance]);

  const items: Items = useMemo(() => {
    const computedItems = groupByOptions.reduce(
      (p, c) => {
        const [acc, count] = p;
        if (!groupBy) {
          return [
            c == ""
              ? {
                  ...acc,
                  [c]: data.map((f, i) => ({ ...f, _pageId: count + i })) ?? [],
                }
              : {
                  ...acc,
                  [c]: [],
                },
            count + data.length,
          ];
        }
        
        // Check if it's a multi-value field
        const isMultiField = groupBy.type?.endsWith('-multi') || groupBy.type === 'tags';
        
        const newItems = data.filter((r) => {
          const value = r[groupBy.name + groupBy.table];
          
          if (isMultiField && value) {
            // For multi-value fields, check if the current option is in the parsed values
            const values = parseMultiString(value);
            return c === "" ? values.length === 0 : values.includes(c);
          }
          
          // For single-value fields, use the existing filter
          return groupByFilter.fn(value, c);
        });
        return [
          newItems.length > 0
            ? {
                ...acc,
                [c]: newItems.map((f, i) => ({
                  ...f,
                  _pageId: count + i,
                })),
              }
            : {
                ...acc,
                [c]: [],
              },
          count + newItems.length,
        ];
      },
      [{}, 0]
    )[0];
    
    return computedItems;
  }, [data, groupByOptions, groupByFilter, groupBy]);

  const primaryKey = useMemo(() => {
    return cols.find((f) => f.primary == "true")?.name;
  }, [cols]);
  const visibleCols = useMemo(() => {
    return sortedColumns.filter((f) => !predicate?.colsHidden.includes(f.name));
  }, [predicate, sortedColumns]);
  // bd Notidian-543 (flag-gated): when the default-ON kill-switch listItemPropertyPicker
  // setting is ON and the view configured a per-item allowlist
  // (predicate.listItemProps.visibleProperties), filter the per-item field set
  // to that allowlist. When OFF (kill-switch) or unconfigured, this returns
  // visibleCols UNCHANGED, so the per-item render is byte-for-byte today's.
  const itemProperties = useMemo(
    () =>
      applyListItemVisibleProperties(
        visibleCols,
        predicate,
        props.superstate.settings?.listItemPropertyPicker === true
      ),
    [visibleCols, predicate, props.superstate.settings?.listItemPropertyPicker]
  );
  const context = {
    _path: source,
    _schema: dbSchema?.id,
    _isContext: dbSchema?.id == defaultContextSchemaID,
    _key: primaryKey,
    _properties: itemProperties,
  };

  const listItemActions: ActionProp = {
    select: (e, value, state, saveState, api) => {
      setSelectedIndexes([state.$contexts?.$context["_index"]]);
    },
    open: (e, value, state, saveState, api) => {
      api.table.open(
        state.$contexts?.$context["_path"],
        state.$contexts?.$context["_schema"],
        state.$contexts?.$context["_index"],
        false
      );
    },
    contextMenu: (e, value, state, saveState, api) => {
      e.preventDefault?.();
      api.table.contextMenu(
        e,
        state.$contexts?.$context["_path"],
        state.$contexts?.$context["_schema"],
        state.$contexts?.$context["_index"]
      );
    },
  };

  const displayProperty = displayPropertyForPredicate(predicate);

  const rowsExpandable =
    listItemSupportsRowExpansion(itemURI) &&
    dbSchema?.primary == "true" &&
    (editSection != "listItem" || editMode == FrameEditorMode.Read);

  const contextMap: { [key: string]: FrameTreeProp } = useMemo(() => {
    if (!dbSchema) {
      return {};
    }
    return dbSchema?.primary == "true"
      ? data.reduce<{ [key: string]: FrameTreeProp }>((p, c) => {
          return {
            ...p,
            [c["_index"]]: {
              $context: {
                _index: c["_index"],
                _keyValue: c[primaryKey],
                _schema: dbSchema.id,
                _name:
                  resolveRowDisplayLabel(
                    c,
                    spaceManager.getPathState(c[primaryKey]),
                    displayProperty
                  ) ?? spaceManager.getPathState(c[primaryKey])?.name,
                _values: c,
                ...context,
              },
              $properties: cols,
              [source]: cols.reduce((a, b) => {
                return {
                  ...a,
                  [b.name]: c[b.name],
                };
              }, {}),
              ...Object.keys(contextTable)
                .filter((f) =>
                  spaceState?.contexts?.some((g) => tagSpacePathFromTag(g) == f) ?? false
                )
                .reduce<FrameTreeProp>((d, e) => {
                  return {
                    ...d,
                    [e]: contextTable[e].cols.reduce((a, b) => {
                      return {
                        ...a,
                        [b.name]: c[b.name + e],
                      };
                    }, {}),
                  };
                }, {}),
            },
          };
        }, {})
      : data.reduce<{ [key: string]: FrameTreeProp }>((p, c) => {
          return {
            ...p,
            [c["_index"]]: {
              $context: {
                _index: c["_index"],
                _keyValue: c[primaryKey],
                _schema: dbSchema.id,
                _name: c[primaryKey],
                _values: c,
                ...context,
              },

              $properties: cols,
              [source]: cols.reduce((a, b) => {
                return {
                  ...a,
                  [b.name]: c[b.name],
                };
              }, {}),
            },
          };
        }, {});
  
  return contextMap;
  }, [data, cols, source, contextTable, spaceState, displayProperty]);

  return (
    <FrameContainerView
      superstate={props.superstate}
      uri={groupURI}
      editMode={editSection == "listGroup" ? editMode : FrameEditorMode.Read}
      cols={[]}
    >
      <SortableContext
        items={Object.keys(items).map(
          (f, i) => (spaceInfo?.path || "unknown") + "listGroup" + i
        )}
        strategy={rectSortingStrategy}
      >
        {
          // groupBy ?
          Object.keys(items).map((c, i) => {
            return (
            <ContextListInstance
              key={"listGroup" + i}
              id={(spaceInfo?.path || "unknown") + "listGroup" + i}
              type="listGroup"
              superstate={props.superstate}
              uri={groupURI}
              props={{
                _selectedIndexes: selectedIndexes,
                _groupValue: c,
                _groupField: groupBy,
                _readMode: readMode,
                ...predicate.listGroupProps,
              }}
              propSetters={null}
              editMode={
                editSection == "listGroup" ? editMode : FrameEditorMode.Read
              }
              cols={[]}
              containerRef={props.containerRef}
              contexts={{ $context: context }}
            >
              <FrameContainerView
                uri={itemURI}
                superstate={props.superstate}
                cols={[]}
                editMode={
                  editSection == "listItem" ? editMode : FrameEditorMode.Read
                }
              >
                <SortableContext
                  items={items[c].flatMap(
                    (f, k) => (spaceInfo?.path || "unknown") + "listGroup" + i + "_listItem" + k
                  )}
                  strategy={rectSortingStrategy}
                >
                  {items[c]
                    .filter(
                      (f) => parseInt(f["_pageId"]) <= pageId * pageLength
                    )
                    .map((f, j) => {
                      if (parseInt(f["_pageId"]) == pageId * pageLength) {
                        return (
                          <ContextInfiniteScroll
                            key={j}
                            onScroll={() => setPageId((p) => p + 1)}
                          ></ContextInfiniteScroll>
                        );
                      }
                      const id =
                        (spaceInfo?.path || "unknown") + "listGroup" + i + "_listItem" + j;
                      const instance = (
                        <ContextListInstance
                          key={"listGroup" + i + "_listItem" + j}
                          id={id}
                          type="listItem"
                          uri={itemURI}
                          superstate={props.superstate}
                          propSetters={{}}
                          cols={[]}
                          props={{
                            _selectedIndexes: selectedIndexes,
                            _groupValue: c,
                            _groupField: groupBy,
                            _readMode: readMode,
                            ...predicate.listItemProps,
                          }}
                          actions={listItemActions}
                          onLayout={(rect: Rect) => {
                            flattenedItems.current[f["_index"]] = [
                              f["_index"],
                              f,
                              {
                                x: rect.x,
                                y: rect.y,
                              },
                            ];
                          }}
                          containerRef={props.containerRef}
                          editMode={
                            editSection == "listItem"
                              ? editMode
                              : FrameEditorMode.Read
                          }
                          contexts={contextMap[f["_index"]]}
                        ></ContextListInstance>
                      );
                      // Sub-items (Notidian-s9m): mirror the table's depth indent
                      // + collapse chevron in the list view. filteredData already
                      // arrives tree-ordered with collapsed descendants removed, so
                      // this only renders the per-row affordance. null when the view
                      // has no sub-items parent column configured.
                      const rowPath = String(f[PathPropertyName] ?? "");
                      const subItemNode = subItemsInfo?.get(rowPath);
                      const subItemCollapsed =
                        !!subItemNode && collapsedSubItems.has(rowPath);
                      const subItemAffordance = subItemNode ? (
                        <span
                          className="mk-subitem-affordance"
                          style={{
                            // ADR 0024 C2: clamp indent at depth 12 (shared with
                            // the table render) so deep/cyclic chains stay legible.
                            paddingLeft: `${
                              Math.min(subItemNode.depth, 12) * 16
                            }px`,
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          {subItemNode.hasChildren ? (
                            <CollapseToggleSmall
                              superstate={props.superstate}
                              collapsed={subItemCollapsed}
                              onToggle={(_, e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                toggleSubItemCollapse(rowPath);
                              }}
                            />
                          ) : (
                            <span className="mk-subitem-toggle-spacer" />
                          )}
                          {/* Adding a sub-item lives in the row's right-click
                              menu (showRowContextMenu "Add sub-item"), not an
                              inline button (owner UX choice). */}
                          {subItemNode.surfacedAsRoot ? (
                            <span
                              className="mk-sub-item-orphan"
                              title="Parent not in this view — shown as top-level (ADR 0024 C2)"
                            >
                              ↥
                            </span>
                          ) : null}
                        </span>
                      ) : null;
                      const listKey = "listGroup" + i + "_listItem" + j;
                      // Notion-style "+ New sub-item" rows (Notidian-gr8t): drawn
                      // after this row when it is an expanded parent's last visible
                      // descendant. Presentational only — never a list instance, so
                      // selection/flattenedItems are untouched.
                      const addRowEls = subItemAddRows
                        ?.get(rowPath)
                        ?.map((add, k) => (
                          <div
                            key={listKey + "_add" + k}
                            className="mk-list-subitem-add"
                            style={{
                              paddingLeft: `${Math.min(add.depth, 12) * 16}px`,
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => onCreateSubItem(add.parentPath)}
                          >
                            <span className="mk-subitem-add-icon">+</span>
                            <span className="mk-subitem-add-label">
                              {i18n.hintText.newSubItem}
                            </span>
                          </div>
                        ));
                      if (!rowsExpandable) {
                        if (!subItemAffordance) {
                          return instance;
                        }
                        const rowEl = (
                          <div key={listKey} className="mk-list-subitem-row">
                            {subItemAffordance}
                            <div className="mk-list-subitem-row-item">
                              {instance}
                            </div>
                          </div>
                        );
                        return addRowEls ? [rowEl, ...addRowEls] : rowEl;
                      }
                      const notePath = expandableRowNotePath(
                        f,
                        primaryKey,
                        (p) => spaceManager.getPathState(p)
                      );
                      const rowExpanded = notePath
                        ? expandedRows[notePath] == true
                        : false;
                      const toggleRowEl = (
                        <div key={listKey} className="mk-list-toggle-row">
                          <div className="mk-list-toggle-row-header">
                            {subItemAffordance}
                            {notePath ? (
                              <CollapseToggle
                                superstate={props.superstate}
                                collapsed={!rowExpanded}
                                onToggle={() =>
                                  setExpandedRows((p) =>
                                    toggleRowExpansion(p, notePath)
                                  )
                                }
                              ></CollapseToggle>
                            ) : (
                              <div className="mk-list-toggle-row-spacer"></div>
                            )}
                            <div className="mk-list-toggle-row-item">
                              {instance}
                            </div>
                          </div>
                          {notePath && rowExpanded && (
                            <NoteView
                              superstate={props.superstate}
                              path={notePath}
                              load={true}
                              classname="mk-list-toggle-row-body"
                              readOnly={readMode}
                            ></NoteView>
                          )}
                        </div>
                      );
                      return addRowEls
                        ? [toggleRowEl, ...addRowEls]
                        : toggleRowEl;
                    })}
                </SortableContext>
              </FrameContainerView>
            </ContextListInstance>
            );
          })
        }
      </SortableContext>
    </FrameContainerView>
  );
};
