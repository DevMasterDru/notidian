// Schema adoption command (Notidian-loan.3, ADR-0056 D9): drafts a v3 Type
// Profile from a database's LIVE rows for the owner to review — "Adopt schema
// for this database" turns onboarding an existing, unprofiled folder into a
// minutes-long review instead of hand-authoring a schema from scratch.
//
// Pure planner (ADR-0015 doctrine): every function here takes already-read
// frontmatter snapshots (paths + frontmatterByPath, the same shape
// notidianSchema.ts's planners already accept) and already-gathered sibling
// database value sets — never Superstate, never the filesystem. The runtime
// glue that gathers those inputs from a live vault and performs the
// confirm-gated write lives in core/superstate/utils/typeProfileAdoption.ts.
//
// D9 is explicit that a draft is a SUGGESTION, never auto-applied and never
// auto-strict:
//   - enum candidates are always emitted with `strict: false` (ADR-0056's
//     rejected-alternatives section specifically rejects defaulting any
//     column's advisory options to strict law) — the owner opts into strict
//     enforcement later, by hand, once they have reviewed the vocabulary.
//   - a drafted `reference` defaults to the least-committal severities
//     (`onBrokenWrite: "warn"`, `onReferencedChange: "warn"`) for the same
//     reason — the draft states a FINDING, not a rule the owner asked for.
// The merge planner at the bottom never touches a field the hub note already
// declares — adoption only ever ADDS fields the owner has not yet profiled.

import {
  FrontmatterSnapshotsByPath,
  discoverFrontmatterSchema,
  frontmatterForPath,
  toValueList,
} from "core/utils/contexts/notidianSchema";
import {
  NotidianTypeProfile,
  TypeProfileField,
  normalizeRawFields,
  serializeTypeProfileField,
  typeProfileKindForType,
} from "core/utils/contexts/typeProfile";
import { PathPropertyName } from "shared/types/context";

// ---------------------------------------------------------------------------
// Per-field value statistics: a finer-grained pass than
// discoverFrontmatterSchema's presentCount/missingCount (which only tracks
// "the key exists"). Adoption needs to tell "key absent" apart from "key
// present but empty" to draft an empty-encoding policy (ADR-0056 D5), and
// needs the field's DISTINCT values to draft an enum vocabulary (D2) or score
// a foreign-key candidate (D6) — discoverFrontmatterSchema exposes neither.
// ---------------------------------------------------------------------------

export type FieldValueStats = {
  key: string;
  totalRows: number;
  // Key present with a genuinely non-empty value (after trimming; an empty
  // array or all-blank list still counts as empty, not present). Counts ROWS,
  // not values — a multi_select row with 3 tags still contributes 1 here.
  presentCount: number;
  // Key present but its value is empty ("" / null / an empty list).
  emptyStringCount: number;
  // Key absent from the row's frontmatter entirely.
  absentCount: number;
  // Every distinct non-empty (trimmed) value observed, first-seen order.
  // List-valued (multi_select-shaped) frontmatter contributes each element.
  distinctValues: string[];
  // Total non-empty VALUE occurrences across all rows, counting every
  // element of a list-valued field separately (unlike presentCount, which
  // counts rows). Equal to presentCount for scalar fields — a present row
  // always contributes exactly one value — but strictly greater whenever a
  // multi_select row carries more than one value. This is what tells "a
  // bounded vocabulary whose values repeat" apart from "as many distinct
  // values as observations" for list-valued fields, where presentCount alone
  // cannot (deriveEnumCandidate's repeat gate).
  totalValueCount: number;
};

// One row's frontmatter folded to a lowercase-key -> unioned-values bucket.
// A key is PRESENT in the map iff the row carries at least one spelling that
// folds onto it — even when every such spelling is empty — so the map preserves
// the present-but-empty vs. absent distinction downstream: a bucket that exists
// but is empty means "present but empty"; a missing entry means "absent".
type RowValueMap = Map<string, string[]>;

