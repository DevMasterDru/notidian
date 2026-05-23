export type PageTitleValidation =
  | { ok: true; title: string }
  | { ok: false; reason: string };

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

export const validatePageTitle = (title: string): PageTitleValidation => {
  const trimmed = title.trim();
  if (trimmed.length == 0) return { ok: false, reason: "empty" };
  if (trimmed.includes("/")) return { ok: false, reason: "slash" };
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
