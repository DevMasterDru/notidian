

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
    // Which rows the view's filters keep relative to the hierarchy (default
    // "parentsAndSubItems" == today's behavior).
    filterScope?: SubItemsFilterScope;
    // Resolved row PATHS (PathPropertyName values) of collapsed parents — keyed
    // by path (not column id) so a parent-column rename never strands them.
    collapsed?: string[];
  };

  export type Sort = {
    field: string;
    fn: string;
  };
