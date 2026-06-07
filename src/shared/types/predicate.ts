

export type ColumnHeaderDisplayMode = "adaptive" | "full" | "text" | "icon";
export type ColumnDataAnchor = "left" | "center" | "right";
export type ColumnDataAnchorMode = "auto" | ColumnDataAnchor;

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
    frozenColumnCount: number;
    limit: number;
  };

  export type Sort = {
    field: string;
    fn: string;
  };
