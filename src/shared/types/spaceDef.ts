import { Filter } from "./predicate";

export type SpaceSort = {
  field: string;
  asc: boolean;
  group: boolean;
  recursive: boolean;
};

export type FilterDef = {
  type: string;
  fType: string;
} & Filter;
export type FilterGroupDef = {
  type: 'any' | 'all';
  trueFalse: boolean;
  filters: FilterDef[];
};
export type JoinDefGroup = {
  recursive: boolean;
  path: string;
  type: 'any' | 'all';
  groups: FilterGroupDef[];
}
export type SpaceType = 'folder' | 'tag' | 'vault' | 'default' | 'unknown';


export type SpaceDefinition = {
  contexts?: string[];
  sort?: SpaceSort;
  joins?: JoinDefGroup[];
  links?: string[];
  tags?: string[];
  template?: string;
  templateName?: string;
  defaultSticker?: string;
  defaultColor?: string;
  readMode?: boolean;
  fullWidth?: boolean;
  // Per-space view state (Notidian-8sl): whether the folder/hub note body region
  // shown above the database is collapsed. View state, not row data — its home
  // is the space metadata (no durable-MDB ownership, no source:"notidian").
  noteBodyCollapsed?: boolean;
  // Per-space view state (Notidian-egoh): an explicit pixel height the user has
  // dragged the note body region to. Absent/undefined => shrink-to-fit (auto);
  // a number => fixed height with the body scrolling on overflow. Same authority
  // class as noteBodyCollapsed (view state, not row data).
  noteBodyHeight?: number;
};
