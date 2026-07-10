import {
  insert,
  insertMulti,
  onlyUniqueProp,
  onlyUniquePropCaseInsensitive,
  orderArrayByArrayWithKey,
  orderStringArrayByArray,
  stableCanonicalByKey,
  uniq,
  uniqByKey,
  uniqCaseInsensitive,
  uniqueCopyName,
  uniqueNameFromString,
} from "./array";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — property + characterization tests for src/shared/utils/array.ts
// (Notidian-u3u). This module had ZERO coverage yet is load-bearing:
//
//   - orderStringArrayByArray  backs COLUMN ordering (cacheParsers.ts:88,
//     newPaths = orderStringArrayByArray(paths, contextPaths)).
//   - orderArrayByArrayWithKey backs SPACE/ROW ordering (superstate.ts:816,
//     ordered by spaceOrder() on the 'path' key).
//   - uniqueNameFromString     backs COLUMN-NAME / schema-id / frame-id dedup
//     (filesystemAdapter, frames/*, ContextEditorContext, SpaceListProperty…).
//   - insert / insertMulti     back row reordering (pathUpdates.ts, context.ts,
//     FrameEditorRootContext) — note the `!index` falsy-zero branch.
//   - uniqCaseInsensitive      backs frontmatter-key dedup (PropertiesView.tsx).
//
// Everything here is pure / offline — no vault, no DOM, no I/O.
//
// CORRECTED (ADR 0025, Option B — accepted). The two comparators were formerly
// NON-REFLEXIVE and NON-TRANSITIVE (the `else` branch returned -1 even when
// A === B, and two items both absent from `order` compared via that same branch),
// mutated the caller's array in place, and emitted absent items in REVERSED input
// order as an artifact of V8 TimSort. They are now a stable, reflexive, total
// order and NON-MUTATING: present items first by order-index, absent items kept
// in INPUT order (stable-sort tie-break on a 0 comparison), returning a NEW
// array. The present-first invariant callers actually depend on is unchanged and
// property-tested below. Closes Notidian-e8e (folds in Notidian-9v6).
// ---------------------------------------------------------------------------

// --- tiny deterministic PRNG (no external dep) -----------------------------
// mulberry32: a fast, well-distributed, fully deterministic 32-bit generator so
// property runs are reproducible across machines/CI without a fixture file.
const makeRng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const randInt = (rng: () => number, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));
const PROPERTY_RUNS = 300;

// =========================================================================
// insert
// =========================================================================
describe("insert", () => {
  it("prepends at index 0 (the !index falsy-zero branch)", () => {
    expect(insert(["a", "b"], 0, "X")).toEqual(["X", "a", "b"]);
  });
  it("inserts in the middle at a positive index", () => {
    expect(insert(["a", "b", "c"], 1, "X")).toEqual(["a", "X", "b", "c"]);
  });
  it("appends at index === length", () => {
    expect(insert(["a", "b"], 2, "X")).toEqual(["a", "b", "X"]);
  });
  it("appends (clamps) when index > length", () => {
    expect(insert(["a", "b"], 5, "X")).toEqual(["a", "b", "X"]);
  });
  it("prepends for a negative index (index <= 0 branch)", () => {
    expect(insert(["a", "b"], -1, "X")).toEqual(["X", "a", "b"]);
    expect(insert(["a", "b"], -100, "X")).toEqual(["X", "a", "b"]);
  });
  it("handles the empty array at index 0", () => {
    expect(insert([], 0, "X")).toEqual(["X"]);
  });
  it("handles the empty array at an out-of-range positive index", () => {
    expect(insert([], 3, "X")).toEqual(["X"]);
  });
  it("is pure — returns a NEW array and does not mutate the input", () => {
    const input = ["a", "b"];
    const out = insert(input, 1, "X");
    expect(out).not.toBe(input);
    expect(input).toEqual(["a", "b"]);
  });

  it("property: result length is always input length + 1 and contains the item", () => {
    const rng = makeRng(0xa11ce);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const len = randInt(rng, 0, 12);
      const arr = Array.from({ length: len }, (_, i) => i);
      const index = randInt(rng, -3, len + 3);
      const item = 999;
      const out = insert(arr, index, item);
      expect(out.length).toBe(len + 1);
      expect(out).toContain(item);
      // For a strictly-in-range positive index the item lands exactly there.
      if (index > 0 && index <= len) {
        expect(out[index]).toBe(item);
      } else {
        // 0, negative, or > length all resolve to a boundary placement that
        // keeps the original elements in their original relative order.
        expect(out.filter((x) => x !== item)).toEqual(arr);
      }
    }
  });
});

