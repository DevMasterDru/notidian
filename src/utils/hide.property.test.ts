import { excludePathPredicate, excludeSpacesPredicate } from "utils/hide";
import { MakeMDSettings } from "shared/types/settings";

// ===========================================================================
// PROPERTY NET for the path-visibility / internal-storage-leak filter in
// src/utils/hide.ts (Notidian-79zp). Sibling of the example-based
// src/utils/hide.test.ts (Notidian-i9d1) and the parity fix Notidian-r2gr
// (commit 81a0ab5, which added the `spacesFolder + '/$'` clause to
// excludePathPredicate so properties #1/#2 below hold).
//
// excludePathPredicate / excludeSpacesPredicate decide which on-disk paths are
// HIDDEN from the navigator and the database/space listing. They are consulted
// on EVERY path the cache walks (cacheParsers.ts:206, the obsidian filesystem
// adapter, filesystemAdapter.ts:198/863). A path WRONGLY SHOWN leaks internal
// storage — the `#`-tag and `$`-system spaces this code exists to suppress —
// into the navigator/db listing; a path WRONGLY HIDDEN is a silently missing
// row. hide.test.ts spot-checks individual clauses; this file LOCKS the
// behaviour over GENERATED (spacesFolder/spaceSubFolder/deny-list, path) pairs,
// proving four invariants the spot-checks only sample:
//
//   1. PARITY        once clause (A) is neutralized, excludePathPredicate and
//                    excludeSpacesPredicate agree on EVERY path — i.e. their
//                    symmetric difference is confined to the TWO intentional
//                    axes (excludePath's hiddenExtensions endsWith vs
//                    excludeSpaces's skipFolderNames endsWith). Nothing else
//                    may diverge.
//   2. NO-LEAK       a path of form `spacesFolder + '/$' + rand` and
//                    `spacesFolder + '/#' + rand` is hidden by BOTH predicates
//                    (system / tag storage never reaches the navigator) — the
//                    property generalization of the Notidian-r2gr fix.
//   3. MONOTONICITY  appending an entry to ANY deny-list (hiddenFiles,
//                    hiddenExtensions, skipFolderNames) never UN-hides a
//                    previously-hidden path. Both predicates are pure ORs over
//                    `.some()` / `.startsWith` clauses, so a deny-list grows the
//                    disjunction monotonically.
//   4. ANCHORING     the `/#` and `/$` clauses are anchored at spacesFolder —
//                    a `#` / `$` segment ELSEWHERE is not hidden by those
//                    clauses alone (with every other clause neutralized).
//                    Generalizes hide.test.ts:162/199.
//
// These are TRUE invariants of the current implementation, not characterization
// of accidental edges; a future change that breaks any of them is a conscious,
// reviewed decision (the leak filter is safety-critical). Pure / offline; zero
// render-path risk.
//
// CONVENTION: hand-rolled mulberry32 PRNG + PROPERTY_RUNS loop, NO fast-check
// dependency — matching the repo's existing property tests
// (src/core/utils/contexts/tableRollup.property.test.ts:32,
// src/shared/utils/array.test.ts, sanitizers.test.ts). Fully deterministic and
// reproducible across machines/CI without a fixture file.
// ===========================================================================

// --- tiny deterministic PRNG (no external dep) -----------------------------
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
const pick = <T>(rng: () => number, pool: readonly T[]): T =>
  pool[randInt(rng, 0, pool.length - 1)];
const PROPERTY_RUNS = 800;

// Only the FIVE consumed MakeMDSettings fields matter to these pure predicates;
// the rest of the (large) interface is irrelevant, so we cast a minimal object.
type HideFields = Pick<
  MakeMDSettings,
  | "hiddenExtensions"
  | "skipFolderNames"
  | "spaceSubFolder"
  | "spacesFolder"
  | "hiddenFiles"
>;
const asSettings = (f: HideFields): MakeMDSettings => f as MakeMDSettings;

// --- generators ------------------------------------------------------------
// A small, adversarial alphabet of folder-name fragments. Includes the special
// markers `#` and `$`, dotfile/sub-folder shapes, illegal-ish chars, the empty
// string, and ordinary names — so generated spacesFolder / spaceSubFolder /
// deny-list entries / path segments collide and overlap by construction.
const FRAGMENTS: readonly string[] = [
  "Spaces",
  "Other",
  "a",
  "b",
  "node_modules",
  ".space",
  ".obsidian",
  ".md",
  "#tag",
  "$sys",
  "#",
  "$",
  "x.space",
  "my.space",
  "deep",
  "",
];
const EXT_FRAGMENTS: readonly string[] = [".md", ".png", ".json", ".canvas", ""];