// Notidian-5mgs: fold a row's keys into ONE lowercase-key -> values map in a
// single O(keys) pass, so per-field stats become O(1) map lookups instead of an
// O(keys) `Object.keys(...).filter(...)` rescan repeated for every field. The
// former per-field lookup made the adoption draft O(rows*fields*keys) — ~O(rows
// *fields^2) on a wide database (a field per key); this fold makes it net
// O(rows*(keys+fields)).
//
// Notidian-1adj (semantics preserved EXACTLY): each bucket is the case-fold
// UNION of every spelling that folds onto its lowercase key. discoverFrontmatter-
// Schema merges case-variant spellings ("state" + "State") into ONE canonical
// summary whose `key` is the most-frequent spelling; the stats reader below
// looks that canonical key up here. Folding to lowercase is what keeps a row
// carrying only a MINORITY spelling from being counted absent and its values
// dropped from the drafted enum vocabulary, empty-encoding policy, and FK
// candidates (the summary advertises presentCount over all spellings, so the
// field's stats must too). Values are appended in the row's own key order, then
// each spelling's value order — byte-for-byte the sequence the former
// `filter(...).flatMap(toValueList)` produced, so distinct-value first-seen
// order is unchanged.
//
// Exclusion is enforced UPSTREAM: discoverFrontmatterSchema folds its excluded-
// key set case-insensitively (Notidian-1adj), so a logical field whose case-
// folded name matches an excluded key emits no summary and its canonical key
// never reaches the reader — this fold therefore only ever unions spellings of a
// NON-excluded field, never re-admits an excluded key's case-variant values.
const foldRowValues = (frontmatter: Record<string, unknown>): RowValueMap => {
  const rowMap: RowValueMap = new Map();
  for (const candidate of Object.keys(frontmatter)) {
    const lowerKey = candidate.toLowerCase();
    let bucket = rowMap.get(lowerKey);
    if (bucket === undefined) {
      bucket = [];
      rowMap.set(lowerKey, bucket);
    }
    // Append (never overwrite): a corrupt row carrying both "state:" and
    // "State:" contributes BOTH spellings' values into the one bucket.
    for (const value of toValueList(frontmatter[candidate])) {
      const trimmed = value.trim();
      if (trimmed.length > 0) bucket.push(trimmed);
    }
  }
  return rowMap;
};

// Build the per-row folded maps ONCE for a set of rows; every field's stats then
// read from these in O(rows) with O(1) per-row lookups (Notidian-5mgs).
const buildRowValueMaps = (
  paths: string[],
  frontmatterByPath: FrontmatterSnapshotsByPath
): RowValueMap[] =>
  paths.map((path) =>
    foldRowValues(frontmatterForPath(frontmatterByPath, path))
  );

// Derive one field's stats from the pre-folded per-row maps: O(1) lookup per
// row, no per-field key rescan.
const fieldValueStatsFromRowMaps = (
  rowMaps: RowValueMap[],
  key: string
): FieldValueStats => {
  const lowerKey = key.toLowerCase();
  let presentCount = 0;
  let emptyStringCount = 0;
  let absentCount = 0;
  let totalValueCount = 0;
  const distinctValues: string[] = [];
  const seen = new Set<string>();

  for (const rowMap of rowMaps) {
    const values = rowMap.get(lowerKey);
    if (values === undefined) {
      absentCount++;
      continue;
    }
    if (values.length == 0) {
      emptyStringCount++;
      continue;
    }
    presentCount++;
    totalValueCount += values.length;
    for (const value of values) {
      if (seen.has(value)) continue;
      seen.add(value);
      distinctValues.push(value);
    }
  }

  return {
    key,
    totalRows: rowMaps.length,
    presentCount,
    emptyStringCount,
    absentCount,
    distinctValues,
    totalValueCount,
  };
};

export const computeFieldValueStats = (
  paths: string[],
  frontmatterByPath: FrontmatterSnapshotsByPath,
  key: string
): FieldValueStats =>
  fieldValueStatsFromRowMaps(buildRowValueMaps(paths, frontmatterByPath), key);

