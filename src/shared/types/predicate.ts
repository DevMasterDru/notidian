

export type ColumnHeaderDisplayMode = "adaptive" | "full" | "text" | "icon";
export type ColumnDataAnchor = "left" | "center" | "right";
export type ColumnDataAnchorMode = "auto" | ColumnDataAnchor;
// Per-column text-wrap mode (Notion-style). "clip" keeps cells to a single
// truncated line (clean, uniform rows); "wrap" lets the cell grow to multiple
// lines. Stored per column in Predicate.colsWrap; the default ("clip") is
// dropped on save so only opted-in columns carry a value.
export type ColumnWrapMode = "clip" | "wrap";
// Per-view row density (Notidian-pb7p.3 / Atlas ADR-0096 H3). "compact"
// tightens row height and cell padding so a dense hub tab fits more rows above
// the fold; "normal" is the default and is dropped on save, so an untouched
// view stays byte-identical.
export type TableRowDensity = "normal" | "compact";
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
    rowDensity?: TableRowDensity;
    tableDirection: TableDirection;
    frozenColumnCount: number;
    limit: number;
    // Notidian-4j7: optional read-only chart over the filtered rows.
    chart?: ChartPredicate;
    // Notidian-pv4: optional sub-items parent/child tree over a frontmatter
    // parent-link property. When set, the table orders rows depth-first and
    // indents children; unset leaves the table a flat list (inert).
    subItems?: SubItemsPredicate;
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

  export type Sort = {
    field: string;
    fn: string;
  };
