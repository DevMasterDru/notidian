// DEPTH characterization + property tests for the space-membership engine
// (Notidian-ugjj). src/core/utils/spaces/query.ts is a VISIBILITY-AUTHORITY
// surface: pathByJoins / pathByDef decide which paths a space or waypoint shows,
// and a regression here silently shows or hides rows. The engine had ZERO
// coverage; these tests LOCK its current behavior (and document the genuine
// seed-driven empty-input asymmetries) so any future change to the membership
// logic is a deliberate, reviewed one — not an accident.
//
// Imports compile against the REAL dependencies (filterFnTypes, parseProperty,
// serializeMultiString) so the fixtures exercise the production filter pipeline,
// not a mock of it.
import {
  pathByJoins,
  pathByDef,
  filterPathsForAny,
  filterPathsForAll,
} from "core/utils/spaces/query";
import { PathState } from "shared/types/PathState";
import {
  FilterDef,
  FilterGroupDef,
  JoinDefGroup,
} from "shared/types/spaceDef";

// ---------------------------------------------------------------------------
// Minimal fixtures. PathState requires `path`, `label`, `readOnly`; everything
// the engine reads (parent / spaces / metadata.property / outlinks / inlinks /
// tags) is optional and supplied per test.
// ---------------------------------------------------------------------------
const mkPath = (over: Partial<PathState> & { path: string }): PathState => ({
  label: { name: "", sticker: "", color: "" },
  readOnly: false,
  ...over,
});

// A frontmatter filter (the most common kind; FilterDef = {type,fType} & Filter).
const fm = (field: string, fn: string, value: string): FilterDef => ({
  type: "frontmatter",
  fType: "value",
  field,
  fn,
  value,
});
// A path-cache filter (outlinks / inlinks / tags) — serializeMultiString path.
const pathFilter = (field: string, fn: string, value: string): FilterDef => ({
  type: "path",
  fType: "value",
  field,
  fn,
  value,
});

const group = (
  type: "any" | "all",
  filters: FilterDef[]
): FilterGroupDef => ({ type, trueFalse: true, filters });

const join = (over: Partial<JoinDefGroup> & { path: string }): JoinDefGroup => ({
  recursive: false,
  type: "all",
  groups: [],
  ...over,
});

