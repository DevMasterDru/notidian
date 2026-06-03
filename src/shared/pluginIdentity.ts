export const pluginId = "notidian";
export const pluginDisplayName = "Notidian";
export const pluginRepositoryUrl = "https://github.com/DevMasterDru/notidian";
export const pluginStorageRoot = ".notidian";

const legacyPerFolderStorageRoot = [".", "space"].join("");
const legacyRootCacheStorageRoot = [".", "makemd"].join("");
const legacyStorageRoots = [
  legacyPerFolderStorageRoot,
  legacyRootCacheStorageRoot,
];

export const isLegacyStorageRoot = (value: unknown) =>
  legacyStorageRoots.includes(String(value ?? ""));

export const normalizePluginStoragePath = (value: string) => {
  const path = String(value ?? "");
  return path
    .split("/")
    .map((part) => (isLegacyStorageRoot(part) ? pluginStorageRoot : part))
    .join("/");
};

export const pluginDataDir = (configDir: string) =>
  `${configDir}/plugins/${pluginId}`;

export const pluginDataPath = (configDir: string, fileName: string) =>
  `${pluginDataDir(configDir)}/${fileName}`;
