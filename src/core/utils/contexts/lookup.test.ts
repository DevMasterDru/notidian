import {
  appendPathMetaData,
  appendPathsMetaData,
} from "core/utils/contexts/lookup";
import { PathState } from "shared/types/PathState";

// ---------------------------------------------------------------------------
// CHARACTERIZATION net for src/core/utils/contexts/lookup.ts (Notidian-mna),
// the relation-metadata appender that feeds the relations/rollup engine
// (sibling of relationResolver Notidian-e1u / makeRelationLinkResolver). It is
// pure: appendPathMetaData(propType, pathState) takes a plain PathState (no
// Superstate) and dispatches on propType to read one field off the path and
// stringify it for the serialized relation column; appendPathsMetaData resolves
// a multi-string of paths through superstate.pathsIndex (a Map is the only
// member touched) and re-serializes the per-path lookups.
//
// These tests LOCK the CURRENT behavior. Where that behavior diverges from a
// naive reading (numeric branches can yield `undefined`, not ""; the empty
// result of appendPathsMetaData is the JSON literal "[]", not ""), the divergence
// is pinned ON PURPOSE so a future refactor that "fixes" it is a visible,
// deliberate decision rather than a silent contract break.
//
// UPDATE (Notidian-i9m): the original characterization pinned an optional-chain
// ASYMMETRY — the extension (metadata.extension), sticker (label.sticker), and
// inlinks/outlinks/tags/spaces (serializeMultiDisplayString(<arr>)) branches
// alone read their parent WITHOUT optional chaining and THREW a TypeError on a
// nullish parent, while every sibling branch (numeric + default) optional-chained
// and collapsed to undefined/''. PathState declares metadata/label/inlinks/etc
// OPTIONAL, so a partially-built PathState crashed the relations/rollup column
// build instead of yielding an empty cell. lookup.ts now optional-chains these
// six branches and defaults to '' for PARITY with the numeric/default branches
// (the conservative crash->safe fix; the established in-file convention, not an
// open product call). The assertions below pin the new ''-default behavior.
//
// Stringification reference (production deps, not re-tested here):
//   serializeMultiDisplayString(arr) = arr.map(f=>f.replace(',', '\\,')).join(', ')
//   serializeMultiString(arr)        = JSON.stringify(arr)
//   parseMultiString(str)            = JSON-array form OR comma-split display form
//   parseProperty(null, v)           = type-detected stringify of a scalar/object
// ---------------------------------------------------------------------------

// A fully-populated PathState skeleton. Tests override only the fields the
// branch under exercise reads, so each assertion isolates one propType path.
const makePathState = (over: Partial<PathState> = {}): PathState =>
  ({
    path: "Notes/Doc.md",
    name: "Doc",
    parent: "Notes",
    type: "file",
    subtype: "md",
    label: { name: "Doc", sticker: "lucide//file", color: "" },
    metadata: {},
    properties: {},
    readOnly: false,
    inlinks: [],
    outlinks: [],
    tags: [],
    spaces: [],
    ...over,
  } as PathState);

describe("appendPathMetaData — nullish pathState early guard", () => {
  it("returns '' for a null pathState (the `if (pathState)` guard never enters)", () => {
    // The early guard means a dropped/dangling path produces an empty cell, not
    // a crash — the relations engine tolerates holes by collapsing them to "".
    expect(appendPathMetaData("folder", null as unknown as PathState)).toBe("");
    expect(appendPathMetaData("name", null as unknown as PathState)).toBe("");
    expect(appendPathMetaData("ctime", null as unknown as PathState)).toBe("");
    expect(appendPathMetaData("anything", null as unknown as PathState)).toBe(
      ""
    );
  });

  it("returns '' for an undefined pathState (same guard)", () => {
    expect(appendPathMetaData("name", undefined as unknown as PathState)).toBe(
      ""
    );
    expect(
      appendPathMetaData("inlinks", undefined as unknown as PathState)
    ).toBe("");
  });
});

