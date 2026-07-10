# ADR 0046: Should the `insertIntoDB`/`updateDB` batched-statement seam (leading space + `;;  ` double-semicolon) be cleaned up?

## Status

Accepted.

Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

**Implemented** — Resolved to **Option C**: `Notidian-k778` / ADR 0045 was
accepted and shipped (commit `98fc4bc`), so the Option-B array+join cleanup was
folded onto that same SQL-builder pass, shipping in its own commit `496b663`
under the use-driven-realignment doctrine (`cb2d74c`); bd `Notidian-p5qt`
CLOSED. `insertIntoDB`/`updateDB` now build per-row statements via
`.flatMap(...).map(...)` joined by `serializeSQLStatements` ('; '), dropping the
reduce-seed leading space and the `;;  ` two-table seam. The ~11 pinned cosmetic
assertions in `db.sql-builders.test.ts` were deliberately re-blessed to the clean
shape; the real-engine net (`db.realengine.roundtrip.test.ts`) stays green.

Originally awaiting an owner decision. Tracked by bd `Notidian-p5qt` (a DESIGN-OPEN /
cosmetic-cleanup-typed bead characterized from `Notidian-xwc6` and grounded by
the real-engine net of `Notidian-0jtp`). This ADR was
written **instead of blindly editing `db.ts`**: the bead itself said "any fix
must be a deliberate flip of those assertions," and the then-current output
shape was **pinned as characterization** in `db.sql-builders.test.ts` (the
leading space on every single-table statement and the `;;  ` two-table seam).
The pinned assertions were **deliberately re-blessed** only by a reviewed
decision (same pattern as ADR 0025/0030/0032/0033/0043/0044/0045). That
decision has since been made: Option C shipped as noted above.

## Date

2026-06-16

## Context

### The seam, exactly

`insertIntoDB` (`src/adapters/mdb/db/db.ts:349-371`) and `updateDB`
(`db.ts:374-397`) build each table's `rowsQuery` with a **`reduce` seeded with
`""`** and a template that begins with `${prev} `:

```ts
// insertIntoDB, db.ts:357-363
const rowsQuery = tables[t].rows.reduce((prev, curr) => {
  return `${prev} ${replace ? "REPLACE" : "INSERT"} INTO ${quoteIdent(t)} VALUES (${...});`;
}, "");
return rowsQuery;
```

Two cosmetic artifacts fall out of this shape:

1. **Leading space on every statement.** On the first iteration `prev` is the
   empty seed `""`, so the template emits `"" + " " + "INSERT INTO ..."` — a
   single **leading space**. Every per-table `rowsQuery` therefore starts with
   a space: ` INSERT INTO "t" VALUES ('1', '2');` (pinned at
   `db.sql-builders.test.ts:198, 214, 232, 254, 276, 296, 316, 326, 339, 359`).

2. **`;;  ` double-semicolon + two-space seam between tables.** Each per-table
   `rowsQuery` already **ends in `;`**. Then the per-table strings are joined by
   `serializeSQLStatements` (`src/utils/serializers.ts:4`,
   `value.join('; ')`). So between two tables the bytes are: the first table's
   trailing `;`, then the join's `; `, then the second table's leading space —
   i.e. `;` + `; ` + ` ` = **`;;  `** (two semicolons, two spaces). Pinned at
   `db.sql-builders.test.ts:300-317`:

   ```ts
   expect(db.statements[0]).toBe(
     ` INSERT INTO "t1" VALUES ('1');;  INSERT INTO "t2" VALUES ('2');`
   );
   ```

`updateDB` has the identical seed-`""` + `${prev} ` reduce shape (`db.ts:383-389`)
and emits the same leading space and the same two-table seam.

### Why it is benign (the engine ground truth)

The seam is a **SQL no-op**, not a defect:

