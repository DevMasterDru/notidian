import { SpaceSort } from "shared/types/spaceDef";
import { parseLinkString } from "utils/parsers";
import { pathToString } from "utils/path";

//named parsers for converting strings to values

export const parseSortStrat = (str: string): SpaceSort => {
  const [a, b] = str.split("_");
  return { field: a, asc: b == "asc", group: true, recursive: true };
};

// A wikilink alias (`[[target|alias]]`) is the AUTHORED human-facing label and
// must be used VERBATIM — never re-derived from the path. The kg81 sub-item
// writer (subItemCreate.ts) deliberately stores `[[Folder/Parent|Parent]]` where
// the alias is the parent's full basename WITH any internal periods intact (only
// a trailing `.md` is stripped). Routing the alias-bearing link back through
// pathToString(parseLinkString(...)) discards the alias (parseLinkString returns
// the target BEFORE the "|") and then truncates the bare target at its last "."
// (pathToString treats it as a file extension), mangling any period-bearing
// basename — "Q1.Report" -> "Q1", "v1.2" -> "v1", "U.S. Strategy" -> "U" — a
// data-fidelity regression on the exact parent-link path this targets
// (Notidian-xsau). So: prefer the alias as-is; only fall back to deriving the
// display name from the bare/aliasless target.
export const parseLinkDisplayString = (string: string) => {
  const alias = parseLinkAlias(string);
  if (alias) return alias;
  return pathToString(parseLinkString(string));
};

// Returns the wikilink alias (the segment after "|" inside `[[...|...]]`),
// trimmed, or "" when the input is not an alias-bearing wikilink. Mirrors the
// `[[...]]` extraction in parseLinkString so the two stay in lockstep.
const parseLinkAlias = (string: string): string => {
  if (!string) return "";
  const match = /\[\[(.*?)\]\]/.exec(string);
  if (!match || match.length < 2) return "";
  const pipeIndex = match[1].indexOf("|");
  if (pipeIndex < 0) return "";
  return match[1].substring(pipeIndex + 1).trim();
};
