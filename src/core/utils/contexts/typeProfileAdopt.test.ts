import { NotidianTypeProfile } from "core/utils/contexts/typeProfile";
import {
  computeFieldValueStats,
  deriveEmptyEncodingStats,
  deriveEnumCandidate,
  detectPropertyProfileDivergence,
  draftTypeProfileAdoption,
  findForeignKeyCandidates,
  planTypeProfileAdoptionMerge,
  SiblingDatabaseValues,
  TypeProfileAdoptionDraft,
} from "./typeProfileAdopt";

// Fixture registry shape modeled on the Data Integrity Program's Gidi pilot
// (Notidian-loan.6): a small Sensor Registry with a bounded-cardinality
// `sensor_class` field, an id-shaped `sensor_id` field, and a `board_id`
// field whose values overlap a sibling Board Registry's `board_id` field.
const sensorPaths = [
  "Gidi/Hardware/Sensor Registry/S-01.md",
  "Gidi/Hardware/Sensor Registry/S-02.md",
  "Gidi/Hardware/Sensor Registry/S-03.md",
  "Gidi/Hardware/Sensor Registry/S-04.md",
  "Gidi/Hardware/Sensor Registry/S-05.md",
];

const sensorFrontmatterByPath: Record<string, Record<string, unknown>> = {
  "Gidi/Hardware/Sensor Registry/S-01.md": {
    sensor_id: "sn-001",
    sensor_class: "temperature",
    board_id: "board-1",
    notes: "",
  },
  "Gidi/Hardware/Sensor Registry/S-02.md": {
    sensor_id: "sn-002",
    sensor_class: "humidity",
    board_id: "board-1",
    notes: "calibrated",
  },
  "Gidi/Hardware/Sensor Registry/S-03.md": {
    sensor_id: "sn-003",
    sensor_class: "temperature",
    board_id: "board-2",
  },
  "Gidi/Hardware/Sensor Registry/S-04.md": {
    sensor_id: "sn-004",
    sensor_class: "pressure",
    board_id: "board-2",
    notes: "",
  },
  "Gidi/Hardware/Sensor Registry/S-05.md": {
    sensor_id: "sn-005",
    sensor_class: "temperature",
    // board_id absent on this row (partial adoption real-world case)
  },
};

const boardRegistrySiblingValues: SiblingDatabaseValues = {
  targetFolder: "Gidi/Hardware/Board Registry",
  targetKey: "board_id",
  values: new Set(["board-1", "board-2", "board-3"]),
};