// ---------------------------------------------------------------------------
// D2 — enum candidate: the "bounded-cardinality heuristic" (ADR-0056 D9).
// A field is a vocabulary candidate when its distinct-value count is small
// AND at least one value repeats — the repeat is what tells a bounded set of
// categories ("active"/"done"/"blocked") apart from a near-unique, id-shaped
// field (a serial number, a slug) where every observed value is different.
// Only ever a SUGGESTION: `strict` is always false in the drafted field.
// ---------------------------------------------------------------------------

export type EnumCandidate = {
  values: string[];
  presentCount: number;
  distinctCount: number;
};

// Absolute cap on distinct values before a field stops looking like a
// vocabulary and starts looking like free text. No repo precedent sets an
// exact number (ADR-0056 leaves the heuristic's constant unspecified) — 12 is
// a deliberately conservative pick: comfortably above small real vocabularies
// (Gidi's registries top out at a 9-value sensor_class enum) while well below
// the point where "every row is basically unique."
const ENUM_MAX_DISTINCT = 12;

// Only free-text/select-shaped kinds are eligible: an enum vocabulary reading
// on a checkbox/number/date/link field is either trivially true (booleans
// always have <=2 distinct values) or nonsensical (a date's "vocabulary").
const ENUM_ELIGIBLE_KINDS = new Set(["text", "select", "multi_select"]);

export const deriveEnumCandidate = (
  stats: Pick<FieldValueStats, "distinctValues" | "presentCount" | "totalValueCount">
): EnumCandidate | undefined => {
  const distinctCount = stats.distinctValues.length;
  if (distinctCount < 2 || distinctCount > ENUM_MAX_DISTINCT) return undefined;
  // Require at least one repeated VALUE occurrence: compare against
  // totalValueCount (every list element counted separately), not
  // presentCount (rows). For a scalar field the two are equal, so this is
  // the same test as before. For a multi_select field, presentCount alone
  // would be wrong: e.g. 4 rows each carrying 2 tags drawn from a 4-word
  // bounded vocabulary gives distinctCount == presentCount == 4 (no repeat
  // visible in rows), even though every value repeats twice across the 8
  // total tag occurrences — totalValueCount (8) catches that repeat where
  // presentCount (4) would not.
  if (distinctCount >= stats.totalValueCount) return undefined;
  return {
    values: [...stats.distinctValues],
    presentCount: stats.presentCount,
    distinctCount,
  };
};

// ---------------------------------------------------------------------------
// D5 — empty-encoding policy: which representation ("absent" vs
// "empty-string") the majority of rows already use. A tie (including
// zero-and-zero, i.e. every row has a real value) has no signal either way —
// suggesting a policy from no evidence would be worse than suggesting none.
// ---------------------------------------------------------------------------

export type EmptyEncodingStats = {
  absentCount: number;
  emptyStringCount: number;
  presentCount: number;
  suggested?: "absent" | "empty-string";
};

export const deriveEmptyEncodingStats = (
  stats: Pick<FieldValueStats, "absentCount" | "emptyStringCount" | "presentCount">
): EmptyEncodingStats => {
  const { absentCount, emptyStringCount, presentCount } = stats;
  const suggested =
    absentCount > emptyStringCount
      ? "absent"
      : emptyStringCount > absentCount
      ? "empty-string"
      : undefined;
  return { absentCount, emptyStringCount, presentCount, ...(suggested ? { suggested } : {}) };
};

// ---------------------------------------------------------------------------
// D6 — foreign-key candidates via cross-database value overlap: the same
// matching keyMatchResolver.ts's resolveKeyMatch performs at query time (trim
// + strict string equality), run speculatively over every other database's
// fields instead of one declared target. Pure: the caller (runtime glue in
// core/superstate/utils/typeProfileAdoption.ts) gathers each sibling
// database's per-field value sets from Superstate; this function only scores
// the overlap.
// ---------------------------------------------------------------------------

export type SiblingDatabaseValues = {
  targetFolder: string;
  targetKey: string;
  values: Set<string>;
};

export type ForeignKeyCandidate = {
  targetFolder: string;
  targetKey: string;
  overlapCount: number;
  candidateCount: number;
  overlapRatio: number;
};

