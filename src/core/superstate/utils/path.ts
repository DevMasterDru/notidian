import { Superstate } from "makemd-core";
import {
    planHubRowDeleteCascade,
    planHubRowRenameCascade,
} from "core/utils/contexts/hubRowCascade";
import i18n from "shared/i18n";
import { uniq } from "shared/utils/array";
import { movePath, renamePathWithExtension, renamePathWithoutExtension } from "shared/utils/uri";
import { renameTag } from "utils/tags";

// Row-as-child-hub cascade (Notidian-z21a, Atlas Method ADR-0042 D1): keeps a
// hub row's nested child-database folder in sync with its file across
// rename/move/delete, gated behind settings.enableNestedHubRows. A cascade
// failure only notifies — it never blocks or rolls back the primary file
// operation the user actually asked for (same non-blocking-secondary-effect
// contract as the Type Profile table<->hub mirror).
const notePathForIndexedFolder = (superstate: Superstate) => (
    folderPath: string
): string | null => superstate.spacesIndex.get(folderPath)?.space?.notePath ?? null;

const cascadeHubRowRename = async (
    superstate: Superstate,
    oldPath: string,
    newPath: string
): Promise<void> => {
    if (!superstate.settings.enableNestedHubRows) return;
    const plan = planHubRowRenameCascade(
        oldPath,
        newPath,
        notePathForIndexedFolder(superstate)
    );
    if (plan.kind !== "rename") return;
    try {
        await superstate.spaceManager.renameSpace(plan.fromFolder, plan.toFolder);
    } catch (e) {
        superstate.ui.notify(i18n.notice.hubRowCascadeRenameFailed);
    }
};

const cascadeHubRowDelete = async (
    superstate: Superstate,
    path: string
): Promise<void> => {
    if (!superstate.settings.enableNestedHubRows) return;
    const plan = planHubRowDeleteCascade(path, notePathForIndexedFolder(superstate));
    if (plan.kind !== "delete") return;
    try {
        // `deleteSpace` (FilesystemAdapter) treats its argument as a TAG name
        // and re-derives an unrelated Spaces/#tag path — it has no folder call
        // site anywhere else in the codebase (removeSpace's folder branch uses
        // `deletePath` instead, mirrored here). `plan.folder` is a real folder
        // path (e.g. "Knowledge/Gidi"), so `deletePath` is the correct API.
        await superstate.spaceManager.deletePath(plan.folder);
        // `spaceManager.deletePath` is filesystem-only: it never touches
        // spacesIndex/contextsIndex/spacesMap and dispatches no `spaceDeleted`
        // event. Pair it with an explicit onSpaceDeleted, mirroring
        // onTagDeleted's identical `deletePath(spacePath)` ->
        // `onSpaceDeleted(...)` pairing (superstate.ts), so in-memory state
        // stops describing a folder that no longer exists on disk (open
        // views/Navigator nodes for it get the `spaceDeleted` event too).
        superstate.onSpaceDeleted(plan.folder);
    } catch (e) {
        superstate.ui.notify(i18n.notice.hubRowCascadeDeleteFailed);
    }
};

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
        const newPath = renamePathWithExtension(oldPath, newName);
        const result = await superstate.spaceManager.renamePath(oldPath, newPath);
        // Only cascade when the primary file rename actually succeeded.
        // `renamePath` swallows internal failures (e.g. a destination-name
        // collision) and resolves falsy/null rather than throwing, so an
        // unguarded cascade would still rename the sibling folder even though
        // the row's file never moved — desyncing folder from file, the exact
        // failure mode this cascade exists to prevent.
        if (result) {
            await cascadeHubRowRename(superstate, oldPath, newPath);
        }
        return result;
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
    // Guard the cascade on the primary delete actually succeeding — the same
    // "only cascade when the primary op succeeded" contract renamePathByName/
    // movePathToSpace apply via `if (result)`. Unlike `renamePath`,
    // `spaceManager.deletePath` has no internal try/catch of its own (see
    // ObsidianFileSystem.deleteFile): a failure rejects instead of resolving
    // falsy, so it has to be caught here rather than checked as a return
    // value. Without this guard, a failed/incomplete primary delete of the
    // row's own file would still let the (now-real, post-cascade-fix)
    // sibling-folder deletion run — desyncing folder from file exactly like
    // the rename/move case this commit already guards.
    let deleted = true;
    try {
        await superstate.spaceManager.deletePath(path);
    } catch (e) {
        deleted = false;
    }
    if (deleted) {
        superstate.onPathDeleted(path);
        await cascadeHubRowDelete(superstate, path);
    }
}

export const movePathToSpace = async (superstate: Superstate, oldPath: string, newParent: string) => {
    const newPath = movePath(oldPath, newParent);
    const result = await superstate.spaceManager.renamePath(oldPath, newPath);
    // See renamePathByName: only cascade when the primary move succeeded.
    if (result) {
        await cascadeHubRowRename(superstate, oldPath, newPath);
    }
    return result;
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