// =========================================================================
// insertMulti
// =========================================================================
describe("insertMulti", () => {
  it("prepends the block at index 0 (the !index falsy-zero branch)", () => {
    expect(insertMulti(["a", "b"], 0, ["X", "Y"])).toEqual([
      "X",
      "Y",
      "a",
      "b",
    ]);
  });
  it("inserts the block at a positive index, preserving block order", () => {
    expect(insertMulti(["a", "b"], 1, ["X", "Y"])).toEqual([
      "a",
      "X",
      "Y",
      "b",
    ]);
  });
  it("appends the block when index > length", () => {
    expect(insertMulti(["a", "b"], 5, ["X", "Y"])).toEqual([
      "a",
      "b",
      "X",
      "Y",
    ]);
  });
  it("prepends the block for a negative index", () => {
    expect(insertMulti(["a", "b"], -2, ["X"])).toEqual(["X", "a", "b"]);
  });
  it("is a no-op (returns a copy) when the inserted block is empty", () => {
    expect(insertMulti(["a", "b"], 1, [])).toEqual(["a", "b"]);
    expect(insertMulti(["a", "b"], 0, [])).toEqual(["a", "b"]);
  });
  it("handles the empty base array", () => {
    expect(insertMulti([], 0, ["X", "Y"])).toEqual(["X", "Y"]);
    expect(insertMulti([], 3, ["X"])).toEqual(["X"]);
  });
  it("is pure — returns a NEW array and does not mutate the inputs", () => {
    const base = ["a", "b"];
    const block = ["X"];
    const out = insertMulti(base, 1, block);
    expect(out).not.toBe(base);
    expect(base).toEqual(["a", "b"]);
    expect(block).toEqual(["X"]);
  });

  it("property: result length is base+block and both subsequences survive in order", () => {
    const rng = makeRng(0xb0b);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const baseLen = randInt(rng, 0, 10);
      const blockLen = randInt(rng, 0, 5);
      const base = Array.from({ length: baseLen }, (_, i) => i);
      const block = Array.from({ length: blockLen }, (_, i) => 1000 + i);
      const index = randInt(rng, -2, baseLen + 2);
      const out = insertMulti(base, index, block);
      expect(out.length).toBe(baseLen + blockLen);
      // The base elements keep their relative order…
      expect(out.filter((x) => x < 1000)).toEqual(base);
      // …and the block keeps its relative order, contiguously.
      expect(out.filter((x) => x >= 1000)).toEqual(block);
    }
  });
});

// =========================================================================
// uniq
// =========================================================================
describe("uniq", () => {
  it("removes duplicates preserving first-seen order", () => {
    expect(uniq([1, 1, 2, 3, 3, 2])).toEqual([1, 2, 3]);
  });
  it("returns [] for an empty array", () => {
    expect(uniq([])).toEqual([]);
  });
  it("uses SameValueZero identity (objects compared by reference)", () => {
    const a = { x: 1 };
    const b = { x: 1 };
    expect(uniq([a, a, b])).toEqual([a, b]);
  });
  it("returns a new array (does not mutate input)", () => {
    const input = [1, 2, 2];
    const out = uniq(input);
    expect(out).not.toBe(input);
    expect(input).toEqual([1, 2, 2]);
  });

  it("property: output has no duplicates and is a stable subsequence of input", () => {
    const rng = makeRng(0xc0ffee);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const len = randInt(rng, 0, 20);
      const arr = Array.from({ length: len }, () => randInt(rng, 0, 5));
      const out = uniq(arr);
      expect(new Set(out).size).toBe(out.length); // no dupes
      // first-occurrence order: filtering the input to first-seen == output.
      const seen = new Set<number>();
      const firstSeen = arr.filter((x) =>
        seen.has(x) ? false : (seen.add(x), true)
      );
      expect(out).toEqual(firstSeen);
    }
  });
});