// Need at least two distinct values before "every value matched" means
// anything (a single-value field trivially "overlaps" almost anything).
const FK_MIN_DISTINCT_VALUES = 2;
// Most of this field's values must resolve in the candidate target — chosen
// high enough that a coincidental partial overlap (e.g. both fields happen to
// contain "true"/"1") does not surface as a confident suggestion.
const FK_MIN_OVERLAP_RATIO = 0.6;
// Cap the preview to the strongest handful of matches; a field rarely has
// more than one or two genuine reference targets, and a long tail of weak
// ties would bury the real candidate.
const FK_MAX_CANDIDATES = 3;

export const findForeignKeyCandidates = (
  distinctValues: string[],
  siblingDatabases: SiblingDatabaseValues[]
): ForeignKeyCandidate[] => {
  const candidateCount = distinctValues.length;
  if (candidateCount < FK_MIN_DISTINCT_VALUES) return [];

  const candidates: ForeignKeyCandidate[] = [];
  for (const sibling of siblingDatabases) {
    if (!sibling.values || sibling.values.size == 0) continue;
    const overlapCount = distinctValues.reduce(
      (count, value) => count + (sibling.values.has(value) ? 1 : 0),
      0
    );
    const overlapRatio = overlapCount / candidateCount;
    if (overlapRatio < FK_MIN_OVERLAP_RATIO) continue;
    candidates.push({
      targetFolder: sibling.targetFolder,
      targetKey: sibling.targetKey,
      overlapCount,
      candidateCount,
      overlapRatio,
    });
  }

  candidates.sort((a, b) =>
    b.overlapRatio != a.overlapRatio
      ? b.overlapRatio - a.overlapRatio
      : b.overlapCount - a.overlapCount
  );
  return candidates.slice(0, FK_MAX_CANDIDATES);
};

// ---------------------------------------------------------------------------
// ADR-0040 Database Boundary Test (Notidian-7v4c): an advisory, NON-BLOCKING
// coherence diagnostic layered onto the draft. Atlas Method ADR-0040 settled
// the general rule — one database = one question × one lifecycle × one
// property profile; a kind joins an existing database only if it shares the
// CORE property profile, its tail may *add* fields but never *replace* the
// core. Kinds whose natural properties would mostly not overlap are different
// answer-shapes and deserve their own database (the exact failure ADR-0040
// diagnosed for the vault's Tools & Materials database).
//
// Silently unioning every observed frontmatter field (what draftTypeProfile-
// Adoption does) papers over that judgment call. This pass detects when the
// scanned rows partition into 2+ divergent property profiles — two answer-
// shapes forced into one folder — and surfaces it so the owner can consider a
// split. It is PURELY advisory: the union still drafts every field; this only
// RECOMMENDS. It changes no drafting behavior.
//
// Scope note: ADR-0040's motivating vault case had the distinguishing fields
// (`location`, `account`) populated on ZERO rows — the divergence lived in the
// natural, unpopulated schema, invisible to any row scan. This heuristic
// necessarily works over what IS observable: the per-row PROPERTY-PRESENCE
// sets (which fields each row actually answers with). It fires on the tractable
// case — rows that DO populate divergent field clusters — and stays silent when
// the divergence is only latent. Advisory bias is deliberately conservative:
// it would rather miss a latent split than false-flag a coherent database.
// ---------------------------------------------------------------------------

// Below this many rows there is not enough evidence to claim two distinct
// answer-shapes rather than incidental early-adoption variation — stay silent.
const DIVERGENCE_MIN_ROWS = 4;
// A field present on at least this FRACTION of all rows is treated as part of
// the shared universal core (name/lifecycle/decided_by-style): every answer-
// shape carries it, so it cannot discriminate between them.
const CORE_PREVALENCE = 0.9;
// A field must be populated on at least this many rows to count as a
// discriminating signal at all — a field on a single row is that one row's
// idiosyncrasy, not an answer-shape.
const DISCRIMINATOR_MIN_ROWS = 2;
// Each divergent group must own at least this many characteristic fields. A
// single differing optional field (some rows carry `url`, others `phone`) is a
// tail variation ADR-0040 D1 explicitly ALLOWS ("its tail may add fields");
// requiring a CLUSTER of co-populated fields per group is what separates "two
// answer-shapes" from "one coherent shape with optional tails."
const GROUP_MIN_CHARACTERISTIC_FIELDS = 2;
// Each divergent group must also cover a meaningful share of the database, so
// a couple of malformed/outlier rows never read as a second answer-shape.
const GROUP_MIN_ROW_FRACTION = 0.15;
// Cap example rows surfaced per group in the advisory.
const GROUP_EXAMPLE_ROW_CAP = 3;

