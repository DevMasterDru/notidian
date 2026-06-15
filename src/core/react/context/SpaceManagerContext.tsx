import { APISpaceManager } from "core/superstate/api";
import {
  linkContextRow,
  propertyDependencies,
} from "core/utils/contexts/linkContextRow";
import { formulas } from "core/utils/formula/formulas";
import { Superstate } from "makemd-core";
import * as math from "mathjs";
import { all } from "mathjs";
import React, { createContext, useCallback, useContext, useMemo } from "react";
import { IAPI } from "shared/types/api";
import { PathCache } from "shared/types/caches";
import { IndexMap } from "shared/types/indexMap";
import {
  SpaceProperty,
  SpaceTable,
  SpaceTables,
  SpaceTableSchema,
} from "shared/types/mdb";
import { FrameSchema, MDBFrame, MDBFrames } from "shared/types/mframe";
import { URI } from "shared/types/path";
import { PathState } from "shared/types/PathState";
import { MakeMDSettings } from "shared/types/settings";
import { SpaceDefinition } from "shared/types/spaceDef";
import { SpaceInfo } from "shared/types/spaceInfo";
import { SpaceManagerInterface } from "shared/types/spaceManager";
import { ContextState } from "shared/types/superstate";

/**
 * Inert MKit-preview context (bd Notidian-bnb / ADR 0018).
 *
 * Background: the MKit *installer* (MKitFileViewer) was the only thing that ever
 * mounted a real MKitProvider, and it was removed in Notidian-ala. With no
 * provider mounted, the old `useMKitPreviewContext()` (a `useContext` read of
 * MKitContext) returned the `createContext` default on every core render — an
 * object whose `isPreviewMode` is `false` and whose helpers are no-ops, so every
 * `mkitContext?.isPreviewMode && …` branch in SpaceManagerProvider was already
 * dead at runtime.
 *
 * This const reproduces that exact runtime default *locally*, which lets us
 * delete MKitContext.tsx + MKitSpaceManagerProvider (breaking a circular import:
 * SpaceManagerContext imported useMKitPreviewContext; MKitContext imported
 * MKitSpaceManagerProvider) WITHOUT changing what the core provider observes.
 * The public SpaceManager context value still carries `isPreviewMode`/
 * `isMKitPath`/`convertMKitPath` (external consumers — SpaceContext, PathCrumb,
 * SpaceFragmentView — read `spaceManager.isPreviewMode`), all evaluating to the
 * same inert values as before.
 */
// The subset of the old ProcessedSpaceData that the (now-dead) mkit branches in
// SpaceManagerProvider read off a space lookup. Reproduced locally so the dead
// branches keep their ORIGINAL element typing (e.g. frameSchemas: FrameSchema[],
// contextTables: SpaceTables) instead of degrading to `any` after MKitContext.tsx
// was deleted — preserving the file's type-check surface exactly.
interface InertProcessedSpaceData {
  contextTables: SpaceTables;
  frameData: MDBFrames;
  frameSchemas?: FrameSchema[];
  contextSchemas?: SpaceTableSchema[];
  pathState: PathState;
}

interface InertMKitPreviewContext {
  isPreviewMode: boolean;
  rootPath: string;
  getContextsIndexMap: () => Map<string, ContextState>;
  getPathsIndexMap: () => Map<string, PathState>;
  getPathState: (path: string) => PathState | null;
  resolvePath: (path: string, source?: string) => string;
  getSpaceByFullPath: (path: string) => InertProcessedSpaceData | undefined;
  getSpaceByRelativePath: (path: string) => InertProcessedSpaceData | undefined;
}

