export const insert = (arr: any[], index: number, newItem: any) => !index || index <= 0 ? [
  newItem,
  ...arr,
] : [
  ...arr.slice(0, index),
  newItem,
  ...arr.slice(index),
];

export const insertMulti = (arr: any[], index: number, newItem: any[]) => !index || index <= 0 ? [
  ...newItem,
  ...arr,
] : [
  ...arr.slice(0, index),
  ...newItem,
  ...arr.slice(index),
];

export const uniq = (a: any[]) => [...new Set(a)];
// Case-insensitive dedup keeping the FIRST-seen casing (ADR 0025, Notidian-9v6).
// `new Map(pairs)` preserves first-insertion POSITION but OVERWRITES the value on
// a duplicate key, so it would keep the LAST-seen casing. We instead skip
// lowercased keys already seen, mirroring `uniq`'s first-seen semantics. Used
// for frontmatter-key column labels (PropertiesView / RemoteMarkdownHeaderView)
// AND for replaceDB's liveCols (Notidian-1q8y): SQLite folds identifier case,
// so case-variant column names must collapse to one column or CREATE TABLE
// throws `duplicate column name`. First-seen casing is what persists.
export const uniqCaseInsensitive = (a: string[]) => {
  const seen = new Set<string>();
  return a.filter((s) => {
    const k = s.toLowerCase();
    return seen.has(k) ? false : (seen.add(k), true);
  });
};
// Object/row sibling of uniqCaseInsensitive (Notidian-buqr): keeps the FIRST-seen
// item per caller-supplied string key and drops later duplicates, preserving input
// order — the exact first-seen-wins semantics of uniqCaseInsensitive, lifted from a
// string list to arbitrary rows via `keyFn`. The SURVIVING ROW IS KEPT WHOLE AND
// VERBATIM: this deliberately does NOT merge fields between duplicates and does NOT
// pick a "more authoritative" winner. It is used to collapse case-variant m_fields
// rows (keyed by schemaId + name.toLowerCase()) so the persisted field list can
// never claim more columns than the physical data table, whose columns replaceDB
// already folds first-seen via uniqCaseInsensitive (db.ts, Notidian-1q8y). Because
// the first-seen row survives whole, its own `name` IS the first-seen casing —
// matching the physical column the fold keeps for the same input order — with no
// casing rewrite needed. Whole-row-first-seen (never source/authority-weighted) is
// intentional: an automatic dedup must never silently flip a field across the
// frontmatter<->notidian authority boundary (ADR 0001/0014/0017).
export const uniqByKey = <T>(items: T[], keyFn: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = keyFn(item);
    return seen.has(k) ? false : (seen.add(k), true);
  });
};
// Deterministic, order-preserving PRE-SORT for a first-seen fold (Notidian-rcvg).
// A first-seen dedup (uniqCaseInsensitive / uniqByKey) keeps whichever member of a
// `keyFn` group appears FIRST — so its survivor depends on the incoming array order.
// replaceDB runs TWO such folds — the m_fields ROW fold and the physical COLUMN fold
// — over independently-built (and thus potentially differently-ordered) arrays, so
// left order-dependent they can keep DIFFERENT casings for one field (drifting the
// persisted field name from its physical column) and can churn a field's kept
// definition (a text vs option case-variant) across save-path assemblies.
// stableCanonicalByKey reorders `items` so that, WITHIN each `keyFn` group, the
// member with the lexicographically-smallest `rankFn` comes first, while each group
// stays at the index of its FIRST occurrence — so items with DISTINCT keys keep
// their original relative order (a collision-free array is returned unchanged) and
// only the WITHIN-group winner becomes deterministic. Feeding this to a first-seen
// fold makes the survivor a pure function of the group's CONTENTS, identical across
// any input permutation and across two folds sharing the same key+rank. The tie-
// break is a plain name-string comparison — authority-neutral, NEVER a source/owner
// preference — so it can't flip a field across the frontmatter<->notidian authority
// boundary (ADR 0001/0014/0017); that source-weighted design was reverted once.
export const stableCanonicalByKey = <T>(
  items: T[],
  keyFn: (item: T) => string,
  rankFn: (item: T) => string
): T[] => {
  const firstIndex = new Map<string, number>();
  items.forEach((item, i) => {
    const k = keyFn(item);
    if (!firstIndex.has(k)) firstIndex.set(k, i);
  });
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const fa = firstIndex.get(keyFn(a.item)) as number;
      const fb = firstIndex.get(keyFn(b.item)) as number;
      if (fa !== fb) return fa - fb; // group position = its FIRST occurrence
      const ra = rankFn(a.item);
      const rb = rankFn(b.item);
      if (ra < rb) return -1; // within a group: deterministic name-rank winner first
      if (ra > rb) return 1;
      return a.i - b.i; // exact rank tie (true duplicate): stable by input index
    })
    .map((e) => e.item);
};
export const uniqueNameFromString = (name: string, cols: string[]) => {
  let newName = name;
  if (cols.includes(newName)) {
    let append = 1;
    while (cols.includes(newName)) {
      newName = name + append.toString();
      append += 1;
    }
  }
  return newName;
};

// Build a collision-free file name for a COPY from the CALLER-REQUESTED base
// name (e.g. the user's typed row title) rather than the SOURCE file's name.
// copyFile's collision branch used to dedup from the template's basename, so a
// templated row-create with a name clash was silently renamed after the
// template ("Task Template") instead of the typed title (Notidian-ksrb). This
// centralizes the correct base so a colliding create yields "<requested>1",
// never "<template>". `requestedBase` and `existingBases` are extension-less
// display names; the extension (if any) is re-appended to the result.
export const uniqueCopyName = (
  requestedBase: string,
  existingBases: string[],
  extension?: string
) => {
  const uniqueBase = uniqueNameFromString(requestedBase, existingBases);
  return extension && extension.length > 0
    ? `${uniqueBase}.${extension}`
    : uniqueBase;
};
export const onlyUniqueProp =
  (prop: string) => (value: any, index: number, self: any[]) => {
    return self.findIndex((v) => value[prop] == v[prop]) === index;
  };

export const onlyUniquePropCaseInsensitive =
  (prop: string) => (value: any, index: number, self: any[]) => {
    return (
      self.findIndex(
        (v) => value[prop].toLowerCase() == v[prop].toLowerCase()
      ) === index
    );
  };

  
// Order `array` by the position of each item in `order` (ADR 0025, Option B).
// Stable, reflexive, total order, and NON-MUTATING:
//   - both present  -> by their `order`-index (0 when equal indices)
//   - one absent    -> the present one sorts first
//   - both absent    -> 0, so Array.prototype.sort's guaranteed stability
//                       preserves their original input order
// Spreading the input first means the caller's array is never mutated.
const orderComparator = (A: number, B: number) => {
  if (A === -1 && B === -1) return 0; // both absent -> keep input order (stable)
  if (A === -1) return 1; // a absent -> after present b
  if (B === -1) return -1; // b absent -> before present a... a stays first
  return A - B; // both present -> by order-index (0 if equal)
};

export const orderStringArrayByArray = (array: string[], order: string[]) =>
  [...array].sort((a, b) =>
    orderComparator(order.indexOf(a), order.indexOf(b))
  );

export const orderArrayByArrayWithKey = (
  array: any[],
  order: string[],
  key: string
) =>
  [...array].sort((a, b) =>
    orderComparator(order.indexOf(a[key]), order.indexOf(b[key]))
  );