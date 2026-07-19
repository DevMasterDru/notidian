export type FilenameTemplateRenameRow = {
  path: string;
  newName: string;
};

export const renameFilesForTemplate = async (
  rows: FilenameTemplateRenameRow[],
  renamePath: (oldPath: string, newPath: string) => Promise<unknown>,
): Promise<number> => {
  const failures: unknown[] = [];
  let renamed = 0;

  for (const row of rows) {
    const parentDir = row.path.includes("/")
      ? row.path.slice(0, row.path.lastIndexOf("/"))
      : "";
    const newPath = parentDir
      ? `${parentDir}/${row.newName}.md`
      : `${row.newName}.md`;
    try {
      const result = await renamePath(row.path, newPath);
      if (!result) {
        throw new Error(`Rename returned no destination for ${row.path}`);
      }
      renamed += 1;
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Renamed ${renamed} file${renamed === 1 ? "" : "s"} (${failures.length} failed).`,
    );
  }
  return renamed;
};
