
import { removeLeadingSlash } from "core/utils/strings";
import { Superstate } from "makemd-core";




    export const pathDisplayName = (path: string, superstate: Superstate) => {
  if (!path) return "";
  
  // Handle special mk-core:// paths
  if (path === "mk-core://settings") {
    return "Settings";
  }
  
  const uri = superstate.spaceManager.uriByString(path);
  if (uri.refType) {
  if (uri.refType == "context") {
    const schema = superstate.contextsIndex
    .get(uri.basePath)
    ?.schemas.find((s) => s.id == uri.ref);
    const space = superstate.spacesIndex.get(uri.basePath);
    if (schema && space) return `${space.name} / ${schema.name}`;
    return "";
  }
  
  if (uri.refType == "action") {
    return superstate.actionsIndex
      .get(uri.basePath)
      ?.find((s) => s.schema.id == uri.ref)?.schema.name;
  }
  return uri.ref
   
  }
  return superstate.pathsIndex.get(uri.basePath)?.name || path;
  
};


    
export const folderPathToString = (path: string) => removeLeadingSlash(path.substring(path.lastIndexOf("/"))) || path;
export const getParentFolderPaths = (path: string): string[] => {
  const folderPaths: string[] = [];
  const parts: string[] = path.split("/");
  let current = "";
  for (let i = 0; i < parts.length; i++) {
    current += `${i === 0 ? "" : "/"}` + parts[i];
    if (current != path) {
      folderPaths.push(current);
    }
  }

  return folderPaths;
};
export const pathToString = (path: string) => {
  if (path.lastIndexOf("/") != -1) {
    // Only treat a "." as an extension boundary when it lies in the BASENAME,
    // i.e. AFTER the last "/". A "." that belongs to a PARENT folder (e.g.
    // "a.b/c") must NOT trigger extension-stripping: doing so would call
    // substring(lastSlash+1, lastDot) with start > end, and String.substring
    // SWAPS the args, leaking a "/"-bearing garbage display name (Notidian-uuco).
    if (path.lastIndexOf(".") > path.lastIndexOf("/"))
      return removeLeadingSlash(
        path.substring(
          path.lastIndexOf("/") + 1,
          path.lastIndexOf(".")
        )
      );
    return removeLeadingSlash(path.substring(path.lastIndexOf("/") + 1));
  }
  if (path.lastIndexOf(".") != -1) {
    return path.substring(0, path.lastIndexOf("."));
  }

  return path;
};

export const pathNameToString = (path: string) => path.substring(0, path.lastIndexOf(".")) || path;
export const getParentPathFromString = (file: string) => {
  const indexOfLastSlash = file.lastIndexOf("/");
  if (indexOfLastSlash == -1) {
    return '/';
  }
  return file.substring(0, indexOfLastSlash + 1);
};

