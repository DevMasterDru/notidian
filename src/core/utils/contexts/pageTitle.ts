export type PageTitleValidationReason =
  | "empty"
  | "slash"
  | "illegal-characters"
  | "reserved-name"
  | "trailing-dot-space"
  | "too-long";

export type PageTitleValidation =
  | { ok: true; title: string }
  | { ok: false; reason: PageTitleValidationReason };

export type PageTitleRename = {
  oldPath: string;
  newPath: string;
  title: string;
};

export const pageTitleFromPath = (path: string): string => {
  const fileName = path.split("/").pop() ?? path;
  const extensionIndex = fileName.lastIndexOf(".");
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
};

const illegalRe = /[\/\?<>\\:\*\|":]/;
const controlRe = /[\x00-\x1f\x80-\x9f]/;
const reservedRe = /^\.+$/;
const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const trailingDotSpaceRe = /[. ]$/;
const maxPageTitleLength = 255;

export const validatePageTitle = (title: string): PageTitleValidation => {
  const trimmed = title.trim();
  if (trimmed.length == 0) return { ok: false, reason: "empty" };
  if (trimmed.includes("/")) return { ok: false, reason: "slash" };
  if (illegalRe.test(trimmed) || controlRe.test(title)) {
    return { ok: false, reason: "illegal-characters" };
  }
  if (reservedRe.test(trimmed) || windowsReservedRe.test(trimmed)) {
    return { ok: false, reason: "reserved-name" };
  }
  // Check the trimmed value: trailing spaces are forgiven (trimmed away), but a
  // trailing dot (which trim does not remove and Windows disallows) is rejected.
  if (trailingDotSpaceRe.test(trimmed)) {
    return { ok: false, reason: "trailing-dot-space" };
  }
  if (trimmed.length > maxPageTitleLength) {
    return { ok: false, reason: "too-long" };
  }
  return { ok: true, title: trimmed };
};

export const buildPageTitleRename = (
  oldPath: string,
  title: string
): PageTitleRename => {
  const validation = validatePageTitle(title);
  if (validation.ok == false) throw new Error(validation.reason);

  const lastSlash = oldPath.lastIndexOf("/");
  const parent = lastSlash >= 0 ? oldPath.slice(0, lastSlash) : "";
  const fileName = lastSlash >= 0 ? oldPath.slice(lastSlash + 1) : oldPath;
  const extensionIndex = fileName.lastIndexOf(".");
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";
  const newPath = parent
    ? `${parent}/${validation.title}${extension}`
    : `${validation.title}${extension}`;

  return { oldPath, newPath, title: validation.title };
};