describe("computeFieldValueStats", () => {
  it("separates absent, empty, and present rows and dedupes distinct values in first-seen order", () => {
    const stats = computeFieldValueStats(
      sensorPaths,
      sensorFrontmatterByPath,
      "sensor_class"
    );
    expect(stats).toEqual({
      key: "sensor_class",
      totalRows: 5,
      presentCount: 5,
      emptyStringCount: 0,
      absentCount: 0,
      distinctValues: ["temperature", "humidity", "pressure"],
      totalValueCount: 5,
    });
  });

  it("counts a present-but-empty key separately from an absent key", () => {
    const stats = computeFieldValueStats(
      sensorPaths,
      sensorFrontmatterByPath,
      "notes"
    );
    // present: "calibrated" (1); empty-string: "" on S-01 and S-04 (2);
    // absent: S-03 and S-05 never declare `notes` at all (2).
    expect(stats.presentCount).toBe(1);
    expect(stats.emptyStringCount).toBe(2);
    expect(stats.absentCount).toBe(2);
    expect(stats.distinctValues).toEqual(["calibrated"]);
  });

  it("counts a key absent on every row without throwing", () => {
    const stats = computeFieldValueStats(
      sensorPaths,
      sensorFrontmatterByPath,
      "does_not_exist"
    );
    expect(stats.absentCount).toBe(5);
    expect(stats.presentCount).toBe(0);
    expect(stats.emptyStringCount).toBe(0);
    expect(stats.distinctValues).toEqual([]);
  });

  it("flattens list-valued (multi_select-shaped) frontmatter into per-element distinct values", () => {
    const stats = computeFieldValueStats(
      ["A.md", "B.md"],
      {
        "A.md": { tags: ["alpha", "beta"] },
        "B.md": { tags: ["beta", "gamma"] },
      },
      "tags"
    );
    expect(stats.presentCount).toBe(2);
    expect(stats.distinctValues).toEqual(["alpha", "beta", "gamma"]);
    // totalValueCount counts every list element separately (2 + 2 = 4),
    // unlike presentCount, which counts the 2 ROWS.
    expect(stats.totalValueCount).toBe(4);
  });

  it("accepts a Map for frontmatterByPath (same shape notidianSchema.ts's planners accept)", () => {
    const stats = computeFieldValueStats(
      ["A.md"],
      new Map([["A.md", { status: "active" }]]),
      "status"
    );
    expect(stats.presentCount).toBe(1);
    expect(stats.distinctValues).toEqual(["active"]);
  });

  // Notidian-1adj: discoverFrontmatterSchema merges case-variant spellings into
  // ONE canonical key; computeFieldValueStats must aggregate across every
  // spelling that folds onto that key, or minority-spelling rows are miscounted
  // as absent and their values silently dropped from the drafted enum/FK/empty
  // stats.
  it("aggregates case-variant spellings of one canonical key so minority-spelling rows are not counted absent", () => {
    // 6 rows carry `state: active`, 4 carry `State: archived`. The merged
    // canonical key is "state"; an exact-case lookup would count the 4 `State`
    // rows absent and drop "archived". Case-folding unions all spellings.
    const paths = Array.from({ length: 10 }, (_, i) => `R-${i}.md`);
    const fm: Record<string, Record<string, unknown>> = {};
    paths.forEach((p, i) => {
      fm[p] = i < 6 ? { state: "active" } : { State: "archived" };
    });
    const stats = computeFieldValueStats(paths, fm, "state");
    expect(stats.presentCount).toBe(10);
    expect(stats.absentCount).toBe(0);
    expect(stats.distinctValues).toEqual(["active", "archived"]);
    expect(stats.totalValueCount).toBe(10);
  });

  it("unions both spellings from a single row carrying two of them and counts it present exactly once", () => {
    // A corrupt row holds both `state:` and `State:`. It must count as ONE
    // present row (presentCount never exceeds totalRows) while contributing
    // both values.
    const stats = computeFieldValueStats(
      ["dup.md", "plain.md"],
      {
        "dup.md": { state: "active", State: "archived" },
        "plain.md": { state: "active" },
      },
      "state"
    );
    expect(stats.presentCount).toBe(2);
    expect(stats.absentCount).toBe(0);
    expect(stats.distinctValues).toEqual(["active", "archived"]);
    // dup.md contributes 2 value occurrences, plain.md contributes 1.
    expect(stats.totalValueCount).toBe(3);
  });

  it("treats a minority-spelling empty value as empty-string, not absent", () => {
    // The canonical key is present under a variant spelling but empty -> the
    // row is empty-string, not absent, so the empty-encoding signal stays
    // faithful across spellings.
    const stats = computeFieldValueStats(
      ["a.md", "b.md"],
      {
        "a.md": { State: "" },
        "b.md": { state: "active" },
      },
      "state"
    );
    expect(stats.presentCount).toBe(1);
    expect(stats.emptyStringCount).toBe(1);
    expect(stats.absentCount).toBe(0);
    expect(stats.distinctValues).toEqual(["active"]);
  });
});