- The empty statement between two real statements (`...;;  INSERT...`) is parsed
  as an **empty statement**, which SQLite accepts and ignores. The real-engine
  round-trip net (`db.realengine.roundtrip.test.ts`, `Notidian-0jtp`, sql.js
  1.8.0) drives `insertIntoDB`/`updateDB`/`replaceDB` end-to-end through the real
  engine and proves data round-trips byte-for-byte and injection payloads do not
  break out — the seam never causes a parse error or a dropped row.
- Both table identifiers stay **quoted** (`quoteIdent`) and all values stay
  **single-quote-doubled** (`sanitizeSQLStatement`); the leading space and the
  extra `;` carry **no security or correctness impact**. This is pure
  whitespace/empty-statement cosmetics on an already-sanitized, already-quoted
  path.

So this is the lowest-stakes class of finding: a deliberate-looking-but-ugly
output string that a future reader could mistake for a bug, which is exactly why
`Notidian-xwc6` **pinned** it as characterization rather than leaving it
undocumented.

### Why it is a decision, not a blind one-liner

The bead is **DESIGN-OPEN** for two reasons:

1. **It flips pinned characterization.** The leading space and the `;;  ` seam
   are asserted **verbatim** in ~11 `db.sql-builders.test.ts` cases (every
   `insertIntoDB`/`updateDB` `toBe` carries the leading space; line 316 pins the
   `;;  ` seam exactly). Any cleanup must **deliberately re-bless** all of them —
   an owner-ratified posture, not a silent edit.

2. **There is real product-direction ambiguity about *when* to spend the
   review-debt.** A standalone cosmetic-only change spends an assertion-flip
   review on **zero functional value** (the output is already correct and
   benign). The neighbouring SQL-builder bead `Notidian-k778` / ADR 0045
   proposes a *behavior-shaped* `replaceDB` change (explicit column list) that
   **also** re-blesses pinned SQL-builder nets. If both land, doing them as **one
   coordinated SQL-builder pass + one assertion-flip review** is cheaper than two
   separate review rounds on the same file.

### Where this differs from `replaceDB` / ADR 0045 (important)

`replaceDB` (`db.ts:433-475`) does **not** have this seam: it builds rows with
`.map()` into a `string[]` and `push`es each statement individually
(`db.ts:451-462`), then execs them **one at a time** in a loop
(`db.ts:467-470`) — there is no seed-`""` reduce, no leading space, and no
`serializeSQLStatements` join, so no `;;  `. ADR 0045's open question is
**count/position alignment** (a correctness footgun), an *orthogonal* concern
from this **pure-cosmetic** seam. They share only the file and the
"flip-a-pinned-net" posture — which is precisely why "fold them together" (Option
C) is on the table as a review-economy move, not because they are the same fix.

## Decision drivers

- **Functional value of the change: zero.** The output is already correct,
  benign, and proven harmless against the real engine. The only thing a fix buys
  is a tidier emitted string (and arguably easier debugging of logged SQL).
- **Review-debt economy.** The cost of the change is dominated by the
  deliberate re-bless of ~11 pinned assertions — a reviewer's attention, not
  engineering effort. Spending that review on a zero-functional-value cosmetic in
  isolation is the weakest use of review-debt; folding it into a change that is
  *already* re-blessing SQL-builder nets amortizes it to near-free.
- **No new authority/render surface.** Pure SQL-string construction over a
  sanitized/quoted path; offline jest-provable, no eyes-on-vault or `innerHTML`
  surface.
- **"Don't mistake it for a bug" is already satisfied.** The pin at
  `db.sql-builders.test.ts:308-317` documents the seam in prose for any future
  reader; the cosmetic ugliness is already explained where it lives, so leaving
  it is not an undocumented trap.

## Options

### Option A — LEAVE AS-IS (benign no-op, zero risk, keep the pins)

Make no code change. Keep the leading space and the `;;  ` seam; the existing
characterization pins remain the canonical record that the shape is
**intentional-and-benign**.

