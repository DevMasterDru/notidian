
// UNIFIED NULLISH CONTRACT (Notidian-wtz, D2). All six sanitizers in this module
// coerce a nullish (null | undefined) input to the empty string `''` at entry,
// then run their normal cleansing. This replaces three divergent legacy
// behaviours that were characterization-locked by Notidian-709:
//   - quoteIdent was already null-safe (returned `'""'`, i.e. the `''` case);
//   - sanitizeSQLStatement / sanitizeColumnName / sanitizeTableName returned
//     `undefined` via optional chaining on nullish input;
//   - sanitizeFolderName / sanitizeFileName THREW (no optional chaining).
// `'' ` is the safest single contract for the two surfaces these feed: SQL
// construction (db.ts) and path/row-identity (file.ts, ADR 0014/0016) both want
// a well-defined empty string, never an exception and never a stray `undefined`
// that string-coerces to the literal text `"undefined"` in a path or SQL value.
// A nullish guard at the entry of each function is the chokepoint; downstream
// logic can then assume a real string. Audited call sites (db.ts:361/385/453
// `?? ""`, propertyNameValue.ts:29, ContextEditorContext.tsx:1212 `.trim()`,
// file.ts:75/59 template literals, tableCsvImport/InlineMenu/TitleComponent
// `.trim()`) do not branch on undefined-vs-'' nor rely on the throw, so the
// `''` contract is strictly compatible (and removes a latent throw on the path
// surface). If a future caller genuinely needs to distinguish nullish, it must
// do so BEFORE calling the sanitizer — that boundary stays out of this module.
export const sanitizeSQLStatement = (name: string) => {
  try {
    return (name ?? "").replace(/'/g, `''`);
  } catch (e) {
    return "";
  }
};

export const quoteIdent = (name: string): string => {
  return `"${(name ?? "").replace(/"/g, `""`)}"`;
};

// IDEMPOTENT data rule for stored column names (Notidian-80m). Two cleansing
// rules apply: (a) strip ALL double-quotes (kept out of persisted identifiers),
// and (b) strip a LEADING run of `_`/`$` sigils. These rules COUPLE: a leading
// double-quote masks a following sigil, so the order matters. The former code
// peeled the leading sigil FIRST and quote-stripped LAST (terminal branch), so a
// quote-masked sigil (`"$x`) survived ONE application (`"$x` -> `$x`) and was
// only peeled on a SECOND call — non-idempotent. We now strip ALL quotes FIRST
// (which can EXPOSE a previously-masked leading sigil), THEN peel the leading
// sigil run to a fixed point. Both passes are removal-only so the loop strictly
// shrinks and terminates. Idempotency matters because the persisted name feeds
// SQL identity (m_fields rows) and the alias decision in propertyNameValue.ts; a
// non-idempotent sanitizer could drift the stored name on re-save.
// SQL escaping of identifiers happens at construction time via quoteIdent, NOT
// here — escaping here would persist `""` into the name. Nullish input is
// coerced to `''` at entry (unified D2 contract, Notidian-wtz), so it returns
// the empty string rather than `undefined`.
export const sanitizeColumnName = (name: string): string => {
  let result = (name ?? "").replace(/"/g, ``);
  while (result.charAt(0) == "_" || result.charAt(0) == "$") {
    result = result.substring(1);
  }
  return result;
};
export const sanitizeTableName = (name: string) => {
  return (name ?? "").replace(/[^a-z0-9+]+/gi, "");
};
const folderReservedRe = /^[+\$#^]+/;
const illegalRe = /[\/\?<>\\:\*\|":]/g;
const controlRe = /[\x00-\x1f\x80-\x9f]/g;
const reservedRe = /^\.+$/;
const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

// IDEMPOTENT folder-name cleansing (Notidian-hsd). The five strips are mutually
// coupling: removing an illegal/control char can EXPOSE a new leading sigil that
// folderReservedRe already passed, AND stripping a leading sigil can expose a
// now-leading Windows device name / pure-dot run that the anchored
// windowsReservedRe / reservedRe already passed. A single linear pass in ANY
// order therefore cannot reach a fixed point, so we run the pipeline to a fixed
// point. Each pass is removal-only (never lengthens), so the loop strictly
// shrinks until stable and terminates in O(name.length) passes (≤3 observed
// across a 200k-input fuzz). Idempotency matters because the path/basename owns
// row identity (ADR 0014/0016): a non-idempotent sanitizer could drift identity
// on re-save. Nullish input is coerced to `''` at entry (unified D2 contract,
// Notidian-wtz) — it no longer throws, returning the empty string instead.
export const sanitizeFolderName = (name: string) => {
  const replacement = "";
  const onePass = (input: string) =>
    input
      .replace(illegalRe, replacement)
      .replace(controlRe, replacement)
      .replace(reservedRe, replacement)
      .replace(windowsReservedRe, replacement)
      .replace(folderReservedRe, replacement);
  let prev: string;
  let current = name ?? "";
  do {
    prev = current;
    current = onePass(current);
  } while (current !== prev);
  return current;
};
export const sanitizeFileName = (name: string) => {
  const replacement = "";
  return (name ?? "")
    .replace(illegalRe, replacement)
    .replace(controlRe, replacement)
    .replace(reservedRe, replacement)
    .replace(windowsReservedRe, replacement);
};
