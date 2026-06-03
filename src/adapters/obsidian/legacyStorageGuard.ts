import type MakeMDPlugin from "main";
import { around } from "monkey-around";
import { normalizePluginStoragePath } from "shared/pluginIdentity";

type VaultAdapterMethod = (...args: unknown[]) => unknown;

const normalizeVaultStorageArg = (value: unknown) =>
  typeof value == "string" ? normalizePluginStoragePath(value) : value;

const guardMethod =
  (old: VaultAdapterMethod, pathIndexes: number[]) =>
  function legacyStorageGuardedMethod(this: unknown, ...args: unknown[]) {
    const normalizedArgs = args.map((arg, index) =>
      pathIndexes.includes(index) ? normalizeVaultStorageArg(arg) : arg
    );
    return old.apply(this, normalizedArgs);
  };

export const installLegacyStorageRootGuard = (plugin: MakeMDPlugin) => {
  const adapter = plugin.app.vault.adapter as unknown as Record<
    string,
    VaultAdapterMethod
  >;

  const onePathArg = [0];
  const twoPathArgs = [0, 1];
  const uninstaller = around(adapter, {
    exists: (old) => guardMethod(old, onePathArg),
    stat: (old) => guardMethod(old, onePathArg),
    read: (old) => guardMethod(old, onePathArg),
    readBinary: (old) => guardMethod(old, onePathArg),
    write: (old) => guardMethod(old, onePathArg),
    writeBinary: (old) => guardMethod(old, onePathArg),
    mkdir: (old) => guardMethod(old, onePathArg),
    rmdir: (old) => guardMethod(old, onePathArg),
    remove: (old) => guardMethod(old, onePathArg),
    list: (old) => guardMethod(old, onePathArg),
    rename: (old) => guardMethod(old, twoPathArgs),
    copy: (old) => guardMethod(old, twoPathArgs),
  });

  plugin.register(uninstaller);
  (plugin as unknown as { legacyStorageRootGuardInstalled: boolean })
    .legacyStorageRootGuardInstalled = true;
};