// ===========================================================================
// pathByJoins — the recursive/non-recursive parent gate, the inclusive
// self-match, the root short-circuit, the empty-path skip, and the startsWith
// path-boundary guard (lines 124-139).
// ===========================================================================
describe("pathByJoins", () => {
  const deep = mkPath({ path: "folder/sub/a.md", parent: "folder/sub" });

  describe("path-boundary gate (startsWith c.path + '/')", () => {
    test("non-recursive: only a DIRECT child of c.path is admitted", () => {
      // boundary passes (folder/sub/a.md startsWith folder/sub/), parent matches
      expect(pathByJoins([join({ path: "folder/sub" })], deep, {})).toBe(true);
    });

    test("non-recursive: a non-direct descendant fails the parent gate", () => {
      // boundary passes (startsWith folder/), but parent 'folder/sub' != 'folder'
      expect(pathByJoins([join({ path: "folder" })], deep, {})).toBe(false);
    });

    test("recursive: any descendant under the boundary is admitted", () => {
      expect(
        pathByJoins([join({ path: "folder", recursive: true })], deep, {})
      ).toBe(true);
    });

    test("'/' separator boundary blocks a sibling-prefix false positive", () => {
      // c.path 'folder/su' is a string prefix of 'folder/sub/a.md' but NOT a
      // path-segment prefix; the engine appends '/' so 'folder/su/' is required,
      // which the path does NOT start with -> no false match.
      expect(
        pathByJoins([join({ path: "folder/su", recursive: true })], deep, {})
      ).toBe(false);
    });

    test("a path NOT under the boundary is skipped (keeps prior accumulator)", () => {
      expect(
        pathByJoins([join({ path: "other", recursive: true })], deep, {})
      ).toBe(false);
    });
  });

  describe("empty c.path is skipped", () => {
    test("an empty join path never matches (c.path.length == 0 short-circuit)", () => {
      expect(pathByJoins([join({ path: "" })], deep, {})).toBe(false);
    });
  });

  describe("root c.path == '/' short-circuits the boundary check", () => {
    test("recursive root admits any path", () => {
      expect(
        pathByJoins([join({ path: "/", recursive: true })], deep, {})
      ).toBe(true);
    });

    test("non-recursive root still enforces the parent gate (only top-level)", () => {
      // boundary skipped, recursive=false -> parent must equal '/'. A deep path's
      // parent is 'folder/sub' -> fails.
      expect(pathByJoins([join({ path: "/" })], deep, {})).toBe(false);
      // A genuine top-level path (parent == '/') passes.
      const top = mkPath({ path: "a.md", parent: "/" });
      expect(pathByJoins([join({ path: "/" })], top, {})).toBe(true);
    });
  });

  describe("inclusive flag — self-match path == c.path", () => {
    const self = mkPath({ path: "folder/sub/a.md", parent: "folder/sub" });

    test("inclusive admits the path that IS the join target (parent gate bypassed)", () => {
      expect(
        pathByJoins([join({ path: "folder/sub/a.md" })], self, {}, true)
      ).toBe(true);
    });

    test("non-inclusive: the path itself fails the boundary (needs c.path + '/')", () => {
      // boundary is c.path + '/' = 'folder/sub/a.md/' which the path is not under.
      expect(
        pathByJoins([join({ path: "folder/sub/a.md" })], self, {}, false)
      ).toBe(false);
    });

    test("inclusive boundary is c.path itself (no trailing slash) so self passes", () => {
      // contrast: inclusive uses startsWith(c.path) not c.path + '/'.
      expect(
        pathByJoins([join({ path: "folder/sub/a.md", recursive: true })], self, {}, true)
      ).toBe(true);
    });
  });

  describe("groups gate after the parent gate", () => {
    const matchable = mkPath({
      path: "folder/a.md",
      parent: "folder",
      metadata: { property: { status: "done" } },
    });

    test("empty groups => admitted on the parent gate alone (c.groups.length == 0)", () => {
      expect(pathByJoins([join({ path: "folder", groups: [] })], matchable, {})).toBe(true);
    });

    test("groups that PASS keep the path", () => {
      expect(
        pathByJoins(
          [
            join({
              path: "folder",
              groups: [group("all", [fm("status", "include", "done")])],
            }),
          ],
          matchable,
          {}
        )
      ).toBe(true);
    });

    test("groups that FAIL reject the path even though the parent gate passed", () => {
      expect(
        pathByJoins(
          [
            join({
              path: "folder",
              groups: [group("all", [fm("status", "include", "nomatch")])],
            }),
          ],
          matchable,
          {}
        )
      ).toBe(false);
    });
  });

  describe("reduce across multiple joins (p || ... short-circuit)", () => {
    const child = mkPath({
      path: "f/a.md",
      parent: "f",
      metadata: { property: { s: "x" } },
    });

    test("once a join matches (p == true), later joins cannot un-match it", () => {
      // first join matches (empty groups), second join is on a different tree.
      expect(
        pathByJoins([join({ path: "f" }), join({ path: "g" })], child, {})
      ).toBe(true);
    });

    test("a non-matching first join is skipped; a later matching join wins", () => {
      expect(
        pathByJoins([join({ path: "g" }), join({ path: "f" })], child, {})
      ).toBe(true);
    });

    test("no joins => not a member (reduce seed is false)", () => {
      expect(pathByJoins([], child, {})).toBe(false);
    });
  });
});