export type PropertyProfileGroup = {
  // Rows whose observed property profile matches this answer-shape.
  rowCount: number;
  // The characteristic (discriminating) fields these rows populate that the
  // OTHER divergent groups' rows essentially never populate — the fields that
  // make this a distinct answer-shape. Sorted, stable. By construction these
  // sets are pairwise-disjoint across groups (ADR-0040 "share no common core").
  characteristicFields: string[];
  // A few example row paths from this group, for the preview (capped).
  exampleRows: string[];
};

export type PropertyProfileDivergence = {
  // True when the scanned rows partition into 2+ divergent answer-shapes that
  // share no common core beyond the universal fields — the ADR-0040 boundary
  // violation. Advisory ONLY: `draftTypeProfileAdoption` still unions every
  // field regardless of this flag.
  divergent: boolean;
  // Fields present on (nearly) every row — the common core the answer-shapes
  // DO share (name/lifecycle-style). Sorted. Context for the warning: "they
  // share only <these>." Populated whether or not `divergent`.
  sharedCoreFields: string[];
  // The 2+ divergent groups, largest first. Empty unless `divergent`.
  groups: PropertyProfileGroup[];
};

export type DetectPropertyProfileDivergenceOptions = {
  paths: string[];
  frontmatterByPath: FrontmatterSnapshotsByPath;
  excludedKeys?: string[];
};

