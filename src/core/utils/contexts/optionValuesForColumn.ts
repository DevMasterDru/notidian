import { deletePath } from "core/superstate/utils/path";
import { folderForTagSpace } from "core/utils/spaces/space";
import { pathToParentPath } from "core/utils/strings";
import { isString } from "lodash";
import { Superstate } from "makemd-core";
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTable } from "shared/types/mdb";
import { SpaceInfo } from "shared/types/spaceInfo";
import { insert } from "shared/utils/array";
import { defaultMDBTableForContext } from "../../../schemas/mdb";
import { uniq } from "../../../shared/utils/array";
import { parseMultiString } from "../../../utils/parsers";
import { formatDate, parseDate } from "../date";


export const optionValuesForColumn = (column: string, table: SpaceTable) => {
  return uniq(
    table?.rows.reduce((p, c) => {
      if (!isString(c[column])) return [...p]
      return [...p, ...parseMultiString(c[column])];
    }, []) ?? []
  );
};

export const defaultTableDataForContext = (superstate: Superstate, space: SpaceInfo): SpaceTable => {
  const paths = [...superstate.getSpaceItems(space.path)];
  return {
    ...defaultMDBTableForContext(space),
    rows: paths.map((f) => ({ [PathPropertyName]: f.path, "Created": formatDate(superstate.settings, parseDate(f.metadata?.ctime), "yyyy-MM-dd") })),
  };

};




export const createNewRow = (mdb: SpaceTable, row: DBRow, index?: number) => {
  // Insert at an explicit position when one is given — including index 0
  // (insert-at-top). A truthy guard (`if (index)`) treats 0 as "no index" and
  // wrongly appends; `index !== undefined` lets 0 (and any negative index)
  // reach insert(), which front-inserts for index <= 0 (shared/utils/array.ts).
  // Only an absent index (undefined) appends at the bottom. Real caller:
  // TableView.tsx newRow(name, index, data) — index 0 means "above the first
  // row". Notidian-9fla.
  if (index !== undefined) {
    return {
      ...mdb,
      rows: insert(mdb.rows, index, row),
    };
  }
  return {
    ...mdb,
    rows: [...mdb.rows, row],
  };
};


export const renameTagSpacePath = async (
  superstate: Superstate,
  tag: string,
  newTag: string
) => {

  const spacePath = folderForTagSpace(tag, superstate.settings);

    if (await superstate.spaceManager.pathExists(spacePath)) {
      const renamed = await superstate.spaceManager.renamePath(
        spacePath,
        pathToParentPath(spacePath) + '/' + newTag
      );
      if (!renamed) return;

    } else {
      await deletePath(superstate, spacePath)
      
    }
  await superstate.onTagRenamed(tag, newTag)

};
