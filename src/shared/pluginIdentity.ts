export const pluginId = "notidian";
export const pluginDisplayName = "Notidian";
export const pluginRepositoryUrl = "https://github.com/DevMasterDru/notidian";

export const pluginDataDir = (configDir: string) =>
  `${configDir}/plugins/${pluginId}`;

export const pluginDataPath = (configDir: string, fileName: string) =>
  `${pluginDataDir(configDir)}/${fileName}`;