describe("deriveEnumCandidate (ADR-0056 D2/D9 bounded-cardinality heuristic)", () => {
  it("suggests an enum when values are few and at least one repeats", () => {
    const candidate = deriveEnumCandidate({
      distinctValues: ["temperature", "humidity", "pressure"],
      presentCount: 5,
      totalValueCount: 5,
    });
    expect(candidate).toEqual({
      values: ["temperature", "humidity", "pressure"],
      presentCount: 5,
      distinctCount: 3,
    });
  });

  it("does not suggest an enum when every value is unique (id-shaped field)", () => {
    // 5 distinct values across 5 present rows: no repeat at all.
    const candidate = deriveEnumCandidate({
      distinctValues: ["sn-001", "sn-002", "sn-003", "sn-004", "sn-005"],
      presentCount: 5,
      totalValueCount: 5,
    });
    expect(candidate).toBeUndefined();
  });

  it("does not suggest an enum with only a single distinct value", () => {
    const candidate = deriveEnumCandidate({
      distinctValues: ["active"],
      presentCount: 5,
      totalValueCount: 5,
    });
    expect(candidate).toBeUndefined();
  });

  it("does not suggest an enum above the bounded-cardinality cap", () => {
    const many = Array.from({ length: 13 }, (_, i) => `v${i}`);
    const candidate = deriveEnumCandidate({
      distinctValues: many,
      // presentCount/totalValueCount comfortably above distinctCount so the
      // repeat gate alone would pass — only the absolute cap should reject
      // this.
      presentCount: 40,
      totalValueCount: 40,
    });
    expect(candidate).toBeUndefined();
  });

  it("is inclusive at the cap boundary (12 distinct values, with a repeat)", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `v${i}`);
    const candidate = deriveEnumCandidate({
      distinctValues: twelve,
      presentCount: 20,
      totalValueCount: 20,
    });
    expect(candidate?.distinctCount).toBe(12);
  });

  it("suggests an enum for a multi_select field where every value repeats across rows, even when distinctCount == presentCount (rows, not values, repeat)", () => {
    // 4 rows, each carrying 2 tags drawn from a 4-word bounded vocabulary;
    // every one of the 4 distinct tags repeats exactly twice across the 4
    // rows — a textbook bounded vocabulary. presentCount (rows) == 4 ==
    // distinctCount, so a presentCount-based gate would wrongly reject this;
    // totalValueCount (8 total tag occurrences) correctly reveals the repeat.
    const stats = computeFieldValueStats(
      ["A.md", "B.md", "C.md", "D.md"],
      {
        "A.md": { tags: ["urgent", "blocked"] },
        "B.md": { tags: ["normal", "blocked"] },
        "C.md": { tags: ["normal", "done"] },
        "D.md": { tags: ["urgent", "done"] },
      },
      "tags"
    );
    expect(stats.presentCount).toBe(4);
    expect(stats.distinctValues.length).toBe(4);
    expect(stats.totalValueCount).toBe(8);

    const candidate = deriveEnumCandidate(stats);
    expect(candidate).toEqual({
      values: ["urgent", "blocked", "normal", "done"],
      presentCount: 4,
      distinctCount: 4,
    });
  });

  it("does not suggest an enum for a multi_select field where every value is genuinely unique (no repeat even counting by value)", () => {
    const stats = computeFieldValueStats(
      ["A.md", "B.md"],
      {
        "A.md": { tags: ["alpha", "beta"] },
        "B.md": { tags: ["gamma", "delta"] },
      },
      "tags"
    );
    // 4 distinct values, 4 total occurrences: no repeat at all, by value.
    expect(stats.totalValueCount).toBe(4);
    expect(deriveEnumCandidate(stats)).toBeUndefined();
  });
});

describe("deriveEmptyEncodingStats (ADR-0056 D5)", () => {
  it("suggests absent when absence dominates", () => {
    expect(
      deriveEmptyEncodingStats({
        absentCount: 5,
        emptyStringCount: 1,
        presentCount: 10,
      }).suggested
    ).toBe("absent");
  });

  it("suggests empty-string when empty-string dominates", () => {
    expect(
      deriveEmptyEncodingStats({
        absentCount: 1,
        emptyStringCount: 5,
        presentCount: 10,
      }).suggested
    ).toBe("empty-string");
  });

  it("suggests nothing on a tie, including the all-present case", () => {
    expect(
      deriveEmptyEncodingStats({
        absentCount: 0,
        emptyStringCount: 0,
        presentCount: 10,
      }).suggested
    ).toBeUndefined();
    expect(
      deriveEmptyEncodingStats({
        absentCount: 2,
        emptyStringCount: 2,
        presentCount: 10,
      }).suggested
    ).toBeUndefined();
  });
});

describe("findForeignKeyCandidates (ADR-0056 D6, keyMatchResolver-style value overlap)", () => {
  it("scores a sibling database field above the overlap threshold as a candidate", () => {
    const candidates = findForeignKeyCandidates(
      ["board-1", "board-2"],
      [boardRegistrySiblingValues]
    );
    expect(candidates).toEqual([
      {
        targetFolder: "Gidi/Hardware/Board Registry",
        targetKey: "board_id",
        overlapCount: 2,
        candidateCount: 2,
        overlapRatio: 1,
      },
    ]);
  });

  it("rejects a sibling field below the overlap ratio threshold", () => {
    const weakSibling: SiblingDatabaseValues = {
      targetFolder: "Gidi/Hardware/Controller Registry",
      targetKey: "controller_id",
      values: new Set(["board-1"]), // only 1 of 3 distinct values match
    };
    const candidates = findForeignKeyCandidates(
      ["board-1", "board-2", "board-3"],
      [weakSibling]
    );
    expect(candidates).toEqual([]);
  });

  it("requires at least two distinct values before scoring any overlap", () => {
    const candidates = findForeignKeyCandidates(
      ["board-1"],
      [boardRegistrySiblingValues]
    );
    expect(candidates).toEqual([]);
  });

  it("ranks multiple candidates by overlap ratio then overlap count, capped at 3", () => {
    const siblings: SiblingDatabaseValues[] = [
      {
        targetFolder: "Db/Weak",
        targetKey: "id",
        values: new Set(["a", "b"]), // ratio 0.67 (2/3)
      },
      {
        targetFolder: "Db/Strong",
        targetKey: "id",
        values: new Set(["a", "b", "c"]), // ratio 1.0 (3/3)
      },
      {
        targetFolder: "Db/AlsoStrong",
        targetKey: "other_id",
        values: new Set(["a", "b", "c", "d"]), // ratio 1.0 too, same overlapCount
      },
      {
        targetFolder: "Db/TooWeak",
        targetKey: "id",
        values: new Set(["a"]), // ratio 0.33, below threshold
      },
    ];
    const candidates = findForeignKeyCandidates(["a", "b", "c"], siblings);
    expect(candidates.length).toBe(3);
    expect(candidates[0].overlapRatio).toBe(1);
    expect(candidates[2].targetFolder).toBe("Db/Weak");
  });
});

