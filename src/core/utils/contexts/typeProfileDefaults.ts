import {
  newRowFrontmatterFromProfile,
  parseTypeProfile,
} from "core/utils/contexts/typeProfile";
import { saveFrontmatterProperties } from "core/utils/properties/frontmatterWrite";
import { Superstate } from "makemd-core";

// Seed a newly-created row's frontmatter with its database's Type Profile value
// defaults (Notidian-drv). No-op unless the space's hub note declares a profile
// and has at least one field default. Never seeds the hub note itself. Failures
// notify and never throw — a missing default must not block row creation.
//
// Wired into the empty-create paths: newPathInSpace (the + menu chokepoint),
// the ContextCreateItemModal create flow, and NoteView force-create. Two paths
// deliberately do NOT seed:
//   - newTemplateInSpace (a configured body template): the template IS the
//     authored new-row scaffold; layering schema defaults could overwrite the
//     user's intentional template values. The template wins.
//   - basics UINote force-create (src/basics, off-core fork debt per
//     Notidian-409): different enactor API; left until the fork-debt decision.
// Every wired path creates an empty file first, so defaults never overwrite
// existing frontmatter.
export const applyNewRowTypeProfileDefaults = async (
  superstate: Superstate,
  contextPath: string,
  filePath: string
): Promise<void> => {
  const notePath = superstate.spacesIndex.get(contextPath)?.space?.notePath;
  if (!notePath || notePath == filePath) return;
  const frontmatter = superstate.pathsIndex.get(notePath)?.metadata?.property;
  const profile = parseTypeProfile(frontmatter);
  if (!profile) return;
  const defaults = newRowFrontmatterFromProfile(profile);
  if (Object.keys(defaults).length == 0) return;
  await saveFrontmatterProperties({
    superstate,
    path: filePath,
    properties: defaults,
    failureMessage: "Could not apply database defaults to the new row.",
  });
};