- **Observable effect:** none. Emitted SQL unchanged; all pins stay green.
- **Pros:** zero code/test churn; zero review-debt; matches the pinned tests
  exactly; the seam is already proven harmless by the real-engine net and already
  explained in prose at the pin, so leaving it is **not** an undocumented trap.
  Honest that the change has no functional value.
- **Cons:** the emitted SQL stays cosmetically ugly (a stray leading space and a
  `;;  ` between batched tables), which is mildly worse to read in any logged or
  debugged SQL. A future reader who skips the pin's comment could still
  second-guess the `;;`.

### Option B — BUILD ROWS AS AN ARRAY AND `.join('; ')`, dropping the seed-space and the trailing-`;` double-up (standalone)

Replace the seed-`""` reduce in `insertIntoDB` and `updateDB` with an array
`.map()` joined by `'; '` (and drop the per-statement trailing `;` so the join
owns the separator, or keep `;` and join with a single space). Then deliberately
flip the ~11 pinned cosmetic assertions.

```ts
// insertIntoDB sketch
const rowsQuery = tables[t].rows.map((curr) =>
  `${replace ? "REPLACE" : "INSERT"} INTO ${quoteIdent(t)} VALUES (${...})`
).join('; ');
```

- **Observable effect:** ` INSERT INTO "t" VALUES ('1', '2');` becomes
  `INSERT INTO "t" VALUES ('1', '2')` (no leading space, separator owned by the
  join), and the two-table case becomes
  `INSERT INTO "t1" VALUES ('1'); INSERT INTO "t2" VALUES ('2')` — a clean single
  `; ` seam, no `;;  `.
- **Pros:** clean emitted SQL; removes both cosmetic artifacts at the source;
  uses the same array+join idiom `serializeSQLStatements` already expresses.
- **Cons (decisive against doing it *standalone*):** spends a deliberate
  re-bless of ~11 pinned assertions on **zero functional value** — the output was
  already correct and benign. It is review-debt churn for aesthetics alone. (The
  fix itself is small and safe; the objection is purely *when/whether to spend
  the review*, which is what makes A and C the live alternatives.)

### Option C (recommended *if* `Notidian-k778` is accepted) — FOLD THE CLEANUP INTO THE k778 SQL-BUILDER PASS

Do **not** do B standalone. If the owner accepts `Notidian-k778` / ADR 0045
(the `replaceDB` explicit-column-list change), apply the Option-B array+join
cleanup to `insertIntoDB`/`updateDB` **in the same SQL-builder refactor**, so the
SQL-builder file changes once and the pinned `db.sql-builders.test.ts` nets are
re-blessed in **one** reviewed pass covering both the k778 alignment flip and the
p5qt seam flip.

- **Observable effect:** same clean SQL as B for `insertIntoDB`/`updateDB`, plus
  the k778 `replaceDB` change — landed and reviewed together.
- **Pros:** amortizes the assertion-re-bless review across two changes to the
  same file; one coordinated SQL-builder pass + one assertion-flip review is
  **cheaper than two** separate rounds; the cosmetic gets cleaned up "for free"
  on the back of a change that was already touching and re-blessing the
  SQL-builder nets. Leaves the SQL-builder file in a uniformly tidy state.
- **Cons:** **coupled to k778's acceptance** — if the owner declines or defers
  k778, there is no carrier change to fold into, and C collapses back to either A
  (do nothing) or a standalone B. C is a *sequencing* recommendation, not an
  independent fix.

## Recommendation

**Option C if `Notidian-k778` (ADR 0045) is accepted; otherwise Option A.**
One line of why: the change has **zero functional value** (the seam is already
correct and proven benign), so its only real cost is the reviewer attention to
re-bless ~11 pinned assertions — fold that into k778's already-required
SQL-builder re-bless so it costs ~nothing (C), and if there is no k778 carrier,
**leave it** rather than spend an isolated assertion-flip review on aesthetics (A).

