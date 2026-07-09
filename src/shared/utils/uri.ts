import { PathRefTypes, URI } from "shared/types/path";
import { removeTrailingSlashFromFolder } from "shared/utils/paths";


export const parseURI = (uri: string): URI => {
  const fullPath= uri;
    //   const nt = uriByStr(uri, source);
    //   return nt;
    // }
    // export const uriByStr = (uri: string, source?: string) => {
      
      let refTypeChar = '';
      let refSigilConsumed = false;
      // decodeURIComponent throws URIError on a malformed percent-escape (a
      // dangling '%', an invalid '%ZZ', a truncated multi-byte sequence). A
      // query is a decoration on the address, never row identity (ADR
      // 0014/0016), so a bad escape must not crash resolution of the whole URI:
      // fall back to the raw substring and keep parseURI total. Well-formed
      // escapes still decode; only the malformed case is caught.
      const safeDecodeURIComponent = (part: string): string => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      };
      const parseQuery = (queryString: string) => {
        const query: { [key: string]: string } = {};
        queryString.split('&').forEach(param => {
          const [key, value] = param.split('=');
          query[safeDecodeURIComponent(key)] = safeDecodeURIComponent(value);
        });
        return query;
      };
    
      const mapRefType = (refTypeChar: string, isSpace: boolean) => {
        if (isSpace) {
          if (refTypeChar === '^') return 'context';
          if (refTypeChar === '*') return 'frame';
          if (refTypeChar === ';') return 'action';
          return null
        }
        if (refTypeChar === '^') return 'block';
        return 'heading';
      };
    
      let space: string | null = null;
      let path: string | null = null;
      let alias: string | null = null;
      let reference: string | null = null;
      let refType: PathRefTypes= null;
      let query: { [key: string]: string } | null = null;
      let scheme: string | null = 'vault';
    
      if (fullPath.indexOf('://') != -1) {
      scheme = uri.slice(0, uri.indexOf('://'))
      const spaceStr = uri.slice(uri.indexOf('://')+3);
        
        if (spaceStr.charAt(0) == "#" || spaceStr.charAt(0) == "$") {
          const endIndex = spaceStr.split('/')[0].lastIndexOf('#');
          if (endIndex > 0) {
            space = removeTrailingSlashFromFolder(spaceStr.slice(0, endIndex))
            uri = spaceStr.slice(endIndex)
          } else {
            space = spaceStr.split('/')[0];
            uri = spaceStr.replace(space, '')
            if (uri.length > 0) {
              uri = uri.slice(1)
            }
            if (uri == '') {
              uri = '/'
            }
          }
        } else {
          const spaceParts = spaceStr.split('/');  
          space = spaceParts[0];
          uri =  (spaceParts.slice(1).join('/') || ''); // Convert the rest back to a relative URI
        }
        
      }
      
    
      const lastSlashIndex = uri.lastIndexOf('/');
      const lastHashIndex = uri.lastIndexOf('#');
      const lastPipeIndex = uri.lastIndexOf('|');
      const queryIndex = uri.lastIndexOf('?');
    let trailSlash = false;
      if (queryIndex !== -1) {
        query = parseQuery(uri.slice(queryIndex + 1));
        uri = uri.slice(0, queryIndex);
      }
    
      if (lastHashIndex !== -1 && lastHashIndex > lastSlashIndex) {
        if (lastHashIndex == lastSlashIndex+1) {
          trailSlash = true
        }
        const refPart = uri.slice(lastHashIndex + 1);
        refType = mapRefType(refPart[0], trailSlash);
        if (refType || lastHashIndex != lastSlashIndex+1) {
        refTypeChar = refPart[0];
        // Only the recognized sigils (^,*,;) are consumed from the front of the
        // ref; for a plain heading/unknown ref the first char is real content
        // and must NOT be dropped (ADR 0014/0016: refs are part of row addressing).
        refSigilConsumed =
          refTypeChar === '^' || refTypeChar === '*' || refTypeChar === ';';
        reference = refSigilConsumed ? refPart.slice(1) : refPart;
        uri = uri.slice(0, lastHashIndex);
        }
      }
    
      if (lastPipeIndex !== -1 && lastPipeIndex > lastSlashIndex) {
        alias = uri.slice(lastPipeIndex + 1);
        uri = uri.slice(0, lastPipeIndex);
      }
      if (uri.charAt(uri.length - 1) == '/') {
        trailSlash = true
      }
    path = uri
      return {
    basePath: removeTrailingSlashFromFolder(`${space ? `${scheme}://${space}/${path != '/' ? path : ''}` : path}`),

        authority: space,
        fullPath,
        scheme,
        path: removeTrailingSlashFromFolder(uri),
        alias: alias,
        ref: reference,
        refType: refType,
        refStr: refSigilConsumed ? refTypeChar+reference : reference,
        query: query,
        trailSlash 
      };
    }

export const movePath = (path: string, newParent: string) : string => {
  const parts = path.split("/")
  const basename = parts[parts.length - 1]
  // Normalize the destination parent so a root/empty/trailing-slash parent does
  // not produce a malformed path. An empty or "/" parent means "root" -> the
  // bare basename (this also aligns movePathToNewSpaceAtIndex, whose existence
  // check already computes the bare name for a "/" parent); a trailing slash is
  // collapsed so "New/" + basename does not yield "New//basename". A trailing
  // slash on the SOURCE (empty basename) is left as-is: there is no basename to
  // fabricate, and no caller produces that shape.
  const parent = removeTrailingSlashFromFolder(newParent)
  if (parent.length == 0 || parent == "/") {
    return basename
  }
  return parent + "/" + basename
}
export const renamePathWithoutExtension = (path: string, newName: string): string => {
  const dir = path.substring(0, path.lastIndexOf("/"));
  return dir.length > 0 ? `${dir}/${newName}` : `${newName}`;
}

export const renamePathWithExtension = (path: string, newName: string): string => {
  const lastSlash = path.lastIndexOf("/");
  const dir = path.substring(0, lastSlash);
  const basename = path.substring(lastSlash + 1);
  // Scope the extension scan to the BASENAME, never the whole path: a dot in a
  // parent folder name must not be mistaken for the file's extension (that would
  // splice the directory tail — including a path separator — into the new name,
  // fabricating a corrupt nested path and silently relocating the row's
  // identity). A leading dot (index 0, e.g. ".gitignore") is part of a dotfile's
  // name, not an extension boundary, so it is excluded. (ADR 0014/0016: paths
  // own row identity.)
  const dotIndex = basename.lastIndexOf(".");
  const ext = dotIndex > 0 ? basename.substring(dotIndex) : "";
  return dir.length > 0 ? `${dir}/${newName}${ext}` : `${newName}${ext}`;
}


export const uriForFolder = (path: string) : URI => {
  return {
    basePath: path,
    fullPath: path,
    authority: null,
    path,
    scheme: 'vault',
    alias: null,
    ref: null,
    refStr: null,
    refType: null,
    query: null,
    trailSlash: true
  };
}


