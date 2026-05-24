import { Superstate } from "makemd-core";

export type FrontmatterWriteResult =
  | { ok: true }
  | { ok: false; error?: unknown };

export const saveFrontmatterProperties = async ({
  superstate,
  path,
  properties,
  failureMessage = "Could not update file properties.",
}: {
  superstate: Superstate;
  path: string;
  properties: Record<string, unknown>;
  failureMessage?: string;
}): Promise<FrontmatterWriteResult> => {
  if (!path || Object.keys(properties).length === 0) return { ok: true };

  try {
    const saved = await superstate.spaceManager.saveProperties(
      path,
      properties
    );
    if (saved === true) return { ok: true };
    superstate.ui?.notify?.(failureMessage);
    return { ok: false };
  } catch (error) {
    superstate.ui?.notify?.(failureMessage);
    return { ok: false, error };
  }
};
