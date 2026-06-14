import { Superstate } from "makemd-core";

// Shared relation-link resolver (Notidian-e1u). Rollups (8pl/9ln), sub-items
// (gg9/pv4), and back-relations (ahk) all parse a frontmatter relation value
// into link targets and then must resolve each target to a real vault path so
// it can match a pathsIndex key (e.g. "Projects/Alpha.md").
//
// The pure resolvePath (core/superstate/utils/path) only handles ./ ../ relative
// links and alias stripping. It leaves a bare wikilink like [[Projects/Alpha]]
// as "Projects/Alpha" (no extension, so it never matches the "Projects/Alpha.md"
// key) and cannot resolve a basename-only [[Alpha]] to its folder at all. That
// silently dropped real relations authored as plain [[Note]] frontmatter — the
// #1 live-verify caveat for the relations pillar.
//
// spaceManager.resolvePath fixes both: it tries the pure resolver first, then
// falls back to the primary adapter's link index (Obsidian's
// getFirstLinkpathDest) which canonicalizes a linkpath + source into the actual
// file path. It returns the original link unchanged when nothing resolves (never
// null), so a dangling link stays a stable, non-matching key instead of
// crashing or collapsing to "". Resolving once, in this shared layer, keeps all
// three relation features matching identically.
export const makeRelationLinkResolver =
  (superstate: Superstate) =>
  (link: string, sourcePath: string): string =>
    superstate.spaceManager.resolvePath(link, sourcePath) ?? link;