describe("appendPathMetaData — direct field branches (folder/name/extension)", () => {
  it("folder => pathState.parent (verbatim, including nested folders)", () => {
    expect(appendPathMetaData("folder", makePathState({ parent: "Notes" }))).toBe(
      "Notes"
    );
    expect(
      appendPathMetaData(
        "folder",
        makePathState({ parent: "Work/Projects/Alpha" })
      )
    ).toBe("Work/Projects/Alpha");
  });

  it("folder => '' when parent is the empty string (vault root); undefined parent passes through", () => {
    expect(appendPathMetaData("folder", makePathState({ parent: "" }))).toBe("");
    // Branch assigns parent verbatim; an undefined parent yields undefined (not "").
    expect(
      appendPathMetaData("folder", makePathState({ parent: undefined }))
    ).toBeUndefined();
  });

  it("name => pathState.name (verbatim)", () => {
    expect(appendPathMetaData("name", makePathState({ name: "Doc" }))).toBe(
      "Doc"
    );
    expect(
      appendPathMetaData("name", makePathState({ name: "My File Name" }))
    ).toBe("My File Name");
  });

  it("extension => pathState.metadata?.extension ?? '' (optional-chained, '' default)", () => {
    expect(
      appendPathMetaData(
        "extension",
        makePathState({ metadata: { extension: "md" } })
      )
    ).toBe("md");
    // Present-but-empty extension passes through as "".
    expect(
      appendPathMetaData(
        "extension",
        makePathState({ metadata: { extension: "" } })
      )
    ).toBe("");
    // Key absent on a present metadata object => '' (Notidian-i9m: was undefined).
    expect(
      appendPathMetaData("extension", makePathState({ metadata: {} }))
    ).toBe("");
    // Notidian-i9m: a wholly-absent metadata no longer THROWS — `metadata?.`
    // short-circuits and the branch defaults to '' (parity with numeric/default).
    expect(() =>
      appendPathMetaData("extension", makePathState({ metadata: undefined }))
    ).not.toThrow();
    expect(
      appendPathMetaData("extension", makePathState({ metadata: undefined }))
    ).toBe("");
  });

  it("sticker => pathState.label?.sticker ?? '' (optional-chained, '' default)", () => {
    expect(
      appendPathMetaData(
        "sticker",
        makePathState({ label: { name: "x", sticker: "lucide//star", color: "" } })
      )
    ).toBe("lucide//star");
    expect(
      appendPathMetaData(
        "sticker",
        makePathState({ label: { name: "x", sticker: "", color: "" } })
      )
    ).toBe("");
    // Notidian-i9m: a wholly-absent label no longer THROWS — `label?.`
    // short-circuits and the branch defaults to '' (parity with siblings).
    expect(() =>
      appendPathMetaData(
        "sticker",
        makePathState({ label: undefined as unknown as PathState["label"] })
      )
    ).not.toThrow();
    expect(
      appendPathMetaData(
        "sticker",
        makePathState({ label: undefined as unknown as PathState["label"] })
      )
    ).toBe("");
  });
});

describe("appendPathMetaData — numeric file metadata (ctime/mtime/size)", () => {
  it("ctime/mtime/size => metadata.file.<field>.toString() (deterministic, base-10)", () => {
    const ps = makePathState({
      metadata: { file: { ctime: 1700000000000, mtime: 1700000999999, size: 4096 } },
    });
    expect(appendPathMetaData("ctime", ps)).toBe("1700000000000");
    expect(appendPathMetaData("mtime", ps)).toBe("1700000999999");
    expect(appendPathMetaData("size", ps)).toBe("4096");
  });

  it("stringifies a zero size as '0' (not '' — the value 0 still reaches .toString())", () => {
    // The chain is metadata?.file?.size?.toString(); 0 is not nullish, so the
    // optional `?.` does NOT short-circuit and "0" is produced.
    expect(
      appendPathMetaData("size", makePathState({ metadata: { file: { size: 0 } } }))
    ).toBe("0");
    expect(
      appendPathMetaData("ctime", makePathState({ metadata: { file: { ctime: 0 } } }))
    ).toBe("0");
  });

  it("yields undefined (NOT '') when metadata.file is missing — optional chain short-circuits", () => {
    // CHARACTERIZATION of a divergence from the naive ""-default reading: with
    // metadata present but `file` absent, `metadata?.file?.ctime?.toString()`
    // evaluates to undefined and is returned as-is. It does NOT throw and is
    // NOT coerced to "" — downstream serialization is what tolerates it.
    const noFile = makePathState({ metadata: {} });
    expect(appendPathMetaData("ctime", noFile)).toBeUndefined();
    expect(appendPathMetaData("mtime", noFile)).toBeUndefined();
    expect(appendPathMetaData("size", noFile)).toBeUndefined();
  });

  it("yields undefined when metadata.file exists but the specific field is missing", () => {
    const partial = makePathState({ metadata: { file: { size: 10 } } });
    expect(appendPathMetaData("ctime", partial)).toBeUndefined();
    expect(appendPathMetaData("mtime", partial)).toBeUndefined();
    // ...while a sibling field present on the same file object still resolves.
    expect(appendPathMetaData("size", partial)).toBe("10");
  });

  it("yields undefined (does NOT throw) when metadata itself is undefined — `metadata?` guards the numeric branches", () => {
    // Unlike extension/sticker (which read metadata.extension / label.sticker
    // WITHOUT a `?.`), the numeric branches optional-chain metadata, so a wholly
    // absent metadata is safe here.
    const noMeta = makePathState({ metadata: undefined });
    expect(() => appendPathMetaData("ctime", noMeta)).not.toThrow();
    expect(appendPathMetaData("ctime", noMeta)).toBeUndefined();
    expect(appendPathMetaData("size", noMeta)).toBeUndefined();
  });
});

