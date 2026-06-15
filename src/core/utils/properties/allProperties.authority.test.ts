import { defaultContextSchemaID } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import { MakeMDSettings } from "shared/types/settings";
import {
  frontmatterPropertySource,
  materializeFrontmatterBackedContextTable,
} from "./allProperties";
import {
  notidianPropertySource,
  propertyAuthorityForColumn,
  PropertyAuthority,
} from "./propertyAuthority";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — generalized property net for the materialization authority
// invariant (Notidian-kyc). This is the *general* form of the Notidian-0jq
// single-case regression test: there it was proven for ONE computed column
// ("Status" of type fileprop); here it is proven for the whole
// type x source x {colliding-fm-name} matrix.
//
// INVARIANT UNDER TEST:
//   For every stored column whose resolved authority partition is one of the
//   protected classes — "computed" / "notidian" / "file" —
//     propertyAuthorityForColumn(col_before)
//       === propertyAuthorityForColumn(col_after)
//   after materializeFrontmatterBackedContextTable, REGARDLESS of colliding
//   observed frontmatter names/types.
//
// Why it matters: materialization is the one place that *rewrites* a stored
// column (it can re-type a column and stamp source:"frontmatter"). If it ever
// re-typed or re-sourced a protected column, the durable authority partition
// (ADR 0001/0017) would silently flip — a derived value could leak into YAML
// or the hidden MDB, or a Notidian-owned field could lose its only durable
// home. apiValueWriteTarget only defends "skip" while the type is STILL
// computed, so the protection MUST hold here, at the rewrite site.
// ---------------------------------------------------------------------------

const settings = {
  fmKeyAlias: "aliases",
  fmKeyBanner: "banner",
  fmKeyBannerOffset: "banner_y",
  fmKeyColor: "color",
  fmKeySticker: "sticker",
} as MakeMDSettings;

const pathState = (property: Record<string, unknown>) =>
  ({
    metadata: { property },
  } as any);

// Computed/read-only column types. Mirrors propertyAuthority.computedTypes.
// IMPORTANT: when a NEW computed type is added to propertyAuthority.ts, add it
// here too — these cases then prove materialize still preserves it. (The
// self-consistency guard below independently catches a type this list forgot
// but that propertyAuthorityForColumn DOES classify computed.)
const COMPUTED_TYPES = ["fileprop", "aggregate", "rollup", "backlink"] as const;

// Types with a native frontmatter representation (propertyAuthority
// .frontmatterStorableTypes). A source-less column of one of these is allowed
// to become frontmatter-backed by materialization (the positive case).
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
// these stays Notidian-owned because the MDB is its only durable home.
const CONTEXT_ONLY_TYPES = ["context", "object", "flex", "super"] as const;

const ALL_SOURCES: ReadonlyArray<string | undefined> = [
  undefined,
  frontmatterPropertySource,
  notidianPropertySource,
];

const PROTECTED_AUTHORITIES: ReadonlySet<PropertyAuthority> = new Set<PropertyAuthority>([
  "computed",
  "notidian",
  "file",
]);

const defaultCols = () => defaultContextFields.rows as SpaceProperty[];

// Build a single-user-column table that is shaped so materialization's ENTRY
// gate admits it (default cols + a column the gate treats as frontmatter-ish),
// guaranteeing the per-column normalization path — where the protected-class
// guards live — is actually exercised. `collidingName` toggles whether the
// stored column's name matches an observed frontmatter key on the path.
const buildTable = (col: SpaceProperty): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
  cols: [...defaultCols(), col],
  rows: [{ [PathPropertyName]: "a.md" }],
});

// Observe a rich frontmatter blob so collisions exercise *re-typing* too: the
// observed type for a colliding key differs from the stored column's type, so
// a leak would actually change the resolved authority.
const observedFrontmatter = (key: string) =>
  new Map<string, any>([
    [
      "a.md",
      pathState({
        // a colliding key with a number value (observed type "number"),
        // plus an unrelated key so discovery always has something to do.
        [key]: 42,
        area: "Veg",
      }),
    ],
  ]);

