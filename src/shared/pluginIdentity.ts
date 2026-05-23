export const pluginId = "notidian";
export const legacyPluginId = "make-md";
export const pluginDisplayName = "Notidian";
export const pluginRepositoryUrl = "https://github.com/DevMasterDru/notidian";

export const pluginDataDir = (configDir: string) =>
  `${configDir}/plugins/${pluginId}`;

export const legacyPluginDataDir = (configDir: string) =>
  `${configDir}/plugins/${legacyPluginId}`;

export const pluginDataPath = (configDir: string, fileName: string) =>
  `${pluginDataDir(configDir)}/${fileName}`;

export const legacyPluginDataPath = (configDir: string, fileName: string) =>
  `${legacyPluginDataDir(configDir)}/${fileName}`;
