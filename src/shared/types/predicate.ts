

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

  export type SubItemsPredicate = {
    // The parent-link column (stored as name+table, like groupBy/sort fields)
    // whose links resolve to each row's parent row. Empty disables sub-items.
    field: string;
  };

  export type Sort = {
    field: string;
    fn: string;
  };