export const detectPropertyProfileDivergence = ({
  paths,
  frontmatterByPath,
  excludedKeys = [],
}: DetectPropertyProfileDivergenceOptions): PropertyProfileDivergence => {
  const rowCount = paths.length;
  // Notidian-1adj: fold the exclusion set case-insensitively, matching
  // discoverFrontmatterSchema's own case-folded exclusion. A case-sensitive
  // check would count a case-variant of an excluded key (e.g. `Tags` when
  // `tags` is excluded) as a populated, discriminating field — surfacing the
  // excluded property in the coherence advisory that the field-union pass
  // deliberately drops.
  const excluded = new Set(
    [PathPropertyName, ...excludedKeys].map((key) => key.toLowerCase())
  );

  // Per-row present-field set: keys the row genuinely ANSWERS with — the same
  // present/empty notion computeFieldValueStats uses, so a key declared with an
  // empty ("" / [] / all-blank) value does NOT count as populated.
  //
  // Notidian-wcig: fold each key to lowercase for FIELD IDENTITY. The rest of
  // the pipeline (discoverFrontmatterSchema merge, computeFieldValueStats) and
  // the exclusion check on this very loop already collapse case-variant
  // spellings ("priority"/"Priority") into ONE logical field. If this present-
  // set kept RAW casing, a coherent database whose rows were imported with
  // inconsistent key casing would split into as many discriminating "fields" as
  // spellings — union-find then sees disjoint components and false-flags a
  // boundary violation, recommending a bad split of a coherent database. Folding
  // collapses each logical field to one discriminator. `spellingCounts` records
  // every observed spelling so `displayField` can recover a canonical casing for
  // the advisory banner (see below).
  const spellingCounts = new Map<string, Map<string, number>>();
  const presentFieldsByRow: Array<Set<string>> = paths.map((path) => {
    const frontmatter = frontmatterForPath(frontmatterByPath, path);
    const present = new Set<string>();
    for (const key of Object.keys(frontmatter)) {
      const canonical = key.toLowerCase();
      if (excluded.has(canonical)) continue;
      const values = toValueList(frontmatter[key])
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (values.length == 0) continue;
      present.add(canonical);
      const spellings =
        spellingCounts.get(canonical) ?? new Map<string, number>();
      spellings.set(key, (spellings.get(key) ?? 0) + 1);
      spellingCounts.set(canonical, spellings);
    }
    return present;
  });

  // Recover a display spelling for a case-folded field: most-frequent spelling
  // wins, ties resolve to the earliest-seen (strict `>` over the first-seen Map
  // order) — the exact canonical-casing rule discoverFrontmatterSchema uses to
  // NAME the drafted field, so the advisory banner shows the same casing the
  // draft will produce rather than a synthetic all-lowercase key.
  const displayField = (canonical: string): string => {
    const spellings = spellingCounts.get(canonical);
    if (!spellings) return canonical;
    let best = canonical;
    let bestCount = -1;
    for (const [spelling, count] of spellings) {
      if (count > bestCount) {
        best = spelling;
        bestCount = count;
      }
    }
    return best;
  };

  // Field -> row-indices that populate it.
  const rowsByField = new Map<string, number[]>();
  presentFieldsByRow.forEach((present, rowIndex) => {
    for (const key of present) {
      const rows = rowsByField.get(key) ?? [];
      rows.push(rowIndex);
      rowsByField.set(key, rows);
    }
  });

  // `rowsByField` / `discriminatingFields` are keyed by the case-folded
  // canonical field (see the present-set build). `displayField` maps each back
  // to a real observed spelling only where it crosses the API boundary as
  // banner text.
  const coreThreshold = rowCount * CORE_PREVALENCE;
  const sharedCoreFields: string[] = [];
  const discriminatingFields: string[] = [];
  for (const [key, rows] of rowsByField) {
    if (rows.length >= coreThreshold) {
      sharedCoreFields.push(key);
    } else if (rows.length >= DISCRIMINATOR_MIN_ROWS) {
      discriminatingFields.push(key);
    }
    // else: a rare/near-singleton field — noise, not an answer-shape signal.
  }
  sharedCoreFields.sort();
  const sharedCoreFieldNames = sharedCoreFields.map(displayField);

  const noDivergence: PropertyProfileDivergence = {
    divergent: false,
    sharedCoreFields: sharedCoreFieldNames,
    groups: [],
  };
  if (rowCount < DIVERGENCE_MIN_ROWS) return noDivergence;
  if (discriminatingFields.length == 0) return noDivergence;

  // Union-find over rows: two rows join the same answer-shape when they
  // co-populate the same discriminating field. Connected components therefore
  // have PAIRWISE-DISJOINT discriminating-field sets — if a field spanned two
  // components its rows would have merged them — which is exactly ADR-0040's
  // "share no common core": distinct components share none of the
  // discriminating fields, only the universal core.
  const parent = paths.map((_, index) => index);
  const find = (start: number): number => {
    let root = start;
    while (parent[root] != root) root = parent[root];
    let node = start;
    while (parent[node] != root) {
      const next = parent[node];
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra != rb) parent[ra] = rb;
  };
  for (const key of discriminatingFields) {
    const rows = rowsByField.get(key) ?? [];
    for (let i = 1; i < rows.length; i++) union(rows[0], rows[i]);
  }

  // Only rows carrying >=1 discriminating field belong to an answer-shape;
  // core-only rows (nothing but universal fields) are the shared middle and
  // join no group.
  const rowHasDiscriminator = presentFieldsByRow.map((present) =>
    discriminatingFields.some((key) => present.has(key))
  );

  const componentRows = new Map<number, number[]>();
  presentFieldsByRow.forEach((_present, rowIndex) => {
    if (!rowHasDiscriminator[rowIndex]) return;
    const root = find(rowIndex);
    const rows = componentRows.get(root) ?? [];
    rows.push(rowIndex);
    componentRows.set(root, rows);
  });

  // Every row populating a given discriminating field shares one root (union
  // guarantees it), so each field maps cleanly to exactly one component.
  const componentFields = new Map<number, string[]>();
  for (const key of discriminatingFields) {
    const rows = rowsByField.get(key) ?? [];
    if (rows.length == 0) continue;
    const root = find(rows[0]);
    const fields = componentFields.get(root) ?? [];
    fields.push(key);
    componentFields.set(root, fields);
  }

  const groupRowFloor = Math.max(
    DISCRIMINATOR_MIN_ROWS,
    Math.ceil(rowCount * GROUP_MIN_ROW_FRACTION)
  );

  const qualifyingGroups: PropertyProfileGroup[] = [];
  for (const [root, rows] of componentRows) {
    const fields = [...(componentFields.get(root) ?? [])].sort();
    if (rows.length < groupRowFloor) continue;
    if (fields.length < GROUP_MIN_CHARACTERISTIC_FIELDS) continue;
    qualifyingGroups.push({
      rowCount: rows.length,
      characteristicFields: fields.map(displayField),
      exampleRows: [...rows]
        .sort((a, b) => a - b)
        .slice(0, GROUP_EXAMPLE_ROW_CAP)
        .map((index) => paths[index]),
    });
  }

  qualifyingGroups.sort(
    (a, b) =>
      b.rowCount - a.rowCount ||
      b.characteristicFields.length - a.characteristicFields.length ||
      (a.characteristicFields[0] ?? "").localeCompare(
        b.characteristicFields[0] ?? ""
      )
  );

  // Two answer-shapes are the minimum for a boundary violation; a single
  // qualifying group is just a coherent database with a rich tail.
  if (qualifyingGroups.length < 2) return noDivergence;

  return {
    divergent: true,
    sharedCoreFields: sharedCoreFieldNames,
    groups: qualifyingGroups,
  };
};