// =========================================================================
// uniqCaseInsensitive
// =========================================================================
describe("uniqCaseInsensitive", () => {
  // CORRECTED (ADR 0025 / Notidian-9v6): dedup keeps the FIRST-seen casing,
  // matching the PropertiesView intent and mirroring `uniq`'s first-seen
  // semantics. (Previously `new Map(...).values()` overwrote the value on a
  // duplicate key and kept the LAST-seen casing — that latent defect is now
  // fixed.)
  it("dedupes case-insensitively, keeping first-seen POSITION", () => {
    const out = uniqCaseInsensitive(["Abc", "abc", "ABC", "def"]);
    expect(out.length).toBe(2);
    expect(out[1]).toBe("def");
  });
  it("keeps the FIRST-seen casing for a collision (corrected, the intended behavior)", () => {
    expect(uniqCaseInsensitive(["Abc", "abc", "ABC"])).toEqual(["Abc"]);
    expect(uniqCaseInsensitive(["a", "A"])).toEqual(["a"]);
    expect(uniqCaseInsensitive(["A", "a"])).toEqual(["A"]);
  });
  it("leaves already-distinct casings untouched", () => {
    expect(uniqCaseInsensitive(["alpha", "beta", "gamma"])).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });
  it("returns [] for an empty array", () => {
    expect(uniqCaseInsensitive([])).toEqual([]);
  });

  it("property: output is case-insensitively unique and as long as the distinct-key count", () => {
    const rng = makeRng(0xfeed);
    const pool = ["a", "A", "b", "B", "cc", "CC", "Dd", "dD"];
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const len = randInt(rng, 0, 12);
      const arr = Array.from(
        { length: len },
        () => pool[randInt(rng, 0, pool.length - 1)]
      );
      const out = uniqCaseInsensitive(arr);
      const lowered = out.map((s) => s.toLowerCase());
      expect(new Set(lowered).size).toBe(out.length);
      expect(out.length).toBe(new Set(arr.map((s) => s.toLowerCase())).size);
    }
  });
});

// =========================================================================
// uniqByKey  (row-level first-seen dedup — the m_fields sibling of
//             uniqCaseInsensitive; Notidian-buqr)
// =========================================================================
describe("uniqByKey", () => {
  it("keeps the FIRST-seen row per key and drops later duplicates, preserving order", () => {
    const rows = [
      { name: "Status", schemaId: "s1", source: "" },
      { name: "status", schemaId: "s1", source: "notidian" },
      { name: "Owner", schemaId: "s1", source: "" },
    ];
    const out = uniqByKey(rows, (r) =>
      JSON.stringify([r.schemaId, r.name.toLowerCase()])
    );
    // Only the first "Status" survives; its casing AND its whole payload are kept.
    expect(out).toEqual([
      { name: "Status", schemaId: "s1", source: "" },
      { name: "Owner", schemaId: "s1", source: "" },
    ]);
  });

  it("keeps the surviving row WHOLE — never merges fields or prefers a later row by source/authority", () => {
    // The later case-variant carries an explicit source:"notidian" marker. A
    // source-weighted tie-break (the reverted Notidian-buqr design) would let it
    // win and flip the field's authority. First-seen-whole-row must NOT: the
    // frontmatter-canonical (source:"") first row survives untouched.
    const rows = [
      { name: "Title", schemaId: "s1", source: "", type: "text" },
      { name: "TITLE", schemaId: "s1", source: "notidian", type: "flex" },
    ];
    const out = uniqByKey(rows, (r) =>
      JSON.stringify([r.schemaId, r.name.toLowerCase()])
    );
    expect(out).toEqual([
      { name: "Title", schemaId: "s1", source: "", type: "text" },
    ]);
  });

  it("scopes the key: same name on DIFFERENT schemaIds is preserved (the m_fields norm)", () => {
    const rows = [
      { name: "Name", schemaId: "a" },
      { name: "name", schemaId: "b" },
      { name: "NAME", schemaId: "a" },
    ];
    const out = uniqByKey(rows, (r) =>
      JSON.stringify([r.schemaId, r.name.toLowerCase()])
    );
    // a/Name and b/name are distinct; the second a/NAME collapses into a/Name.
    expect(out).toEqual([
      { name: "Name", schemaId: "a" },
      { name: "name", schemaId: "b" },
    ]);
  });

  it("mirrors uniqCaseInsensitive's surviving name for a single schema's column list", () => {
    // Parity guarantee: for one schemaId, the survivor names uniqByKey keeps must
    // equal exactly what uniqCaseInsensitive keeps for the same column order — so
    // m_fields and the physical data table (folded by uniqCaseInsensitive in
    // replaceDB) never disagree on the surviving casing/set.
    const cols = ["File", "Created", "Status", "status", "STATUS"];
    const rows = cols.map((name) => ({ name, schemaId: "ctx" }));
    const out = uniqByKey(rows, (r) =>
      JSON.stringify([r.schemaId, r.name.toLowerCase()])
    ).map((r) => r.name);
    expect(out).toEqual(uniqCaseInsensitive(cols));
    expect(out).toEqual(["File", "Created", "Status"]);
  });

  it("returns [] for an empty array", () => {
    expect(uniqByKey([] as { name: string }[], (r) => r.name)).toEqual([]);
  });
});