const INERT_MKIT_PREVIEW_CONTEXT: InertMKitPreviewContext = {
  // isPreviewMode is the dead-branch guard; it is always false (no provider is
  // ever mounted), but its STATIC type stays `boolean` so the mkit branches
  // remain type-checked as reachable code rather than being narrowed away.
  isPreviewMode: false,
  rootPath: "",
  getContextsIndexMap: () => new Map<string, ContextState>(),
  getPathsIndexMap: () => new Map<string, PathState>(),
  getPathState: () => null,
  resolvePath: (path: string) => path,
  getSpaceByFullPath: () => undefined,
  getSpaceByRelativePath: () => undefined,
};

/**
 * Enhanced SpaceManager interface that handles both regular and MKit operations
 */
interface SpaceManagerContextType extends APISpaceManager {
  // Core data operations (MKit-aware)
  readTable(path: string, schema: string): Promise<SpaceTable | null>;
  saveTable(path: string, table: SpaceTable, force?: boolean): Promise<boolean>;
  readFrame(path: string, schema: string): Promise<MDBFrame | null>;
  saveFrame(path: string, frame: MDBFrame): Promise<void>;

  // Schema operations (MKit-aware)
  tablesForSpace(path: string): Promise<SpaceTableSchema[]>;
  framesForSpace(path: string): Promise<SpaceTableSchema[]>;

  // Path operations (MKit-aware)
  resolvePath(path: string, source?: string): string;
  uriByString(uri: string, source?: string): URI;
  pathExists(path: string): Promise<boolean>;

  // Space operations
  createSpace(
    name: string,
    parentPath: string,
    definition: SpaceDefinition
  ): void;
  deleteSpace(path: string): void;
  spaceInfoForPath(path: string): SpaceInfo;
  contextForSpace(path: string): Promise<SpaceTable>;

  // Property operations
  addSpaceProperty(path: string, property: SpaceProperty): Promise<boolean>;
  saveProperties(
    path: string,
    properties: Record<string, any>
  ): Promise<boolean>;
  deleteProperty(path: string, property: string): void;
  renameProperty(path: string, property: string, newProperty: string): void;

  // File operations
  createItemAtPath(
    parent: string,
    type: string,
    name: string,
    content?: any
  ): Promise<string>;
  deletePath(path: string): void;
  readPath(path: string): Promise<string>;
  writeToPath(path: string, content: any, binary?: boolean): Promise<void>;
  parentPathForPath(path: string): string;

  // Additional space operations
  allSpaces(): SpaceInfo[];
  childrenForSpace(path: string): string[];
  spaceInitiated(path: string): Promise<boolean>;
  contextInitiated(path: string): Promise<boolean>;
  readAllTables(path: string): Promise<SpaceTables>;
  readAllFrames(path: string): Promise<MDBFrames>;
  saveSpace(
    path: string,
    definition: (def: SpaceDefinition) => SpaceDefinition,
    properties?: Record<string, any>
  ): void;
  renameSpace(path: string, newPath: string): Promise<string>;
  spaceDefForSpace(path: string): Promise<SpaceDefinition>;

  // Additional path operations
  allPaths(type?: string[]): string[];
  renamePath(oldPath: string, newPath: string): Promise<string>;
  copyPath(
    source: string,
    destination: string,
    newName?: string
  ): Promise<string>;
  getPathInfo(path: string): Promise<Record<string, any>>;
  readPathCache(path: string): Promise<PathCache>;
  getPathState(path: string): PathState | null;
  getPathsIndexMap: () => Map<string, PathState>;
  childrenForPath(path: string, type?: string): Promise<string[]>;

  // Frame schema operations
  saveFrameSchema(
    path: string,
    schemaId: string,
    saveSchema: (prev: SpaceTableSchema) => SpaceTableSchema
  ): Promise<void>;
  deleteFrame(path: string, name: string): Promise<void>;

  // MKit-specific utilities
  isPreviewMode: boolean;
  convertMKitPath(path: string): string;
  isMKitPath(path: string): boolean;

  // Context access map
  getContextsIndexMap: () => Map<string, ContextState>;

  // API reference
  api: IAPI;