// ---------------------------------------------------------------------------
// Whole-database draft assembly.
// ---------------------------------------------------------------------------

export type TypeProfileFieldDraft = {
  field: TypeProfileField;
  enumCandidate?: EnumCandidate;
  foreignKeyCandidates: ForeignKeyCandidate[];
  emptyEncoding: EmptyEncodingStats;
};

export type TypeProfileAdoptionDraft = {
  database: string;
  rowCount: number;
  // Only fields NOT already declared in the hub's existing profile (if any) —
  // adoption drafts ADDITIONS, never edits to an already-profiled field
  // (that is the merge planner's "never clobber" invariant, enforced again
  // below at write-plan time).
  fields: TypeProfileFieldDraft[];
  alreadyDeclaredFieldNames: string[];
  // ADR-0040 Database Boundary Test (Notidian-7v4c): advisory, non-blocking.
  // `divergent: true` when the scanned rows look like 2+ answer-shapes forced
  // into one database. The `fields` union above is UNCHANGED by this — it only
  // recommends a split. Optional so pre-existing draft literals/fixtures stay
  // valid; always populated by `draftTypeProfileAdoption`.
  profileDivergence?: PropertyProfileDivergence;
};

export type DraftTypeProfileAdoptionOptions = {
  database: string;
  paths: string[];
  frontmatterByPath: FrontmatterSnapshotsByPath;
  excludedKeys?: string[];
  existingProfile?: NotidianTypeProfile | null;
  siblingDatabases?: SiblingDatabaseValues[];
};

