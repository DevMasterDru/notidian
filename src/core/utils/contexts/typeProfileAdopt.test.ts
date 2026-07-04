import { NotidianTypeProfile } from "core/utils/contexts/typeProfile";
import {
  computeFieldValueStats,
  deriveEmptyEncodingStats,
  deriveEnumCandidate,
  draftTypeProfileAdoption,
  findForeignKeyCandidates,
  planTypeProfileAdoptionMerge,
  SiblingDatabaseValues,
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
});

describe("deriveEnumCandidate (ADR-0056 D2/D9 bounded-cardinality heuristic)", () => {
  it("suggests an enum when values are few and at least one repeats", () => {
    const candidate = deriveEnumCandidate({
      distinctValues: ["temperature", "humidity", "pressure"],
      presentCount: 5,
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
    });
    expect(candidate).toBeUndefined();
  });

  it("does not suggest an enum with only a single distinct value", () => {
    const candidate = deriveEnumCandidate({
      distinctValues: ["active"],
      presentCount: 5,
    });
    expect(candidate).toBeUndefined();
  });

  it("does not suggest an enum above the bounded-cardinality cap", () => {
    const many = Array.from({ length: 13 }, (_, i) => `v${i}`);
    const candidate = deriveEnumCandidate({
      distinctValues: many,
      // presentCount comfortably above distinctCount so the repeat gate alone
      // would pass — only the absolute cap should reject this.
      presentCount: 40,
    });
    expect(candidate).toBeUndefined();
  });

  it("is inclusive at the cap boundary (12 distinct values, with a repeat)", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `v${i}`);
    const candidate = deriveEnumCandidate({
      distinctValues: twelve,
      presentCount: 20,
    });
    expect(candidate?.distinctCount).toBe(12);
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
});
