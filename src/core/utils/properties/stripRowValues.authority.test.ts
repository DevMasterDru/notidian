import { defaultContextSchemaID } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import {
  frontmatterPropertySource,
  stripFrontmatterBackedRowValues,
} from "./allProperties";
import {
  notidianPropertySource,
  propertyAuthorityForColumn,
  PropertyAuthority,
  shouldPersistAuthorityValueToContext,
} from "./propertyAuthority";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — write-back side of the authority partition (Notidian-2el).
//
// This is the symmetric mirror of allProperties.authority.test.ts
// (Notidian-kyc), which proves the READ-side boundary
// (materializeFrontmatterBackedContextTable) preserves the authority partition.
// Here we prove the WRITE-BACK boundary: stripFrontmatterBackedRowValues, run
// by filesystemAdapter.saveTable on EVERY MDB persist, drops the row VALUES of
// any column that is not durably owned by the context MDB.
//
// INVARIANT UNDER TEST (the write-back contract):
//   For every stored row key `k`, the persisted table KEEPS row[k] IFF a column
//   definition named `k` exists and shouldPersistAuthorityValueToContext(col)
//   is true — i.e. its resolved authority is "file" or "notidian". Every other
//   key is STRIPPED. A key with no matching column definition is preserved
//   untouched (we never strip data we cannot classify).
//
// Authority -> keep/strip:
//   "file"        -> KEEP  (file identity; the PathPropertyName column)
//   "notidian"    -> KEEP  (explicit Notidian ownership / context-only types:
//                           the MDB is their ONLY durable home)
//   "frontmatter" -> STRIP (durable home is the file's YAML, not the MDB)
//   "computed"    -> STRIP (a derived value must NEVER be persisted to the MDB)
//
// Why it matters: this is the last gate before a derived/file-backed value
// could be frozen into the hidden context MDB. If a computed value leaked
// through here it would persist a STALE snapshot of a render-time value; if a
// frontmatter value leaked through, the MDB would shadow the file's YAML and
// the two layers could silently diverge (ADR 0001/0017). materialize defends
// the read side; this function defends the write side — both must hold.
// ---------------------------------------------------------------------------

// Computed/read-only column types. Mirrors propertyAuthority.computedTypes.
// IMPORTANT: when a NEW computed type is added to propertyAuthority.ts, add it
// here too — these cases then prove the write-back gate still strips it. (The
// self-consistency guard below independently catches a type this list forgot
// but that propertyAuthorityForColumn DOES classify computed.)
const COMPUTED_TYPES = ["fileprop", "aggregate", "rollup", "backlink"] as const;

// Types with a native frontmatter representation
// (propertyAuthority.frontmatterStorableTypes). A source-less or
// source:"frontmatter" column of one of these is frontmatter-authority and so
// its value must be STRIPPED from the MDB row — its durable home is the YAML.
const FRONTMATTER_STORABLE_TYPES = [
  "text",
  "password",
  "number",
  "boolean",
  "date",
  "option",
  "option-multi",
  "link",
  "image",
  "tags-multi",
] as const;

// Context-only types (no frontmatter form): a source-less column of one of
// these stays Notidian-owned because the MDB is its only durable home, so its
// value must be KEPT.
const CONTEXT_ONLY_TYPES = ["context", "object", "flex", "super"] as const;

const PROTECTED_KEEP_AUTHORITIES: ReadonlySet<PropertyAuthority> =
  new Set<PropertyAuthority>(["file", "notidian"]);

const col = (overrides: Partial<SpaceProperty>): SpaceProperty => ({
  name: "field",
  type: "text",
  value: "",
  schemaId: "files",
  ...overrides,
});

// Build a one-user-column table carrying a value for that column plus the
// default file-identity / Created cells, so every assertion exercises the real
// reducer path over a populated row.
const tableWith = (
  userCol: SpaceProperty,
  rowValue: string
): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
  cols: [...(defaultContextFields.rows as SpaceProperty[]), userCol],
  rows: [
    {
      [PathPropertyName]: "a.md",
      Created: "2026-05-24",
      [userCol.name]: rowValue,
    },
  ],
});