describe("draftTypeProfileAdoption", () => {
  it("drafts inferred kind/type, suggested-only enum, FK reference, and empty policy together", () => {
    const draft = draftTypeProfileAdoption({
      database: "Gidi/Hardware/Sensor Registry",
      paths: sensorPaths,
      frontmatterByPath: sensorFrontmatterByPath,
      siblingDatabases: [boardRegistrySiblingValues],
    });

    expect(draft.rowCount).toBe(5);
    const byName = new Map(draft.fields.map((f) => [f.field.name, f]));

    const sensorClass = byName.get("sensor_class");
    // Kind/type inference stays the conservative one discoverFrontmatterSchema
    // already produces (ADR-0056 D9: "type inference reuses the ADR-0015
    // planner's conservative-type inference") — the enum candidate is an
    // ADDITIVE declaration layered on top, never an upgrade of the base type.
    expect(sensorClass?.field.kind).toBe("text");
    expect(sensorClass?.field.enum).toEqual({
      values: ["temperature", "humidity", "pressure"],
      strict: false, // D9: always a suggestion, never auto-strict
    });

    const sensorId = byName.get("sensor_id");
    expect(sensorId?.field.enum).toBeUndefined(); // id-shaped, all unique

    const boardId = byName.get("board_id");
    expect(boardId?.field.reference).toEqual({
      targetFolder: "Gidi/Hardware/Board Registry",
      targetKey: "board_id",
      onBrokenWrite: "warn", // D9: least-committal default, owner upgrades later
      onReferencedChange: "warn",
    });
    expect(boardId?.foreignKeyCandidates[0].targetFolder).toBe(
      "Gidi/Hardware/Board Registry"
    );

    const notes = byName.get("notes");
    // notes: 1 present, 2 empty-string, 2 absent -> tie between empty-string
    // and absent is broken by the 2-vs-2 comparison being a TRUE tie here,
    // so no policy is suggested; assert the underlying stats instead.
    expect(notes?.emptyEncoding).toEqual({
      absentCount: 2,
      emptyStringCount: 2,
      presentCount: 1,
    });
  });

  it("never drafts a field the hub note has already declared", () => {
    const existingProfile: NotidianTypeProfile = {
      fields: [{ name: "sensor_class", kind: "select", type: "option" }],
      kindFields: {},
      invariants: [],
      issues: [],
    };
    const draft = draftTypeProfileAdoption({
      database: "Gidi/Hardware/Sensor Registry",
      paths: sensorPaths,
      frontmatterByPath: sensorFrontmatterByPath,
      existingProfile,
    });
    expect(draft.fields.some((f) => f.field.name == "sensor_class")).toBe(
      false
    );
    expect(draft.alreadyDeclaredFieldNames).toEqual(["sensor_class"]);
  });

  it("drafts nothing when every discovered field is already declared", () => {
    const existingProfile: NotidianTypeProfile = {
      fields: [
        "sensor_id",
        "sensor_class",
        "board_id",
        "notes",
      ].map((name) => ({ name, kind: "text", type: "text" })),
      kindFields: {},
      invariants: [],
      issues: [],
    };
    const draft = draftTypeProfileAdoption({
      database: "Gidi/Hardware/Sensor Registry",
      paths: sensorPaths,
      frontmatterByPath: sensorFrontmatterByPath,
      existingProfile,
    });
    expect(draft.fields).toEqual([]);
  });

  // Notidian-1adj (consumer-path regression): discoverFrontmatterSchema merges
  // case-variant spellings into ONE canonical field. The surviving field's
  // value stats must cover EVERY spelling's rows — pre-fix the exact-case
  // computeFieldValueStats lookup counted minority-spelling rows absent and
  // silently dropped their values from the drafted enum vocabulary and
  // empty-encoding, exactly the mixed-case scenario the merge targeted.
  it("drafts one merged field whose enum vocabulary and empty-encoding cover every case-variant spelling", () => {
    // 10 rows `priority:` in {low, med, high} and 3 rows `Priority: urgent`.
    const cycle = ["low", "med", "high"];
    const paths = Array.from({ length: 13 }, (_, i) => `T-${i}.md`);
    const frontmatterByPath: Record<string, Record<string, unknown>> = {};
    paths.forEach((p, i) => {
      frontmatterByPath[p] =
        i < 10 ? { priority: cycle[i % 3] } : { Priority: "urgent" };
    });

    const draft = draftTypeProfileAdoption({
      database: "Ops/Tasks",
      paths,
      frontmatterByPath,
    });

    // Exactly ONE priority field (the merge removed the duplicate case-variant
    // field), and its canonical casing is the most-frequent spelling.
    const priorityFields = draft.fields.filter(
      (f) => f.field.name.toLowerCase() == "priority"
    );
    expect(priorityFields).toHaveLength(1);
    const priority = priorityFields[0];
    expect(priority.field.name).toBe("priority");

    // The minority-spelling value "urgent" survives in the drafted vocabulary.
    expect(priority.enumCandidate?.values).toEqual([
      "low",
      "med",
      "high",
      "urgent",
    ]);
    expect(priority.field.enum).toEqual({
      values: ["low", "med", "high", "urgent"],
      strict: false,
    });
    // presentCount / empty-encoding cover all 13 rows, not just the 10 canonical.
    expect(priority.enumCandidate?.presentCount).toBe(13);
    expect(priority.emptyEncoding).toEqual({
      absentCount: 0,
      emptyStringCount: 0,
      presentCount: 13,
    });
  });
});

