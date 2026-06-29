/**
 * FilenameEnforcer (Notidian-pay5.1.2 / ADR 0054).
 *
 * Watches for frontmatter changes in template-configured databases and
 * auto-renames files when the computed name diverges from the actual filename.
 * Ships behind the `filenameTemplateEnforcement` kill-switch (default ON).
 */

import { Superstate } from "makemd-core";
import {
  evaluateFilenameTemplate,
  parseFilenameTemplate,
  resolveCollision,
  TemplateSegment,
} from "./filenameTemplate";
import { pageTitleFromPath } from "./pageTitle";

export class FilenameEnforcer {
  private superstate: Superstate;
  /** Reentrancy guard: paths currently being renamed (TTL-cleared). */
  private renaming = new Set<string>();
  private queue: Array<() => Promise<void>> = [];
  private processing = false;

  constructor(superstate: Superstate) {
    this.superstate = superstate;
  }

  /**
   * Called on every metadata change. Checks whether the file belongs to a
   * template-configured database and renames it if the computed name diverges.
   */
  async onMetadataChange(path: string): Promise<void> {
    // 1. Kill-switch
    if (!this.superstate.settings.filenameTemplateEnforcement) return;

    // 2. Reentrancy guard
    if (this.renaming.has(path)) return;

    // 3. Find the database template
    const pathEntry = this.superstate.pathsIndex.get(path);
    if (!pathEntry?.spaces) return;

    let templateString: string | undefined;
    for (const spacePath of pathEntry.spaces) {
      const spaceEntry = this.superstate.spacesIndex.get(spacePath);
      const tmpl = spaceEntry?.metadata?.filenameTemplate;
      if (tmpl) {
        templateString = tmpl;
        break;
      }
    }

    if (!templateString) return;

    // 4. Parse the template
    let segments: TemplateSegment[];
    try {
      segments = parseFilenameTemplate(templateString);
    } catch (e) {
      console.warn(
        `[Notidian] FilenameEnforcer: malformed template for '${path}':`,
        e
      );
      return;
    }

    // 5. Get current frontmatter
    const frontmatter: Record<string, any> =
      pathEntry.metadata?.property ?? {};

    // 6. Evaluate
    let expectedName: string;
    try {
      expectedName = evaluateFilenameTemplate(segments, frontmatter);
    } catch (e) {
      console.warn(
        `[Notidian] FilenameEnforcer: template evaluation failed for '${path}':`,
        e
      );
      return;
    }

    // 7. Compare to current basename
    const currentBasename = pageTitleFromPath(path);
    if (currentBasename === expectedName) return;

    // 8. Resolve collision
    const parentDir = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "";
    const existingNames = new Set<string>();
    for (const [p] of this.superstate.pathsIndex) {
      if (p === path) continue; // skip the file being renamed
      const pParent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
      if (pParent === parentDir) {
        existingNames.add(pageTitleFromPath(p));
      }
    }

    let resolvedName: string;
    try {
      resolvedName = resolveCollision(expectedName, existingNames);
    } catch (e) {
      console.warn(
        `[Notidian] FilenameEnforcer: collision resolution failed for '${path}':`,
        e
      );
      return;
    }

    if (resolvedName !== expectedName) {
      this.superstate.ui.notify(
        `Filename template collision: ${expectedName}.md already exists, using ${resolvedName}.md`,
        "notice"
      );
    }

    // 9. Queue the rename
    const newPath = parentDir
      ? `${parentDir}/${resolvedName}.md`
      : `${resolvedName}.md`;

    this.queue.push(() => this.executeRename(path, newPath));
    this.drainQueue();
  }

  /** Sequential drain to avoid filesystem races. */
  private async drainQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const op = this.queue.shift()!;
        await op();
      }
    } finally {
      this.processing = false;
    }
  }

  /** Execute a single rename with reentrancy guard. */
  private async executeRename(
    oldPath: string,
    newPath: string
  ): Promise<void> {
    // Guard both old and new paths
    this.renaming.add(oldPath);
    this.renaming.add(newPath);

    try {
      await this.superstate.spaceManager.renamePath(oldPath, newPath);
    } catch (e) {
      console.warn(
        `[Notidian] FilenameEnforcer: rename failed ${oldPath} -> ${newPath}:`,
        e
      );
    }

    // Clear guards after events settle
    setTimeout(() => {
      this.renaming.delete(oldPath);
      this.renaming.delete(newPath);
    }, 2000);
  }
}