describe("stripFrontmatterBackedRowValues — write-back authority matrix (Notidian-2el)", () => {
  // ---- COMPUTED: derived values must NEVER be persisted into the MDB.
  describe("computed columns are stripped (a derived value must never persist)", () => {
    for (const type of COMPUTED_TYPES) {
      // Even a stray source:"frontmatter"/"notidian" must not save a computed
      // value: propertyAuthorityForColumn resolves the computed type first.
      for (const source of [
        undefined,
        frontmatterPropertySource,
        notidianPropertySource,
      ] as const) {
        const sourceLabel = source ?? "none";
        it(`type=${type} source=${sourceLabel} -> stripped`, () => {
          const userCol = col({
            name: "derived",
            type,
            ...(source ? { source } : {}),
          });
          // Precondition: this really is a non-persistent (computed) column.
          expect(propertyAuthorityForColumn(userCol)).toBe("computed");
          expect(shouldPersistAuthorityValueToContext(userCol)).toBe(false);

          const result = stripFrontmatterBackedRowValues(
            tableWith(userCol, "rendered-value")
          );

          expect(result.rows[0]).not.toHaveProperty("derived");
          // File identity always survives.
          expect(result.rows[0][PathPropertyName]).toBe("a.md");
        });
      }
    }
  });

  // ---- FRONTMATTER authority: durable home is the YAML, strip from the MDB.
  describe("frontmatter-authority columns are stripped (durable home is YAML)", () => {
    for (const type of FRONTMATTER_STORABLE_TYPES) {
      // Explicit source:"frontmatter" AND source-less (ambiguous, file-backed
      // default) both resolve to frontmatter authority -> stripped.
      for (const source of [undefined, frontmatterPropertySource] as const) {
        const sourceLabel = source ?? "none";
        it(`type=${type} source=${sourceLabel} -> stripped`, () => {
          const userCol = col({
            name: "fm",
            type,
            ...(source ? { source } : {}),
          });
          expect(propertyAuthorityForColumn(userCol)).toBe("frontmatter");
          expect(shouldPersistAuthorityValueToContext(userCol)).toBe(false);

          const result = stripFrontmatterBackedRowValues(
            tableWith(userCol, "yaml-value")
          );

          expect(result.rows[0]).not.toHaveProperty("fm");
        });
      }
    }
  });

  // ---- NOTIDIAN: explicit ownership over a frontmatter-STORABLE type. The
  // only thing keeping the value in the MDB is the explicit marker — the case
  // most at risk of being wrongly stripped.
  describe("explicitly Notidian-owned columns are kept (MDB is their only durable home)", () => {
    for (const type of FRONTMATTER_STORABLE_TYPES) {
      it(`type=${type} source=notidian -> kept`, () => {
        const userCol = col({
          name: "owned",
          type,
          source: notidianPropertySource,
        });
        expect(propertyAuthorityForColumn(userCol)).toBe("notidian");
        expect(shouldPersistAuthorityValueToContext(userCol)).toBe(true);

        const result = stripFrontmatterBackedRowValues(
          tableWith(userCol, "mdb-value")
        );

        expect(result.rows[0].owned).toBe("mdb-value");
      });
    }
  });

  // ---- CONTEXT-ONLY types: source-less, but no frontmatter form, so the MDB
  // is their only durable home -> kept.
  describe("source-less context-only columns are kept (no frontmatter form)", () => {
    for (const type of CONTEXT_ONLY_TYPES) {
      it(`type=${type} source=none -> kept`, () => {
        const userCol = col({ name: "rel", type });
        expect(propertyAuthorityForColumn(userCol)).toBe("notidian");
        expect(shouldPersistAuthorityValueToContext(userCol)).toBe(true);

        const result = stripFrontmatterBackedRowValues(
          tableWith(userCol, "context-link")
        );

        expect(result.rows[0].rel).toBe("context-link");
      });
    }
  });

  // ---- FILE IDENTITY: the PathPropertyName column is "file" authority and is
  // the row's identity — it must always survive.
  it("keeps the file identity column (PathPropertyName)", () => {
    const identityCol = col({ name: PathPropertyName, type: "file" });
    expect(propertyAuthorityForColumn(identityCol)).toBe("file");
    expect(shouldPersistAuthorityValueToContext(identityCol)).toBe(true);

    const result = stripFrontmatterBackedRowValues({
      schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
      cols: [
        identityCol,
        col({ name: "fm", type: "text", source: frontmatterPropertySource }),
      ],
      rows: [{ [PathPropertyName]: "a.md", fm: "yaml-value" }],
    });

    expect(result.rows[0][PathPropertyName]).toBe("a.md");
    expect(result.rows[0]).not.toHaveProperty("fm");
  });

  // ---- Cross-check: the keep/strip decision the function makes for EVERY
  // column equals shouldPersistAuthorityValueToContext, driven by the authority
  // function's own verdict. This is the self-consistency backstop — if a new
  // protected/persistable class is added to propertyAuthority and forgotten in
  // the explicit lists above, this still proves the write-back gate honors it.
  it("a column's row value is kept IFF shouldPersistAuthorityValueToContext is true (full matrix)", () => {
    const cases: SpaceProperty[] = [];
    const types = [
      ...COMPUTED_TYPES,
      ...FRONTMATTER_STORABLE_TYPES,
      ...CONTEXT_ONLY_TYPES,
    ];
    for (const type of types) {
      for (const source of [
        undefined,
        frontmatterPropertySource,
        notidianPropertySource,
      ] as const) {
        cases.push(
          col({
            name: `c_${type}_${source ?? "none"}`,
            type,
            ...(source ? { source } : {}),
          })
        );
      }
    }

    const row: Record<string, string> = { [PathPropertyName]: "a.md" };
    for (const c of cases) row[c.name] = `v_${c.name}`;

    const result = stripFrontmatterBackedRowValues({
      schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
      cols: [col({ name: PathPropertyName, type: "file" }), ...cases],
      rows: [row],
    });

    // Identity always kept.
    expect(result.rows[0][PathPropertyName]).toBe("a.md");

    for (const c of cases) {
      const keep = shouldPersistAuthorityValueToContext(c);
      const authority = propertyAuthorityForColumn(c);
      // The keep decision must match the persist contract, which in turn must
      // match the protected-keep authority set.
      expect(keep).toBe(PROTECTED_KEEP_AUTHORITIES.has(authority));
      if (keep) {
        expect(result.rows[0][c.name]).toBe(`v_${c.name}`);
      } else {
        expect(result.rows[0]).not.toHaveProperty(c.name);
      }
    }
  });

  // ---- EDGE: a row key with NO matching column definition is preserved
  // untouched. The reducer only strips a key that BOTH has a column definition
  // AND is in the non-persistent set; an orphan key (no column) is data we
  // cannot classify, so we never drop it (allProperties.ts:323-324).
  it("preserves a row key that has no matching column definition", () => {
    const result = stripFrontmatterBackedRowValues({
      schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
      cols: [
        col({ name: PathPropertyName, type: "file" }),
        // A defined frontmatter column whose value WILL be stripped, proving the
        // strip path runs (nonPersistentColumns is non-empty) yet leaves the
        // orphan key alone.
        col({ name: "fm", type: "text", source: frontmatterPropertySource }),
      ],
      rows: [
        {
          [PathPropertyName]: "a.md",
          fm: "yaml-value",
          orphan: "keep-me",
        },
      ],
    });

    expect(result.rows[0]).not.toHaveProperty("fm");
    expect(result.rows[0].orphan).toBe("keep-me");
    expect(result.rows[0][PathPropertyName]).toBe("a.md");
  });

  // ---- EDGE: empty / no-rows tables are returned as-is.
  it("returns a table with no rows untouched (early return)", () => {
    const emptyRows: SpaceTable = {
      schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
      cols: [col({ name: "fm", type: "text", source: frontmatterPropertySource })],
      rows: [],
    };
    expect(stripFrontmatterBackedRowValues(emptyRows)).toBe(emptyRows);

    // A null/undefined table is passed through without throwing.
    expect(
      stripFrontmatterBackedRowValues(undefined as unknown as SpaceTable)
    ).toBeUndefined();
  });

  // ---- EDGE: an all-keep table short-circuits (nonPersistentColumns.size===0)
  // and is returned by IDENTITY (no row rebuild), preserving every value.
  it("short-circuits and returns the same table when every column is persistable", () => {
    const allKeep: SpaceTable = {
      schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
      cols: [
        col({ name: PathPropertyName, type: "file" }),
        col({ name: "owned", type: "text", source: notidianPropertySource }),
        col({ name: "rel", type: "context" }),
      ],
      rows: [
        { [PathPropertyName]: "a.md", owned: "x", rel: "y" },
      ],
    };

    const result = stripFrontmatterBackedRowValues(allKeep);

    // Returned by identity — the short-circuit path, not a rebuilt copy.
    expect(result).toBe(allKeep);
    expect(result.rows[0]).toEqual({
      [PathPropertyName]: "a.md",
      owned: "x",
      rel: "y",
    });
  });
});