describe("detectPropertyProfileDivergence (ADR-0040 Database Boundary Test)", () => {
  // Two answer-shapes forced into one folder — the exact failure ADR-0040
  // diagnosed for the vault's Tools & Materials database. Three "tool" rows
  // (digital tail: platform/url/account) and three "material" rows (physical
  // tail: location/safety/sourcing) share only a universal core
  // (decided_by/lifecycle). Their characteristic property clusters do not
  // overlap at all.
  const toolsAndMaterialsPaths = [
    "Vault/Tools & Materials/T-01.md",
    "Vault/Tools & Materials/T-02.md",
    "Vault/Tools & Materials/T-03.md",
    "Vault/Tools & Materials/M-01.md",
    "Vault/Tools & Materials/M-02.md",
    "Vault/Tools & Materials/M-03.md",
  ];
  const toolsAndMaterialsFrontmatter: Record<
    string,
    Record<string, unknown>
  > = {
    "Vault/Tools & Materials/T-01.md": {
      decided_by: "dru",
      lifecycle: "active",
      platform: "web",
      url: "https://a.example",
      account: "acct-1",
    },
    "Vault/Tools & Materials/T-02.md": {
      decided_by: "dru",
      lifecycle: "active",
      platform: "ios",
      url: "https://b.example",
      account: "acct-2",
    },
    "Vault/Tools & Materials/T-03.md": {
      decided_by: "claude",
      lifecycle: "retired",
      platform: "web",
      url: "https://c.example",
      account: "acct-1",
    },
    "Vault/Tools & Materials/M-01.md": {
      decided_by: "dru",
      lifecycle: "active",
      location: "shelf-a",
      safety: "flammable",
      sourcing: "vendor-x",
    },
    "Vault/Tools & Materials/M-02.md": {
      decided_by: "dru",
      lifecycle: "active",
      location: "shelf-b",
      safety: "inert",
      sourcing: "vendor-y",
    },
    "Vault/Tools & Materials/M-03.md": {
      decided_by: "claude",
      lifecycle: "stocked",
      location: "shelf-a",
      safety: "flammable",
      sourcing: "vendor-x",
    },
  };

  it("flags two divergent answer-shapes and reports their disjoint groups + shared core", () => {
    const result = detectPropertyProfileDivergence({
      paths: toolsAndMaterialsPaths,
      frontmatterByPath: toolsAndMaterialsFrontmatter,
    });

    expect(result.divergent).toBe(true);
    // The only fields on (nearly) every row: the shared universal core.
    expect(result.sharedCoreFields).toEqual(["decided_by", "lifecycle"]);
    expect(result.groups.length).toBe(2);

    // Each group's characteristic fields are the discriminating cluster its
    // rows populate — and the two clusters are pairwise-disjoint (ADR-0040
    // "share no common core"): a property in one group appears in neither the
    // other group's cluster nor the shared core.
    const clusters = result.groups
      .map((g) => g.characteristicFields)
      .sort((a, b) => a[0].localeCompare(b[0]));
    expect(clusters).toEqual([
      ["account", "platform", "url"],
      ["location", "safety", "sourcing"],
    ]);
    for (const group of result.groups) {
      expect(group.rowCount).toBe(3);
      expect(group.exampleRows.length).toBeGreaterThan(0);
    }
    const allCharacteristic = result.groups.flatMap(
      (g) => g.characteristicFields
    );
    expect(new Set(allCharacteristic).size).toBe(allCharacteristic.length);
    for (const coreField of result.sharedCoreFields) {
      expect(allCharacteristic).not.toContain(coreField);
    }
  });

  it("does not flag a single coherent profile whose rows differ only by optional tail fields", () => {
    // A coherent task database: every row shares a strong core
    // (status/owner/priority); a few rows add a SINGLE optional tail field.
    // ADR-0040 D1 explicitly allows a tail to *add* fields — one differing
    // optional field per subset is not a divergent core, so no flag.
    const paths = ["K1.md", "K2.md", "K3.md", "K4.md", "K5.md", "K6.md"];
    const frontmatter: Record<string, Record<string, unknown>> = {
      "K1.md": { status: "open", owner: "dru", priority: "high", sprint: "s1" },
      "K2.md": { status: "done", owner: "dru", priority: "low", sprint: "s1" },
      "K3.md": { status: "open", owner: "cl", priority: "med", sprint: "s2" },
      "K4.md": { status: "open", owner: "dru", priority: "high", blocker: "x" },
      "K5.md": { status: "done", owner: "cl", priority: "low", blocker: "y" },
      "K6.md": { status: "open", owner: "dru", priority: "med", blocker: "z" },
    };
    const result = detectPropertyProfileDivergence({ paths, frontmatterByPath: frontmatter });
    expect(result.divergent).toBe(false);
    expect(result.groups).toEqual([]);
    expect(result.sharedCoreFields).toEqual(["owner", "priority", "status"]);
  });

  it("does not flag sparse, near-unique per-row properties (no repeated discriminator)", () => {
    // Every non-core field appears on exactly one row: idiosyncratic tails,
    // below the discriminator floor, not an answer-shape signal.
    const paths = ["R1.md", "R2.md", "R3.md", "R4.md", "R5.md"];
    const frontmatter: Record<string, Record<string, unknown>> = {
      "R1.md": { id: "r1", alpha: "1" },
      "R2.md": { id: "r2", beta: "2" },
      "R3.md": { id: "r3", gamma: "3" },
      "R4.md": { id: "r4", delta: "4" },
      "R5.md": { id: "r5", epsilon: "5" },
    };
    const result = detectPropertyProfileDivergence({ paths, frontmatterByPath: frontmatter });
    expect(result.divergent).toBe(false);
    expect(result.sharedCoreFields).toEqual(["id"]);
  });

  it("does not flag pairwise-overlapping rows that chain into one connected profile", () => {
    // A "ring" of sparse pairwise overlaps: each field is shared by exactly two
    // adjacent rows, chaining every row into ONE connected component — not two
    // disjoint answer-shapes. A single component never divergences.
    const paths = ["N1.md", "N2.md", "N3.md", "N4.md", "N5.md", "N6.md"];
    const frontmatter: Record<string, Record<string, unknown>> = {
      "N1.md": { id: "n1", a: "x", b: "x" },
      "N2.md": { id: "n2", b: "x", c: "x" },
      "N3.md": { id: "n3", c: "x", d: "x" },
      "N4.md": { id: "n4", d: "x", e: "x" },
      "N5.md": { id: "n5", e: "x", f: "x" },
      "N6.md": { id: "n6", f: "x", a: "x" },
    };
    const result = detectPropertyProfileDivergence({ paths, frontmatterByPath: frontmatter });
    expect(result.divergent).toBe(false);
  });

  it("does not flag two answer-shapes bridged by a shared discriminating field", () => {
    // Same two clusters as the Tools & Materials fixture, but a `common_note`
    // field populated across BOTH natures bridges them into one component: they
    // now share a discriminating core, so the boundary is not clearly violated.
    const frontmatter: Record<string, Record<string, unknown>> = {};
    for (const [path, fm] of Object.entries(toolsAndMaterialsFrontmatter)) {
      frontmatter[path] = { ...fm };
    }
    frontmatter["Vault/Tools & Materials/T-01.md"].common_note = "shared";
    frontmatter["Vault/Tools & Materials/M-01.md"].common_note = "shared";
    const result = detectPropertyProfileDivergence({
      paths: toolsAndMaterialsPaths,
      frontmatterByPath: frontmatter,
    });
    expect(result.divergent).toBe(false);
  });

  it("stays silent below the minimum row count even for two clearly divergent rows", () => {
    const result = detectPropertyProfileDivergence({
      paths: ["T.md", "M.md"],
      frontmatterByPath: {
        "T.md": { platform: "web", url: "https://a", account: "acct-1" },
        "M.md": { location: "shelf", safety: "inert", sourcing: "vendor" },
      },
    });
    expect(result.divergent).toBe(false);
  });

  it("treats an empty-valued property as unpopulated (does not count toward a cluster)", () => {
    // Every material row DECLARES the tool tail keys but leaves them empty (and
    // vice-versa) — the flat-schema artifact ADR-0040 called out. Empty
    // declarations must not read as populated, so this still resolves to two
    // divergent clusters by what each row actually ANSWERS.
    const frontmatter: Record<string, Record<string, unknown>> = {};
    for (const [path, fm] of Object.entries(toolsAndMaterialsFrontmatter)) {
      const isTool = path.includes("/T-");
      frontmatter[path] = {
        ...fm,
        ...(isTool
          ? { location: "", safety: "", sourcing: "" }
          : { platform: "", url: "", account: "" }),
      };
    }
    const result = detectPropertyProfileDivergence({
      paths: toolsAndMaterialsPaths,
      frontmatterByPath: frontmatter,
    });
    expect(result.divergent).toBe(true);
    expect(result.groups.length).toBe(2);
  });

  it("excludes configured keys from the coherence analysis", () => {
    // If the divergence-driving keys are all excluded, no signal remains.
    const result = detectPropertyProfileDivergence({
      paths: toolsAndMaterialsPaths,
      frontmatterByPath: toolsAndMaterialsFrontmatter,
      excludedKeys: [
        "platform",
        "url",
        "account",
        "location",
        "safety",
        "sourcing",
      ],
    });
    expect(result.divergent).toBe(false);
  });

  it("is surfaced on the whole-database draft without changing the field union", () => {
    const draft = draftTypeProfileAdoption({
      database: "Vault/Tools & Materials",
      paths: toolsAndMaterialsPaths,
      frontmatterByPath: toolsAndMaterialsFrontmatter,
    });
    // Advisory only: every observed field is still drafted (union unchanged).
    expect(new Set(draft.fields.map((f) => f.field.name))).toEqual(
      new Set([
        "decided_by",
        "lifecycle",
        "platform",
        "url",
        "account",
        "location",
        "safety",
        "sourcing",
      ])
    );
    expect(draft.profileDivergence?.divergent).toBe(true);
    expect(draft.profileDivergence?.groups.length).toBe(2);
  });

  it("reports divergent: false on the coherent Sensor Registry fixture", () => {
    const draft = draftTypeProfileAdoption({
      database: "Gidi/Hardware/Sensor Registry",
      paths: sensorPaths,
      frontmatterByPath: sensorFrontmatterByPath,
      siblingDatabases: [boardRegistrySiblingValues],
    });
    expect(draft.profileDivergence?.divergent).toBe(false);
  });
});