// =========================================================================
// stableCanonicalByKey  (deterministic, order-preserving pre-sort for a
//   first-seen fold — Notidian-rcvg)
//
// A first-seen dedup (uniqCaseInsensitive / uniqByKey) keeps whichever member of
// a collision group appears FIRST, so its survivor depends on the incoming array
// order. replaceDB runs TWO such folds — the m_fields ROW fold and the physical
// COLUMN fold — over independently-built (and thus differently-ordered) arrays;
// left order-dependent they can keep DIFFERENT casings for one field and churn a
// field's kept definition across save-path assemblies. stableCanonicalByKey makes
// each fold's survivor a pure function of the group's CONTENTS (not its order) via
// an authority-neutral name-string tie-break, so both folds agree and the survivor
// is stable across any input permutation.
// =========================================================================
describe("stableCanonicalByKey", () => {
  const lower = (s: string) => s.toLowerCase();
  const idFn = (s: string) => s;
  const rowKey = (r: { name: string; schemaId: string }) =>
    JSON.stringify([r.schemaId, r.name.toLowerCase()]);
  const rowRank = (r: { name: string }) => r.name;

  it("is the identity (order-preserving) when there are no key collisions", () => {
    expect(
      stableCanonicalByKey(["File", "Created", "Status"], lower, idFn)
    ).toEqual(["File", "Created", "Status"]);
  });

  it("moves the lexicographically-smallest member of a collision group to the front of that group", () => {
    // "Status" ('S' 0x53) < "status" ('s' 0x73): the SAME member wins regardless
    // of input order — this is what makes the downstream first-seen fold determinate.
    expect(stableCanonicalByKey(["status", "Status"], lower, idFn)).toEqual([
      "Status",
      "status",
    ]);
    expect(stableCanonicalByKey(["Status", "status"], lower, idFn)).toEqual([
      "Status",
      "status",
    ]);
  });

  it("keeps each collision group at the position of its FIRST occurrence (non-colliding order preserved)", () => {
    // The status-group first appears at index 0, Created at index 1: the group
    // stays put; only its INTERNAL order becomes deterministic. After a first-seen
    // fold the surviving distinct columns keep their original relative positions.
    expect(
      stableCanonicalByKey(["status", "Created", "Status"], lower, idFn)
    ).toEqual(["Status", "status", "Created"]);
  });

  it("is order-INDEPENDENT: every permutation of the same multiset yields the same fold survivor set", () => {
    const survivor = (arr: string[]) =>
      new Set(uniqCaseInsensitive(stableCanonicalByKey(arr, lower, idFn)));
    const expected = new Set(["File", "Status", "Created"]);
    for (const p of [
      ["File", "Status", "status", "Created"],
      ["status", "File", "Created", "Status"],
      ["Created", "status", "Status", "File"],
      ["Status", "Created", "File", "status"],
    ]) {
      expect(survivor(p)).toEqual(expected);
    }
  });

  it("cross-fold parity: uniqCaseInsensitive over cols and uniqByKey over rows keep the SAME casing even from OPPOSITE input orders", () => {
    // The exact drift the bead names: builders assembled the m_fields rows and the
    // data-table cols in opposite orders. Pre-sorting BOTH with stableCanonicalByKey
    // makes the two independent folds pick the identical survivor casing.
    const cols = ["Status", "status"];
    const rows = ["status", "Status"].map((name) => ({ name, schemaId: "s" }));
    const colSurvivor = uniqCaseInsensitive(
      stableCanonicalByKey(cols, lower, idFn)
    );
    const rowSurvivor = uniqByKey(
      stableCanonicalByKey(rows, rowKey, rowRank),
      rowKey
    ).map((r) => r.name);
    expect(rowSurvivor).toEqual(colSurvivor);
    expect(rowSurvivor).toEqual(["Status"]);
  });

  it("is authority-neutral: the tie-break reads ONLY the rank string, never a source/owner field", () => {
    // The LATER case-variant carries source:"notidian". A source-weighted winner
    // (the reverted design that crossed the ADR 0001/0014/0017 boundary) would let
    // it win. stableCanonicalByKey ranks by NAME only, so the lexicographically-
    // smallest name's row survives WHOLE — here the frontmatter-canonical row.
    const rows = [
      { name: "title", schemaId: "s", source: "notidian", type: "flex" },
      { name: "Title", schemaId: "s", source: "", type: "text" },
    ];
    const out = uniqByKey(
      stableCanonicalByKey(
        rows,
        (r) => JSON.stringify([r.schemaId, r.name.toLowerCase()]),
        (r) => r.name
      ),
      (r) => JSON.stringify([r.schemaId, r.name.toLowerCase()])
    );
    expect(out).toEqual([
      { name: "Title", schemaId: "s", source: "", type: "text" },
    ]);
  });

  it("scopes the group by the full key: same name on different schemaIds is never merged", () => {
    const rows = [
      { name: "name", schemaId: "b" },
      { name: "Name", schemaId: "a" },
      { name: "NAME", schemaId: "a" },
    ];
    const out = uniqByKey(stableCanonicalByKey(rows, rowKey, rowRank), rowKey);
    // Within a/{Name,NAME} the name-rank winner is "NAME" ('A' 0x41 < 'a' 0x61, so
    // "NAME" < "Name") — deterministic, not input-order-first. b/name is a distinct
    // group (different schemaId), never merged.
    expect(out).toEqual([
      { name: "name", schemaId: "b" },
      { name: "NAME", schemaId: "a" },
    ]);
  });

  it("does not mutate the input array", () => {
    const input = ["status", "Status", "File"];
    stableCanonicalByKey(input, lower, idFn);
    expect(input).toEqual(["status", "Status", "File"]);
  });

  it("returns [] for an empty array", () => {
    expect(stableCanonicalByKey([] as string[], lower, idFn)).toEqual([]);
  });

  it("property: output is a permutation of the input and the fold survivor is permutation-invariant", () => {
    const rng = makeRng(0x5ca1ab1e);
    const pool = ["a", "A", "b", "B", "Cc", "cC", "d", "D"];
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const len = randInt(rng, 0, 12);
      const arr = Array.from(
        { length: len },
        () => pool[randInt(rng, 0, pool.length - 1)]
      );
      const canon = stableCanonicalByKey(arr, lower, idFn);
      // same multiset (a permutation)
      expect([...canon].sort()).toEqual([...arr].sort());
      // shuffle and re-canonicalize: the folded survivor set is identical
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = randInt(rng, 0, i);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      expect(
        new Set(uniqCaseInsensitive(stableCanonicalByKey(shuffled, lower, idFn)))
      ).toEqual(new Set(uniqCaseInsensitive(canon)));
    }
  });
});

