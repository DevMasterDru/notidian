# ADR 0047: `db.exec(string)` cannot transport a NUL (0x00) in a value — bind-param API vs NUL-stripping vs accept+document

## Status

Accepted. Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

**Implemented** — resolved by implementing the **recommended Option B** (NUL
strip in `sanitizeSQLStatement`) as the interim fix, shipped in `da0d41b` under
the use-driven-realignment doctrine (`cb2d74c`); bd `Notidian-dgo6` CLOSED.
Option A (parameter-bound writes) is recorded as the eventual byte-faithful fix
(roadmap / `bd remember`). The original Proposed body is kept below as the
decision record.

Originally tracked by bd `Notidian-dgo6` (DESIGN-OPEN,
characterized — not fixed — by the real-engine net of `Notidian-0jtp`). This ADR was
written **instead of blindly building a fix**: the bead itself said "Decision,
not a blind fix" and offered three structurally different directions (a
cross-cutting API seam change, a lossy-but-explicit sanitizer tweak, or
accept+document), and the then-current failure mode was **pinned as characterization**
in `db.realengine.roundtrip.test.ts:500-528` (sql.js 1.8.0). That decision has
since been made: Option B shipped as the interim fix, as noted above.

## Date

2026-06-16

## Context

### The limitation, exactly

`sql.js` `db.exec(sql: string)` (and `db.run(sql: string)`) hand the SQL **text**
to the WASM C engine as a **C string**, which is NUL-terminated. An embedded NUL
(`0x00`) in that text therefore **terminates the string at the engine boundary**:
the SQL is silently truncated at the first NUL. The four string-building builders
in `src/adapters/mdb/db/db.ts` interpolate each row value into the SQL text
itself —

```ts
// db.ts:361  insertIntoDB
.map((c) => `'${sanitizeSQLStatement(curr?.[c]) ?? ""}'`)
// db.ts:385  updateDB
.map((c) => `${quoteIdent(c)}='${sanitizeSQLStatement(curr?.[c]) ?? ""}'`)
// db.ts:453  replaceDB
.map((c) => `'${sanitizeSQLStatement(curr?.[c] ?? "")}'`)
```

— so a value containing `0x00` becomes part of the SQL **text**, and the engine
cuts the statement there. `'a\x00b'` is delivered as `'a` (an unterminated string
literal), the statement fails to parse, and the engine throws.

### What the real-engine net proves (the ground truth)

`db.realengine.roundtrip.test.ts` drives the builders against the **real** pinned
sql.js 1.8.0 WASM and pins this as a **hard limitation**, not a `db.ts` defect:

- `:501-510` — **DIRECT** `db.exec(`INSERT INTO "t" VALUES ('a\x00b');`)`
  **throws** a parse error (the literal is cut to `'a` at the NUL).
- `:512-527` — **VIA `replaceDB`** the throw is **swallowed** by `replaceDB`'s
  `try/catch` (`db.ts:467-473`), which returns **`false`**; `selectDB` then yields
  an empty table — the failed `REPLACE` inside the transaction stored nothing.

The net's own header (`:487-498`) is explicit that this is an **engine/transport
limitation, NOT a `db.ts` escaping defect** — "`quoteIdent`/`sanitizeSQLStatement`
have no NUL-safe representation in a `db.exec(string)` API" — and that a future
move to a **parameter-bound API** would "flip this pin deliberately."

### Why it is NOT a `quoteIdent`/`sanitizeSQLStatement` defect

This must not be confused with the injection / escaping family (ADR
0030/0043/0045) or the cosmetic seam (ADR 0046). The escaping layer is
**correct**: `sanitizeSQLStatement` single-quote-doubles, `quoteIdent`
double-quote-doubles, and the same net proves (`:94-174`) that **every other**
byte — single quotes, double quotes, semicolons, comment markers, unicode/astral,
**and the entire C0 control range `0x01`-`0x1f` *except* NUL** (`:126-147`) —
round-trips **byte-for-byte** through the real engine. NUL is singular: there is
**no escape sequence** that survives a C-string transport. So this is not "escape
NUL better"; it is "NUL cannot ride in the SQL text at all."

### Why it is a decision, not a blind one-liner