describe("appendPathMetaData — multi-display link/tag branches (inlinks/outlinks/tags/spaces)", () => {
  it("each => serializeMultiDisplayString(<that array>): comma-joined, member commas escaped", () => {
    const ps = makePathState({
      inlinks: ["Notes/A.md", "Notes/B.md"],
      outlinks: ["Refs/C.md"],
      tags: ["#alpha", "#beta"],
      spaces: ["Space/One", "Space/Two"],
    });
    expect(appendPathMetaData("inlinks", ps)).toBe("Notes/A.md, Notes/B.md");
    expect(appendPathMetaData("outlinks", ps)).toBe("Refs/C.md");
    expect(appendPathMetaData("tags", ps)).toBe("#alpha, #beta");
    expect(appendPathMetaData("spaces", ps)).toBe("Space/One, Space/Two");
  });

  it("escapes the FIRST comma inside a member (serializeMultiDisplayString uses non-global replace)", () => {
    // serializeMultiDisplayString = arr.map(f=>f.replace(',', '\\,')).join(', ')
    // String.replace(',', ...) is non-global: only the first comma per member is
    // escaped. Pinned so the round-trip contract with parseMultiDisplayString is
    // visible.
    expect(
      appendPathMetaData("tags", makePathState({ tags: ["a,b"] }))
    ).toBe("a\\,b");
    // A member with TWO commas: only the first is escaped (documented quirk).
    expect(
      appendPathMetaData("tags", makePathState({ tags: ["a,b,c"] }))
    ).toBe("a\\,b,c");
  });

  it("=> '' for an empty array (nothing to join)", () => {
    expect(appendPathMetaData("inlinks", makePathState({ inlinks: [] }))).toBe(
      ""
    );
    expect(appendPathMetaData("tags", makePathState({ tags: [] }))).toBe("");
  });

  it("=> '' (does NOT throw) when the underlying array is undefined (Notidian-i9m: `?? []` before serialize)", () => {
    // Notidian-i9m fixed the optional-chain asymmetry: inlinks/outlinks/tags/
    // spaces are now defaulted to [] (`pathState.<arr> ?? []`) before reaching
    // serializeMultiDisplayString, so a PathState whose array field is absent
    // collapses to '' instead of throwing a TypeError. PathState declares these
    // OPTIONAL, so a partially-built PathState yields an empty cell rather than
    // crashing the relations/rollup column build (parity with the numeric/default
    // branches). The indexer typically fills [], so this guards the latent gap.
    expect(() =>
      appendPathMetaData("inlinks", makePathState({ inlinks: undefined }))
    ).not.toThrow();
    expect(
      appendPathMetaData("inlinks", makePathState({ inlinks: undefined }))
    ).toBe("");
    expect(
      appendPathMetaData("outlinks", makePathState({ outlinks: undefined }))
    ).toBe("");
    expect(
      appendPathMetaData("tags", makePathState({ tags: undefined }))
    ).toBe("");
    expect(
      appendPathMetaData("spaces", makePathState({ spaces: undefined }))
    ).toBe("");
  });
});

describe("appendPathMetaData — default branch (arbitrary frontmatter property)", () => {
  it("default => parseProperty(null, metadata[propType]) for an unrecognized propType", () => {
    // A plain string property routes through detectPropertyType -> stringify.
    expect(
      appendPathMetaData("status", makePathState({ metadata: { status: "Open" } }))
    ).toBe("Open");
  });

  it("stringifies a numeric frontmatter property deterministically", () => {
    expect(
      appendPathMetaData("priority", makePathState({ metadata: { priority: 3 } }))
    ).toBe("3");
    expect(
      appendPathMetaData("priority", makePathState({ metadata: { priority: 0 } }))
    ).toBe("0");
  });

  it("stringifies a boolean frontmatter property as 'true'/'false'", () => {
    expect(
      appendPathMetaData("done", makePathState({ metadata: { done: true } }))
    ).toBe("true");
    expect(
      appendPathMetaData("done", makePathState({ metadata: { done: false } }))
    ).toBe("false");
  });

  it("=> '' when the metadata key is absent (parseProperty(null, undefined) => '')", () => {
    expect(
      appendPathMetaData("missing", makePathState({ metadata: {} }))
    ).toBe("");
  });

  it("=> '' (no throw) when metadata itself is undefined — default branch optional-chains metadata", () => {
    // value = parseProperty(null, pathState.metadata?.[propType]); the `?.`
    // makes the lookup undefined -> parseProperty returns "".
    const noMeta = makePathState({ metadata: undefined });
    expect(() => appendPathMetaData("status", noMeta)).not.toThrow();
    expect(appendPathMetaData("status", noMeta)).toBe("");
  });

  it("serializes an array-valued frontmatter property via parseProperty (option-multi -> JSON)", () => {
    // detectPropertyType on a string[] with no links => option-multi =>
    // serializeMultiString (JSON array).
    expect(
      appendPathMetaData(
        "labels",
        makePathState({ metadata: { labels: ["red", "blue"] } })
      )
    ).toBe('["red","blue"]');
  });

  it("does not collide with a reserved propType: a metadata key NAMED like a branch never reaches default", () => {
    // 'name' is a dedicated branch reading pathState.name, so a metadata.name is
    // ignored entirely — proves the dispatch order, not the default branch.
    expect(
      appendPathMetaData(
        "name",
        makePathState({ name: "RealName", metadata: { name: "ShadowName" } })
      )
    ).toBe("RealName");
  });
});