// =========================================================================
// uniqueNameFromString  (column-name / schema-id / frame-id dedup)
// =========================================================================
describe("uniqueNameFromString", () => {
  it("returns the name unchanged when not present", () => {
    expect(uniqueNameFromString("a", ["b", "c"])).toBe("a");
  });
  it("returns the name unchanged for empty cols", () => {
    expect(uniqueNameFromString("a", [])).toBe("a");
  });
  it("appends 1 on the first collision", () => {
    expect(uniqueNameFromString("a", ["a"])).toBe("a1");
  });
  it("walks the collision chain: a vs [a,a1,a2] -> a3", () => {
    expect(uniqueNameFromString("a", ["a", "a1", "a2"])).toBe("a3");
  });
  it("fills the FIRST available gap rather than max+1: a vs [a,a2] -> a1", () => {
    expect(uniqueNameFromString("a", ["a", "a2"])).toBe("a1");
  });
  it("is case-sensitive: 'A' vs ['a'] stays 'A'", () => {
    expect(uniqueNameFromString("A", ["a"])).toBe("A");
  });
  it("characterization: an empty name colliding with [''] becomes '1'", () => {
    expect(uniqueNameFromString("", [""])).toBe("1");
  });
  it("handles a long collision chain deterministically", () => {
    const cols = ["x", "x1", "x2", "x3", "x4"];
    expect(uniqueNameFromString("x", cols)).toBe("x5");
  });
  it("does not mutate the cols array", () => {
    const cols = ["a", "a1"];
    uniqueNameFromString("a", cols);
    expect(cols).toEqual(["a", "a1"]);
  });

  it("property: the returned name is always absent from cols (never throws, always unique)", () => {
    const rng = makeRng(0x5eed);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const base = ["a", "b", "c"][randInt(rng, 0, 2)];
      // Build a random subset of the collision chain plus noise.
      const cols: string[] = [];
      const chainLen = randInt(rng, 0, 6);
      for (let i = 0; i < chainLen; i++) {
        if (rng() < 0.7) cols.push(i === 0 ? base : base + i);
      }
      // noise
      for (let i = 0; i < randInt(rng, 0, 4); i++) cols.push("noise" + i);
      const result = uniqueNameFromString(base, cols);
      expect(cols).not.toContain(result);
      expect(typeof result).toBe("string");
    }
  });
});

