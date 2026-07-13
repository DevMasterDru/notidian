import { FrameTreeProp } from "shared/types/mframe";

/**
 * Notidian-cd87: resolve a `node.types[key]` lookup where `key` may be
 * derived from a runtime PROPS VALUE rather than `Object.keys(node.types)`.
 *
 * FrameSlidesEditor computes `f = removeQuotes(selectedSlideParent.props?.value)`
 * and previously read `selectedNode.types[f]` directly. Unlike the sibling
 * lookups in ast.ts (propertiesForNode), FilterBar, and FrameNodeEditor —
 * which all iterate `Object.keys(node.types)`, so the key is always an OWN
 * key — a props-value-derived key can be an arbitrary string, including a
 * dunder name (`'__proto__'` / `'constructor'`). If `node.types` lacks an OWN
 * entry for that key, a bare bracket read resolves through the prototype
 * chain instead: `Object.prototype` (the `'__proto__'` getter) or the
 * `Object` constructor (inherited) — a truthy, NON-STRING value that would
 * otherwise flow straight into `selectedProperty.type`.
 *
 * This guard requires BOTH an own key AND a string value, so only a genuine
 * own string type can ever be returned; a missing key, an inherited key, or
 * a non-string value all resolve to `undefined`. Defense-in-depth sibling of
 * Notidian-jkxj (commit 65208c8d), which guards the same cross-object
 * inherited-key-coercion family in `generateCodeForProp`.
 */
export const ownStringNodeType = (
  types: FrameTreeProp | undefined,
  key: string
): string | undefined => {
  const rawType = Object.prototype.hasOwnProperty.call(types, key)
    ? types[key]
    : undefined;
  return typeof rawType === "string" ? rawType : undefined;
};