// ===========================================================================
// pathByDef — the AND-vs-OR reduce over FilterGroupDef[] (lines 141-153).
// Seed is `all`. The empty-group passthrough and the seed-driven empty-INPUT
// asymmetry are the subtle, untested behaviors this section locks.
// ===========================================================================
describe("pathByDef", () => {
  const donePath = mkPath({ path: "a.md", metadata: { property: { status: "done" } } });
  const match = group("any", [fm("status", "include", "done")]);
  const miss = group("any", [fm("status", "include", "nope")]);

  describe("OR mode (all == false)", () => {
    test("a single matching group passes", () => {
      expect(pathByDef([match], donePath, {}, false)).toBe(true);
    });

    test("a single failing group fails", () => {
      expect(pathByDef([miss], donePath, {}, false)).toBe(false);
    });

    test("fail then match => true (OR)", () => {
      expect(pathByDef([miss, match], donePath, {}, false)).toBe(true);
    });

    test("match then fail => true (the p|| short-circuit holds the match)", () => {
      expect(pathByDef([match, miss], donePath, {}, false)).toBe(true);
    });

    test("an EMPTY group passes OR immediately (c.filters.length == 0 => true)", () => {
      expect(pathByDef([group("any", [])], donePath, {}, false)).toBe(true);
    });

    test("ASYMMETRY: no groups at all => false (OR seed is false, no iterations)", () => {
      // Locked, not endorsed. With zero groups the reduce returns its seed; for
      // OR that seed is `false`, so an empty filter-set is treated as 'no match'.
      expect(pathByDef([], donePath, {}, false)).toBe(false);
    });
  });

  describe("AND mode (all == true)", () => {
    test("a single matching group passes", () => {
      expect(pathByDef([match], donePath, {}, true)).toBe(true);
    });

    test("a single failing group fails", () => {
      expect(pathByDef([miss], donePath, {}, true)).toBe(false);
    });

    test("match then fail => false (every group must pass)", () => {
      expect(pathByDef([match, miss], donePath, {}, true)).toBe(false);
    });

    test("an EMPTY group is passthrough when the accumulator is still true", () => {
      // match (p stays true) then empty group => true.
      expect(pathByDef([match, group("all", [])], donePath, {}, true)).toBe(true);
    });

    test("an EMPTY group does NOT rescue an already-failed accumulator", () => {
      // the `if (!p) return false` runs BEFORE the empty-group passthrough, so a
      // prior failure stays a failure.
      expect(pathByDef([miss, group("all", [])], donePath, {}, true)).toBe(false);
    });

    test("an empty group FOLLOWED by a failing group still fails", () => {
      expect(pathByDef([group("all", []), miss], donePath, {}, true)).toBe(false);
    });

    test("ASYMMETRY: no groups at all => true (AND seed is true, no iterations)", () => {
      // Locked, not endorsed. Mirror image of the OR case: an empty filter-set in
      // AND mode passes everything (vacuous truth).
      expect(pathByDef([], donePath, {}, true)).toBe(true);
    });
  });

  describe("the empty-group OR/AND asymmetry is genuine and intentional-by-seed", () => {
    test("[] groups: OR => false but AND => true (documented divergence)", () => {
      expect(pathByDef([], donePath, {}, false)).toBe(false);
      expect(pathByDef([], donePath, {}, true)).toBe(true);
    });
  });
});