// ---------------------------------------------------------------------------
// appendPathsMetaData(superstate, propType, pathsString)
// Only superstate.pathsIndex (a Map<path, PathState>) is touched, so the fake
// superstate is just that Map. Flow: parseMultiString(pathsString) ->
// .map(pathsIndex.get) -> .filter(Boolean) [drops unknown paths] ->
// serializeMultiString(filtered.map(p => appendPathMetaData(propType, p))).
// ---------------------------------------------------------------------------

const makeSuperstate = (entries: Record<string, PathState>) =>
  ({ pathsIndex: new Map(Object.entries(entries)) } as any);

const idx = () =>
  makeSuperstate({
    "Projects/Alpha.md": makePathState({
      name: "Alpha",
      parent: "Projects",
      metadata: { file: { size: 10 } },
    }),
    "Projects/Beta.md": makePathState({
      name: "Beta",
      parent: "Projects",
      metadata: { file: { size: 20 } },
    }),
  });

describe("appendPathsMetaData — resolution + serialization round-trip", () => {
  it("maps each known path through appendPathMetaData and JSON-array serializes the results", () => {
    const result = appendPathsMetaData(
      idx(),
      "name",
      "Projects/Alpha.md, Projects/Beta.md"
    );
    expect(result).toBe('["Alpha","Beta"]');
  });

  it("accepts the JSON-array input form (parseMultiString reads a leading '[')", () => {
    // parseMultiString routes a string starting with "[" through JSON.parse,
    // so both the comma-display form and the JSON form resolve identically.
    expect(
      appendPathsMetaData(
        idx(),
        "name",
        '["Projects/Alpha.md","Projects/Beta.md"]'
      )
    ).toBe('["Alpha","Beta"]');
  });

  it("DROPS unknown paths via .filter(Boolean) (pathsIndex.get => undefined => filtered out)", () => {
    // A dangling path is silently removed rather than appearing as an empty
    // member — the surviving known path is the only one serialized.
    expect(
      appendPathsMetaData(idx(), "name", "Projects/Alpha.md, Ghost/Missing.md")
    ).toBe('["Alpha"]');
  });

  it("preserves input order of the surviving known paths", () => {
    expect(
      appendPathsMetaData(idx(), "name", "Projects/Beta.md, Projects/Alpha.md")
    ).toBe('["Beta","Alpha"]');
  });

  it("returns the JSON literal '[]' (NOT '') for empty input — serializeMultiString([])", () => {
    // CHARACTERIZATION of a divergence from a naive ""-default reading: with no
    // paths, serializeMultiString([]) = JSON.stringify([]) = "[]". An empty
    // relation column is the string "[]", which parseMultiString later reads
    // back to [].
    expect(appendPathsMetaData(idx(), "name", "")).toBe("[]");
  });

  it("returns '[]' when ALL paths are unknown (everything filtered out)", () => {
    expect(
      appendPathsMetaData(idx(), "name", "Ghost/A.md, Ghost/B.md")
    ).toBe("[]");
  });

  it("applies the SAME propType dispatch per resolved path (size => stringified file size)", () => {
    expect(
      appendPathsMetaData(
        idx(),
        "size",
        "Projects/Alpha.md, Projects/Beta.md"
      )
    ).toBe('["10","20"]');
  });

  it("propagates appendPathMetaData's undefined for a propType the resolved path can't satisfy", () => {
    // The Alpha/Beta entries have metadata.file but no `ctime`; each per-path
    // append yields undefined, and JSON.stringify serializes undefined array
    // members as null — pinned so the empty-numeric-field round-trip is explicit.
    expect(
      appendPathsMetaData(
        idx(),
        "ctime",
        "Projects/Alpha.md, Projects/Beta.md"
      )
    ).toBe("[null,null]");
  });
});