// =========================================================================
// uniqueCopyName  (templated-copy collision naming — Notidian-ksrb)
// =========================================================================
describe("uniqueCopyName", () => {
  it("keeps the requested base when it does not collide, re-appending the ext", () => {
    expect(uniqueCopyName("Meeting Notes", ["Task Template"], "md")).toBe(
      "Meeting Notes.md"
    );
  });

  // The core Notidian-ksrb regression: a templated row-create where the user's
  // title ("Meeting Notes") already exists must dedup from the USER TITLE, never
  // from the template basename ("Task Template") that copyFile once used.
  it("dedups from the requested title, NOT the template, on collision", () => {
    const result = uniqueCopyName(
      "Meeting Notes",
      ["Meeting Notes", "Task Template"],
      "md"
    );
    expect(result).toBe("Meeting Notes1.md");
    expect(result).not.toContain("Task Template");
  });

  it("walks the collision chain from the requested title", () => {
    expect(
      uniqueCopyName(
        "Meeting Notes",
        ["Meeting Notes", "Meeting Notes1", "Meeting Notes2"],
        "md"
      )
    ).toBe("Meeting Notes3.md");
  });

  it("omits the extension separator when there is no extension (folder-ish)", () => {
    expect(uniqueCopyName("Draft", ["Draft"], "")).toBe("Draft1");
    expect(uniqueCopyName("Draft", ["Draft"], undefined)).toBe("Draft1");
  });

  it("does not mutate the existingBases array", () => {
    const bases = ["Meeting Notes", "Task Template"];
    uniqueCopyName("Meeting Notes", bases, "md");
    expect(bases).toEqual(["Meeting Notes", "Task Template"]);
  });
});