1. **The three options differ in kind, not degree.** (a) is a **cross-cutting API
   seam change** touching how *every* row-value write is transported (and flips a
   pinned net); (b) is a **lossy** data-altering edit to a shared sanitizer on the
   hot path; (c) is **no change**. Picking among "change the architecture", "lose
   data deliberately", and "do nothing" is an owner call about product direction
   and acceptable data-fidelity, not a mechanical fix.
2. **It flips pinned characterization either way (a/b).** The two pins at
   `:501-527` lock the current truncate-and-throw / swallow-and-return-`false`
   behavior. (a) makes a NUL-bearing row **round-trip**; (b) makes it **store a
   NUL-stripped value** and succeed. Both must **deliberately re-bless** those
   pins (same posture as ADR 0025/0030/0033/0043/0045/0046).
3. **Latent today.** Row values come from **frontmatter / markdown** (file-canonical
   per ADR 0001/0014/0017), where a literal NUL is **rare** — a NUL in a YAML
   value or note body is itself an upstream anomaly (and one ADR 0039 /
   `Notidian-jlb5` separately proposes guarding *at source*). So this is insurance
   against a malformed/pasted value, not a fix for an everyday break.

### What the engine actually offers (grounds option a)

The pinned `sql-wasm.js` 1.8.0 already exposes the **parameter-bound API**:
`Database.prototype.prepare` (`sql-wasm.js:514`), `Database.prototype.run(sql,
params)` (`:458`), and `Statement.prototype.bind` (`:256`). A bound parameter is
transported as a **typed value over the WASM ABI**, *not* spliced into the SQL
text — so a NUL in a value is carried intact (SQLite `TEXT` stores embedded NULs
fine; only the *C-string SQL transport* cannot). Option (a) is therefore
**genuinely available** in the engine the plugin already loads — it is a code
seam cost, not an engine capability gap.

## Decision drivers

- **Data fidelity vs. silent loss.** Today a single NUL-bearing value makes
  `replaceDB` return `false` and **lose the whole table's rows for that save**
  (the entire transaction is rolled back) — the worst outcome: a *whole-table*
  loss from *one* anomalous byte, swallowed silently. Any change must at least
  stop the whole-table loss.
- **Blast radius / review cost.** (a) touches every string-building builder and
  the way values are transported (large, principled); (b) is a few characters in
  one shared sanitizer (smallest, lossy); (c) is zero.
- **Correctness of the eventual model.** Only (a) is *byte-faithful* — it is the
  architecturally correct answer; (b) deliberately mutates data; (c) leaves the
  footgun.
- **Likelihood.** A literal NUL in a frontmatter/markdown-sourced value is rare,
  so the *expected* benefit of the large change (a) is low **today** — which is
  exactly why an interim (b) that removes the whole-table-loss cheaply, with (a)
  recorded as the eventual correct fix, is attractive.
- **No new authority/render surface.** All three options are pure
  SQL-construction / transport over an already-sanitized, file-canonical write
  path; offline jest-provable against the real engine, **no eyes-on-vault or
  `innerHTML` surface**.

## Options

### Option A — move row-value writes to the parameter-bound API (`db.prepare` + `bind` / `db.run(sql, params)`)

Rewrite the VALUES/SET interpolation in `insertIntoDB`, `updateDB`, and
`replaceDB` to emit **placeholders** (`?` / `:name`) and pass the row values as a
**bound params array/object**, so values are transported as typed parameters, not
spliced into SQL text. Identifiers (table/column names) stay built with
`quoteIdent` — they cannot be parameterized — but every *value* rides a bind.

- **Observable effect:** a NUL-bearing value **round-trips byte-for-byte**; the
  `:512-527` pin flips from "returns `false`, stores nothing" to "returns `true`,
  stores `'a\x00b'`". All other round-trips and injection-breakout properties stay
  green (bind is *more* injection-safe than escaping, not less).
- **Pros:** the **principled, byte-faithful** fix — correct by construction for
  NUL **and** every other byte; eliminates the whole-class "value in SQL text"
  concern; reduces (does not just relocate) the escaping surface; the engine
  already supports it (no dependency bump). This is the **eventual correct
  direction** regardless of the interim pick.
