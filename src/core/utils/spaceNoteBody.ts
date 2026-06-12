// Body-emptiness check for the space note region (Notidian-7oj): the hub
// note's body decides whether the space view shows the note region at all.

export const stripFrontmatter = (content: string): string => {
  if (!content) return "";
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);
  return match ? content.slice(match[0].length) : content;
};

export const isNoteBodyEmpty = (
  content: string | null | undefined
): boolean => {
  if (content == null) return true;
  return stripFrontmatter(content).trim().length === 0;
};
