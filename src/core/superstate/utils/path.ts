import { Superstate } from "makemd-core";
import { uniq } from "shared/utils/array";
import { movePath, renamePathWithExtension, renamePathWithoutExtension } from "shared/utils/uri";
import { renameTag } from "utils/tags";

export const resolvePath = (path: string, source: string, isSpace?: (path: string) => boolean): string => {
    if (!source || !path) return path;
    if (/^https?:\/\//i.test(path)) return path;
    if (path.indexOf('|') != -1) {
        path = path.split('|')[0];
    }
    if (path.indexOf('./') == 0 && source) {
        if (isSpace?.(source)) {
            return source + path.slice(1);
        }
        // Resolve './x' against the parent directory of a non-space source file.
        // When the source is a bare basename (no '/'), its parent directory is
        // the vault root (''), so lastIndexOf('/') === -1. The old
        // `source.slice(0, -1)` silently DROPPED the source's last character
        // (e.g. './a.md' vs 'Note.md' -> 'Note.m/a.md'), producing a corrupt,
        // non-existent path that becomes a wrong row-identity lookup key into
        // paths/spacesIndex (ADR 0014/0016). Guard the -1 case to yield a
        // root-relative 'a.md' (no leading '/', matching the repo-wide invariant
        // that resolved paths never carry a leading slash).
        const lastSlash = source.lastIndexOf('/');
        if (lastSlash === -1) {
            // path is './…'; drop the leading './' so the result is rootless.
            return path.slice(2);
        }
        return source.slice(0, lastSlash) + path.slice(1);
    } else if (path.indexOf('../') == 0 && source) {
        // Resolve '../…' against the source's directory by walking up one
        // directory per leading '..' segment.
        //
        // CONTRACT — over-pop degrades gracefully to a root-equivalent clamp
        // (ratified by ADR 0048, Notidian-ircw):
        // When the number of '..' segments EXCEEDS the source's depth, the loop
        // keeps calling pop() on an already-empty sourceParts array.
        // Array.prototype.pop() on [] returns undefined with NO throw and NO
        // mutation, so the array stays [] and the extra '..' are simply absorbed.
        // The result is the rootless tail (e.g. '../../../a.md' over 'A/B.md' ->
        // 'a.md'; a path-consuming walk like '../../' over 'A/B.md' -> '').
        // This is INTENTIONALLY equivalent to path.resolve's absolute-root clamp
        // under the repo-wide no-leading-slash invariant: path.resolve('/A',
        // '../../../a.md') === '/a.md', and our root-relative model drops the
        // mandatory leading '/', so '/a.md' === 'a.md'. The degradation NEVER
        // emits a leading '/' nor a '//' duplication (locked by the property test
        // in resolvePath.test.ts) and NEVER throws. Over-pop only arises from a
        // MALFORMED link (more '..' than the source has depth); the bare-leaf /
        // '' result is handed downstream as a non-matching/empty lookup key
        // (resolvePath is identity-critical — ADR 0014/0016), which is precisely
        // the dangling-link contract the relation resolver was built around.
        // The explicit-guard alternative (Option A: `if (sourceParts.length > 0)`)
        // is a readability-only follow-up — see ADR 0048 — not a behavior fix:
        // its output equals this for the common case and it carries an asymmetric
        // risk (deterministically re-pointing a malformed link to a real root
        // file). The current graceful behavior is the ratified contract.
        const sourceParts = source.split('/');
        const pathParts = path.split('/');
        sourceParts.pop();
        while (pathParts[0] === '..') {
            sourceParts.pop(); // pop()-on-[] is a no-op once drained: root clamp (ADR 0048)
            pathParts.shift();
        }
        return [...sourceParts, ...pathParts].join('/');
    }
    return path;
};

export const renamePathByName = async (superstate: Superstate, oldPath: string, newName: string) : Promise<string> => {
    if (superstate.spacesIndex.has(oldPath)) {
        const spaceState = superstate.spacesIndex.get(oldPath);
        if (spaceState.type == 'tag') {
            return renameTag(superstate, spaceState.name, newName);
        }
        return superstate.spaceManager.renameSpace(oldPath, renamePathWithoutExtension(oldPath, newName));
    } else {
        return superstate.spaceManager.renamePath(oldPath, renamePathWithExtension(oldPath, newName));
    }
  
}

export const hidePath = async (superstate: Superstate, path: string) => {
    superstate.settings.hiddenFiles = uniq([
      ...superstate.settings.hiddenFiles,
      path,
    ]);
    superstate.ui.notify("Item is now hidden in the Navigator, you can manage hidden items in the Navigator menu.", );
    superstate.saveSettings();
    superstate.reloadPath(path, true).then(f => superstate.dispatchEvent("superstateUpdated", null));
}

export const hidePaths = async (superstate: Superstate, paths: string[]) => {
    superstate.settings.hiddenFiles = uniq([
      ...superstate.settings.hiddenFiles,
      ...paths,
    ]);
    superstate.saveSettings();
    Promise.all(paths.map((path) => {
        superstate.reloadPath(path, true);
    })).then(f => superstate.dispatchEvent("superstateUpdated", null));
}

export const deletePath = async (superstate: Superstate, path: string) => {
    superstate.spaceManager.deletePath(path);
    superstate.onPathDeleted(path);
}

export const movePathToSpace = async (superstate: Superstate, oldPath: string, newParent: string) => {
    return superstate.spaceManager.renamePath(oldPath, movePath(oldPath, newParent));
};
export const convertPathToSpace = async (
  superstate: Superstate,
  path: string,
  open?: boolean
) => {
  const pathState = superstate.pathsIndex.get(path);
  if (!pathState) {
    return;
  }
  const newPath = pathState.parent+'/'+pathState.name
  await superstate.spaceManager.createSpace(pathState.name, pathState.parent, {});
    await superstate.spaceManager.renamePath(path, newPath+'/'+pathState.metadata?.file?.name+'.md');
    superstate.ui.viewsByPath(path).forEach(view => {
      view.openPath(newPath);
  });
  if (open) {
    superstate.ui.openPath(newPath, false);
  }
};