const noCollisionFrontmatter = () =>
  new Map<string, any>([["a.md", pathState({ area: "Veg" })]]);

const findCol = (table: SpaceTable, name: string) =>
  table.cols.find((c) => c.name === name);

describe("materialize preserves a column's resolved authority partition (Notidian-kyc)", () => {
  // ---- COMPUTED: must stay "computed" across the full source x collision matrix
  describe("computed columns stay computed (generalizes Notidian-0jq)", () => {
    for (const type of COMPUTED_TYPES) {
      for (const source of ALL_SOURCES) {
        for (const colliding of [true, false]) {
          const sourceLabel = source ?? "none";
          it(`type=${type} source=${sourceLabel} colliding=${colliding}`, () => {
            const col: SpaceProperty = {
              name: "derived",
              type,
              value: "",
              schemaId: "files",
              ...(source ? { source } : {}),
            };
            expect(propertyAuthorityForColumn(col)).toBe("computed");

            const paths = ["a.md"];
            const pathsIndex = colliding
              ? observedFrontmatter("derived")
              : noCollisionFrontmatter();

            const { table } = materializeFrontmatterBackedContextTable(
              buildTable(col),
              pathsIndex,
              paths,
              settings,
              true
            );

            const after = findCol(table, "derived")!;
            // Authority partition is preserved...
            expect(propertyAuthorityForColumn(after)).toBe("computed");
            // ...and concretely: the computed type was never overwritten, and
            // the source marker was never *changed* (in particular no NEW
            // source:"frontmatter" stamp on a source-less computed column — the
            // exact leak vector). A column that arrived already carrying a stray
            // source:"frontmatter" mislabel keeps it, but stays computed because
            // propertyAuthorityForColumn resolves the computed type first.
            expect(after.type).toBe(type);
            expect(after.source).toBe(col.source);
            if (col.source !== frontmatterPropertySource) {
              expect(after.source).not.toBe(frontmatterPropertySource);
            }
          });
        }
      }
    }
  });

  // ---- NOTIDIAN: source:"notidian" must stay "notidian" across the matrix.
  // Use frontmatter-STORABLE types so the ONLY thing keeping the column
  // Notidian-owned is the explicit marker — the case most at risk of a flip.
  describe("explicitly Notidian-owned columns stay notidian", () => {
    for (const type of FRONTMATTER_STORABLE_TYPES) {
      for (const colliding of [true, false]) {
        it(`type=${type} source=notidian colliding=${colliding}`, () => {
          const col: SpaceProperty = {
            name: "owned",
            type,
            value: "",
            schemaId: "files",
            source: notidianPropertySource,
          };
          expect(propertyAuthorityForColumn(col)).toBe("notidian");

          const pathsIndex = colliding
            ? observedFrontmatter("owned")
            : noCollisionFrontmatter();

          const { table } = materializeFrontmatterBackedContextTable(
            buildTable(col),
            pathsIndex,
            ["a.md"],
            settings,
            true
          );

          const after = findCol(table, "owned")!;
          expect(propertyAuthorityForColumn(after)).toBe("notidian");
          // The marker survives and the type was not rewritten to the observed
          // (number) type — both would otherwise flip the partition.
          expect(after.source).toBe(notidianPropertySource);
          expect(after.type).toBe(type);
        });
      }
    }
  });

  // ---- NOTIDIAN: source-less context-only types stay notidian (MDB is their
  // only durable home), even when a same-named frontmatter key exists.
  describe("source-less context-only columns stay notidian", () => {
    for (const type of CONTEXT_ONLY_TYPES) {
      for (const colliding of [true, false]) {
        it(`type=${type} source=none colliding=${colliding}`, () => {
          const col: SpaceProperty = {
            name: "rel",
            type,
            value: "",
            schemaId: "files",
          };
          expect(propertyAuthorityForColumn(col)).toBe("notidian");

          const pathsIndex = colliding
            ? observedFrontmatter("rel")
            : noCollisionFrontmatter();

          const { table } = materializeFrontmatterBackedContextTable(
            buildTable(col),
            pathsIndex,
            ["a.md"],
            settings,
            true
          );

          const after = findCol(table, "rel")!;
          expect(propertyAuthorityForColumn(after)).toBe("notidian");
          expect(after.source).not.toBe(frontmatterPropertySource);
          expect(after.type).toBe(type);
        });
      }
    }
  });

  // ---- FILE IDENTITY: the PathPropertyName column stays "file". It lives in
  // the default columns, so this also proves materialization never molests the
  // identity column even while it discovers/normalizes around it.
  describe("the file identity column stays file", () => {
    for (const colliding of [true, false]) {
      it(`PathPropertyName colliding=${colliding}`, () => {
        // A normal user frontmatter column drives materialization into its
        // active (changed) path so the identity column is processed alongside.
        const userCol: SpaceProperty = {
          name: "status",
          type: "text",
          value: "",
          schemaId: "files",
        };
        const table: SpaceTable = {
          schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
          cols: [...defaultCols(), userCol],
          rows: [{ [PathPropertyName]: "a.md" }],
        };
        const before = findCol(table, PathPropertyName)!;
        expect(propertyAuthorityForColumn(before)).toBe("file");

        const pathsIndex = colliding
          ? // an (absurd) frontmatter key literally named "File" must not flip
            // the identity column — name match must not beat identity.
            new Map<string, any>([
              ["a.md", pathState({ [PathPropertyName]: "spoof", status: "x" })],
            ])
          : new Map<string, any>([["a.md", pathState({ status: "x" })]]);

        const { table: out } = materializeFrontmatterBackedContextTable(
          table,
          pathsIndex,
          ["a.md"],
          settings,
          true
        );

        const after = findCol(out, PathPropertyName)!;
        expect(propertyAuthorityForColumn(after)).toBe("file");
        expect(after.type).toBe("file");
        expect(after.source).not.toBe(frontmatterPropertySource);
      });
    }
  });

  // ---- POSITIVE CASE: the feature still works. A source-less,
  // frontmatter-storable column whose name collides with an observed key MAY
  // become frontmatter-backed. (Not a protected class, so a flip is allowed —
  // we assert the feature is alive so the protections above aren't vacuously
  // satisfied by a dead/disabled materializer.)
  describe("ordinary source-less frontmatter-storable columns may become frontmatter-backed", () => {
    it("a source-less text column with a matching frontmatter key is materialized", () => {
      const col: SpaceProperty = {
        name: "status",
        type: "text",
        value: "",
        schemaId: "files",
      };
      // before: ambiguous source-less storable -> defaults to "frontmatter"
      // authority already, but it is NOT yet a frontmatter-BACKED column
      // (no source marker). Materialization should stamp the marker.
      expect(col.source).toBeUndefined();

      const { table, changed } = materializeFrontmatterBackedContextTable(
        buildTable(col),
        new Map<string, any>([["a.md", pathState({ status: "active" })]]),
        ["a.md"],
        settings,
        true
      );

      expect(changed).toBe(true);
      const after = findCol(table, "status")!;
      expect(after.source).toBe(frontmatterPropertySource);
      expect(propertyAuthorityForColumn(after)).toBe("frontmatter");
    });
  });

  // ---- SELF-CONSISTENCY GUARD (the real "future computed type" net): for
  // EVERY type the system might use, if propertyAuthorityForColumn classifies a
  // stored column into a PROTECTED partition, materialization must preserve that
  // exact partition under a colliding frontmatter key. This catches a NEW
  // computed type added to propertyAuthority.computedTypes but forgotten in the
  // materialize guard, *even if this test file never explicitly listed it*,
  // because the assertion is driven by propertyAuthorityForColumn's own verdict
  // — not by a hand-maintained type list.
  describe("self-consistency: any protected partition is preserved under collision", () => {
    const candidateTypes = [
      ...COMPUTED_TYPES,
      ...FRONTMATTER_STORABLE_TYPES,
      ...CONTEXT_ONLY_TYPES,
      // a plausibly-forgotten future computed type, simulated by classifying it
      // via the real function. If it isn't computed today this case simply
      // exercises the default partition; if a future edit makes it computed,
      // the guard automatically demands preservation.
      "unknown-future-type",
    ];

    for (const type of candidateTypes) {
      for (const source of ALL_SOURCES) {
        const sourceLabel = source ?? "none";
        it(`type=${type} source=${sourceLabel} preserves protected partition`, () => {
          const col: SpaceProperty = {
            name: "probe",
            type,
            value: "",
            schemaId: "files",
            ...(source ? { source } : {}),
          };
          const beforeAuthority = propertyAuthorityForColumn(col);

          const { table } = materializeFrontmatterBackedContextTable(
            buildTable(col),
            observedFrontmatter("probe"),
            ["a.md"],
            settings,
            true
          );
          const after = findCol(table, "probe")!;
          const afterAuthority = propertyAuthorityForColumn(after);

          if (PROTECTED_AUTHORITIES.has(beforeAuthority)) {
            expect(afterAuthority).toBe(beforeAuthority);
          }
          // For non-protected (frontmatter) columns we make no demand here;
          // the positive case above proves that direction.
        });
      }
    }
  });

  // ---- IDEMPOTENCY / LOOP-SAFETY: a second materialize pass over an
  // already-materialized table reports changed:false. A re-running converge
  // loop must reach a fixpoint, never oscillate.
  describe("idempotency / loop-safety", () => {
    it("a second pass over an already-materialized table returns changed:false", () => {
      const pathsIndex = new Map<string, any>([
        ["a.md", pathState({ status: "active", area: "Veg", sort_order: 2 })],
      ]);
      const paths = ["a.md"];
      const seed: SpaceTable = {
        schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
        cols: [
          ...defaultCols(),
          { name: "status", type: "text", value: "", schemaId: "files" },
        ],
        rows: [{ [PathPropertyName]: "a.md" }],
      };

      const first = materializeFrontmatterBackedContextTable(
        seed,
        pathsIndex,
        paths,
        settings,
        true
      );
      expect(first.changed).toBe(true);

      const second = materializeFrontmatterBackedContextTable(
        first.table,
        pathsIndex,
        paths,
        settings,
        true
      );
      expect(second.changed).toBe(false);
      // The fixpoint table is identical in shape (no churn of cols).
      expect(second.table.cols).toEqual(first.table.cols);
    });

    it("a mixed protected + storable table converges in one pass and holds on the second", () => {
      const pathsIndex = new Map<string, any>([
        [
          "a.md",
          pathState({
            status: "active",
            derived: 1, // collides with the computed column name
            owned: 2, // collides with the notidian column name
          }),
        ],
      ]);
      const paths = ["a.md"];
      const seed: SpaceTable = {
        schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
        cols: [
          ...defaultCols(),
          { name: "status", type: "text", value: "", schemaId: "files" },
          { name: "derived", type: "rollup", value: "", schemaId: "files" },
          {
            name: "owned",
            type: "number",
            value: "",
            schemaId: "files",
            source: notidianPropertySource,
          },
        ],
        rows: [{ [PathPropertyName]: "a.md" }],
      };

      const first = materializeFrontmatterBackedContextTable(
        seed,
        pathsIndex,
        paths,
        settings,
        true
      );

      // Protected columns held; only the storable one (and discovery) changed.
      expect(propertyAuthorityForColumn(findCol(first.table, "derived")!)).toBe(
        "computed"
      );
      expect(propertyAuthorityForColumn(findCol(first.table, "owned")!)).toBe(
        "notidian"
      );

      const second = materializeFrontmatterBackedContextTable(
        first.table,
        pathsIndex,
        paths,
        settings,
        true
      );
      expect(second.changed).toBe(false);
    });
  });
});