// ===========================================================================
// filterPathsForAny (OR set-union, no double count) vs filterPathsForAll
// (AND intersection). Production calls these with a single [path]; the
// set-diff / chaining contracts only become observable with multi-path input,
// which is exactly what these tests provide.
// ===========================================================================
describe("filterPathsForAny / filterPathsForAll set semantics", () => {
  const a = mkPath({ path: "a.md", metadata: { property: { s: "done", p: "high" } } });
  const b = mkPath({ path: "b.md", metadata: { property: { s: "todo", p: "high" } } });
  const c = mkPath({ path: "c.md", metadata: { property: { s: "done", p: "low" } } });
  const universe = [a, b, c];

  describe("filterPathsForAny — OR union", () => {
    test("a path matching SEVERAL OR filters is counted exactly once", () => {
      // filter1 (s include done) matches a,c ; filter2 (p include high) matches a,b.
      // 'a' satisfies both but the set-diff removes already-matched paths from the
      // 'remaining' pool, so the union is {a,c,b} with NO duplicate of 'a'.
      const result = filterPathsForAny(
        universe,
        [fm("s", "include", "done"), fm("p", "include", "high")],
        {}
      );
      const paths = result.map((x) => x.path);
      expect(paths).toHaveLength(3);
      expect(new Set(paths)).toEqual(new Set(["a.md", "b.md", "c.md"]));
      // exactly one occurrence of each — the no-double-count guarantee
      expect(paths.filter((x) => x === "a.md")).toHaveLength(1);
    });

    test("union ordering is matched-first, then remaining (filter1's hits precede filter2's)", () => {
      const result = filterPathsForAny(
        universe,
        [fm("s", "include", "done"), fm("p", "include", "high")],
        {}
      ).map((x) => x.path);
      // filter1 matches a,c (in input order); from the remaining {b}, filter2 adds b.
      expect(result).toEqual(["a.md", "c.md", "b.md"]);
    });

    test("no filters => empty result (OR seed accumulates nothing)", () => {
      expect(filterPathsForAny(universe, [], {})).toEqual([]);
    });

    test("a single filter behaves as a plain predicate filter", () => {
      const result = filterPathsForAny(universe, [fm("s", "include", "done")], {}).map(
        (x) => x.path
      );
      expect(result).toEqual(["a.md", "c.md"]);
    });
  });

  describe("filterPathsForAll — AND intersection (chaining)", () => {
    test("each filter narrows the survivors of the previous (intersection)", () => {
      // s=done -> {a,c}; then p=high -> {a}.
      const result = filterPathsForAll(
        universe,
        [fm("s", "include", "done"), fm("p", "include", "high")],
        {}
      ).map((x) => x.path);
      expect(result).toEqual(["a.md"]);
    });

    test("no filters => the whole input survives (AND seed is the input)", () => {
      expect(filterPathsForAll(universe, [], {}).map((x) => x.path)).toEqual([
        "a.md",
        "b.md",
        "c.md",
      ]);
    });

    test("AND vs ANY diverge on the same filters (intersection ⊆ union)", () => {
      const filters = [fm("s", "include", "done"), fm("p", "include", "high")];
      const anyR = filterPathsForAny(universe, filters, {});
      const allR = filterPathsForAll(universe, filters, {});
      expect(anyR.length).toBeGreaterThan(allR.length);
      // every AND survivor is also an OR survivor
      const anyPaths = new Set(anyR.map((x) => x.path));
      for (const p of allR) expect(anyPaths.has(p.path)).toBe(true);
    });
  });

  describe("path-cache filters compile against serializeMultiString (outlinks/tags)", () => {
    const tagged = mkPath({ path: "t.md", tags: ["#a", "#b"], outlinks: ["x.md"] });
    const untagged = mkPath({ path: "u.md", tags: [], outlinks: [] });

    test("a tag include filter matches via the serialized multi-string", () => {
      const result = filterPathsForAny(
        [tagged, untagged],
        [pathFilter("tags", "include", "#a")],
        {}
      ).map((x) => x.path);
      expect(result).toEqual(["t.md"]);
    });

    test("an outlinks include filter matches via the serialized multi-string", () => {
      const result = filterPathsForAll(
        [tagged, untagged],
        [pathFilter("outlinks", "include", "x.md")],
        {}
      ).map((x) => x.path);
      expect(result).toEqual(["t.md"]);
    });
  });
});

