import type { FrontmatterWritePlan } from "./notidianSchema";

export type FrontmatterSchemaWriteResult =
  | { ok: true }
  | { ok: false; error?: unknown };

export type FrontmatterSchemaWriteFailure = {
  path: string;
  phase: "set" | "remove";
  key?: string;
  error?: unknown;
};

export type ApplyFrontmatterSchemaWritePlansResult = {
  ok: boolean;
  applied: number;
  failed: FrontmatterSchemaWriteFailure[];
};

export const applyFrontmatterSchemaWritePlans = async ({
  writes,
  saveProperties,
  deleteProperty,
}: {
  writes: FrontmatterWritePlan[];
  saveProperties: (
    path: string,
    properties: Record<string, unknown>
  ) => Promise<FrontmatterSchemaWriteResult>;
  deleteProperty: (
    path: string,
    key: string
  ) => Promise<FrontmatterSchemaWriteResult>;
}): Promise<ApplyFrontmatterSchemaWritePlansResult> => {
  let applied = 0;

  for (const write of writes) {
    if (Object.keys(write.set).length > 0) {
      const setResult = await saveProperties(write.path, write.set);
      if (setResult.ok === false) {
        return {
          ok: false,
          applied,
          failed: [
            {
              path: write.path,
              phase: "set",
              error: setResult.error,
            },
          ],
        };
      }
    }

    for (const key of write.removeKeys) {
      const removeResult = await deleteProperty(write.path, key);
      if (removeResult.ok === false) {
        return {
          ok: false,
          applied,
          failed: [
            {
              path: write.path,
              phase: "remove",
              key,
              error: removeResult.error,
            },
          ],
        };
      }
    }

    applied++;
  }

  return { ok: true, applied, failed: [] };
};
