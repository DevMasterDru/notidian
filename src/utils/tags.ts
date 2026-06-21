import { renameTagSpacePath } from "core/utils/contexts/optionValuesForColumn";
import { Superstate } from "makemd-core";
import { pathToString } from "utils/path";
import { encodeSpaceName } from "../core/utils/strings";


export const renameTag = async (
  superstate: Superstate,
  tag: string,
  toTag: string
) => {

  // CASE-FOLD THE INCOMING TAG TO THE CANONICAL REPRESENTATION FIRST.
  // The source `tag` reaches renameTag from spaceState.name (path.ts
  // renamePathByName -> renameTag(superstate, spaceState.name, newName)), and
  // that name is RAW per-file tag casing: fileSystemSpaceInfoFromTag sets
  // `name: tag` verbatim (spaceInfo.ts) and superstate.ts builds tag spaces
  // from per-file `cache.tags` (un-folded). So `tag` can be MIXED-CASE
  // ('#Foo'). But every other tag surface is lowercased:
  //   * readTags() returns a LOWERCASED fold (loadTags ->
  //     Object.keys(getTags()).map(f => f.toLowerCase())), and
  //   * newTag here is ensureTag(validateName(toTag)) — already lowercased.
  // Without folding, getAllSubtags('#Foo') would build prefix '#Foo/' and MISS
  // the lowercased '#foo/bar' descendants readTags() returns, and the
  // case-SENSITIVE recursive `subtag.replace(tag, newTag)` would fail to
  // rewrite a folded subtag against a mixed-case `tag`. Folding `tag` up front
  // makes EVERY comparison (getAllSubtags prefix, pathsForTag, the recursive
  // prefix rewrite, renameTagSpacePath) operate on the same lowercased
  // representation readTags() already returns. ensureTag is the canonical fold
  // used everywhere (it lowercases + guarantees a single leading '#'), and
  // validateName trims first, exactly mirroring how newTag is derived.
  // (Notidian-ehfz; preserves the Notidian-23bl '/'-boundary invariant.)
  const folded = ensureTag(validateName(tag));
  if (!folded) return null;

  // getAllSubtags returns the COMPLETE flat descendant subtree of `folded`
  // (every entry under the `folded/` boundary, at every depth — Notidian-23bl).
  // It is therefore the full, already-flat set of nodes to rename; there is no
  // need to RE-DESCEND it. The previous implementation recursed
  // (`for (const subtag of tags) await renameTag(superstate, subtag, ...)`) and
  // each recursive call RE-FETCHED getAllSubtags, so a descendant at depth d
  // below the renamed root was dispatched d times — O(sum-of-depths) filesystem/
  // property writes and O(sum-of-depths) onTagRenamed events. Idempotent on disk
  // (each redundant pass rewrites the same `folded/` prefix to the same newTag),
  // but wasteful and noisy. Collapsing to a FLAT loop runs the SAME per-node
  // side-effects EXACTLY ONCE each — O(n) total. (Notidian-i9uk)
  const tags = getAllSubtags(superstate, folded);
  const newTag = ensureTag(validateName(toTag));
  const paths = superstate.spaceManager.pathsForTag(folded);
  for (const path of paths) {
    superstate.spaceManager.renameTag(path, folded, newTag);
  }
  await renameTagSpacePath(superstate, folded, newTag);
  for (const subtag of tags) {
    // CASE-FOLD each descendant's SOURCE and TARGET before dispatching, exactly
    // as the recursion it replaced did. The old body was
    // `renameTag(superstate, subtag, subtag.replace(folded, newTag))`, and that
    // recursive call RE-FOLDED both arguments at its top —
    // `ensureTag(validateName(tag))` on the source and
    // `ensureTag(validateName(toTag))` on the target — so it ALWAYS dispatched
    // the canonical LOWERCASED tuples to spaceManager.renameTag /
    // renameTagSpacePath. A flat loop that dispatched the RAW `subtag` would
    // diverge whenever a descendant carries a mixed-case segment: readTags() is
    // only PARTLY folded — its tag-space-FOLDER branch maps `tagPathToTag(name)`
    // (adapters/obsidian/utils/tags.ts loadTags), and tagPathToTag does NOT
    // lowercase, so a folder named '#proj+Alpha' yields the readTags entry
    // '#proj/Alpha' (a '/'-boundaried descendant of folded '#proj' with a
    // MIXED-CASE child). Dispatching that raw would write the non-canonical
    // '#work/Alpha' into file bodies (editTagInFileBody splices newTag verbatim)
    // and into the `tags:` property (editTagInProperties stores
    // stringFromTag(newTag) verbatim), breaking the Notidian-ehfz fold invariant
    // (every stored tag surface lowercased) and, on a case-SENSITIVE filesystem,
    // flipping renameTagSpacePath's renamePath branch to the deletePath else.
    // Folding here keeps the flat loop's tuples IDENTICAL to the recursion's.
    // (replace rewrites only the FIRST/leading occurrence, which the
    // '/'-boundary filter guarantees is exactly the `folded` prefix.)
    // (Notidian-i9uk; preserves Notidian-ehfz + Notidian-23bl.)
    const subtagFolded = ensureTag(validateName(subtag));
    if (!subtagFolded) continue;
    const subtagNewTag = subtagFolded.replace(folded, newTag);
    for (const path of superstate.spaceManager.pathsForTag(subtagFolded)) {
      superstate.spaceManager.renameTag(path, subtagFolded, subtagNewTag);
    }
    await renameTagSpacePath(superstate, subtagFolded, subtagNewTag);
  }
  return newTag
};
export const getAllParentTags = (str: string) => {
  if (str.startsWith('#')) {
    str = str.slice(1);
  }

  const parts = str.split('/');
  const result: string[] = [];

  for (let i = 0; i < parts.length - 1; i++) {
    if (i === 0) {
      result.push(parts[i]);
    } else {
      result.push(result[i - 1] + '/' + parts[i]);
    }
  }

  return result;
};
export const validateName = (tag: string) => {
  return tag.trim();
};
export const getAllSubtags = (superstate: Superstate, tag: string) => {

  const tags = superstate.spaceManager.readTags();
  // A genuine subtag lives BELOW `tag` in the '/'-segmented hierarchy, i.e.
  // it is exactly "<tag>/<child...>". The boundary slash is mandatory: a bare
  // `f.startsWith(tag)` would over-match unrelated SIBLING tags that merely
  // share a textual prefix ('#foo' would capture '#foobar'/'#football'), and
  // renameTag's recursive `subtag.replace(tag, newTag)` would then corrupt
  // those siblings. Requiring `tag + '/'` keeps the recursion confined to the
  // true descendant subtree. (Notidian-23bl)
  const prefix = tag + "/";
  return tags.filter((f) => f.startsWith(prefix));
};
export const tagToTagPath = (tag: string) => {
  return encodeSpaceName(ensureTag(tag));
};

export const tagPathToTag = (string: string) => {
  return pathToString(string).replace(/\+/g, "/");
};

export const ensureTag = (tag: string) => {
  if (!tag) return null;
  let string = tag;
  if (string.charAt(0) != "#") string = "#" + string;
  return string.toLowerCase();
};
export const stringFromTag = (string: string) => {
  if (string.charAt(0) == "#") {
    if (string.charAt(1) == "#") {
      return string.substring(2, string.length);
    }
    return string.substring(1, string.length);
  }

  return string;
};