### Ruled out

- **Option B as a *standalone* change** — the fix is small and safe, but doing it
  on its own spends a deliberate re-bless of ~11 pinned cosmetic assertions on
  zero functional value; it is review-debt churn for aesthetics alone. Acceptable
  only if the owner specifically wants the tidy SQL *now* and there is no k778
  carrier to fold it into — in which case it is just C-without-the-carrier, the
  weakest economy of the three.
- **A default-OFF runtime flag / minimal spike** — adds nothing. The seam's
  harmlessness is **already empirically captured** against the real sql.js engine
  (`db.realengine.roundtrip.test.ts`, `Notidian-0jtp`): we know it is an
  empty-statement no-op that never breaks parse or drops a row. The change is
  pure, deterministic SQL-string construction over a sanitized/quoted path with
  **no render / `innerHTML` / eyes-on-vault surface**; its correctness is fully
  offline-provable by flipping the existing jest pins to assert the cleaned
  string. The open question is **whether/when to spend the review** (A/B/C), not a
  measurement a flag yields (same no-flag posture as ADR
  0025/0030/0032/0033/0043/0044/0045).
- **Also cleaning up the `replaceDB` `idxQuery` reduce seed-space in the same
  breath** — `replaceDB`'s `idxQuery` (`db.ts:445-449`) uses the same seed-`""` +
  `${p} ` reduce idiom and so carries a leading space, but `replaceDB` execs each
  pushed statement individually (no `serializeSQLStatements` join), so it has the
  leading-space cosmetic **without** the `;;  ` seam, and its pins differ. If the
  owner wants the seed-space idiom retired uniformly across all four builders,
  that is the natural extension of C — recorded here, not silently widened into
  this decision.

## Consequences

If the owner approves **C** (folded into k778), the implementing session — as
part of the ADR-0045 work — additionally:

1. rewrites `insertIntoDB` (`db.ts:357-363`) and `updateDB` (`db.ts:383-389`)
   to build per-table rows via `.map(...)` and `.join('; ')` (no seed-`""`, no
   `${prev} ` prefix, separator owned by the join);
2. **flips the leading-space pins** in `db.sql-builders.test.ts` (every
   `insertIntoDB`/`updateDB` `toBe` that currently begins with a space — lines
   ~198/214/232/254/276/296/316/326/339/359 — drops the leading space) with a
   comment citing this ADR + `Notidian-p5qt`;
3. **flips the `;;  ` two-table seam pin** (`db.sql-builders.test.ts:300-317`)
   to the clean single-`; ` seam, rewording the prose comment from "benign
   `;;  ` quirk, pinned" to "single clean `; ` separator";
4. confirms the rest of the builder nets (hostile-ident quoting, single-quote
   doubling, col/row alignment, empty/missing-value wrapping) stay green — only
   the leading whitespace and the inter-statement separator change;
5. confirms the real-engine net (`db.realengine.roundtrip.test.ts`) stays green
   unchanged (the cleaned SQL round-trips identically — the seam was already a
   no-op).

If the owner approves **A**, no change is made; this ADR plus the existing pins
stand as the record that the seam is intentional-and-benign.

The change (under C or standalone B) is pure, offline-provable SQL-string
construction exercised through both the fake-DB builder net and the real sql.js
engine net, so the gate is **jest** (`npm test`) + tsc + build green — **no
default-OFF flag, no eyes-on verification.** Until a pick, **no `db.ts` or
`db.sql-builders.test.ts` change is made** and the leading-space + `;;  ` pins
are **not** flipped.

This ADR applies to, and does not supersede, the authority/transaction model of
ADR 0001/0004/0006, and is the **cosmetic sibling** of ADR 0045 (which owns the
orthogonal `replaceDB` count/position-alignment correctness decision on the same
SQL-builder file).
