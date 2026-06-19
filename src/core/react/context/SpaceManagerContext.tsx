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
import { MDBFrame, MDBFrames } from "shared/types/mframe";
import { URI } from "shared/types/path";
import { PathState } from "shared/types/PathState";
import { MakeMDSettings } from "shared/types/settings";
import { SpaceDefinition } from "shared/types/spaceDef";
import { SpaceInfo } from "shared/types/spaceInfo";
import { SpaceManagerInterface } from "shared/types/spaceManager";
import { ContextState } from "shared/types/superstate";

// The dead MKit-preview runtime was fully removed (bd Notidian-rzv, post the
// Notidian-bnb live-verify / ADR 0018). The .mkit installer that once mounted
// MKitProvider was gone (Notidian-ala) and MKitContext.tsx deleted (Notidian-bnb),
// so every `mkit://preview/` branch here was already dead at runtime; this file
// now delegates straight to `superstate.spaceManager`. The public value keeps a
// literal `isPreviewMode: false` because external consumers (SpaceContext,
// PathCrumb, SpaceFragmentView) still gate on `spaceManager.isPreviewMode`.

/**
 * Enhanced SpaceManager interface (delegates to superstate.spaceManager)
 */
interface SpaceManagerContextType extends APISpaceManager {
  // Core data operations
  readTable(path: string, schema: string): Promise<SpaceTable | null>;
  saveTable(path: string, table: SpaceTable, force?: boolean): Promise<boolean>;
  readFrame(path: string, schema: string): Promise<MDBFrame | null>;
  saveFrame(path: string, frame: MDBFrame): Promise<void>;

  // Schema operations
  tablesForSpace(path: string): Promise<SpaceTableSchema[]>;
  framesForSpace(path: string): Promise<SpaceTableSchema[]>;

  // Path operations
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

  // Inert MKit-preview flag — always false; external consumers (SpaceContext,
  // PathCrumb, SpaceFragmentView) gate on `spaceManager.isPreviewMode`.
  isPreviewMode: boolean;

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

  // Define getContextsIndexMap before readTable to avoid reference errors
  const getContextsIndexMap = useCallback((): Map<string, ContextState> => {
    if (superstate?.contextsIndex) {
      return superstate.contextsIndex;
    }
    // Fallback to empty map
    return new Map<string, ContextState>();
  }, [superstate]);

  // Define getPathsIndexMap before readTable to avoid reference errors
  const getPathsIndexMap = useCallback((): Map<string, PathState> => {
    if (superstate?.pathsIndex) {
      return superstate.pathsIndex;
    }
    // Fallback to empty map
    return new Map<string, PathState>();
  }, [superstate]);

  // Core data operations
  const readTable = useCallback(
    async (path: string, schema: string): Promise<SpaceTable | null> => {
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
    [superstate, formulaContext, getPathsIndexMap, getContextsIndexMap]
  );

  const saveTable = useCallback(
    async (
      path: string,
      table: SpaceTable,
      force?: boolean
    ): Promise<boolean> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.saveTable(path, table, force);
      }

      return false;
    },
    [superstate]
  );

  const readFrame = useCallback(
    async (path: string, schema: string): Promise<MDBFrame | null> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.readFrame(path, schema);
      }

      return null;
    },
    [superstate]
  );

  const saveFrame = useCallback(
    async (path: string, frame: MDBFrame): Promise<void> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.saveFrame(path, frame);
      }
    },
    [superstate]
  );

  // Schema operations
  const tablesForSpace = useCallback(
    async (path: string): Promise<SpaceTableSchema[]> => {
      if (superstate?.spaceManager) {
        const schemas = await superstate.spaceManager.tablesForSpace(path);
        return schemas || [];
      }

      return [];
    },
    [superstate]
  );

  const framesForSpace = useCallback(
    async (path: string): Promise<SpaceTableSchema[]> => {
      if (superstate?.spaceManager) {
        const schemas = await superstate.spaceManager.framesForSpace(path);
        return schemas || [];
      }

      return [];
    },
    [superstate]
  );

  // Path operations
  const resolvePath = useCallback(
    (path: string, source?: string): string => {
      if (superstate?.spaceManager) {
        return superstate.spaceManager.resolvePath(path, source);
      }

      return path;
    },
    [superstate]
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
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.pathExists(path);
      }

      return false;
    },
    [superstate]
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
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.contextForSpace(path);
      }

      return {
        schema: null,
        cols: [],
        rows: [],
      };
    },
    [superstate]
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
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.readAllTables(path);
      }
      return {};
    },
    [superstate]
  );

  const readAllFrames = useCallback(
    async (path: string): Promise<MDBFrames> => {
      if (superstate?.spaceManager) {
        return await superstate.spaceManager.readAllFrames(path);
      }
      return {};
    },
    [superstate]
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
      if (superstate?.pathsIndex) {
        return superstate.pathsIndex.get(path) || null;
      }

      return null;
    },
    [superstate]
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

      // Inert MKit-preview flag — always false (external consumers gate on it).
      isPreviewMode: false,

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
