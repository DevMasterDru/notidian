// ADR 0030 (Option A): escape EVERY comma per element (global /,/g), not just the
// first. The string-pattern `.replace(',', ...)` only touched the first occurrence,
// fracturing any multi-comma element on round-trip. Paired with the global, after-split
// un-escape in parseMultiDisplayString (parsers.ts), this makes the human-readable
// comma-joined display form round-trip losslessly for all values; comma-free values
// are byte-identical to the old output (the common case).
export const serializeMultiDisplayString = (value: string[]) => value.map(f => f.replace(/,/g, '\\,')).join(', ');
export const serializeMultiString = (value: string[]) => JSON.stringify(value)
export const serializeSQLValues = (value: string[]) => value.join(', ');
export const serializeSQLStatements = (value: string[]) => value.join('; ');
export const serializeSQLFieldNames = (value: string[]) => value.join(',');

