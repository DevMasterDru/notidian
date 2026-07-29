import { fileSystemSpaceInfoFromFolder } from "core/spaceManager/filesystemAdapter/spaceInfo"
import { SpaceManager } from "makemd-core"


import { PathState, SpaceState } from "shared/types/PathState"
import { SpaceDefinition } from "shared/types/spaceDef"
import { MakeMDSettings } from "../../shared/types/settings"



export const FMMetadataKeys = (settings: MakeMDSettings) => [settings.fmKeyBanner, settings.fmKeySticker, settings.fmKeyColor, settings.fmKeyBanner, settings.fmKeyBannerOffset,
  spaceContextsKey, spaceJoinsKey, spaceLinksKey, spaceSortKey, spaceTemplateKey, spaceTemplateNameKey, spaceFilenameTemplateKey
]
  export const createVaultSpace  = (manager: SpaceManager) : SpaceState => ({
    name: "Vault",
    path: "/",
    space: fileSystemSpaceInfoFromFolder(manager, "/"),
    type: "default",
  });



  


  

  export const vaultPath: PathState = {
    name: "Vault",
    readOnly: false,
    path: "/",
    label: {
      thumbnail: '',
      name: "Vault",
      sticker: "ui//vault",
      color: ''
    },
    type: "default",
  };



export type BuiltinSpace = {
  name: string;
  icon: string;
  readOnly: boolean;
  hidden: boolean;
}

export const builtinSpaces : Record<string, BuiltinSpace> = {
  tags: {
    name: "Tags",
    icon: "ui//tags",
    readOnly: false,
    hidden: false
  },
  overview: {
    name: "Overview",
    icon: "ui//overview",
    readOnly: true,
    hidden: true
  },
};

export const spaceContextsKey = "_contexts";
export const spaceTemplateKey = "_template";
export const spaceTemplateNameKey = "_templateName";
export const spaceJoinsKey = "_joins";
export const spaceLinksKey = "_links";
export const spaceSortKey = "_sort";
export const spaceRecursiveKey = "_subfolders";
export const spaceFilenameTemplateKey = "_filenameTemplate";

/**
 * Serialize a SpaceDefinition into the canonical definition-frontmatter object
 * that is written to disk (the `.space` def file).
 *
 * This is the single source of truth for WHICH SpaceDefinition fields are
 * durable. It exists as a pure function so the disk-write allowlist and the
 * read parser (`parseSpaceMetadata`) can be round-trip tested together — the
 * allowlist drifting out of sync with the parser is exactly how
 * `noteBodyCollapsed` was silently dropped from disk (Notidian-8sl). Any new
 * durable SpaceDefinition field MUST be added here AND to `parseSpaceMetadata`.
 */
export const spaceDefinitionFrontmatter = (
  metadata: SpaceDefinition
): Record<string, any> => ({
  [spaceJoinsKey]: metadata.joins,
  [spaceContextsKey]: metadata.contexts,
  [spaceLinksKey]: metadata.links,
  [spaceSortKey]: metadata.sort,
  [spaceTemplateKey]: metadata.template,
  [spaceTemplateNameKey]: metadata.templateName,
  defaultSticker: metadata.defaultSticker,
  defaultColor: metadata.defaultColor,
  readMode: metadata.readMode,
  fullWidth: metadata.fullWidth,
  noteBodyCollapsed: metadata.noteBodyCollapsed,
  noteBodyHeight: metadata.noteBodyHeight,
  activeHubTab: metadata.activeHubTab,
  [spaceFilenameTemplateKey]: metadata.filenameTemplate,
});

