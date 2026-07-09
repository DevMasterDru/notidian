// ===========================================================================
// Adversarial property tests for notidianSchema.ts (Notidian-tl4n)
//
// notidianSchema.ts plans real frontmatter writes across many files
// (authority-partitioned canonical data — ADR 0001/0014/0017) but, unlike
// sibling modules such as keyMatchResolver.ts (96 lines / 1366 test lines),
// only had 8 characterization tests. This file hardens the four planning
// entry points against malformed/adversarial inputs a corrupt vault, a
// case-drifted frontmatter key, or a scripted bulk edit could produce:
//
//   - discoverFrontmatterSchema
//   - createFrontmatterPropertyPlan
//   - planRenameFrontmatterProperty
//   - planDeleteFrontmatterProperty
//
// Invariants proven (mirrors the keyMatchResolver.adversarial.test.ts
// convention — mulberry32 PRNG, 500+ runs per property, no external deps):
//
//   TOTAL         — never throws for any adversarial input
//   STABLE        — deterministic (same input -> same result)
//   READ-ONLY     — never mutates the input table/frontmatterByPath/paths
//   CONFIRM-GATED — canApply(Automatically) is false / frontmatterWrites and
//                   automaticWrites stay empty whenever the input is
//                   ambiguous or colliding; a destructive delete NEVER
//                   auto-applies, only previews with requiresConfirmation
//
// Bug class under direct test (Notidian-buqr: "m_fields keeps case-variant
// field rows the physical table deduped away"): several sections below show
// that this module's own presence checks are exact-string (case-sensitive),
// while its schema-duplicate checks are case-insensitive. That asymmetry
// means a rename/delete plan can silently fail to "see" a case-variant
// frontmatter key sitting right next to the one it operated on — the exact
// shape of bug the module downstream (m_fields) hit. Some sections below PIN
// that observed behavior (characterization only, zero production-code
// change) so any future change to the asymmetry is deliberate. Two sections
// instead assert a FIXED, safe behavior:
//   * planRenameFrontmatterProperty's per-file scan (Notidian-lqt4) -- a
//     case-variant frontmatter key is surfaced as a distinct
//     "case-variant-frontmatter-key" issue + "case-variant" fileState, never
//     silent "neither".
//   * discoverFrontmatterSchema (Notidian-1adj) -- case-variant spellings of
//     one logical key ("state" + "State") are MERGED into a single canonical
//     summary entry (canonical casing = most-frequent spelling, tie ->
//     first-seen) and the collision is flagged via a `caseVariants` breakdown
//     so the schema-adoption UI can show it, instead of the old two-entry
//     split that mis-counted each casing as "missing" on the other's rows.
// ===========================================================================

import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import {
  createFrontmatterPropertyPlan,
  discoverFrontmatterSchema,
  FrontmatterSnapshotsByPath,
  planDeleteFrontmatterProperty,
  planRenameFrontmatterProperty,
} from "./notidianSchema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// mulberry32 PRNG (repo convention — same as keyMatchResolver.adversarial.test.ts)
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

const PROPERTY_RUNS = 500;

const baseTable = (): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
  cols: [
    {
      name: PathPropertyName,
      type: "file",
      schemaId: defaultContextSchemaID,
      primary: "true",
    },
    {
      name: "status",
      type: "text",
      value: "",
      schemaId: defaultContextSchemaID,
      source: frontmatterPropertySource,
    },
  ],
  rows: [],
});