- **Cons (decisive against doing it *now/standalone*):** a **larger seam change**
  across all string-building builders — it reshapes how rows are written (per-row
  `prepare`/`bind`/`step`/`free` or a batched `run` with params), interacts with
  the `REPLACE`/`BEGIN…COMMIT` transaction shape in `replaceDB`, and must re-bless
  the pinned net **and** re-verify the full real-engine round-trip + injection
  suite. High review/engineering cost for a defect that is **latent** (rare NUL).
  Worth doing as a deliberate, scoped refactor — not a drive-by.

### Option B (recommended as the interim) — strip/replace NUL in `sanitizeSQLStatement`

Add a single NUL strip to `sanitizeSQLStatement` (the chokepoint **all** value
writes already pass through), e.g.:

```ts
export const sanitizeSQLStatement = (name: string) => {
  try {
    return (name ?? "").replace(/\x00/g, "").replace(/'/g, `''`);
  } catch (e) {
    return "";
  }
};
```

NUL is the **only** byte that breaks the string transport (the net proves
`0x01`-`0x1f` survive intact), so stripping **just** NUL is the minimal,
targeted intervention — it does not touch the legitimately-round-tripping control
bytes.

- **Observable effect:** a NUL-bearing value now **succeeds**, storing the value
  with the NUL(s) removed (`'a\x00b'` -> `'ab'`); `replaceDB` returns `true` and
  **the rest of the table's rows are saved** instead of the whole save being lost.
  The `:512-527` pin flips from "returns `false`, stores nothing" to "returns
  `true`, stores the NUL-stripped value".
- **Pros:** **smallest blast radius** — a few characters in one shared sanitizer,
  one chokepoint, one pin to re-bless; immediately removes the **whole-table
  silent-loss** footgun (the actual harm) at near-zero cost; pairs naturally with
  the existing control-byte-source-guard direction (ADR 0039 / `Notidian-jlb5`),
  which prefers a NUL never reach a tracked value in the first place. Honest and
  explicit about the trade-off.
- **Cons:** it is **lossy** — a value that genuinely contained a NUL silently
  loses that byte (acceptable for frontmatter/markdown text, where a literal NUL
  is an anomaly, but it *is* data alteration). It is therefore an **interim**, not
  the correct end state — which is why the recommendation pairs it with a
  `bd remember` note that **(A) is the eventual correct fix**.

### Option C — accept + document (no change)

Leave the builders as-is; the `:500-528` pins remain the canonical record that a
NUL-bearing value truncates-and-throws and `replaceDB` returns `false`. Document
the limitation (this ADR) and rely on NUL being rare in frontmatter/markdown.

- **Observable effect:** none. A NUL-bearing value continues to make the whole
  save return `false` and store nothing for that table.
- **Pros:** zero code/test churn; zero review-debt; the limitation is already
  pinned and now explained; honest that the case is rare.
- **Cons (decisive):** leaves a **whole-table silent-loss** footgun in place — one
  anomalous byte in one value rolls back **every** row of that table's save, with
  the failure **swallowed** (returns `false`, no user signal). That a *single*
  malformed value can silently discard an entire table's save is a worse failure
  than the lossy strip, for a fix (B) that costs almost nothing. Rejected as the
  resting state.

## Recommendation

**Option B (strip NUL in `sanitizeSQLStatement`) as the interim, with a
`bd remember` note that Option A (parameter-bound API) is the eventual correct
fix.** One line of why: B removes the actual harm — a single NUL silently losing
the **whole table's** save — at the **smallest possible blast radius** (a
NUL-only strip at the one chokepoint every value write already passes through,
one pin to re-bless), while A, the byte-faithful and architecturally correct
answer, is a **cross-cutting seam change** whose cost is not justified *today* for
a **latent** (rare-NUL) case; recording A as the eventual fix keeps the interim
honest. C is rejected because doing nothing leaves a whole-table silent-loss
footgun for a fix that costs almost nothing.

### Ruled out

- **Option A as the *immediate / standalone* fix** — it is the *correct eventual*
  direction and the recommendation explicitly preserves it as such, but doing the
  full bind-param seam change now spends a large refactor + re-bless of the
  real-engine net + transaction-shape rework on a **latent** defect. Sequence it
  as a deliberate, scoped SQL-builder refactor (it could naturally fold in the ADR
  0045 / `Notidian-k778` column-alignment work and the ADR 0046 / `Notidian-p5qt`
  seam cleanup — all three touch the same builders), not as a drive-by.
