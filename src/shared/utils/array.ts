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
// lowercased keys already seen, mirroring `uniq`'s first-seen semantics. This is
// display-only (frontmatter-key column labels in PropertiesView /
// RemoteMarkdownHeaderView) — no casing is persisted as authority.
export const uniqCaseInsensitive = (a: string[]) => {
  const seen = new Set<string>();
  return a.filter((s) => {
    const k = s.toLowerCase();
    return seen.has(k) ? false : (seen.add(k), true);
  });
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