export const draftTypeProfileAdoption = ({
  database,
  paths,
  frontmatterByPath,
  excludedKeys = [],
  existingProfile = null,
  siblingDatabases = [],
}: DraftTypeProfileAdoptionOptions): TypeProfileAdoptionDraft => {
  const summaries = discoverFrontmatterSchema({
    paths,
    frontmatterByPath,
    excludedKeys,
  });
  const existingNames = new Set(
    (existingProfile?.fields ?? []).map((field) => field.name.toLowerCase())
  );

  // Notidian-5mgs: fold every row ONCE (O(rows*keys)), then read each field's
  // stats from the shared maps in O(rows) — instead of rescanning every row's
  // keys per field. Net O(rows*(keys+fields)) rather than O(rows*fields*keys).
  const rowValueMaps = buildRowValueMaps(paths, frontmatterByPath);

  const fields: TypeProfileFieldDraft[] = [];
  for (const summary of summaries) {
    if (existingNames.has(summary.key.toLowerCase())) continue;

    const stats = fieldValueStatsFromRowMaps(rowValueMaps, summary.key);
    const kind = typeProfileKindForType(summary.type);
    const enumCandidate = ENUM_ELIGIBLE_KINDS.has(kind)
      ? deriveEnumCandidate(stats)
      : undefined;
    const emptyEncoding = deriveEmptyEncodingStats(stats);
    const foreignKeyCandidates = findForeignKeyCandidates(
      stats.distinctValues,
      siblingDatabases
    );
    const topForeignKey = foreignKeyCandidates[0];

    const field: TypeProfileField = {
      name: summary.key,
      kind,
      type: summary.type,
      ...(enumCandidate
        ? { enum: { values: enumCandidate.values, strict: false } }
        : {}),
      ...(emptyEncoding.suggested ? { empty: emptyEncoding.suggested } : {}),
      ...(topForeignKey
        ? {
            reference: {
              targetFolder: topForeignKey.targetFolder,
              targetKey: topForeignKey.targetKey,
              onBrokenWrite: "warn",
              onReferencedChange: "warn",
            },
          }
        : {}),
    };

    fields.push({ field, enumCandidate, foreignKeyCandidates, emptyEncoding });
  }

  return {
    database,
    rowCount: paths.length,
    fields,
    alreadyDeclaredFieldNames: [...existingNames],
    // Advisory ADR-0040 boundary check over the SAME excluded-key set the
    // schema discovery above used, so both passes see the same field universe.
    profileDivergence: detectPropertyProfileDivergence({
      paths,
      frontmatterByPath,
      excludedKeys,
    }),
  };
};

// ---------------------------------------------------------------------------
// Merge planner (ADR-0015 preview/confirm doctrine, ADR-0056 D9's "never
// auto-applied"): produces the hub note's NEXT `fields:` map. Never clobbers
// a field the hub already declares — even if the caller passes a stale draft
// computed before a concurrent edit, re-planning against the CURRENT raw
// fields map (as every apply-path call site should) means an already-added
// field is simply skipped a second time, not overwritten.
//
// A field name can also be declared inside `kind_fields.<kind>.<name>`
// instead of the common `fields:` map (Notidian-egz v2 kind-scoped columns —
// e.g. via the table's kind_fields mirror, planTypeProfileMirror in
// typeProfile.ts, which applies the identical "or find owning kind" check
// for its own add-column collision guard). The collision check below must
// cover both maps: checking only `fields` would let a field concurrently
// declared into `kind_fields` between preview-open and confirm-click get
// silently ADDED a second time into `fields`, which `parseTypeProfile`'s
// addUnique union then dedupes by first-occurrence (common wins), orphaning
// the kind-scoped declaration with no diagnostic — exactly the "never
// clobber" invariant this planner exists to guarantee.
// ---------------------------------------------------------------------------

export type TypeProfileAdoptionMergePlan = {
  changed: boolean;
  fields: Record<string, unknown>;
  addedFieldNames: string[];
};

export const planTypeProfileAdoptionMerge = (
  existingRawFields: unknown,
  draft: Pick<TypeProfileAdoptionDraft, "fields">,
  existingRawKindFields?: unknown
): TypeProfileAdoptionMergePlan => {
  const base = normalizeRawFields(existingRawFields) ?? {};
  const kindFieldsMap = normalizeRawFields(existingRawKindFields) ?? {};
  const fields: Record<string, unknown> = { ...base };
  const addedFieldNames: string[] = [];

  const findKey = (name: string) =>
    Object.keys(fields).find((key) => key.toLowerCase() == name.toLowerCase());

  const isDeclaredInAnyKind = (name: string) =>
    Object.values(kindFieldsMap).some((kindDef) => {
      const kindMap = normalizeRawFields(kindDef);
      if (!kindMap) return false;
      return Object.keys(kindMap).some(
        (key) => key.toLowerCase() == name.toLowerCase()
      );
    });

  for (const { field } of draft.fields) {
    // Never clobber an existing declaration, whether it lives in the common
    // `fields` map or is owned by a specific kind in `kind_fields`.
    if (findKey(field.name) || isDeclaredInAnyKind(field.name)) continue;
    fields[field.name] = serializeTypeProfileField(field);
    addedFieldNames.push(field.name);
  }

  return { changed: addedFieldNames.length > 0, fields, addedFieldNames };
};