// ===========================================================================
// End-to-end: pathByJoins delegating into pathByDef with its `type == 'all'`
// flag. Locks that a join's `type` selects AND vs OR group evaluation.
// ===========================================================================
describe("pathByJoins -> pathByDef integration (join.type selects AND/OR)", () => {
  const p = mkPath({
    path: "folder/a.md",
    parent: "folder",
    metadata: { property: { s: "done", p: "low" } },
  });

  test("join type 'all' requires every group to pass (AND)", () => {
    // group1 matches (s=done), group2 fails (p=high) -> AND fails.
    expect(
      pathByJoins(
        [
          join({
            path: "folder",
            type: "all",
            groups: [
              group("any", [fm("s", "include", "done")]),
              group("any", [fm("p", "include", "high")]),
            ],
          }),
        ],
        p,
        {}
      )
    ).toBe(false);
  });

  test("join type 'any' passes if any group passes (OR)", () => {
    expect(
      pathByJoins(
        [
          join({
            path: "folder",
            type: "any",
            groups: [
              group("any", [fm("s", "include", "done")]),
              group("any", [fm("p", "include", "high")]),
            ],
          }),
        ],
        p,
        {}
      )
    ).toBe(true);
  });
});

// ===========================================================================
// PROPERTY-style invariants (small exhaustive enumerations rather than a fuzz
// dependency, since the repo carries no fast-check). These hold for ALL inputs
// in the enumerated space and pin the engine's algebraic shape.
// ===========================================================================
describe("property invariants", () => {
  // Build a path whose two boolean properties are set independently.
  const makePath = (m1: boolean, m2: boolean): PathState =>
    mkPath({
      path: "x.md",
      metadata: { property: { f1: m1 ? "yes" : "no", f2: m2 ? "yes" : "no" } },
    });
  const g1 = group("all", [fm("f1", "include", "yes")]);
  const g2 = group("all", [fm("f2", "include", "yes")]);

  const bools = [false, true];

  test("OR of two non-empty groups == logical OR of their individual results", () => {
    for (const m1 of bools)
      for (const m2 of bools) {
        const path = makePath(m1, m2);
        const got = pathByDef([g1, g2], path, {}, false);
        expect(got).toBe(m1 || m2);
      }
  });

  test("AND of two non-empty groups == logical AND of their individual results", () => {
    for (const m1 of bools)
      for (const m2 of bools) {
        const path = makePath(m1, m2);
        const got = pathByDef([g1, g2], path, {}, true);
        expect(got).toBe(m1 && m2);
      }
  });

  test("AND result is always a subset (implies) the OR result for the same groups", () => {
    for (const m1 of bools)
      for (const m2 of bools) {
        const path = makePath(m1, m2);
        const andR = pathByDef([g1, g2], path, {}, true);
        const orR = pathByDef([g1, g2], path, {}, false);
        // and => or  (no input where AND passes but OR fails)
        expect(!andR || orR).toBe(true);
      }
  });

  test("filterPathsForAll(universe) ⊆ filterPathsForAny(universe) for any filter list", () => {
    const universe = [makePath(true, true), makePath(true, false), makePath(false, true), makePath(false, false)];
    universe.forEach((p, i) => (p.path = `p${i}.md`));
    const filterSets: FilterDef[][] = [
      [],
      [fm("f1", "include", "yes")],
      [fm("f1", "include", "yes"), fm("f2", "include", "yes")],
    ];
    for (const filters of filterSets) {
      const anyP = new Set(filterPathsForAny(universe, filters, {}).map((x) => x.path));
      const allP = filterPathsForAll(universe, filters, {}).map((x) => x.path);
      // NOTE: the empty-filter case is the one place this subset law breaks, by
      // design — ANY([]) == [] while ALL([]) == universe (each follows its reduce
      // seed). We assert the law for non-empty filters and the documented
      // divergence for the empty case.
      if (filters.length === 0) {
        expect(anyP.size).toBe(0);
        expect(allP.length).toBe(universe.length);
      } else {
        for (const p of allP) expect(anyP.has(p)).toBe(true);
      }
    }
  });

  test("filterPathsForAny never returns a path more than once (no double count)", () => {
    const universe = [makePath(true, true), makePath(true, false), makePath(false, true)];
    universe.forEach((p, i) => (p.path = `q${i}.md`));
    const result = filterPathsForAny(
      universe,
      [fm("f1", "include", "yes"), fm("f2", "include", "yes")],
      {}
    ).map((x) => x.path);
    expect(new Set(result).size).toBe(result.length);
  });
});