const randSegment = (rng: () => number): string => pick(rng, FRAGMENTS);

// Build a random path of 0..4 segments joined by "/". Empty segments and a
// trailing slash are intentionally reachable so the predicates' edge behaviour
// (pop() === "", bare ".space", etc.) is exercised.
const randPath = (rng: () => number): string => {
  const n = randInt(rng, 0, 4);
  const segs: string[] = [];
  for (let i = 0; i < n; i++) segs.push(randSegment(rng));
  let p = segs.join("/");
  // Occasionally append a trailing slash and/or a special-prefixed leaf so the
  // generator reaches the `/#` and `/$` and trailing-slash edges more often.
  if (rng() < 0.15) p = p + "/";
  return p;
};

const randList = (rng: () => number, pool: readonly string[]): string[] => {
  const n = randInt(rng, 0, 3);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(pick(rng, pool));
  return out;
};

// Random shared settings (the fields BOTH predicates consult identically) plus
// the two divergent endsWith arrays. spacesFolder is drawn from non-empty
// fragments for the leak/anchoring properties that need a real prefix.
const NONEMPTY_FOLDERS = FRAGMENTS.filter((f) => f.length > 0);
const randSettings = (rng: () => number): HideFields => ({
  hiddenExtensions: randList(rng, EXT_FRAGMENTS),
  skipFolderNames: randList(rng, FRAGMENTS),
  spaceSubFolder: pick(rng, [".space", ".sp", "_space", "space"]),
  spacesFolder: pick(rng, NONEMPTY_FOLDERS),
  hiddenFiles: randList(rng, FRAGMENTS),
});

// ===========================================================================
// INVARIANT 1 — PARITY: confined symmetric difference.
//
// excludePathPredicate and excludeSpacesPredicate are textually identical
// EXCEPT for clause (A): excludePath ends-with-tests `hiddenExtensions`,
// excludeSpaces ends-with-tests `skipFolderNames`. We neutralize clause (A) in
// each (by emptying ITS array) while keeping ALL shared fields equal, and
// assert the two now agree on every generated path. Then we assert the FULL
// predicates' disagreement is fully explained by those two axes alone.
// ===========================================================================
describe("hide.ts PARITY — symmetric difference confined to the two intentional axes", () => {
  it("shared clauses (B/C/D/E/E$/F) agree on every generated path once clause (A) is neutralized", () => {
    const rng = makeRng(0x50a1);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const base = randSettings(rng);
      const path = randPath(rng);
      // Neutralize each predicate's OWN endsWith array -> only the shared
      // clauses remain, which are character-for-character identical.
      const excl = excludePathPredicate(
        asSettings({ ...base, hiddenExtensions: [] }),
        path
      );
      const spaces = excludeSpacesPredicate(
        asSettings({ ...base, skipFolderNames: [] }),
        path
      );
      if (excl !== spaces) {
        throw new Error(
          `PARITY VIOLATION at run ${i}: shared clauses disagree on ` +
            `path=${JSON.stringify(path)} settings=${JSON.stringify(base)} ` +
            `(excludePath=${excl}, excludeSpaces=${spaces})`
        );
      }
    }
  });

  it("any disagreement of the FULL predicates is explained ONLY by the hiddenExtensions-vs-skipFolderNames axes", () => {
    const rng = makeRng(0x7b2c);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const s = randSettings(rng);
      const path = randPath(rng);
      const full = asSettings(s);
      const excl = excludePathPredicate(full, path);
      const spaces = excludeSpacesPredicate(full, path);
      if (excl === spaces) continue;
      // They differ. The difference MUST vanish once both endsWith arrays are
      // neutralized (i.e. the only possible cause is clause (A) on either side).
      const neutral = asSettings({
        ...s,
        hiddenExtensions: [],
        skipFolderNames: [],
      });
      const exclN = excludePathPredicate(neutral, path);
      const spacesN = excludeSpacesPredicate(neutral, path);
      if (exclN !== spacesN) {
        throw new Error(
          `UNEXPECTED divergence axis at run ${i}: full predicates differ ` +
            `(excludePath=${excl}, excludeSpaces=${spaces}) AND still differ ` +
            `after neutralizing both endsWith arrays (excludePath=${exclN}, ` +
            `excludeSpaces=${spacesN}) on path=${JSON.stringify(path)} ` +
            `settings=${JSON.stringify(s)} — a divergence NOT attributable to ` +
            `hiddenExtensions/skipFolderNames`
        );
      }
    }
  });
});