const buildPaths = (n: number, prefix = "DB"): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}/Row${i}.md`);

// ---------------------------------------------------------------------------
// 1. Case-variant key collisions across hundreds of paths (Notidian-buqr class)
// ---------------------------------------------------------------------------

describe("discoverFrontmatterSchema — case-variant key collisions", () => {
  it("FIXED (Notidian-1adj, was Notidian-buqr-class PIN): case-variant keys across paths MERGE into one canonical, flagged summary entry", () => {
    // 600 paths, 60% keyed "state" (lowercase), 40% keyed "State" (capitalized).
    // The physical MDB column model is case-insensitive-deduped elsewhere
    // (caseInsensitiveColumn / mdb-collapse Notidian-1q8y), and two summary
    // entries for one logical field is an aggregation bug: each casing
    // mis-reports the OTHER casing's rows as "missing". The fix folds by
    // key.toLowerCase() into ONE entry whose `key` is the most-frequent
    // spelling and whose presentCount covers every row carrying any spelling.
    const paths = buildPaths(600);
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    paths.forEach((path, i) => {
      frontmatterByPath[path] =
        i % 5 < 3 ? { state: "active" } : { State: "active" };
    });

    const schema = discoverFrontmatterSchema({ paths, frontmatterByPath });

    // ONE merged entry, not two.
    expect(schema.length).toBe(1);
    const entry = schema[0];
    // Canonical casing = most-frequent spelling: "state" (360) beats "State"
    // (240). No "State" entry survives as a separate row.
    expect(entry.key).toBe("state");
    expect(schema.some((s) => s.key === "State")).toBe(false);
    // presentCount now counts EVERY row carrying any spelling of the field, so
    // missingCount is 0 (the field is present on all 600 rows).
    expect(entry.presentCount).toBe(600);
    expect(entry.missingCount).toBe(0);
    // CONFIRM the collision is surfaced DISTINCTLY (flagged for the adoption
    // UI), never silently unioned: every observed spelling with its own
    // per-spelling row count, in first-seen order ("state" seen at path 0,
    // "State" first at path 3).
    expect(entry.caseVariants).toEqual([
      { spelling: "state", count: 360 },
      { spelling: "State", count: 240 },
    ]);
  });

  it("Notidian-1adj: 3+ variant spellings merge; canonical = strict most-frequent; rows with the field absent are counted missing", () => {
    // Five distinct-count spellings across eight rows, two of which do not
    // carry the field at all. The merged entry's canonical casing is the
    // strict most-frequent spelling, and missingCount reflects the truly-absent
    // rows only.
    const frontmatterByPath: Record<string, Record<string, unknown>> = {
      "R/0.md": { status: "a" },
      "R/1.md": { Status: "a" },
      "R/2.md": { STATUS: "a" },
      "R/3.md": { status: "a" },
      "R/4.md": { STATUS: "a" },
      "R/5.md": { status: "a" },
      "R/6.md": { other: "x" }, // field absent (unrelated key)
      "R/7.md": {}, // field absent (empty frontmatter)
    };
    const paths = Object.keys(frontmatterByPath);

    const schema = discoverFrontmatterSchema({ paths, frontmatterByPath });
    const merged = schema.find((s) => s.key.toLowerCase() === "status")!;

    // canonical = "status" (3) over "STATUS" (2) over "Status" (1).
    expect(merged.key).toBe("status");
    expect(merged.presentCount).toBe(6);
    expect(merged.missingCount).toBe(2); // R/6 (unrelated) and R/7 (empty)
    // First-seen spelling order: status (R/0), Status (R/1), STATUS (R/2).
    expect(merged.caseVariants).toEqual([
      { spelling: "status", count: 3 },
      { spelling: "Status", count: 1 },
      { spelling: "STATUS", count: 2 },
    ]);
    // The unrelated single-spelling key is NOT flagged as a collision.
    const other = schema.find((s) => s.key === "other")!;
    expect(other.caseVariants).toBeUndefined();
    expect(other.presentCount).toBe(1);
  });

  it("Notidian-1adj: a frequency TIE between spellings resolves to the FIRST-SEEN spelling as canonical", () => {
    // 2 vs 2. "State" is encountered first (path 0), so it wins the canonical
    // slot even though "state" is the more conventional casing.
    const frontmatterByPath: Record<string, Record<string, unknown>> = {
      "DB/0.md": { State: "a" }, // first-seen spelling of this logical key
      "DB/1.md": { state: "b" },
      "DB/2.md": { State: "c" },
      "DB/3.md": { state: "d" },
    };
    const paths = Object.keys(frontmatterByPath);

    const schema = discoverFrontmatterSchema({ paths, frontmatterByPath });

    expect(schema.length).toBe(1);
    expect(schema[0].key).toBe("State"); // tie -> first-seen
    expect(schema[0].presentCount).toBe(4);
    expect(schema[0].missingCount).toBe(0);
    expect(schema[0].caseVariants).toEqual([
      { spelling: "State", count: 2 },
      { spelling: "state", count: 2 },
    ]);
  });

  it("Notidian-1adj: a single row carrying BOTH spellings counts as ONE present row (presentCount never exceeds path count)", () => {
    // A corrupt/hand-edited row holds both "state:" and "State:". It is one
    // present row for the merged field, but it contributes to BOTH per-spelling
    // counts -- so the variant counts sum to more than presentCount, which is
    // intended and lets the adoption UI flag rows with duplicate keys.
    const frontmatterByPath: Record<string, Record<string, unknown>> = {
      "R/0.md": { state: "a", State: "b" }, // both spellings in one row
      "R/1.md": { state: "c" },
      "R/2.md": { other: "x" }, // field absent
    };
    const paths = Object.keys(frontmatterByPath);

    const schema = discoverFrontmatterSchema({ paths, frontmatterByPath });
    const merged = schema.find((s) => s.key.toLowerCase() === "state")!;

    // R/0 (both) is one present row; R/1 present; R/2 absent.
    expect(merged.presentCount).toBe(2);
    expect(merged.missingCount).toBe(1);
    // Canonical: "state" occurs in 2 rows (R/0 + R/1), "State" in 1 (R/0).
    expect(merged.key).toBe("state");
    expect(merged.caseVariants).toEqual([
      { spelling: "state", count: 2 },
      { spelling: "State", count: 1 },
    ]);
    // Variant counts (2 + 1 = 3) exceed presentCount (2) -- the both-spellings
    // row is double-counted across spellings, single-counted for presence.
    const variantTotal = merged.caseVariants!.reduce(
      (sum, v) => sum + v.count,
      0
    );
    expect(variantTotal).toBeGreaterThan(merged.presentCount);
  });

  it("TOTAL + STABLE + no pathological slowdown (Notidian-1adj): 1000+ paths with many random-case key variants all fold to ONE canonical entry", () => {
    const rng = makeRng(0xc0ffee);
    const paths = buildPaths(1200);
    const CASINGS = ["status", "Status", "STATUS", "StAtUs", "sTATUS"];
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    for (const path of paths) {
      frontmatterByPath[path] = { [pick(rng, CASINGS)]: "v" };
    }

    const start = Date.now();
    let schema: ReturnType<typeof discoverFrontmatterSchema> = [];
    expect(() => {
      schema = discoverFrontmatterSchema({ paths, frontmatterByPath });
    }).not.toThrow();
    expect(Date.now() - start).toBeLessThan(3000);

    // All spellings fold onto exactly ONE canonical entry -- no per-casing rows.
    expect(schema.length).toBe(1);
    const entry = schema[0];
    // Each path carried exactly one spelling, so the field is present on all.
    expect(entry.presentCount).toBe(paths.length);
    expect(entry.missingCount).toBe(0);
    // caseVariants covers exactly the distinct spellings that occurred, and the
    // per-spelling counts sum to the path count (each path has one spelling).
    expect(entry.caseVariants).toBeDefined();
    const occurred = new Set(
      paths.map((p) => Object.keys(frontmatterByPath[p])[0])
    );
    expect(new Set(entry.caseVariants!.map((v) => v.spelling))).toEqual(occurred);
    const variantTotal = entry.caseVariants!.reduce((s, v) => s + v.count, 0);
    expect(variantTotal).toBe(paths.length);
    // Canonical key is the most-frequent spelling among the variants.
    const maxCount = Math.max(...entry.caseVariants!.map((v) => v.count));
    expect(
      entry.caseVariants!.find((v) => v.spelling === entry.key)!.count
    ).toBe(maxCount);

    // STABLE: identical input yields identical merged output (key order,
    // canonical choice, and caseVariants order are all deterministic).
    const again = discoverFrontmatterSchema({ paths, frontmatterByPath });
    expect(again).toEqual(schema);
  });
});

describe("createFrontmatterPropertyPlan — case-variant duplicate stress", () => {
  it("blocks hundreds of random-cased duplicates of an existing column", () => {
    const rng = makeRng(0xdead10);
    const table = baseTable();

    for (let run = 0; run < PROPERTY_RUNS; run++) {
      // Build a random casing of "status" (existing column) letter by letter.
      const candidate = "status"
        .split("")
        .map((ch) => (rng() > 0.5 ? ch.toUpperCase() : ch))
        .join("");

      const plan = createFrontmatterPropertyPlan({
        table,
        key: candidate,
        type: "text",
      });

      expect(plan.canApply).toBe(false);
      expect(plan.frontmatterWrites).toEqual([]);
      expect(plan.issues).toEqual([
        { reason: "duplicate-column", key: candidate, existingKey: "status" },
      ]);
      // READ-ONLY: original table object is returned unchanged, not mutated.
      expect(plan.tablePreview).toBe(table);
      expect(table.cols.length).toBe(2);
    }
  });
});

describe("planRenameFrontmatterProperty — case-variant collisions", () => {
  it("blocks a rename INTO an existing case-variant column before any file scan", () => {
    const table = baseTable(); // has "status"
    table.cols.push({
      name: "area",
      type: "text",
      value: "",
      schemaId: defaultContextSchemaID,
      source: frontmatterPropertySource,
    });
    const paths = buildPaths(400);
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    paths.forEach((path, i) => {
      frontmatterByPath[path] = { area: i % 2 === 0 ? "north" : "south" };
    });

    const plan = planRenameFrontmatterProperty({
      table,
      oldKey: "area",
      newKey: "STATUS", // case-variant of existing "status" column
      paths,
      frontmatterByPath,
    });

    expect(plan.canApplyAutomatically).toBe(false);
    expect(plan.issues).toEqual([
      { reason: "duplicate-column", key: "STATUS", existingKey: "status" },
    ]);
    // The schema-level guard fires before any per-file scanning happens.
    expect(plan.fileStates).toEqual([]);
    expect(plan.automaticWrites).toEqual([]);
  });

  it("FIXED (Notidian-lqt4, was Notidian-buqr-class PIN): a case-variant frontmatter key is surfaced as a conflict, never silently dropped", () => {
    // Table column is exactly "state". 300 files hold the exact key "state";
    // 200 files instead hold a case-variant spelling "State" — a corrupt or
    // hand-edited frontmatter scenario. The exact-string per-file presence
    // check (hasOwn(frontmatter, normalizedOldKey)) still cannot see "State"
    // directly, but planRenameFrontmatterProperty now falls back to a
    // case-insensitive scan of each file's real keys whenever the exact scan
    // finds neither key -- so those 200 "State" files are routed to a
    // distinct "case-variant" fileState + a "case-variant-frontmatter-key"
    // issue instead of "neither". canApplyAutomatically must be false: no
    // caller can ever read this rename as a silent full success while 200
    // rows still carry an untouched, differently-cased "state" family key.
    const table = baseTable();
    table.cols = table.cols.map((c) =>
      c.name === "status" ? { ...c, name: "state" } : c
    );

    const exactPaths = buildPaths(300, "Exact");
    const variantPaths = buildPaths(200, "Variant");
    const paths = [...exactPaths, ...variantPaths];
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    exactPaths.forEach((p) => (frontmatterByPath[p] = { state: "active" }));
    variantPaths.forEach((p) => (frontmatterByPath[p] = { State: "active" }));

    const plan = planRenameFrontmatterProperty({
      table,
      oldKey: "state",
      newKey: "archived",
      paths,
      frontmatterByPath,
    });

    // CONFIRM-GATED: the case-variant ambiguity blocks full automatic apply.
    expect(plan.canApplyAutomatically).toBe(false);
    expect(plan.requiresResolution).toBe(true);
    expect(plan.issues.length).toBe(200); // one issue per "Variant/" file
    expect(
      plan.issues.every((issue) => issue.reason === "case-variant-frontmatter-key")
    ).toBe(true);
    expect(
      plan.issues.every(
        (issue) =>
          issue.reason !== "case-variant-frontmatter-key" ||
          (issue.requestedKey === "state" && issue.foundKey === "State")
      )
    ).toBe(true);
    expect(
      new Set(
        plan.issues.map((issue) =>
          issue.reason === "case-variant-frontmatter-key" ? issue.path : ""
        )
      )
    ).toEqual(new Set(variantPaths));

    // The 300 exact-cased files are still classified and previewed normally
    // -- the plan still computes their writes, it just can never be applied
    // automatically as a whole until the case-variant files are resolved.
    expect(plan.automaticWrites.length).toBe(300);
    expect(
      plan.automaticWrites.every((w) => w.path.startsWith("Exact/"))
    ).toBe(true);
    expect(
      plan.automaticWrites.some((w) => w.path.startsWith("Variant/"))
    ).toBe(false);

    // Every variant-cased file is now surfaced as "case-variant" -- never
    // "neither", never silently untouched-and-unflagged.
    const variantStates = plan.fileStates.filter((f) =>
      f.path.startsWith("Variant/")
    );
    expect(variantStates.length).toBe(200);
    expect(variantStates.every((f) => f.state === "case-variant")).toBe(true);
    expect(variantStates.every((f) => f.oldValue === "active")).toBe(true);
    expect(variantStates.every((f) => f.newValue === undefined)).toBe(true);
    // The exact-cased files are unaffected -- still "old-only" as before.
    const exactStates = plan.fileStates.filter((f) =>
      f.path.startsWith("Exact/")
    );
    expect(exactStates.every((f) => f.state === "old-only")).toBe(true);
  });

  it("Notidian-lqt4 mustFix: an exact old-key match plus a stray case-variant of the NEW key is surfaced, never silently double-written (old-only branch)", () => {
    // Reviewer-flagged gap: the original fix only ran the case-variant
    // fallback in the "neither key present" branch. A file with an EXACT
    // match on the old key (hasOld = true) but ALSO a pre-existing,
    // differently-cased spelling of the new key ("STATUS" vs the real
    // target "Status") took the old-only branch untouched -- no issue was
    // raised, canApplyAutomatically stayed true, and the automatic write
    // would have added a second live "Status" key alongside the stale
    // "STATUS" one.
    const table = baseTable();
    table.cols = table.cols.map((c) =>
      c.name === "status" ? { ...c, name: "State" } : c
    );
    const paths = ["DB/Row0.md"];
    const frontmatterByPath: Record<string, Record<string, unknown>> = {
      "DB/Row0.md": { State: "active", STATUS: "legacy-stale-value" },
    };

    const plan = planRenameFrontmatterProperty({
      table,
      oldKey: "State",
      newKey: "Status",
      paths,
      frontmatterByPath,
    });

    expect(plan.canApplyAutomatically).toBe(false);
    expect(plan.requiresResolution).toBe(true);
    expect(plan.issues).toEqual([
      {
        reason: "case-variant-frontmatter-key",
        path: "DB/Row0.md",
        requestedKey: "Status",
        foundKey: "STATUS",
      },
    ]);
    expect(plan.fileStates).toEqual([
      {
        path: "DB/Row0.md",
        state: "case-variant",
        oldValue: "active",
        newValue: "legacy-stale-value",
      },
    ]);
    // The whole point: no automatic write for this path, so the pre-existing
    // "STATUS" key is never left orphaned next to a freshly written "Status".
    expect(plan.automaticWrites).toEqual([]);
  });

  it("Notidian-lqt4 mustFix: an exact new-key match plus a stray case-variant of the OLD key is surfaced (new-only branch)", () => {
    // Symmetric gap: hasNew = true (exact "state" already present), but a
    // stray case-variant of the OLD key ("Priority" as a differently-cased
    // spelling of the source column "priority") sits in the same file. The
    // new-only branch never writes anything either way, but silently
    // classifying the file as plain "new-only" (no issue) would report a
    // full, unqualified success while the stale-cased old key is left
    // completely untouched and unflagged.
    const table = baseTable();
    table.cols = table.cols.map((c) =>
      c.name === "status" ? { ...c, name: "priority" } : c
    );
    const paths = ["DB/Row0.md"];
    const frontmatterByPath: Record<string, Record<string, unknown>> = {
      "DB/Row0.md": { Priority: "High", state: "already-migrated" },
    };

    const plan = planRenameFrontmatterProperty({
      table,
      oldKey: "priority",
      newKey: "state",
      paths,
      frontmatterByPath,
    });

    expect(plan.canApplyAutomatically).toBe(false);
    expect(plan.requiresResolution).toBe(true);
    expect(plan.issues).toEqual([
      {
        reason: "case-variant-frontmatter-key",
        path: "DB/Row0.md",
        requestedKey: "priority",
        foundKey: "Priority",
      },
    ]);
    expect(plan.fileStates).toEqual([
      {
        path: "DB/Row0.md",
        state: "case-variant",
        oldValue: "High",
        newValue: "already-migrated",
      },
    ]);
    expect(plan.automaticWrites).toEqual([]);
  });

  it("Notidian-lqt4 mustFix: a single file carrying case-variants of BOTH old and new keys produces two distinct issues for one path", () => {
    // Neither key is present under its exact spelling, and the file's real
    // frontmatter holds a stray case-variant of EACH side at once -- the
    // dual-issue-per-path branch (oldCaseVariantKey AND newCaseVariantKey
    // both truthy) that no prior test constructed.
    const table = baseTable();
    table.cols = table.cols.map((c) =>
      c.name === "status" ? { ...c, name: "state" } : c
    );
    const paths = ["DB/Row0.md"];
    const frontmatterByPath: Record<string, Record<string, unknown>> = {
      "DB/Row0.md": { State: "queued", ARCHIVED: "yes" },
    };

    const plan = planRenameFrontmatterProperty({
      table,
      oldKey: "state",
      newKey: "archived",
      paths,
      frontmatterByPath,
    });

    expect(plan.canApplyAutomatically).toBe(false);
    expect(plan.requiresResolution).toBe(true);
    expect(plan.issues).toEqual([
      {
        reason: "case-variant-frontmatter-key",
        path: "DB/Row0.md",
        requestedKey: "state",
        foundKey: "State",
      },
      {
        reason: "case-variant-frontmatter-key",
        path: "DB/Row0.md",
        requestedKey: "archived",
        foundKey: "ARCHIVED",
      },
    ]);
    // One fileState entry per path, even though it carries two issues.
    expect(plan.fileStates).toEqual([
      {
        path: "DB/Row0.md",
        state: "case-variant",
        oldValue: "queued",
        newValue: "yes",
      },
    ]);
    expect(plan.automaticWrites).toEqual([]);
  });

  it("PIN: sourceColumn lookup is case-sensitive — case-variant oldKey fails safely (missing-source-column)", () => {
    const table = baseTable(); // column is exactly "status"
    const paths = buildPaths(50);
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    paths.forEach((p) => (frontmatterByPath[p] = { STATUS: "active" }));

    const plan = planRenameFrontmatterProperty({
      table,
      oldKey: "STATUS", // case-variant of the real column "status"
      newKey: "workflow_state",
      paths,
      frontmatterByPath,
    });

    expect(plan.canApplyAutomatically).toBe(false);
    expect(plan.issues).toEqual([
      { reason: "missing-source-column", key: "STATUS" },
    ]);
    // CONFIRM-GATED: no file scan happened, nothing was written.
    expect(plan.fileStates).toEqual([]);
    expect(plan.automaticWrites).toEqual([]);
  });

  it("500-run fuzz: automaticWrites never includes a both-conflict or case-variant path (FIXED behavior)", () => {
    const rng = makeRng(0xdead11);
    const CASINGS = ["state", "State", "STATE", "sTaTe"];

    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const table = baseTable();
      table.cols = table.cols.map((c) =>
        c.name === "status" ? { ...c, name: "state" } : c
      );
      const n = randInt(rng, 1, 60);
      const paths = buildPaths(n, `R${run}`);
      const frontmatterByPath: Record<string, Record<string, unknown>> = {};
      for (const path of paths) {
        const casing = pick(rng, CASINGS);
        const includeNew = rng() > 0.6;
        const fm: Record<string, unknown> = { [casing]: `v${randInt(rng, 0, 9)}` };
        if (includeNew) fm["archived"] = `v${randInt(rng, 0, 9)}`;
        frontmatterByPath[path] = fm;
      }

      const plan = planRenameFrontmatterProperty({
        table,
        oldKey: "state",
        newKey: "archived",
        paths,
        frontmatterByPath,
      });

      const conflictPaths = new Set(
        plan.fileStates
          .filter((f) => f.state === "both-conflict")
          .map((f) => f.path)
      );
      const caseVariantPaths = new Set(
        plan.fileStates
          .filter((f) => f.state === "case-variant")
          .map((f) => f.path)
      );
      const neitherOrNewOnlyPaths = new Set(
        plan.fileStates
          .filter((f) => f.state === "neither" || f.state === "new-only")
          .map((f) => f.path)
      );

      for (const write of plan.automaticWrites) {
        expect(conflictPaths.has(write.path)).toBe(false);
        expect(caseVariantPaths.has(write.path)).toBe(false);
        expect(neitherOrNewOnlyPaths.has(write.path)).toBe(false);
      }
      // FIXED (Notidian-lqt4): a case-variant-cased path (any CASINGS entry
      // other than the exact "state") with no exact "archived" key present
      // must never fall into "neither" -- it is always routed to
      // "case-variant", accompanied by a matching issue, and always blocks
      // full automatic apply for the whole plan.
      if (caseVariantPaths.size > 0) {
        expect(plan.canApplyAutomatically).toBe(false);
        expect(plan.requiresResolution).toBe(true);
        const issuePaths = new Set(
          plan.issues
            .filter((issue) => issue.reason === "case-variant-frontmatter-key")
            .map((issue) => issue.path)
        );
        expect(issuePaths).toEqual(caseVariantPaths);
      }
      // CONFIRM-GATED: any issue at all (schema or per-file conflict) means
      // canApplyAutomatically must be false.
      if (plan.issues.length > 0) {
        expect(plan.canApplyAutomatically).toBe(false);
      } else {
        expect(plan.canApplyAutomatically).toBe(true);
      }
    }
  });

  it("500-run fuzz (Notidian-lqt4): an exact match on one key plus an independent stray case-variant of the OTHER key is always routed to case-variant, in both the old-only and new-only shapes", () => {
    // Every earlier fuzz in this suite only ever varies the CASING of the
    // OLD key while holding the new key ("archived") fixed and exact, so it
    // can never construct the shapes this bead's reviewers flagged as
    // unproven: an exact old-key file that ALSO carries a stray case-variant
    // of the new key, and the symmetric exact-new-key-plus-stray-old-variant
    // shape. This fuzz builds each file from one of six explicit shapes and
    // asserts the exact classification + automaticWrites/issues invariant
    // for every one of them.
    const rng = makeRng(0xdead22);
    const OLD_VARIANTS = ["State", "STATE", "sTaTe"]; // never exactly "state"
    const NEW_VARIANTS = ["Archived", "ARCHIVED", "aRchiVED"]; // never exactly "archived"
    const shapes = [
      "old-exact-only",
      "new-exact-only",
      "old-exact-plus-new-variant",
      "new-exact-plus-old-variant",
      "old-variant-only",
      "new-variant-only",
      "both-variants",
      "unrelated-only",
    ] as const;

    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const table = baseTable();
      table.cols = table.cols.map((c) =>
        c.name === "status" ? { ...c, name: "state" } : c
      );
      const n = randInt(rng, 1, 40);
      const paths = buildPaths(n, `S${run}`);
      const frontmatterByPath: Record<string, Record<string, unknown>> = {};
      const shapeByPath = new Map<string, (typeof shapes)[number]>();

      for (const path of paths) {
        const shape = pick(rng, shapes);
        shapeByPath.set(path, shape);
        const fm: Record<string, unknown> = {};
        switch (shape) {
          case "old-exact-only":
            fm["state"] = "v";
            break;
          case "new-exact-only":
            fm["archived"] = "v";
            break;
          case "old-exact-plus-new-variant":
            fm["state"] = "v";
            fm[pick(rng, NEW_VARIANTS)] = "stray";
            break;
          case "new-exact-plus-old-variant":
            fm["archived"] = "v";
            fm[pick(rng, OLD_VARIANTS)] = "stray";
            break;
          case "old-variant-only":
            fm[pick(rng, OLD_VARIANTS)] = "v";
            break;
          case "new-variant-only":
            fm[pick(rng, NEW_VARIANTS)] = "v";
            break;
          case "both-variants":
            fm[pick(rng, OLD_VARIANTS)] = "v";
            fm[pick(rng, NEW_VARIANTS)] = "w";
            break;
          case "unrelated-only":
            fm["some_other_key"] = "v";
            break;
        }
        frontmatterByPath[path] = fm;
      }

      const plan = planRenameFrontmatterProperty({
        table,
        oldKey: "state",
        newKey: "archived",
        paths,
        frontmatterByPath,
      });

      const stateByPath = new Map(plan.fileStates.map((f) => [f.path, f.state]));
      const writtenPaths = new Set(plan.automaticWrites.map((w) => w.path));
      const caseVariantIssuePaths = new Set(
        plan.issues
          .filter((issue) => issue.reason === "case-variant-frontmatter-key")
          .map((issue) => issue.path)
      );

      for (const path of paths) {
        const shape = shapeByPath.get(path);
        const state = stateByPath.get(path);
        switch (shape) {
          case "old-exact-only":
            expect(state).toBe("old-only");
            expect(writtenPaths.has(path)).toBe(true);
            expect(caseVariantIssuePaths.has(path)).toBe(false);
            break;
          case "new-exact-only":
            expect(state).toBe("new-only");
            expect(writtenPaths.has(path)).toBe(false);
            expect(caseVariantIssuePaths.has(path)).toBe(false);
            break;
          case "old-exact-plus-new-variant":
          case "new-exact-plus-old-variant":
          case "old-variant-only":
          case "new-variant-only":
            expect(state).toBe("case-variant");
            expect(writtenPaths.has(path)).toBe(false);
            expect(caseVariantIssuePaths.has(path)).toBe(true);
            break;
          case "both-variants":
            expect(state).toBe("case-variant");
            expect(writtenPaths.has(path)).toBe(false);
            // Both sides are stray case-variants here -- two distinct
            // issues share this one path.
            expect(
              plan.issues.filter(
                (issue) =>
                  issue.reason === "case-variant-frontmatter-key" &&
                  issue.path === path
              ).length
            ).toBe(2);
            break;
          case "unrelated-only":
            expect(state).toBe("neither");
            expect(writtenPaths.has(path)).toBe(false);
            expect(caseVariantIssuePaths.has(path)).toBe(false);
            break;
        }
      }

      // CONFIRM-GATED: any per-file case-variant issue blocks the whole plan.
      if (caseVariantIssuePaths.size > 0) {
        expect(plan.canApplyAutomatically).toBe(false);
        expect(plan.requiresResolution).toBe(true);
      }
      expect(plan.canApplyAutomatically).toBe(plan.issues.length === 0);
    }
  });

  it("500-run fuzz: case-variant detection also fires across NFC/NFD-normalized old/new keys, treating them as genuinely distinct (no false-positive case-fold across normalization forms)", () => {
    // "café" (NFC, precomposed é) vs "café" (NFD, e + combining acute) are
    // visually identical but different code point sequences. The fix's
    // fallback lookup case-folds via toLowerCase() only (mirroring
    // caseInsensitiveColumn's existing contract) -- it does NOT Unicode-
    // normalize, so an NFD-keyed file is never mistaken for a case-variant
    // of an NFC oldKey, and vice versa. This is a deliberate, narrower scope
    // than full Unicode-fold case-variant detection (documented, unfixed gap
    // -- see the "Unicode NFC/NFD-normalized key collisions" describe block).
    const rng = makeRng(0xdead15);
    const CAFE_NFC = "café";
    // Derive the NFD form programmatically rather than hand-typing a second
    // invisible Unicode string literal -- "é" (precomposed) vs "e" + U+0301
    // (combining acute) render identically, so a hand-typed second literal
    // risks silently collapsing to the same NFC bytes as CAFE_NFC.
    const CAFE_NFD = CAFE_NFC.normalize("NFD");
    const CASINGS = [CAFE_NFC, CAFE_NFD, "CAFÉ", "Café"];

    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const table = baseTable();
      table.cols = table.cols.map((c) =>
        c.name === "status" ? { ...c, name: CAFE_NFC } : c
      );
      const n = randInt(rng, 1, 40);
      const paths = buildPaths(n, `U${run}`);
      const frontmatterByPath: Record<string, Record<string, unknown>> = {};
      for (const path of paths) {
        frontmatterByPath[path] = { [pick(rng, CASINGS)]: "v" };
      }

      const plan = planRenameFrontmatterProperty({
        table,
        oldKey: CAFE_NFC,
        newKey: "renamed",
        paths,
        frontmatterByPath,
      });

      expect(() => plan).not.toThrow();
      for (const fileState of plan.fileStates) {
        const key = Object.keys(frontmatterByPath[fileState.path])[0];
        if (key === CAFE_NFC) {
          expect(fileState.state).toBe("old-only");
        } else if (key.toLowerCase() === CAFE_NFC.toLowerCase()) {
          // "CAFÉ" / "Café" are real case-variants of the NFC column name.
          expect(fileState.state).toBe("case-variant");
        } else {
          // CAFE_NFD is a different code point sequence entirely -- neither
          // an exact match nor a case-fold match of the NFC column name.
          expect(fileState.state).toBe("neither");
        }
      }
    }
  });
});

describe("planDeleteFrontmatterProperty — case-variant collisions", () => {
  it("PIN: deleting a case-variant of the real column name is confirm-gated to missing-source-column", () => {
    const table = baseTable(); // "status"
    const paths = buildPaths(300);
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    paths.forEach((p) => (frontmatterByPath[p] = { STATUS: "active" }));

    const plan = planDeleteFrontmatterProperty({
      table,
      key: "STATUS",
      mode: "delete-frontmatter",
      paths,
      frontmatterByPath,
    });

    expect(plan.issues).toEqual([
      { reason: "missing-source-column", key: "STATUS" },
    ]);
    expect(plan.affectedFiles).toEqual([]);
    expect(plan.frontmatterWrites).toEqual([]);
    expect(plan.requiresConfirmation).toBe(false); // nothing to confirm — nothing found
    expect(plan.canApplyAutomatically).toBe(false); // destructive mode never auto-applies
  });
});

// ---------------------------------------------------------------------------
// 2. Unicode NFC/NFD-normalized key collisions
// ---------------------------------------------------------------------------

describe("Unicode NFC/NFD-normalized key collisions", () => {
  // "café" spelled with a precomposed é (U+00E9) vs. "café" spelled with a
  // bare e (U+0065) + combining acute accent (U+0301). They render
  // identically but are different byte/char sequences.
  const CAFE_NFC = "café";
  const CAFE_NFD = "café";

  it("sanity: the two forms are visually identical but not ===", () => {
    expect(CAFE_NFC).not.toBe(CAFE_NFD);
    expect(CAFE_NFC.normalize("NFC")).toBe(CAFE_NFD.normalize("NFC"));
  });

  it("PIN: createFrontmatterPropertyPlan does NOT treat NFC/NFD forms as duplicates", () => {
    const table = baseTable();
    const first = createFrontmatterPropertyPlan({
      table,
      key: CAFE_NFC,
      type: "text",
    });
    expect(first.canApply).toBe(true);

    // Feed the NFD form against the table that now (in a real caller) would
    // include the NFC column — but createFrontmatterPropertyPlan checks the
    // TABLE PASSED IN, so simulate the sequential-apply scenario directly:
    const tableWithNFC = first.tablePreview;
    const second = createFrontmatterPropertyPlan({
      table: tableWithNFC,
      key: CAFE_NFD,
      type: "text",
    });

    // Not normalized -> not detected as a duplicate -> both succeed, meaning
    // the resulting schema could end up with two visually-identical columns.
    expect(second.canApply).toBe(true);
    expect(second.issues).toEqual([]);
  });

  it("PIN: renaming with a differently-normalized oldKey than the stored column fails safely (missing-source-column)", () => {
    const table = baseTable();
    table.cols = table.cols.map((c) =>
      c.name === "status" ? { ...c, name: CAFE_NFC } : c
    );
    const paths = buildPaths(20);
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    paths.forEach((p) => (frontmatterByPath[p] = { [CAFE_NFD]: "v" }));

    const plan = planRenameFrontmatterProperty({
      table,
      oldKey: CAFE_NFD, // different normalization than the stored column name
      newKey: "renamed",
      paths,
      frontmatterByPath,
    });

    expect(plan.canApplyAutomatically).toBe(false);
    expect(plan.issues).toEqual([
      { reason: "missing-source-column", key: CAFE_NFD },
    ]);
    expect(plan.automaticWrites).toEqual([]);
  });

  it("TOTAL: 700 paths mixing NFC/NFD/emoji/CJK/combining-mark keys through discover + delete", () => {
    const UNICODE_KEY_VARIANTS = [
      CAFE_NFC,
      CAFE_NFD,
      "日本語", // CJK "Japanese"
      "😀field", // emoji-prefixed key
      "á̂̃", // stacked combining marks on "a"
      "​field", // zero-width-space-prefixed key
    ];
    const paths = buildPaths(700, "Uni");
    const rng = makeRng(0xf00d01);
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    for (const path of paths) {
      frontmatterByPath[path] = { [pick(rng, UNICODE_KEY_VARIANTS)]: "v" };
    }

    expect(() =>
      discoverFrontmatterSchema({ paths, frontmatterByPath })
    ).not.toThrow();

    const table = baseTable();
    table.cols.push({
      name: CAFE_NFC,
      type: "text",
      value: "",
      schemaId: defaultContextSchemaID,
      source: frontmatterPropertySource,
    });

    const plan = planDeleteFrontmatterProperty({
      table,
      key: CAFE_NFC,
      mode: "delete-frontmatter",
      paths,
      frontmatterByPath,
    });

    // Only the paths keyed with the EXACT NFC form are affected — the NFD
    // form (a different string) is untouched, exactly matching the
    // exact-string discipline pinned above.
    expect(plan.affectedFiles.length).toBe(plan.frontmatterWrites.length);
    for (const path of plan.affectedFiles) {
      expect(Object.prototype.hasOwnProperty.call(frontmatterByPath[path], CAFE_NFC)).toBe(
        true
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Non-plain-object frontmatter values (arrays/null/primitives) per path
// ---------------------------------------------------------------------------

describe("non-plain-object frontmatter snapshots per path", () => {
  // frontmatterByPath[path] itself (not a field value) is malformed: an
  // array, null, a primitive, or undefined instead of a proper key/value
  // frontmatter object. This can happen if an upstream indexer hands the
  // planner a corrupt or partially-migrated snapshot map.
  const MALFORMED_SNAPSHOTS: readonly unknown[] = [
    [],
    ["a", "b", "c"],
    null,
    undefined,
    0,
    42,
    "",
    "plain string",
    true,
    false,
    NaN,
  ];

  it("TOTAL: discoverFrontmatterSchema never throws for any malformed per-path snapshot", () => {
    for (const malformed of MALFORMED_SNAPSHOTS) {
      const paths = ["A.md", "B.md"];
      const frontmatterByPath: Record<string, unknown> = {
        "A.md": malformed,
        "B.md": { status: "ok" },
      };
      expect(() =>
        discoverFrontmatterSchema({
          paths,
          frontmatterByPath: frontmatterByPath as FrontmatterSnapshotsByPath,
        })
      ).not.toThrow();
    }
  });

  it("TOTAL: planRenameFrontmatterProperty never throws for any malformed per-path snapshot", () => {
    for (const malformed of MALFORMED_SNAPSHOTS) {
      const table = baseTable();
      const paths = ["A.md", "B.md"];
      const frontmatterByPath: Record<string, unknown> = {
        "A.md": malformed,
        "B.md": { status: "ok" },
      };
      expect(() =>
        planRenameFrontmatterProperty({
          table,
          oldKey: "status",
          newKey: "workflow",
          paths,
          frontmatterByPath: frontmatterByPath as FrontmatterSnapshotsByPath,
        })
      ).not.toThrow();
    }
  });

  it("TOTAL: planDeleteFrontmatterProperty never throws for any malformed per-path snapshot", () => {
    for (const malformed of MALFORMED_SNAPSHOTS) {
      const table = baseTable();
      const paths = ["A.md", "B.md"];
      const frontmatterByPath: Record<string, unknown> = {
        "A.md": malformed,
        "B.md": { status: "ok" },
      };
      expect(() =>
        planDeleteFrontmatterProperty({
          table,
          key: "status",
          mode: "delete-frontmatter",
          paths,
          frontmatterByPath: frontmatterByPath as FrontmatterSnapshotsByPath,
        })
      ).not.toThrow();
    }
  });

  it("PIN: an array-valued snapshot exposes its indices as pseudo-keys to discoverFrontmatterSchema", () => {
    const paths = ["A.md"];
    const frontmatterByPath = {
      "A.md": ["first", "second"] as unknown as Record<string, unknown>,
    };
    const schema = discoverFrontmatterSchema({ paths, frontmatterByPath });
    const keys = schema.map((s) => s.key).sort();
    expect(keys).toEqual(["0", "1"]);
  });

  it("500-run fuzz: TOTAL over malformed snapshots combined with Map/Record forms and 1-50 paths", () => {
    const rng = makeRng(0xdead12);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const n = randInt(rng, 1, 50);
      const paths = buildPaths(n, `M${run}`);
      const asMap = rng() > 0.5;
      const entries: [string, unknown][] = paths.map((p) => [
        p,
        rng() > 0.5 ? pick(rng, MALFORMED_SNAPSHOTS) : { status: "ok" },
      ]);
      const frontmatterByPath = (asMap
        ? new Map(entries)
        : Object.fromEntries(entries)) as FrontmatterSnapshotsByPath;

      const table = baseTable();
      expect(() =>
        discoverFrontmatterSchema({ paths, frontmatterByPath })
      ).not.toThrow();
      expect(() =>
        planRenameFrontmatterProperty({
          table,
          oldKey: "status",
          newKey: "workflow",
          paths,
          frontmatterByPath,
        })
      ).not.toThrow();
      expect(() =>
        planDeleteFrontmatterProperty({
          table,
          key: "status",
          mode: "delete-frontmatter",
          paths,
          frontmatterByPath,
        })
      ).not.toThrow();
    }
  });
});

describe("non-plain-object frontmatter FIELD values (arrays/null/primitives/exotic)", () => {
  const FIELD_VALUES: readonly unknown[] = [
    [],
    [1, 2, 3],
    ["a", ["b", "c"]],
    null,
    undefined,
    0,
    -0,
    NaN,
    Infinity,
    -Infinity,
    "",
    true,
    false,
    { nested: "object" },
    new Date(0),
  ];

  it("TOTAL: discoverFrontmatterSchema field-type detection never throws across the full pool", () => {
    for (const value of FIELD_VALUES) {
      const paths = ["A.md"];
      const frontmatterByPath = { "A.md": { field: value } };
      expect(() =>
        discoverFrontmatterSchema({ paths, frontmatterByPath })
      ).not.toThrow();
    }
  });

  it("500-run fuzz: TOTAL + STABLE for planRenameFrontmatterProperty over exotic per-file field values", () => {
    const rng = makeRng(0xdead13);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const table = baseTable();
      const n = randInt(rng, 1, 30);
      const paths = buildPaths(n, `F${run}`);
      const frontmatterByPath: Record<string, Record<string, unknown>> = {};
      for (const path of paths) {
        const hasOld = rng() > 0.3;
        const hasNew = rng() > 0.5;
        const fm: Record<string, unknown> = {};
        if (hasOld) fm["status"] = pick(rng, FIELD_VALUES);
        if (hasNew) fm["workflow"] = pick(rng, FIELD_VALUES);
        frontmatterByPath[path] = fm;
      }

      const call = () =>
        planRenameFrontmatterProperty({
          table,
          oldKey: "status",
          newKey: "workflow",
          paths,
          frontmatterByPath,
        });

      expect(call).not.toThrow();
      const a = call();
      const b = call();
      expect(a).toEqual(b); // STABLE
      expect(a.fileStates.length).toBe(paths.length);
    }
  });

  // ---- Exotic bonus: values that can never come from real YAML frontmatter
  // parsing (Map/Set/circular refs) but are legal at the `unknown` type
  // boundary and worth pinning defensively, mirroring the sibling
  // keyMatchResolver adversarial suite's EXOTIC_VALUES treatment.
  it("Notidian-hz8f FIXED: Map/Set frontmatter values with different contents compare NOT equal (no false both-same auto-drop)", () => {
    // stableNormalize now has explicit Map/Set branches (before the plain-
    // object branch). Previously Object.keys(map) returned [] so two DIFFERENT
    // Maps both collapsed to "{}" and valuesEqual reported them "both-same" --
    // planRenameFrontmatterProperty would then auto-write removeKeys:[oldKey],
    // silently dropping a value that actually differed (latent data loss).
    // Now the differing contents surface as a "both-conflict" with no
    // automatic write, for both Map and Set values.
    const table = baseTable();

    for (const [oldValue, newValue] of [
      [new Map([["a", 1]]), new Map([["b", 2]])],
      [new Set([1, 2, 3]), new Set([4, 5, 6])],
    ] as const) {
      const path = "A.md";
      const frontmatterByPath = { [path]: { status: oldValue, workflow: newValue } };

      const plan = planRenameFrontmatterProperty({
        table,
        oldKey: "status",
        newKey: "workflow",
        paths: [path],
        frontmatterByPath,
      });

      expect(plan.fileStates).toEqual([
        { path, state: "both-conflict", oldValue, newValue },
      ]);
      expect(plan.issues).toContainEqual({
        reason: "frontmatter-conflict",
        path,
        oldKey: "status",
        newKey: "workflow",
      });
      expect(plan.automaticWrites).toEqual([]);
      expect(plan.canApplyAutomatically).toBe(false);
    }
  });

  it("Notidian-hz8f FIXED: Map/Set frontmatter values with identical contents compare EQUAL (order-independent)", () => {
    // The Map/Set branches sort their (recursively normalized) entries, so two
    // Sets with the same members in a different insertion order -- and two
    // Maps with the same key/value pairs -- normalize identically and compare
    // EQUAL, yielding the "both-same" auto-migration path.
    const table = baseTable();
    const path = "A.md";
    const frontmatterByPath = {
      [path]: {
        status: new Set([3, 1, 2]),
        workflow: new Set([1, 2, 3]), // same members, different order
      },
    };

    const plan = planRenameFrontmatterProperty({
      table,
      oldKey: "status",
      newKey: "workflow",
      paths: [path],
      frontmatterByPath,
    });

    expect(plan.fileStates).toEqual([
      {
        path,
        state: "both-same",
        oldValue: frontmatterByPath[path].status,
        newValue: frontmatterByPath[path].workflow,
      },
    ]);
    expect(plan.automaticWrites).toEqual([
      { path, set: {}, removeKeys: ["status"] },
    ]);
  });

  it("Notidian-hz8f FIXED: a self-referential (circular) frontmatter value no longer crashes valuesEqual's normalize step", () => {
    // Cannot occur from real YAML parsing (no object identity in YAML), but
    // the type signature (`unknown`) permits it. stableNormalize now threads a
    // WeakSet visited-guard so a self-reference yields a stable "[Circular]"
    // sentinel instead of overflowing the stack. Two DISTINCT circular objects
    // are used (not the same reference) so valuesEqual's Object.is(left, right)
    // fast path can't short-circuit before reaching stableNormalize; with the
    // same shape they normalize identically and compare EQUAL (both-same).
    const circularA: Record<string, unknown> = {};
    circularA.self = circularA;
    const circularB: Record<string, unknown> = {};
    circularB.self = circularB;

    const table = baseTable();
    const path = "A.md";
    const frontmatterByPath = {
      [path]: { status: circularA, workflow: circularB },
    };

    const call = () =>
      planRenameFrontmatterProperty({
        table,
        oldKey: "status",
        newKey: "workflow",
        paths: [path],
        frontmatterByPath,
      });

    expect(call).not.toThrow();
    const plan = call();
    expect(plan.fileStates).toEqual([
      { path, state: "both-same", oldValue: circularA, newValue: circularB },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. Whitespace-only / empty keys
// ---------------------------------------------------------------------------

describe("whitespace-only and empty keys", () => {
  const EMPTY_AFTER_TRIM = ["", " ", "  ", "\t", "\n", "\t\n \t", "   \t  "];

  it("TOTAL + CONFIRM-GATED: createFrontmatterPropertyPlan blocks every whitespace-only key", () => {
    const table = baseTable();
    for (const key of EMPTY_AFTER_TRIM) {
      const plan = createFrontmatterPropertyPlan({ table, key, type: "text" });
      expect(plan.canApply).toBe(false);
      expect(plan.frontmatterWrites).toEqual([]);
      expect(plan.issues).toContainEqual({ reason: "empty-key", key });
    }
  });

  it("TOTAL + CONFIRM-GATED: planRenameFrontmatterProperty blocks whitespace-only oldKey/newKey", () => {
    const table = baseTable();
    const paths = buildPaths(10);
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    paths.forEach((p) => (frontmatterByPath[p] = { status: "active" }));

    for (const key of EMPTY_AFTER_TRIM) {
      const plan = planRenameFrontmatterProperty({
        table,
        oldKey: key,
        newKey: "workflow",
        paths,
        frontmatterByPath,
      });
      expect(plan.canApplyAutomatically).toBe(false);
      expect(plan.automaticWrites).toEqual([]);
      expect(plan.fileStates).toEqual([]);
      expect(plan.issues).toContainEqual({ reason: "empty-key", key });

      const planBothEmpty = planRenameFrontmatterProperty({
        table,
        oldKey: key,
        newKey: "   ",
        paths,
        frontmatterByPath,
      });
      expect(planBothEmpty.canApplyAutomatically).toBe(false);
      expect(planBothEmpty.automaticWrites).toEqual([]);
    }
  });

  it("TOTAL + CONFIRM-GATED: planDeleteFrontmatterProperty blocks whitespace-only key even in destructive mode", () => {
    const table = baseTable();
    const paths = buildPaths(10);
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    paths.forEach((p) => (frontmatterByPath[p] = { status: "active" }));

    for (const key of EMPTY_AFTER_TRIM) {
      const plan = planDeleteFrontmatterProperty({
        table,
        key,
        mode: "delete-frontmatter",
        paths,
        frontmatterByPath,
      });
      expect(plan.canApplyAutomatically).toBe(false);
      expect(plan.frontmatterWrites).toEqual([]);
      expect(plan.affectedFiles).toEqual([]);
      expect(plan.issues).toContainEqual({ reason: "empty-key", key });
    }
  });

  it("PIN: a zero-width-space-only key is NOT stripped by trim() and is treated as a valid new key", () => {
    // JS String.prototype.trim() only strips Unicode "White_Space" code
    // points; U+200B (ZERO WIDTH SPACE) is explicitly NOT in that set, so a
    // key that is *only* a ZWSP is a non-empty, "successfully created"
    // column name — an invisible, easy-to-mistype landmine, but not one this
    // module's empty-key guard catches.
    const table = baseTable();
    const zwsp = "​";
    const plan = createFrontmatterPropertyPlan({
      table,
      key: zwsp,
      type: "text",
    });
    expect(plan.canApply).toBe(true);
    expect(plan.issues).toEqual([]);
    expect(plan.tablePreview.cols.at(-1)?.name).toBe(zwsp);
  });

  it("PIN: leading/trailing whitespace around a real key IS trimmed and detected as a duplicate", () => {
    const table = baseTable(); // has "status"
    const plan = createFrontmatterPropertyPlan({
      table,
      key: "  STATUS  ",
      type: "text",
    });
    expect(plan.canApply).toBe(false);
    expect(plan.issues).toEqual([
      { reason: "duplicate-column", key: "  STATUS  ", existingKey: "status" },
    ]);
  });

  it("500-run fuzz: TOTAL + CONFIRM-GATED over a whitespace/Unicode-space key pool across all three planners", () => {
    const rng = makeRng(0xdead14);
    const KEY_POOL = [
      "",
      " ",
      "\t",
      "\n",
      " ", // no-break space
      "​", // zero-width space
      "　", // ideographic space
      "status",
      " status ",
      "STATUS",
      "a",
      " a ",
    ];

    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const table = baseTable();
      const paths = buildPaths(randInt(rng, 1, 20), `W${run}`);
      const frontmatterByPath: Record<string, Record<string, unknown>> = {};
      paths.forEach((p) => (frontmatterByPath[p] = { status: "active" }));

      const key = pick(rng, KEY_POOL);
      const newKey = pick(rng, KEY_POOL);

      expect(() =>
        createFrontmatterPropertyPlan({ table, key, type: "text" })
      ).not.toThrow();
      const createPlan = createFrontmatterPropertyPlan({
        table,
        key,
        type: "text",
      });
      if (key.trim().length === 0) {
        expect(createPlan.canApply).toBe(false);
        expect(createPlan.frontmatterWrites).toEqual([]);
      }

      expect(() =>
        planRenameFrontmatterProperty({
          table,
          oldKey: key,
          newKey,
          paths,
          frontmatterByPath,
        })
      ).not.toThrow();
      const renamePlan = planRenameFrontmatterProperty({
        table,
        oldKey: key,
        newKey,
        paths,
        frontmatterByPath,
      });
      if (key.trim().length === 0 || newKey.trim().length === 0) {
        expect(renamePlan.canApplyAutomatically).toBe(false);
        expect(renamePlan.automaticWrites).toEqual([]);
      }

      expect(() =>
        planDeleteFrontmatterProperty({
          table,
          key,
          mode: "delete-frontmatter",
          paths,
          frontmatterByPath,
        })
      ).not.toThrow();
      const deletePlan = planDeleteFrontmatterProperty({
        table,
        key,
        mode: "delete-frontmatter",
        paths,
        frontmatterByPath,
      });
      if (key.trim().length === 0) {
        expect(deletePlan.frontmatterWrites).toEqual([]);
        expect(deletePlan.canApplyAutomatically).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Large (1000+) path-count stress cases
// ---------------------------------------------------------------------------

describe("large dataset stress (1000+ paths)", () => {
  const ROW_COUNT = 1500;
  const SLOWDOWN_BUDGET_MS = 3000;

  const buildLargeFrontmatter = (
    paths: string[],
    rng: () => number
  ): Record<string, Record<string, unknown>> => {
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    for (const path of paths) {
      const roll = rng();
      if (roll < 0.5) {
        frontmatterByPath[path] = { state: `v${randInt(rng, 0, 9)}` };
      } else if (roll < 0.7) {
        frontmatterByPath[path] = { archived: `v${randInt(rng, 0, 9)}` };
      } else if (roll < 0.85) {
        frontmatterByPath[path] = {
          state: `v${randInt(rng, 0, 9)}`,
          archived: `v${randInt(rng, 0, 9)}`,
        };
      } else {
        frontmatterByPath[path] = {};
      }
    }
    return frontmatterByPath;
  };

  it("TOTAL + bounded time: discoverFrontmatterSchema over 1500 paths", () => {
    const rng = makeRng(0xbeef01);
    const paths = buildPaths(ROW_COUNT, "Large");
    const frontmatterByPath = buildLargeFrontmatter(paths, rng);

    const start = Date.now();
    let schema: ReturnType<typeof discoverFrontmatterSchema> = [];
    expect(() => {
      schema = discoverFrontmatterSchema({ paths, frontmatterByPath });
    }).not.toThrow();
    expect(Date.now() - start).toBeLessThan(SLOWDOWN_BUDGET_MS);
    expect(schema.every((s) => s.presentCount + s.missingCount === ROW_COUNT)).toBe(
      true
    );
  });

  it("TOTAL + bounded time + STRUCTURAL invariants: planRenameFrontmatterProperty over 1500 paths", () => {
    const rng = makeRng(0xbeef02);
    const table = baseTable();
    table.cols = table.cols.map((c) =>
      c.name === "status" ? { ...c, name: "state" } : c
    );
    const paths = buildPaths(ROW_COUNT, "Large");
    const frontmatterByPath = buildLargeFrontmatter(paths, rng);

    const start = Date.now();
    let plan: ReturnType<typeof planRenameFrontmatterProperty> | undefined;
    expect(() => {
      plan = planRenameFrontmatterProperty({
        table,
        oldKey: "state",
        newKey: "archived",
        paths,
        frontmatterByPath,
      });
    }).not.toThrow();
    expect(Date.now() - start).toBeLessThan(SLOWDOWN_BUDGET_MS);

    expect(plan!.fileStates.length).toBe(ROW_COUNT);
    expect(plan!.automaticWrites.length).toBeLessThanOrEqual(ROW_COUNT);
    // No write ever targets a both-conflict path.
    const conflicts = new Set(
      plan!.fileStates
        .filter((f) => f.state === "both-conflict")
        .map((f) => f.path)
    );
    expect(plan!.automaticWrites.every((w) => !conflicts.has(w.path))).toBe(true);
    // requiresResolution correctly mirrors the presence of a conflict.
    expect(plan!.requiresResolution).toBe(conflicts.size > 0);
  });

  it("TOTAL + bounded time + CONFIRM-GATED: planDeleteFrontmatterProperty (destructive) over 1500 paths", () => {
    const rng = makeRng(0xbeef03);
    const table = baseTable();
    table.cols = table.cols.map((c) =>
      c.name === "status" ? { ...c, name: "state" } : c
    );
    const paths = buildPaths(ROW_COUNT, "Large");
    const frontmatterByPath = buildLargeFrontmatter(paths, rng);

    const start = Date.now();
    let plan: ReturnType<typeof planDeleteFrontmatterProperty> | undefined;
    expect(() => {
      plan = planDeleteFrontmatterProperty({
        table,
        key: "state",
        mode: "delete-frontmatter",
        paths,
        frontmatterByPath,
      });
    }).not.toThrow();
    expect(Date.now() - start).toBeLessThan(SLOWDOWN_BUDGET_MS);

    expect(plan!.affectedFiles.length).toBe(plan!.frontmatterWrites.length);
    expect(plan!.canApplyAutomatically).toBe(false); // destructive never auto-applies
    expect(plan!.requiresConfirmation).toBe(plan!.affectedFiles.length > 0);
    for (const write of plan!.frontmatterWrites) {
      expect(write.removeKeys).toEqual(["state"]);
      expect(write.set).toEqual({});
    }
  });

  it("TOTAL: 2000-path Map-backed frontmatterByPath (not Record) does not throw or slow down", () => {
    const rng = makeRng(0xbeef04);
    const paths = buildPaths(2000, "MapLarge");
    const entries: [string, Record<string, unknown>][] = paths.map((p) => [
      p,
      rng() > 0.5 ? { state: "active" } : { archived: "yes" },
    ]);
    const frontmatterByPath = new Map(entries);
    const table = baseTable();
    table.cols = table.cols.map((c) =>
      c.name === "status" ? { ...c, name: "state" } : c
    );

    const start = Date.now();
    expect(() =>
      discoverFrontmatterSchema({ paths, frontmatterByPath })
    ).not.toThrow();
    expect(() =>
      planRenameFrontmatterProperty({
        table,
        oldKey: "state",
        newKey: "archived",
        paths,
        frontmatterByPath,
      })
    ).not.toThrow();
    expect(() =>
      planDeleteFrontmatterProperty({
        table,
        key: "state",
        mode: "delete-frontmatter",
        paths,
        frontmatterByPath,
      })
    ).not.toThrow();
    expect(Date.now() - start).toBeLessThan(SLOWDOWN_BUDGET_MS);
  });
});

// ---------------------------------------------------------------------------
// 6. Explicit confirm-gating invariant across every plan function
// ---------------------------------------------------------------------------

describe("confirm-gating invariant — never a silent destructive write", () => {
  it("createFrontmatterPropertyPlan: canApply is false and frontmatterWrites empty whenever issues exist (500 runs)", () => {
    const rng = makeRng(0xf00d10);
    const KEYS = ["", " ", "status", "STATUS", "new_field", "  new  ", "\t"];

    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const table = baseTable();
      const key = pick(rng, KEYS);
      const plan = createFrontmatterPropertyPlan({ table, key, type: "text" });

      expect(plan.frontmatterWrites).toEqual([]); // always empty for create
      if (plan.issues.length > 0) {
        expect(plan.canApply).toBe(false);
        expect(plan.tablePreview).toBe(table); // unchanged on rejection
      } else {
        expect(plan.canApply).toBe(true);
      }
    }
  });

  it("planRenameFrontmatterProperty: canApplyAutomatically is false whenever any issue exists (500 runs)", () => {
    const rng = makeRng(0xf00d11);
    const OLD_KEYS = ["status", "STATUS", "", " ", "missing"];
    const NEW_KEYS = ["status", "workflow", "", " ", "STATUS"];

    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const table = baseTable();
      const paths = buildPaths(randInt(rng, 0, 15), `G${run}`);
      const frontmatterByPath: Record<string, Record<string, unknown>> = {};
      paths.forEach((p) => {
        const fm: Record<string, unknown> = {};
        if (rng() > 0.4) fm["status"] = `v${randInt(rng, 0, 5)}`;
        if (rng() > 0.6) fm["workflow"] = `v${randInt(rng, 0, 5)}`;
        frontmatterByPath[p] = fm;
      });

      const oldKey = pick(rng, OLD_KEYS);
      const newKey = pick(rng, NEW_KEYS);
      const plan = planRenameFrontmatterProperty({
        table,
        oldKey,
        newKey,
        paths,
        frontmatterByPath,
      });

      if (plan.issues.length > 0) {
        expect(plan.canApplyAutomatically).toBe(false);
      } else {
        expect(plan.canApplyAutomatically).toBe(true);
      }
      // requiresResolution can only be true if canApplyAutomatically is false.
      if (plan.requiresResolution) {
        expect(plan.canApplyAutomatically).toBe(false);
      }
    }
  });

  it("planDeleteFrontmatterProperty: hide-from-view NEVER writes frontmatter regardless of input (500 runs)", () => {
    const rng = makeRng(0xf00d12);
    const KEYS = ["status", "STATUS", "", " ", "missing"];

    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const table = baseTable();
      const paths = buildPaths(randInt(rng, 0, 15), `H${run}`);
      const frontmatterByPath: Record<string, Record<string, unknown>> = {};
      paths.forEach((p) => (frontmatterByPath[p] = { status: "active" }));

      const plan = planDeleteFrontmatterProperty({
        table,
        key: pick(rng, KEYS),
        mode: "hide-from-view",
        paths,
        frontmatterByPath,
      });

      expect(plan.destructive).toBe(false);
      expect(plan.requiresConfirmation).toBe(false);
      expect(plan.frontmatterWrites).toEqual([]);
      expect(plan.affectedFiles).toEqual([]);
    }
  });

  it("planDeleteFrontmatterProperty: delete-frontmatter NEVER auto-applies, and only confirms when writes exist (500 runs)", () => {
    const rng = makeRng(0xf00d13);
    const KEYS = ["status", "STATUS", "", " ", "missing"];

    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const table = baseTable();
      const paths = buildPaths(randInt(rng, 0, 15), `I${run}`);
      const frontmatterByPath: Record<string, Record<string, unknown>> = {};
      paths.forEach((p) => {
        frontmatterByPath[p] = rng() > 0.4 ? { status: "active" } : {};
      });

      const plan = planDeleteFrontmatterProperty({
        table,
        key: pick(rng, KEYS),
        mode: "delete-frontmatter",
        paths,
        frontmatterByPath,
      });

      expect(plan.canApplyAutomatically).toBe(false); // never auto-applies
      expect(plan.requiresConfirmation).toBe(plan.frontmatterWrites.length > 0);
      if (plan.issues.length > 0) {
        expect(plan.frontmatterWrites).toEqual([]);
        expect(plan.affectedFiles).toEqual([]);
      }
    }
  });

  it("PIN: an unrecognized/garbage `mode` value never triggers a destructive write (fail-closed default)", () => {
    const table = baseTable();
    const paths = buildPaths(25);
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    paths.forEach((p) => (frontmatterByPath[p] = { status: "active" }));

    const GARBAGE_MODES = [
      "Delete-Frontmatter", // case-variant of the real destructive literal
      "DELETE",
      "",
      "hide",
      null,
      undefined,
      123,
      {},
    ];

    for (const garbageMode of GARBAGE_MODES) {
      const plan = planDeleteFrontmatterProperty({
        table,
        key: "status",
        mode: garbageMode as any, // adversarial: bypasses the TS union on purpose
        paths,
        frontmatterByPath,
      });

      expect(plan.destructive).toBe(false);
      expect(plan.frontmatterWrites).toEqual([]);
      expect(plan.affectedFiles).toEqual([]);
      expect(plan.requiresConfirmation).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. READ-ONLY invariants (inputs are never mutated by any plan function)
// ---------------------------------------------------------------------------

describe("READ-ONLY: plan functions never mutate their inputs", () => {
  it("discoverFrontmatterSchema does not mutate frontmatterByPath or paths", () => {
    const paths = buildPaths(50);
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    paths.forEach((p, i) => (frontmatterByPath[p] = { status: `v${i}` }));
    const snapshot = JSON.stringify(frontmatterByPath);
    const pathsSnapshot = [...paths];

    discoverFrontmatterSchema({ paths, frontmatterByPath });

    expect(JSON.stringify(frontmatterByPath)).toBe(snapshot);
    expect(paths).toEqual(pathsSnapshot);
  });

  it("planRenameFrontmatterProperty does not mutate table.cols, frontmatterByPath, or paths", () => {
    const table = baseTable();
    const colsSnapshot = JSON.stringify(table.cols);
    const paths = buildPaths(50);
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    paths.forEach((p, i) => (frontmatterByPath[p] = { status: `v${i}` }));
    const fmSnapshot = JSON.stringify(frontmatterByPath);

    planRenameFrontmatterProperty({
      table,
      oldKey: "status",
      newKey: "workflow",
      paths,
      frontmatterByPath,
    });

    expect(JSON.stringify(table.cols)).toBe(colsSnapshot);
    expect(JSON.stringify(frontmatterByPath)).toBe(fmSnapshot);
  });

  it("planDeleteFrontmatterProperty does not mutate table.cols or frontmatterByPath", () => {
    const table = baseTable();
    const colsSnapshot = JSON.stringify(table.cols);
    const paths = buildPaths(50);
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    paths.forEach((p, i) => (frontmatterByPath[p] = { status: `v${i}` }));
    const fmSnapshot = JSON.stringify(frontmatterByPath);

    planDeleteFrontmatterProperty({
      table,
      key: "status",
      mode: "delete-frontmatter",
      paths,
      frontmatterByPath,
    });

    expect(JSON.stringify(table.cols)).toBe(colsSnapshot);
    expect(JSON.stringify(frontmatterByPath)).toBe(fmSnapshot);
  });
});