  // Fallback to original spaceManager for uncovered methods
  spaceManager: SpaceManagerInterface;
}

const SpaceManagerContext = createContext<SpaceManagerContextType | null>(null);

interface SpaceManagerProviderProps {
  superstate: Superstate;
  children: React.ReactNode;
}

export const SpaceManagerProvider: React.FC<SpaceManagerProviderProps> = ({
  superstate,
  children,
}) => {
  // MKit preview runtime is dead post-installer-removal (bd Notidian-bnb / ADR
  // 0018). Default-OFF: feed the now-orphaned mkit branches the LOCAL inert
  // default — identical to the value the deleted useMKitPreviewContext()
  // returned, so runtime behavior is byte-for-byte unchanged. Flag ON: force it
  // null so the branches short-circuit (the clean state for live verification).
  // Either way no real MKit provider exists, so isPreviewMode is always false.
  const removeMKitPreviewRuntime =
    superstate?.settings?.removeMKitPreviewRuntime === true;
  const mkitContext = removeMKitPreviewRuntime
    ? null
    : INERT_MKIT_PREVIEW_CONTEXT;

  // Create formula context for regular provider
  const formulaContext = useMemo(() => {
    // Use superstate's formula context if available, otherwise create one
    if (superstate?.formulaContext) {
      return superstate.formulaContext;
    }
    const config: math.ConfigOptions = {
      matrix: "Array",
    };
    const runContext = math.create(all, config);
    runContext.import(formulas, { override: true });
    return runContext;
  }, [superstate]);

  // MKit path utilities
  const isMKitPath = useCallback((path: string): boolean => {
    return path?.startsWith("mkit://preview/") || false;
  }, []);

  const convertMKitPath = useCallback(
    (path: string): string => {
      if (!isMKitPath(path)) {
        return path;
      }

      const pathAfterPrefix = path.replace("mkit://preview/", "");
      const kitId = mkitContext?.rootPath?.replace("mkit://preview/", "") || "";

      if (pathAfterPrefix === kitId || pathAfterPrefix === "") {
        return ".";
      } else if (pathAfterPrefix.startsWith(kitId + "/")) {
        let relativePath = pathAfterPrefix.slice((kitId + "/").length);
        // Remove trailing slashes
        relativePath = relativePath.replace(/\/+$/, "");
        return relativePath || ".";
      }

      // Remove trailing slashes from the result
      let result = pathAfterPrefix.replace(/\/+$/, "");
      return result || ".";
    },
    [mkitContext?.rootPath, isMKitPath]
  );

  // Define getContextsIndexMap before readTable to avoid reference errors
  const getContextsIndexMap = useCallback((): Map<string, ContextState> => {
    if (mkitContext?.isPreviewMode && mkitContext?.getContextsIndexMap) {
      // In MKit preview mode, use MKit context's map
      return mkitContext.getContextsIndexMap();
    } else if (superstate?.contextsIndex) {
      // In regular mode, return superstate's contexts index
      return superstate.contextsIndex;
    }
    // Fallback to empty map
    return new Map<string, ContextState>();
  }, [mkitContext, superstate]);

  // Define getPathsIndexMap before readTable to avoid reference errors
  const getPathsIndexMap = useCallback((): Map<string, PathState> => {
    if (mkitContext?.isPreviewMode && mkitContext?.getPathsIndexMap) {
      // In MKit preview mode, use MKit context's map
      return mkitContext.getPathsIndexMap();
    } else if (superstate?.pathsIndex) {
      // In regular mode, return superstate's paths index
      return superstate.pathsIndex;
    }
    // Fallback to empty map
    return new Map<string, PathState>();
  }, [mkitContext, superstate]);

  // Core data operations
  const readTable = useCallback(
    async (path: string, schema: string): Promise<SpaceTable | null> => {
      if (mkitContext?.isPreviewMode && isMKitPath(path)) {
        // Handle MKit preview mode
        const lookupPath = convertMKitPath(path);

        const mkitSpaceData =
          mkitContext.getSpaceByFullPath(lookupPath) ||
          mkitContext.getSpaceByRelativePath(lookupPath);

        if (mkitSpaceData?.contextTables?.[schema]) {
          const table = mkitSpaceData.contextTables[schema];

          // Apply linkContextRow for MKit data
          if (table.rows && table.cols && table.cols.length > 0) {
            // Use getPathsIndexMap and getContextsIndexMap from MKit context
            const pathsMap = mkitContext?.getPathsIndexMap
              ? mkitContext.getPathsIndexMap()
              : new Map<string, PathState>();
            const contextsMap = mkitContext?.getContextsIndexMap
              ? mkitContext.getContextsIndexMap()
              : new Map<string, ContextState>();
            const spacesMap = new IndexMap();

            // Calculate dependencies once
            const dependencies = propertyDependencies(table.cols);

            // Use superstate settings if available
            const settings = superstate?.settings || ({} as MakeMDSettings);

            // Apply linkContextRow to each row
            const processedRows = table.rows.map((row: any) =>
              linkContextRow(
                formulaContext,
                pathsMap,
                contextsMap,
                spacesMap,
                row,
                table.cols,
                mkitSpaceData.pathState,
                settings,
                dependencies
              )
            );

            return {
              ...table,
              rows: processedRows,
            };
          }

          return table;
        }
      }

      // Fallback to regular spaceManager
      if (superstate?.spaceManager) {
        const table = await superstate.spaceManager.readTable(path, schema);

        // Apply linkContextRow for regular data using getPathsIndexMap
        if (table && table.rows && table.cols && table.cols.length > 0) {
          // Use getPathsIndexMap and getContextsIndexMap for consistent access
          const pathsMap = getPathsIndexMap();
          const contextsMap = getContextsIndexMap();
          const pathState = pathsMap.get(path);

          if (pathState) {
            const dependencies = propertyDependencies(table.cols);
            const processedRows = table.rows.map((row: any) =>
              linkContextRow(
                formulaContext,
                pathsMap,
                contextsMap,
                superstate.spacesMap || new IndexMap(),
                row,
                table.cols,
                pathState,
                superstate.settings || ({} as MakeMDSettings),
                dependencies
              )
            );

            return {
              ...table,
              rows: processedRows,
            };
          }
        }

        return table;
      }

      return null;
    },
    [
      mkitContext,
      isMKitPath,
      convertMKitPath,
      superstate,
      formulaContext,
      getPathsIndexMap,
      getContextsIndexMap,
    ]
  );

  const saveTable = useCallback(
    async (
      path: string,
      table: SpaceTable,
      force?: boolean
    ): Promise<boolean> => {
      if (mkitContext?.isPreviewMode && isMKitPath(path)) {
        return false;
      }

      // Regular mode
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.saveTable(path, table, force);
      }

      return false;
    },
    [mkitContext, isMKitPath, superstate]
  );

  const readFrame = useCallback(
    async (path: string, schema: string): Promise<MDBFrame | null> => {
      if (mkitContext?.isPreviewMode && isMKitPath(path)) {
        // Handle MKit preview mode
        const lookupPath = convertMKitPath(path);

        const mkitSpaceData =
          mkitContext.getSpaceByFullPath(lookupPath) ||
          mkitContext.getSpaceByRelativePath(lookupPath);

        if (mkitSpaceData?.frameData?.[schema]) {
          return mkitSpaceData.frameData[schema];
        } else {
        }
      }

      // Fallback to regular spaceManager
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.readFrame(path, schema);
      }

      return null;
    },
    [mkitContext, isMKitPath, convertMKitPath, superstate]
  );

  const saveFrame = useCallback(
    async (path: string, frame: MDBFrame): Promise<void> => {
      if (mkitContext?.isPreviewMode && isMKitPath(path)) {
        return;
      }

      // Regular mode
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.saveFrame(path, frame);
      }
    },
    [mkitContext, isMKitPath, superstate]
  );

  // Schema operations
  const tablesForSpace = useCallback(
    async (path: string): Promise<SpaceTableSchema[]> => {
      if (mkitContext?.isPreviewMode && isMKitPath(path)) {
        // Handle MKit preview mode
        const lookupPath = convertMKitPath(path);

        const mkitSpaceData =
          mkitContext.getSpaceByFullPath(lookupPath) ||
          mkitContext.getSpaceByRelativePath(lookupPath);

        if (mkitSpaceData?.contextSchemas) {
          return mkitSpaceData.contextSchemas;
        } else {
        }
      }

      // Fallback to regular spaceManager
      if (superstate?.spaceManager) {
        const schemas = await superstate.spaceManager.tablesForSpace(path);
        return schemas || [];
      }

      return [];
    },
    [mkitContext, isMKitPath, convertMKitPath, superstate]
  );

  const framesForSpace = useCallback(
    async (path: string): Promise<SpaceTableSchema[]> => {
      if (mkitContext?.isPreviewMode && isMKitPath(path)) {
        // Handle MKit preview mode
        const lookupPath = convertMKitPath(path);

        const mkitSpaceData =
          mkitContext.getSpaceByFullPath(lookupPath) ||
          mkitContext.getSpaceByRelativePath(lookupPath);

        if (mkitSpaceData?.frameSchemas) {
          return mkitSpaceData.frameSchemas.map(
            (fs) => fs as any as SpaceTableSchema
          );
        } else {
        }
      }

      // Fallback to regular spaceManager
      if (superstate?.spaceManager) {
        const schemas = await superstate.spaceManager.framesForSpace(path);
        return schemas || [];
      }

      return [];
    },
    [mkitContext, isMKitPath, convertMKitPath, superstate]
  );

  // Path operations
  const resolvePath = useCallback(
    (path: string, source?: string): string => {
      if (mkitContext?.isPreviewMode) {
        // Let MKit context handle path resolution for preview mode
        return mkitContext.resolvePath(path, source);
      }

      // Fallback to regular spaceManager
      if (superstate?.spaceManager) {
        return superstate.spaceManager.resolvePath(path, source);
      }

      return path;
    },
    [mkitContext, superstate]
  );

  const uriByString = useCallback(
    (uri: string, source?: string): URI => {
      // Always use regular spaceManager for URI parsing
      if (superstate?.spaceManager) {
        return superstate.spaceManager.uriByString(uri, source);
      }

      // Fallback URI structure
      return {
        scheme: "",
        authority: "",
        path: uri,
        basePath: uri,
        fullPath: uri,
        ref: null,
        trailSlash: false,
      };
    },
    [superstate]
  );

  const pathExists = useCallback(
    async (path: string): Promise<boolean> => {
      if (mkitContext?.isPreviewMode && isMKitPath(path)) {
        // For MKit paths, check if space data exists
        const lookupPath = convertMKitPath(path);
        const mkitSpaceData =
          mkitContext.getSpaceByFullPath(lookupPath) ||
          mkitContext.getSpaceByRelativePath(lookupPath);
        return !!mkitSpaceData;
      }

      // Fallback to regular spaceManager
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.pathExists(path);
      }

      return false;
    },
    [mkitContext, isMKitPath, convertMKitPath, superstate]
  );

  // Space operations (always use regular spaceManager)
  const createSpace = useCallback(
    (name: string, parentPath: string, definition: SpaceDefinition): void => {
      if (superstate?.spaceManager) {
        superstate.spaceManager.createSpace(name, parentPath, definition);
      }
    },
    [superstate]
  );

  const deleteSpace = useCallback(
    (path: string): void => {
      if (superstate?.spaceManager) {
        superstate.spaceManager.deleteSpace(path);
      }
    },
    [superstate]
  );

  const spaceInfoForPath = useCallback(
    (path: string): SpaceInfo => {
      if (superstate?.spaceManager) {
        return superstate.spaceManager.spaceInfoForPath(path);
      }

      return null;
    },
    [superstate]
  );

  const contextForSpace = useCallback(
    async (path: string): Promise<SpaceTable> => {
      if (mkitContext?.isPreviewMode && isMKitPath(path)) {
        // Handle MKit preview mode - return default context table
        const lookupPath = convertMKitPath(path);

        const mkitSpaceData =
          mkitContext.getSpaceByFullPath(lookupPath) ||
          mkitContext.getSpaceByRelativePath(lookupPath);

        if (mkitSpaceData?.contextTables) {
          // Return the first context table or create a default one
          const tables = Object.values(mkitSpaceData.contextTables);
          if (tables.length > 0) {
            return tables[0];
          }
        }

        // Return empty context table for MKit
        return {
          schema: null,
          cols: [],
          rows: [],
        };
      }

      // Fallback to regular spaceManager
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.contextForSpace(path);
      }

      return {
        schema: null,
        cols: [],
        rows: [],
      };
    },
    [mkitContext, isMKitPath, convertMKitPath, superstate]
  );

  // Property operations (always use regular spaceManager)
  const addSpaceProperty = useCallback(
    async (path: string, property: SpaceProperty): Promise<boolean> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.addSpaceProperty(path, property);
      }

      return false;
    },
    [superstate]
  );

  const saveProperties = useCallback(
    async (path: string, properties: Record<string, any>): Promise<boolean> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.saveProperties(path, properties);
      }

      return false;
    },
    [superstate]
  );

  const deleteProperty = useCallback(
    (path: string, property: string): void => {
      if (superstate?.spaceManager) {
        superstate.spaceManager.deleteProperty(path, property);
      }
    },
    [superstate]
  );

  const renameProperty = useCallback(
    (path: string, property: string, newProperty: string): void => {
      if (superstate?.spaceManager) {
        superstate.spaceManager.renameProperty(path, property, newProperty);
      }
    },
    [superstate]
  );

  // Table operations
  const createTable = useCallback(
    (path: string, schema: SpaceTableSchema): void => {
      if (superstate?.spaceManager) {
        superstate.spaceManager.createTable(path, schema);
      }
    },
    [superstate]
  );

  // File operations (always use regular spaceManager)
  const createItemAtPath = useCallback(
    async (
      parent: string,
      type: string,
      name: string,
      content?: any
    ): Promise<string> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.createItemAtPath(
          parent,
          type,
          name,
          content
        );
      }

      return "";
    },
    [superstate]
  );

  const deletePath = useCallback(
    (path: string): void => {
      if (superstate?.spaceManager) {
        superstate.spaceManager.deletePath(path);
      }
    },
    [superstate]
  );

  const readPath = useCallback(
    async (path: string): Promise<string> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.readPath(path);
      }

      return "";
    },
    [superstate]
  );

  const writeToPath = useCallback(
    async (path: string, content: any, binary?: boolean): Promise<void> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.writeToPath(path, content, binary);
      }
    },
    [superstate]
  );

  const parentPathForPath = useCallback(
    (path: string): string => {
      if (superstate?.spaceManager) {
        return superstate.spaceManager.parentPathForPath(path);
      }

      return "";
    },
    [superstate]
  );

  // Additional critical methods
  const allSpaces = useCallback((): SpaceInfo[] => {
    if (superstate?.spaceManager) {
      return superstate.spaceManager.allSpaces();
    }
    return [];
  }, [superstate]);

  const childrenForSpace = useCallback(
    (path: string): string[] => {
      if (superstate?.spaceManager) {
        return superstate.spaceManager.childrenForSpace(path);
      }
      return [];
    },
    [superstate]
  );

  const spaceInitiated = useCallback(
    async (path: string): Promise<boolean> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.spaceInitiated(path);
      }
      return false;
    },
    [superstate]
  );

  const contextInitiated = useCallback(
    async (path: string): Promise<boolean> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.contextInitiated(path);
      }
      return false;
    },
    [superstate]
  );

  const readAllTables = useCallback(
    async (path: string): Promise<SpaceTables> => {
      if (mkitContext?.isPreviewMode && isMKitPath(path)) {
        const convertedPath = convertMKitPath(path);
        const spaceData =
          mkitContext.getSpaceByFullPath(convertedPath) ||
          mkitContext.getSpaceByRelativePath(convertedPath);

        if (spaceData?.contextTables) {
          return spaceData.contextTables;
        }
      }

      if (superstate?.spaceManager) {
        return await superstate.spaceManager.readAllTables(path);
      }
      return {};
    },
    [superstate, mkitContext, isMKitPath, convertMKitPath]
  );

  const readAllFrames = useCallback(
    async (path: string): Promise<MDBFrames> => {
      if (mkitContext?.isPreviewMode && isMKitPath(path)) {
        const convertedPath = convertMKitPath(path);
        const spaceData =
          mkitContext.getSpaceByFullPath(convertedPath) ||
          mkitContext.getSpaceByRelativePath(convertedPath);

        if (spaceData?.frameData) {
          return spaceData.frameData;
        }
      }

      if (superstate?.spaceManager) {
        return await superstate.spaceManager.readAllFrames(path);
      }
      return {};
    },
    [superstate, mkitContext, isMKitPath, convertMKitPath]
  );

  const saveSpace = useCallback(
    (
      path: string,
      definition: (def: SpaceDefinition) => SpaceDefinition,
      properties?: Record<string, any>
    ): void => {
      if (superstate?.spaceManager) {
        superstate.spaceManager.saveSpace(path, definition, properties);
      }
    },
    [superstate]
  );

  const renameSpace = useCallback(
    async (path: string, newPath: string): Promise<string> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.renameSpace(path, newPath);
      }
      return "";
    },
    [superstate]
  );

  const spaceDefForSpace = useCallback(
    async (path: string): Promise<SpaceDefinition> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.spaceDefForSpace(path);
      }
      return null;
    },
    [superstate]
  );

  const allPaths = useCallback(
    (type?: string[]): string[] => {
      if (superstate?.spaceManager) {
        return superstate.spaceManager.allPaths(type);
      }
      return [];
    },
    [superstate]
  );

  const renamePath = useCallback(
    async (oldPath: string, newPath: string): Promise<string> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.renamePath(oldPath, newPath);
      }
      return "";
    },
    [superstate]
  );

  const copyPath = useCallback(
    async (
      source: string,
      destination: string,
      newName?: string
    ): Promise<string> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.copyPath(
          source,
          destination,
          newName
        );
      }
      return "";
    },
    [superstate]
  );

  const getPathInfo = useCallback(
    async (path: string): Promise<Record<string, any>> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.getPathInfo(path);
      }
      return {};
    },
    [superstate]
  );

  const readPathCache = useCallback(
    async (path: string): Promise<PathCache> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.readPathCache(path);
      }
      return null;
    },
    [superstate]
  );

  const getPathState = useCallback(
    (path: string): PathState | null => {
      if (mkitContext?.isPreviewMode && mkitContext?.getPathState) {
        // In MKit preview mode, use MKit context's getPathState
        if (isMKitPath(path)) {
          const convertedPath = convertMKitPath(path);
          return mkitContext.getPathState(convertedPath) || null;
        }
        // For non-MKit paths in preview mode, still try MKit context
        return mkitContext.getPathState(path) || null;
      }

      // In regular mode, use superstate's paths index
      if (superstate?.pathsIndex) {
        return superstate.pathsIndex.get(path) || null;
      }

      return null;
    },
    [mkitContext, isMKitPath, convertMKitPath, superstate]
  );

  const childrenForPath = useCallback(
    async (path: string, type?: string): Promise<string[]> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.childrenForPath(path, type);
      }
      return [];
    },
    [superstate]
  );

  const saveFrameSchema = useCallback(
    async (
      path: string,
      schemaId: string,
      saveSchema: (prev: SpaceTableSchema) => SpaceTableSchema
    ): Promise<void> => {
      if (superstate?.spaceManager) {
        await superstate.spaceManager.saveFrameSchema(
          path,
          schemaId,
          saveSchema
        );
      }
    },
    [superstate]
  );

  const deleteFrame = useCallback(
    async (path: string, name: string): Promise<void> => {
      if (superstate?.spaceManager) {
        await superstate.spaceManager.deleteFrame(path, name);
      }
    },
    [superstate]
  );

  const contextValue = useMemo<SpaceManagerContextType>(
    () => ({
      // Core data operations
      readTable,
      saveTable,
      readFrame,
      saveFrame,

      // Schema operations
      tablesForSpace,
      framesForSpace,

      // Path operations
      resolvePath,
      uriByString,
      pathExists,

      // Space operations
      createSpace,
      deleteSpace,
      spaceInfoForPath,
      contextForSpace,

      // Property operations
      addSpaceProperty,
      saveProperties,
      deleteProperty,
      renameProperty,

      // Table operations
      createTable,

      // File operations
      createItemAtPath,
      deletePath,
      readPath,
      writeToPath,
      parentPathForPath,

      // Additional space operations
      allSpaces,
      childrenForSpace,
      spaceInitiated,
      contextInitiated,
      readAllTables,
      readAllFrames,
      saveSpace,
      renameSpace,
      spaceDefForSpace,

      // Additional path operations
      allPaths,
      renamePath,
      copyPath,
      getPathInfo,
      readPathCache,
      getPathState,
      getPathsIndexMap,
      childrenForPath,

      // Frame schema operations
      saveFrameSchema,
      deleteFrame,

      // MKit utilities
      isPreviewMode: !!mkitContext?.isPreviewMode,
      convertMKitPath,
      isMKitPath,

      // Context access map
      getContextsIndexMap,

      // API reference
      api: superstate?.api,

      // Fallback
      spaceManager: superstate?.spaceManager as SpaceManagerInterface,
    }),
    [
      readTable,
      saveTable,
      readFrame,
      saveFrame,
      tablesForSpace,
      framesForSpace,
      resolvePath,
      uriByString,
      pathExists,
      createSpace,
      deleteSpace,
      spaceInfoForPath,
      contextForSpace,
      addSpaceProperty,
      saveProperties,
      deleteProperty,
      renameProperty,
      createTable,
      createItemAtPath,
      deletePath,
      readPath,
      writeToPath,
      parentPathForPath,
      allSpaces,
      childrenForSpace,
      spaceInitiated,
      contextInitiated,
      readAllTables,
      readAllFrames,
      saveSpace,
      renameSpace,
      spaceDefForSpace,
      allPaths,
      renamePath,
      copyPath,
      getPathInfo,
      readPathCache,
      getPathState,
      getPathsIndexMap,
      childrenForPath,
      saveFrameSchema,
      deleteFrame,
      mkitContext?.isPreviewMode,
      convertMKitPath,
      isMKitPath,
      getContextsIndexMap,
      superstate?.spaceManager,
      formulaContext,
    ]
  );

  return (
    <SpaceManagerContext.Provider value={{ ...contextValue }}>
      {children}
    </SpaceManagerContext.Provider>
  );
};

export const useSpaceManager = (): SpaceManagerContextType => {
  const context = useContext(SpaceManagerContext);
  return context;
};


export { SpaceManagerContext };