// =========================================================================
// orderStringArrayByArray  (column ordering)
// =========================================================================
describe("orderStringArrayByArray", () => {
  it("places items that appear in `order` first, in order-sequence; absent items keep input order", () => {
    expect(orderStringArrayByArray(["x", "b", "a", "y"], ["a", "b", "c"]))
      .toEqual(["a", "b", "x", "y"]);
  });
  it("orders a fully-ordered set exactly by `order`", () => {
    expect(orderStringArrayByArray(["c", "a", "b"], ["a", "b", "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  it("does not throw on duplicate entries in `order`", () => {
    expect(() => orderStringArrayByArray(["b", "a"], ["a", "a", "b"])).not.toThrow();
    expect(orderStringArrayByArray(["b", "a"], ["a", "a", "b"])).toEqual([
      "a",
      "b",
    ]);
  });
  it("does not throw on an empty `order`", () => {
    expect(() => orderStringArrayByArray(["b", "a", "c"], [])).not.toThrow();
  });
  it("does not throw on an empty input array", () => {
    expect(orderStringArrayByArray([], ["a"])).toEqual([]);
  });
  it("handles a single-element array", () => {
    expect(orderStringArrayByArray(["a"], ["x"])).toEqual(["a"]);
  });

  // --- CORRECTED behavior of the stable, reflexive, non-mutating comparator ---
  it("does NOT mutate the input array and returns a NEW reference (corrected)", () => {
    const input = ["b", "a"];
    const out = orderStringArrayByArray(input, ["a", "b"]);
    expect(out).not.toBe(input);
    expect(input).toEqual(["b", "a"]); // input untouched
    expect(out).toEqual(["a", "b"]);
  });
  it("emits items ABSENT from `order` in INPUT order (stable tie-break on equal-rank)", () => {
    // Empty order => every item is absent and compares as equal (0); a stable
    // sort therefore preserves the original input order.
    expect(orderStringArrayByArray(["b", "a", "c"], [])).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(
      orderStringArrayByArray(["1", "2", "3", "4", "5"], [])
    ).toEqual(["1", "2", "3", "4", "5"]);
  });
  it("mixed case: ordered items in order-sequence, absent items in input order after them", () => {
    expect(
      orderStringArrayByArray(["z1", "b", "z2", "a", "z3", "c", "z4"], [
        "a",
        "b",
        "c",
      ])
    ).toEqual(["a", "b", "c", "z1", "z2", "z3", "z4"]);
  });
  it("does NOT dedupe duplicates already present in the input", () => {
    expect(orderStringArrayByArray(["a", "a", "b", "b"], ["b", "a"])).toEqual([
      "b",
      "b",
      "a",
      "a",
    ]);
  });

  // --- PROPERTY: the one invariant callers actually rely on -----------------
  it("property: every item present in `order` precedes every item absent from `order`", () => {
    const seedRng = makeRng(0x12345);
    const pool = ["a", "b", "c", "d", "e", "p", "q", "r", "s", "t"];
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const arrLen = randInt(seedRng, 0, 10);
      const arr = Array.from(
        { length: arrLen },
        () => pool[randInt(seedRng, 0, pool.length - 1)]
      );
      // order = a random subset of the pool (a-e are "orderable")
      const order = ["a", "b", "c", "d", "e"].filter(() => seedRng() < 0.6);
      const out = orderStringArrayByArray([...arr], order);

      // Invariant 1: a permutation of the input (same multiset).
      expect([...out].sort()).toEqual([...arr].sort());

      // Invariant 2: present-in-order items come before absent ones.
      const inOrder = (x: string) => order.indexOf(x) !== -1;
      let seenAbsent = false;
      for (const item of out) {
        if (!inOrder(item)) seenAbsent = true;
        else if (seenAbsent) {
          throw new Error(
            `ordered item "${item}" appeared after an absent item in ${JSON.stringify(
              out
            )} (order=${JSON.stringify(order)})`
          );
        }
      }

      // Invariant 3: the ordered prefix is sorted by order-index
      // (ascending), ignoring equal-index duplicates.
      const prefixIdx = out
        .filter(inOrder)
        .map((x) => order.indexOf(x));
      const sorted = [...prefixIdx].sort((a, b) => a - b);
      expect(prefixIdx).toEqual(sorted);
    }
  });

  it("property: re-running on already-sorted output is idempotent for ordered-only inputs", () => {
    const seedRng = makeRng(0xabcdef);
    const order = ["a", "b", "c", "d", "e"];
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const arr = order.filter(() => seedRng() < 0.7);
      // shuffle
      for (let i = arr.length - 1; i > 0; i--) {
        const j = randInt(seedRng, 0, i);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      const once = orderStringArrayByArray([...arr], order);
      const twice = orderStringArrayByArray([...once], order);
      expect(twice).toEqual(once);
      // ...and equals the order-subset projection.
      expect(once).toEqual(order.filter((o) => arr.includes(o)));
    }
  });
});

// =========================================================================
// orderArrayByArrayWithKey  (space / row ordering)
// =========================================================================
describe("orderArrayByArrayWithKey", () => {
  const k = (ids: string[]) => ids.map((id) => ({ id }));
  const ids = (objs: { id: string }[]) => objs.map((o) => o.id);

  it("orders objects by the `order` of their key, ordered-first; absent keys in input order", () => {
    expect(
      ids(orderArrayByArrayWithKey(k(["x", "b", "a", "y"]), ["a", "b", "c"], "id"))
    ).toEqual(["a", "b", "x", "y"]);
  });
  it("orders a fully-ordered set exactly", () => {
    expect(
      ids(orderArrayByArrayWithKey(k(["c", "a", "b"]), ["a", "b", "c"], "id"))
    ).toEqual(["a", "b", "c"]);
  });
  it("does not throw on empty order / empty array", () => {
    expect(orderArrayByArrayWithKey([], ["a"], "id")).toEqual([]);
    expect(() => orderArrayByArrayWithKey(k(["a"]), [], "id")).not.toThrow();
  });
  it("does NOT mutate the input and returns a NEW reference (corrected)", () => {
    const input = k(["b", "a"]);
    const out = orderArrayByArrayWithKey(input, ["a", "b"], "id");
    expect(out).not.toBe(input);
    expect(ids(input)).toEqual(["b", "a"]); // input untouched
    expect(ids(out)).toEqual(["a", "b"]);
  });
  it("emits absent-key items in input order (stable tie-break on equal-rank)", () => {
    expect(ids(orderArrayByArrayWithKey(k(["b", "a", "c"]), [], "id"))).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("property: behaves identically to orderStringArrayByArray on the key field", () => {
    const seedRng = makeRng(0x99887766);
    const pool = ["a", "b", "c", "p", "q"];
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const len = randInt(seedRng, 0, 8);
      const keys = Array.from(
        { length: len },
        () => pool[randInt(seedRng, 0, pool.length - 1)]
      );
      const order = ["a", "b", "c"].filter(() => seedRng() < 0.6);
      const viaKey = ids(orderArrayByArrayWithKey(k([...keys]), order, "id"));
      const viaString = orderStringArrayByArray([...keys], order);
      expect(viaKey).toEqual(viaString);
    }
  });
});

// =========================================================================
// onlyUniqueProp / onlyUniquePropCaseInsensitive  (filter predicates)
// =========================================================================
describe("onlyUniqueProp", () => {
  it("keeps the FIRST object for each distinct prop value", () => {
    const out = [
      { k: "a", n: 1 },
      { k: "b", n: 2 },
      { k: "a", n: 3 },
    ].filter(onlyUniqueProp("k"));
    expect(out).toEqual([
      { k: "a", n: 1 },
      { k: "b", n: 2 },
    ]);
  });
  it("uses loose equality (== ) on the prop value (characterization)", () => {
    // The predicate uses `==`, so "1" and 1 collide.
    const out = [{ k: "1" as any }, { k: 1 as any }].filter(
      onlyUniqueProp("k")
    );
    expect(out.length).toBe(1);
  });
  it("returns everything when all values are distinct", () => {
    const data = [{ k: "a" }, { k: "b" }, { k: "c" }];
    expect(data.filter(onlyUniqueProp("k"))).toEqual(data);
  });
});

describe("onlyUniquePropCaseInsensitive", () => {
  it("keeps the FIRST object, comparing the prop value case-insensitively", () => {
    const out = [{ k: "a" }, { k: "A" }, { k: "b" }].filter(
      onlyUniquePropCaseInsensitive("k")
    );
    expect(out).toEqual([{ k: "a" }, { k: "b" }]);
  });
  it("returns everything when all values differ case-insensitively", () => {
    const data = [{ k: "alpha" }, { k: "beta" }];
    expect(data.filter(onlyUniquePropCaseInsensitive("k"))).toEqual(data);
  });
});