// ===========================================================================
// INVARIANT 2 — NO-LEAK: `spacesFolder + '/$' + rand` and `spacesFolder + '/#'
// + rand` are hidden by BOTH predicates (the property generalization of
// Notidian-r2gr: system/tag storage never reaches the navigator).
// ===========================================================================
describe("hide.ts NO-LEAK — $-system and #-tag storage under spacesFolder is hidden by BOTH predicates", () => {
  it("spacesFolder + '/$' + rand is always hidden by excludePath AND excludeSpaces", () => {
    const rng = makeRng(0x24a9);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const s = randSettings(rng);
      // Append an arbitrary, possibly multi-segment, suffix after the marker.
      const suffix = randPath(rng);
      const path = `${s.spacesFolder}/$${suffix}`;
      const full = asSettings(s);
      const excl = excludePathPredicate(full, path);
      const spaces = excludeSpacesPredicate(full, path);
      if (!excl || !spaces) {
        throw new Error(
          `$-LEAK at run ${i}: path=${JSON.stringify(path)} not hidden by both ` +
            `(excludePath=${excl}, excludeSpaces=${spaces}) ` +
            `spacesFolder=${JSON.stringify(s.spacesFolder)}`
        );
      }
    }
  });

  it("spacesFolder + '/#' + rand is always hidden by excludePath AND excludeSpaces", () => {
    const rng = makeRng(0x3f10);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const s = randSettings(rng);
      const suffix = randPath(rng);
      const path = `${s.spacesFolder}/#${suffix}`;
      const full = asSettings(s);
      const excl = excludePathPredicate(full, path);
      const spaces = excludeSpacesPredicate(full, path);
      if (!excl || !spaces) {
        throw new Error(
          `#-LEAK at run ${i}: path=${JSON.stringify(path)} not hidden by both ` +
            `(excludePath=${excl}, excludeSpaces=${spaces}) ` +
            `spacesFolder=${JSON.stringify(s.spacesFolder)}`
        );
      }
    }
  });
});

// ===========================================================================
// INVARIANT 3 — MONOTONICITY: adding a deny-list entry never un-hides a hidden
// path. Both predicates are pure ORs whose deny-list clauses are `.some()` /
// `.startsWith` disjunctions, so growing a deny-list can only add disjuncts.
// ===========================================================================
describe("hide.ts MONOTONICITY — appending a deny-list entry never un-hides a hidden path", () => {
  const DENY_KEYS = [
    "hiddenFiles",
    "hiddenExtensions",
    "skipFolderNames",
  ] as const;

  const checkMonotone = (
    name: string,
    predicate: (s: MakeMDSettings, p: string) => boolean,
    seed: number
  ) => {
    it(`${name} stays hidden after appending to any deny-list`, () => {
      const rng = makeRng(seed);
      for (let i = 0; i < PROPERTY_RUNS; i++) {
        const s = randSettings(rng);
        const path = randPath(rng);
        const before = predicate(asSettings(s), path);
        if (!before) continue; // monotonicity only constrains hidden->hidden
        const key = pick(rng, DENY_KEYS);
        const entry = randSegment(rng);
        const grown: HideFields = { ...s, [key]: [...s[key], entry] };
        const after = predicate(asSettings(grown), path);
        if (!after) {
          throw new Error(
            `MONOTONICITY VIOLATION (${name}) at run ${i}: appending ` +
              `${JSON.stringify(entry)} to ${key} UN-HID ` +
              `path=${JSON.stringify(path)} settings=${JSON.stringify(s)}`
          );
        }
      }
    });
  };

  checkMonotone("excludePathPredicate", excludePathPredicate, 0x6c01);
  checkMonotone("excludeSpacesPredicate", excludeSpacesPredicate, 0x6c02);
});

