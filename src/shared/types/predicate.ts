

export type ColumnHeaderDisplayMode = "adaptive" | "full" | "text" | "icon";
export type ColumnDataAnchor = "left" | "center" | "right";
export type ColumnDataAnchorMode = "auto" | ColumnDataAnchor;
// Per-column text-wrap mode (Notion-style). "clip" keeps cells to a single
// truncated line (clean, uniform rows); "wrap" lets the cell grow to multiple
// lines. Stored per column in Predicate.colsWrap; the default ("clip") is
// dropped on save so only opted-in columns carry a value.
export type ColumnWrapMode = "clip" | "wrap";
export type TableDirection = "ltr" | "rtl";

export type Filter = {
    field: string;
    fn: string;
    value: string;
    fType: string;
  };

  export type Predicate = {
    view: string;

    listView: string;
    listItem: string;
    listGroup: string;
    listViewProps: Record<string, any>;
    listItemProps: Record<string, any>;
    listGroupProps: Record<string, any>;
    filters: Filter[];
    sort: Sort[];
    groupBy: string[];
    // ADR 0052: grouped-table island state is per-view configuration. Both
    // fields stay optional so legacy predicates retain the fully-expanded,
    // global-option-order behaviour without a migration.
    groupOrder?: Record<string, string[]>;
    collapsedGroups?: Record<string, string[]>;

    colsOrder: string[];
    colsHidden: string[];
    colsSize: Record<string, number>;
    colsCalc: Record<string, string>;
    colsHeaderDisplay: Record<string, ColumnHeaderDisplayMode>;
    colsDataAnchor: Record<string, ColumnDataAnchor>;
    colsWrap?: Record<string, ColumnWrapMode>;
    tableDirection: TableDirection;
    frozenColumnCount: number;
    limit: number;
    // Notidian-4j7: optional read-only chart over the filtered rows.
    chart?: ChartPredicate;
    // Notidian-pv4: optional sub-items parent/child tree over a frontmatter
    // parent-link property. When set, the table orders rows depth-first and
    // indents children; unset leaves the table a flat list (inert).
    subItems?: SubItemsPredicate;
    // Notidian-mx0k.2: optional grouping island header config. When groupBy is
    // active and this is set, the group header resolves the group key through the
    // referenced relation column and displays the configured fields from the
    // target record. Absent == no island (plain group headers).
    groupIsland?: GroupIslandConfig;
  };

  export type ChartPredicate = {
    visible: boolean;
    groupKey: string;
    aggregate: "count" | "sum" | "avg" | "min" | "max";
    valueKey?: string;
  };

  // ADR 0050 sub-item view config. How the tree is laid out, which rows the
  // view's filters select relative to the hierarchy, and which parents are
  // collapsed. All optional; absent == legacy (nested / parentsAndSubItems /
  // fully expanded), so pre-existing predicates round-trip byte-identically.
  export type SubItemsDisplay = "nested" | "flattened" | "parents-only";
  export type SubItemsFilterScope =
    | "parents"
    | "parentsAndSubItems"
    | "subItems";

  export type SubItemsPredicate = {
    // The parent-link column (stored as name+table, like groupBy/sort fields)
    // whose links resolve to each row's parent row. Empty disables sub-items.
    field: string;
    // Layout mode (default "nested"). "flattened" bypasses tree ordering so the
    // global sort wins; "parents-only" shows roots with descendant counts.
    display?: SubItemsDisplay;
    // How the view's predicate FILTERS interact with the hierarchy (Notidian-5ond.5):
    //   "parentsAndSubItems" (default == today): each row judged on its own; only
    //      matching rows survive (a matched child of a dropped parent surfaces as a root).
    //   "parents": keep matches PLUS their ANCESTORS (a matching row keeps its
    //      parent chain — e.g. filter status=done on sub-tasks, still see the parent).
    //   "subItems": keep matches PLUS their DESCENDANTS (a matching parent reveals
    //      its whole subtree — e.g. filter project=Atlas on parents, see all sub-items).
    // default == parents ∩ subItems. SEARCH is applied BEFORE the scope closure
    // (it narrows the candidate universe row-by-row; a search-excluded parent can't
    // be pulled back by a matching child). Inert in "flattened" display (no tree).
    filterScope?: SubItemsFilterScope;
    // Resolved row PATHS (PathPropertyName values) of collapsed parents — keyed
    // by path (not column id) so a parent-column rename never strands them.
    collapsed?: string[];
  };

  // Notidian-mx0k.2: grouping island header config. When the grouped field has
  // an associated relation (key-match or wikilink), the group header displays
  // configured properties from the resolved target record alongside the raw
  // group value. Ships behind the `groupingIslandHeader` kill-switch.
  export type GroupIslandConfig = {
    // Column name+table reference of the relation column whose value JSON
    // contains the key-match (or wikilink) config used for resolution.
    relation: string;
    // Frontmatter property names to fetch from the resolved target record and
    // display in the group header bar.
    fields: string[];
  };

  export type Sort = {
    field: string;
    fn: string;
  };
