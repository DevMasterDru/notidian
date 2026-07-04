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
  hasOwn,
  toValueList,
} from "core/utils/contexts/notidianSchema";
import {
  NotidianTypeProfile,
  TypeProfileField,
  normalizeRawFields,
  serializeTypeProfileField,
  typeProfileKindForType,
} from "core/utils/contexts/typeProfile";

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
  // array or all-blank list still counts as empty, not present).
  presentCount: number;
  // Key present but its value is empty ("" / null / an empty list).
  emptyStringCount: number;
  // Key absent from the row's frontmatter entirely.
  absentCount: number;
  // Every distinct non-empty (trimmed) value observed, first-seen order.
  // List-valued (multi_select-shaped) frontmatter contributes each element.
  distinctValues: string[];
};

export const computeFieldValueStats = (
  paths: string[],
  frontmatterByPath: FrontmatterSnapshotsByPath,
  key: string
): FieldValueStats => {
  let presentCount = 0;
  let emptyStringCount = 0;
  let absentCount = 0;
  const distinctValues: string[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    const frontmatter = frontmatterForPath(frontmatterByPath, path);
    if (!hasOwn(frontmatter, key)) {
      absentCount++;
      continue;
    }
    const values = toValueList(frontmatter[key])
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (values.length == 0) {
      emptyStringCount++;
      continue;
    }
    presentCount++;
    for (const value of values) {
      if (seen.has(value)) continue;
      seen.add(value);
      distinctValues.push(value);
    }
  }

  return {
    key,
    totalRows: paths.length,
    presentCount,
    emptyStringCount,
    absentCount,
    distinctValues,
  };
};

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
  stats: Pick<FieldValueStats, "distinctValues" | "presentCount">
): EnumCandidate | undefined => {
  const distinctCount = stats.distinctValues.length;
  if (distinctCount < 2 || distinctCount > ENUM_MAX_DISTINCT) return undefined;
  // Require at least one repeat (distinctCount < presentCount) — otherwise
  // every observed value is unique and this is an id-shaped field, not a
  // bounded vocabulary, regardless of how few rows exist.
  if (distinctCount >= stats.presentCount) return undefined;
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

  const fields: TypeProfileFieldDraft[] = [];
  for (const summary of summaries) {
    if (existingNames.has(summary.key.toLowerCase())) continue;

    const stats = computeFieldValueStats(paths, frontmatterByPath, summary.key);
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
  };
};

// ---------------------------------------------------------------------------
// Merge planner (ADR-0015 preview/confirm doctrine, ADR-0056 D9's "never
// auto-applied"): produces the hub note's NEXT `fields:` map. Never clobbers
// a field the hub already declares — even if the caller passes a stale draft
// computed before a concurrent edit, re-planning against the CURRENT raw
// fields map (as every apply-path call site should) means an already-added
// field is simply skipped a second time, not overwritten.
// ---------------------------------------------------------------------------

export type TypeProfileAdoptionMergePlan = {
  changed: boolean;
  fields: Record<string, unknown>;
  addedFieldNames: string[];
};

export const planTypeProfileAdoptionMerge = (
  existingRawFields: unknown,
  draft: Pick<TypeProfileAdoptionDraft, "fields">
): TypeProfileAdoptionMergePlan => {
  const base = normalizeRawFields(existingRawFields) ?? {};
  const fields: Record<string, unknown> = { ...base };
  const addedFieldNames: string[] = [];

  const findKey = (name: string) =>
    Object.keys(fields).find((key) => key.toLowerCase() == name.toLowerCase());

  for (const { field } of draft.fields) {
    if (findKey(field.name)) continue; // never clobber an existing declaration
    fields[field.name] = serializeTypeProfileField(field);
    addedFieldNames.push(field.name);
  }

  return { changed: addedFieldNames.length > 0, fields, addedFieldNames };
};