describe("planTypeProfileAdoptionMerge (never-clobber merge)", () => {
  it("adds only NEW drafted fields onto an empty existing map", () => {
    const draft = draftTypeProfileAdoption({
      database: "Gidi/Hardware/Sensor Registry",
      paths: sensorPaths,
      frontmatterByPath: sensorFrontmatterByPath,
      siblingDatabases: [boardRegistrySiblingValues],
    });
    const plan = planTypeProfileAdoptionMerge(undefined, draft);
    expect(plan.changed).toBe(true);
    expect(new Set(plan.addedFieldNames)).toEqual(
      new Set(["sensor_id", "sensor_class", "board_id", "notes"])
    );
    expect(plan.fields["sensor_class"]).toEqual({
      kind: "text",
      enum: { values: ["temperature", "humidity", "pressure"], strict: false },
    });
  });

  it("never overwrites a field name already present in the raw hub map, case-insensitively", () => {
    const draft = draftTypeProfileAdoption({
      database: "Gidi/Hardware/Sensor Registry",
      paths: sensorPaths,
      frontmatterByPath: sensorFrontmatterByPath,
    });
    const existingRawFields = {
      Sensor_Class: { kind: "select", required: true, value: "temperature" },
    };
    const plan = planTypeProfileAdoptionMerge(existingRawFields, draft);
    // The differently-cased existing key is untouched, verbatim.
    expect(plan.fields["Sensor_Class"]).toEqual({
      kind: "select",
      required: true,
      value: "temperature",
    });
    expect(plan.fields["sensor_class"]).toBeUndefined();
    expect(plan.addedFieldNames).not.toContain("sensor_class");
  });

  it("is a no-op (changed: false) when nothing new is drafted", () => {
    const plan = planTypeProfileAdoptionMerge(
      { onlyField: { kind: "text" } },
      { fields: [] }
    );
    expect(plan).toEqual({
      changed: false,
      fields: { onlyField: { kind: "text" } },
      addedFieldNames: [],
    });
  });

  it("tolerates a JSON-string-encoded existing fields map (Obsidian metadata cache quirk)", () => {
    const plan = planTypeProfileAdoptionMerge(
      JSON.stringify({ existing: { kind: "text" } }),
      { fields: [{ field: { name: "new_field", kind: "text", type: "text" }, foreignKeyCandidates: [], emptyEncoding: { absentCount: 0, emptyStringCount: 0, presentCount: 1 } }] }
    );
    expect(plan.changed).toBe(true);
    expect(plan.fields["existing"]).toEqual({ kind: "text" });
    expect(plan.fields["new_field"]).toEqual({ kind: "text" });
  });

  it("never clobbers a field declared only in kind_fields (Notidian-egz v2 kind-scoped columns), not the common fields map", () => {
    // Reproduces the write-time race the "never clobber" invariant exists to
    // close: "status" is not in the flat `fields:` map, so a check against
    // `fields` alone would miss that it is already declared under
    // `kind_fields.task.status` (e.g. via the table's kind_fields mirror,
    // planTypeProfileMirror) and add a duplicate, conflicting declaration.
    const draft: Pick<TypeProfileAdoptionDraft, "fields"> = {
      fields: [
        {
          field: { name: "status", kind: "text", type: "text" },
          foreignKeyCandidates: [],
          emptyEncoding: { absentCount: 0, emptyStringCount: 0, presentCount: 1 },
        },
      ],
    };
    const existingRawKindFields = {
      task: { status: { kind: "select", options: ["open", "done"] } },
    };
    const plan = planTypeProfileAdoptionMerge({}, draft, existingRawKindFields);
    expect(plan.changed).toBe(false);
    expect(plan.fields["status"]).toBeUndefined();
    expect(plan.addedFieldNames).not.toContain("status");
  });

  it("matches a kind_fields declaration case-insensitively", () => {
    const draft: Pick<TypeProfileAdoptionDraft, "fields"> = {
      fields: [
        {
          field: { name: "Status", kind: "text", type: "text" },
          foreignKeyCandidates: [],
          emptyEncoding: { absentCount: 0, emptyStringCount: 0, presentCount: 1 },
        },
      ],
    };
    const existingRawKindFields = {
      task: { status: { kind: "select" } },
    };
    const plan = planTypeProfileAdoptionMerge(
      undefined,
      draft,
      existingRawKindFields
    );
    expect(plan.changed).toBe(false);
    expect(plan.addedFieldNames).not.toContain("Status");
  });

  it("still adds a field declared in neither fields nor kind_fields, with kind_fields present", () => {
    const draft: Pick<TypeProfileAdoptionDraft, "fields"> = {
      fields: [
        {
          field: { name: "priority", kind: "text", type: "text" },
          foreignKeyCandidates: [],
          emptyEncoding: { absentCount: 0, emptyStringCount: 0, presentCount: 1 },
        },
      ],
    };
    const existingRawKindFields = {
      task: { status: { kind: "select" } },
    };
    const plan = planTypeProfileAdoptionMerge(
      undefined,
      draft,
      existingRawKindFields
    );
    expect(plan.changed).toBe(true);
    expect(plan.fields["priority"]).toEqual({ kind: "text" });
  });
});
