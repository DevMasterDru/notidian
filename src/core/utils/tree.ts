// ---------------------------------------------------------------------------
// Folder/space tree helpers: a path-ancestry predicate + the sort comparator
// FACTORIES the space/row ordering path feeds to Array.prototype.sort
// (consumed by core/superstate/utils/spaces.ts `spaceSortFn` and the d-n-d
// path logic in core/utils/dnd/*).
//
// Array.prototype.sort requires its comparator to be a STRICT WEAK ORDERING
// (a real total order over the data): reflexive (cmp(x,x)===0), antisymmetric
// (sign(cmp(a,b)) === -sign(cmp(b,a))), and transitive. A comparator that
// returns `undefined` or `NaN` gives V8/TimSort an UNDEFINED contract and
// yields version-dependent, unstable, or outright-wrong orderings — the
// Notidian-e8e / ADR-0025 / ADR-0033 bug class. The two field comparators
// below are therefore hardened to ALWAYS return a finite number for any
// possible field value (including null/undefined/non-numeric cells), and the
// ancestry predicate is hardened to honour a real path boundary.
// ---------------------------------------------------------------------------

// True iff `path` is `target` itself or a proper ancestor folder of `target`,
// respecting the `/` path boundary so that `/foo` is NOT treated as an ancestor
// of `/foobar`. The vault root (`/`) is an ancestor of every path.
export const nodeIsAncestorOfTarget = (path: string, target: string) => {
  if (path == null || target == null) return false;
  if (path === target) return true;
  // Root is an ancestor of everything (its `path + "/"` would be the invalid
  // "//", so special-case it).
  if (path === "/") return true;
  // A proper descendant: target must continue past `path` at a path separator,
  // not merely share a string prefix (the latent `/foo` vs `/foobar` bug).
  return target.startsWith(path.endsWith("/") ? path : path + "/");
};

// Helper Function to Create Folder Tree


export const compareByFieldDeep =
  (field: (obj: Record<string, any>) => string, dir: boolean) =>
  (_a: Record<string, any>, _b: Record<string, any>) => {
    const a = dir ? _a : _b;
    const b = dir ? _b : _a;

    if (field(a) < field(b)) {
      return -1;
    }
    if (field(a) > field(b)) {
      return 1;
    }
    return 0;
  };


export const compareByField =
  (field: string, dir: boolean) =>
  (_a: Record<string, any>, _b: Record<string, any>) => {
    const a = dir ? _a : _b;
    const b = dir ? _b : _a;
    if (a[field] < b[field]) {
      return -1;
    }
    if (a[field] > b[field]) {
      return 1;
    }
    return 0;
  };

export const compareByFieldCaseInsensitive =
  (field: string, dir: boolean) =>
  (_a: Record<string, any>, _b: Record<string, any>) => {
    const a = dir ? _a : _b;
    const b = dir ? _b : _a;
    // Coerce a missing/null/non-string field to "" so the comparator ALWAYS
    // returns a number (a real total order). The previous `a[field]?.toLower…`
    // short-circuited to `undefined` on null/undefined fields, which V8 treats
    // inconsistently and breaks the sort contract. `numeric: true` keeps
    // natural numeric-aware locale collation ("file2" < "file10").
    return String(a[field] ?? "")
      .toLowerCase()
      .localeCompare(String(b[field] ?? "").toLowerCase(), undefined, {
        numeric: true,
      });
  };


export const compareByFieldNumerical =
  (field: string, dir: boolean) =>
  (_a: Record<string, any>, _b: Record<string, any>) => {
    const a = dir ? _a : _b;
    const b = dir ? _b : _a;
    // `+value` is NaN for any non-numeric / missing field, and a NaN comparator
    // return breaks the sort contract (NaN is neither <, >, nor ===). Treat
    // non-finite values as a defined sentinel that sorts AFTER every real number
    // — the same discipline as sort.ts `numSort` (Notidian-5ym) — so the
    // ordering stays a strict weak ordering: NaN===NaN -> 0 (reflexive), and a
    // junk/empty cell consistently sinks below real numbers.
    const av = +a[field];
    const bv = +b[field];
    const aFinite = Number.isFinite(av);
    const bFinite = Number.isFinite(bv);
    if (aFinite && bFinite) return av - bv;
    if (aFinite) return -1; // a is a real number, b is junk -> a first
    if (bFinite) return 1; // b is a real number, a is junk -> b first
    return 0; // both non-finite -> equal (reflexive)
  };