- **Option C as the resting state** — accept+document leaves a *single* anomalous
  byte able to silently roll back an entire table's save (returns `false`, no
  signal), strictly worse than the near-free B for the rare case it guards.
- **A default-OFF runtime flag / minimal spike** — adds nothing. The behavior is
  **already empirically captured** against the real sql.js engine
  (`db.realengine.roundtrip.test.ts:500-528`): we know exactly what NUL does
  (truncate+throw / swallow+`false`) and exactly what B and A would change. All
  three options are pure, deterministic SQL-construction / transport over an
  already-sanitized, file-canonical write path with **no render / `innerHTML` /
  authority / eyes-on-vault surface**; correctness is fully offline-provable by
  flipping the existing jest pins and re-running the real-engine round-trip +
  injection suite (same no-flag posture as ADR 0042/0043/0045/0046).
- **Treating this as a `quoteIdent` / `sanitizeSQLStatement` *escaping* fix** —
  it is not. The escaping layer is correct (proven byte-for-byte for every byte
  but NUL, `:94-174`); there is **no NUL-safe escape** for a C-string transport.
  Conflating it with the injection/escaping family (ADR 0030/0043/0045) or the
  cosmetic seam (ADR 0046) would mis-frame the fix.
- **A dependency bump / engine swap** — unnecessary: the pinned sql.js 1.8.0
  already exposes `prepare`/`run(sql, params)`/`bind` (`sql-wasm.js:256/458/514`),
  so Option A needs **no** new engine capability.

## Consequences

If the owner approves **B**, the implementing session: adds the `.replace(/\x00/g,
"")` NUL strip to `sanitizeSQLStatement` (`src/shared/utils/sanitizers.ts:22-28`)
**before** the single-quote doubling, with a comment citing this ADR +
`Notidian-dgo6`; **flips the `:512-527` real-engine pin** from "returns `false`,
stores nothing" to "returns `true`, stores the NUL-stripped value" (and the
`:126-147` C0-range comment is updated to note that NUL is now *stripped* at the
sanitizer rather than reaching the transport); confirms the rest of the
round-trip + injection-breakout + control-byte (`0x01`-`0x1f`) suite stays green
(only the NUL case changes); and records a `bd remember` that **Option A
(parameter-bound writes) is the eventual byte-faithful fix** and this strip is the
interim. The DIRECT-exec pin (`:501-510`, raw `db.exec` of a NUL-bearing literal)
stays unchanged — it characterizes the *engine*, which B does not alter.

If the owner approves **A**, the implementing session rewrites the value
interpolation in `insertIntoDB`/`updateDB`/`replaceDB` to placeholders + bound
params (`db.run(sql, params)` or per-row `prepare`/`bind`/`step`/`free`),
preserving `quoteIdent` for identifiers and the `REPLACE`/transaction semantics;
flips **both** `replaceDB` NUL pins (`:512-527` to byte-for-byte round-trip) and
re-verifies the full real-engine round-trip + injection-breakout suite green; this
is best sequenced as one deliberate SQL-builder refactor (optionally folding in
ADR 0045 / 0046, which touch the same builders).

If the owner approves **C**, no code change is made; this ADR plus the existing
`:500-528` pins stand as the record that the NUL transport limitation is known,
explained, and accepted.

The change (under B or A) is pure, offline-provable SQL-construction / transport
exercised through the real sql.js engine net, so the gate is **jest** (`npm test`)
+ tsc + build green — **no default-OFF flag, no eyes-on verification.** Until a
pick, **no `db.ts` or `sanitizers.ts` change is made** and the
`db.realengine.roundtrip.test.ts:500-528` NUL pins are **not** flipped.

This ADR applies to, and does not supersede, the authority/transaction model of
ADR 0001/0004/0006. It is the **transport sibling** of the SQL-builder decisions
on the same file — ADR 0045 (`replaceDB` count/position alignment) and ADR 0046
(the cosmetic statement seam) — and pairs with ADR 0039 / `Notidian-jlb5`
(guarding a raw NUL at *source* so it never reaches a value): if both land, ADR
0039 keeps a NUL out of tracked source and ADR 0047(B) is the defence-in-depth
strip at the write chokepoint.
