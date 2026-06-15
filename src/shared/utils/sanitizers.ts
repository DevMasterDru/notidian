
export const sanitizeSQLStatement = (name: string) => {
  try {
    return name?.replace(/'/g, `''`)
  } catch(e) {
    return ''
  }
};

export const quoteIdent = (name: string): string => {
  return `"${(name ?? "").replace(/"/g, `""`)}"`;
};

// Data rule for stored column names: strip double quotes (kept out of persisted
// identifiers). SQL escaping of identifiers happens at construction time via
// quoteIdent, NOT here — escaping here would persist `""` into the name.
export const sanitizeColumnName = (name: string): string => {
  if (name?.charAt(0) == "_" || name?.charAt(0) == "$") {
    return sanitizeColumnName(name.substring(1));
  }
  return name?.replace(/"/g, ``);
};
export const sanitizeTableName = (name: string) => {
  return name?.replace(/[^a-z0-9+]+/gi, "");
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
// on re-save. Throws on null/undefined (no optional chaining) — locked contract.
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
  let current = name;
  do {
    prev = current;
    current = onePass(current);
  } while (current !== prev);
  return current;
};
export const sanitizeFileName = (name: string) => {
  const replacement = "";
  return name
    .replace(illegalRe, replacement)
    .replace(controlRe, replacement)
    .replace(reservedRe, replacement)
    .replace(windowsReservedRe, replacement);
};