// ===========================================================================
// INVARIANT 4 — ANCHORING: the `/#` and `/$` clauses fire ONLY at spacesFolder.
// A `#` / `$` segment ELSEWHERE is not hidden by those clauses alone. We
// neutralize EVERY other clause (empty deny-lists; a spaceSubFolder that the
// generated path cannot contain) and a prefix guaranteed NOT to begin with
// `spacesFolder + '/#'` or `spacesFolder + '/$'`, then assert NOT hidden.
// ===========================================================================
describe("hide.ts ANCHORING — '/#' and '/$' clauses are anchored at spacesFolder", () => {
  // A spaceSubFolder marker that none of our generated prefixes/segments equal,
  // so the triple-check cannot fire. A control char is never produced by the
  // generator (which only emits printable fragments).
  const INERT_SUB = "__inert_sub__";

  const checkAnchored = (
    marker: "#" | "$",
    name: string,
    predicate: (s: MakeMDSettings, p: string) => boolean,
    seed: number
  ) => {
    it(`${name}: a '${marker}' segment NOT under spacesFolder is not hidden by the anchored clause alone`, () => {
      const rng = makeRng(seed);
      let exercised = 0;
      for (let i = 0; i < PROPERTY_RUNS; i++) {
        const spacesFolder = pick(rng, NONEMPTY_FOLDERS);
        // A prefix that is NOT equal to spacesFolder, so `prefix + '/' + marker`
        // cannot start with `spacesFolder + '/' + marker`.
        const prefixPool = NONEMPTY_FOLDERS.filter((f) => f !== spacesFolder);
        const prefix = pick(rng, prefixPool);
        const suffix = randSegment(rng);
        const path = `${prefix}/${marker}${suffix}`;
        // Sanity: this path must genuinely NOT be anchored. (It cannot start
        // with `spacesFolder + '/' + marker` because prefix !== spacesFolder
        // and the marker sits right after the first '/').
        if (path.startsWith(`${spacesFolder}/${marker}`)) continue;
        const s: HideFields = {
          hiddenExtensions: [],
          skipFolderNames: [],
          hiddenFiles: [],
          spaceSubFolder: INERT_SUB,
          spacesFolder,
        };
        exercised++;
        const hidden = predicate(asSettings(s), path);
        if (hidden) {
          throw new Error(
            `ANCHORING VIOLATION (${name}, '${marker}') at run ${i}: ` +
              `path=${JSON.stringify(path)} hidden with spacesFolder=` +
              `${JSON.stringify(spacesFolder)} and every other clause neutralized`
          );
        }
      }
      // Guard against a vacuous test (all runs skipped).
      expect(exercised).toBeGreaterThan(PROPERTY_RUNS / 2);
    });
  };

  checkAnchored("#", "excludePathPredicate", excludePathPredicate, 0x9a01);
  checkAnchored("$", "excludePathPredicate", excludePathPredicate, 0x9a02);
  checkAnchored("#", "excludeSpacesPredicate", excludeSpacesPredicate, 0x9a03);
  checkAnchored("$", "excludeSpacesPredicate", excludeSpacesPredicate, 0x9a04);

  // Companion: the POSITIVE anchoring — the SAME marker DOES fire when the
  // prefix IS spacesFolder (with all other clauses neutralized), proving the
  // clause is genuinely present, not merely "never fires".
  it("positive control: the same marker IS hidden when the prefix IS spacesFolder", () => {
    const rng = makeRng(0x9b00);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const spacesFolder = pick(rng, NONEMPTY_FOLDERS);
      const marker = pick(rng, ["#", "$"] as const);
      const suffix = randSegment(rng);
      const path = `${spacesFolder}/${marker}${suffix}`;
      const s: HideFields = {
        hiddenExtensions: [],
        skipFolderNames: [],
        hiddenFiles: [],
        spaceSubFolder: INERT_SUB,
        spacesFolder,
      };
      const excl = excludePathPredicate(asSettings(s), path);
      const spaces = excludeSpacesPredicate(asSettings(s), path);
      if (!excl || !spaces) {
        throw new Error(
          `POSITIVE ANCHORING control failed at run ${i}: ` +
            `path=${JSON.stringify(path)} not hidden ` +
            `(excludePath=${excl}, excludeSpaces=${spaces})`
        );
      }
    }
  });
});
