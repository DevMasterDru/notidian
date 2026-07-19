import { addTagToProperties, getAllFilesForTag, loadTags, removeTagFromMarkdownFile, renameTagInMarkdownFile } from "adapters/obsidian/utils/tags";
import _ from "lodash";
import MakeMDPlugin from "main";
import { AFile, FileCache, FileSystemAdapter, FileTypeCache, FilesystemMiddleware, PathLabel } from "makemd-core";
import { FileSystemAdapter as ObsidianFileSystemAdapter, Platform, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";

import { LocalStorageCache } from "adapters/mdb/localCache/localCache";
import { LocalCachePersister } from "shared/types/persister";

import { MobileCachePersister } from "adapters/mdb/localCache/localCacheMobile";
import { sanitizeNotidianSettings } from "core/schemas/settings";
import { defaultFocusFile } from "core/spaceManager/filesystemAdapter/filesystemAdapter";
import { parsePathState } from "core/utils/superstate/parser";
import { DBRows } from "shared/types/mdb";
import { pluginDataPath, pluginDisplayName } from "shared/pluginIdentity";
import { uniqueCopyName, uniqueNameFromString } from "shared/utils/array";
import { dispatchBestEffort, postPhysicalLifecycleFailure } from "shared/utils/asyncContracts";
import { removeTrailingSlashFromFolder } from "shared/utils/paths";
import { parseURI } from "shared/utils/uri";
import { excludePathPredicate } from "utils/hide";
import { getParentPathFromString, pathToString } from "utils/path";
import { urlRegex } from "utils/regex";
import { serializeMultiDisplayString } from "utils/serializers";
import { getAllFrontmatterKeys } from "../filetypes/frontmatter/fm";
import { getAbstractFileAtPath, getAllAbstractFilesInVault, tFileToAFile } from "../utils/file";


const illegalCharacters = ['/', '\\', '?', '%', '*', ':', '|', '"', '<', '>'];

const appendFlattenedFailures = (target: unknown[], error: unknown) => {
    if (error instanceof AggregateError) {
        for (const nested of error.errors) appendFlattenedFailures(target, nested);
        return;
    }
    target.push(error);
};

export class ObsidianFileSystem implements FileSystemAdapter {
    public middleware: FilesystemMiddleware;
    public vaultDBLoaded : boolean;
    public vaultDBCache: DBRows = [];
    public tagsCache: Set<string>;

    public cache: Map<string, FileCache> = new Map();
    public persister: LocalCachePersister;
    public pathLastUpdated: Map<string, number> = new Map();
    private persistenceQueues: Map<string, Promise<void>> = new Map();
    private deleteLifecycles: Map<string, {
        file: TAbstractFile;
        promise: Promise<void>;
        started: boolean;
        physicalComplete: boolean;
        resolve: () => void;
        reject: (error: unknown) => void;
    }> = new Map();
    private processedDeleteEvents = new WeakSet<object>();
    private renameLifecycles = new WeakMap<object, Map<string, {
        file: TAbstractFile;
        oldPath: string;
        newPath: string;
        promise: Promise<void>;
        started: boolean;
        resolve: () => void;
        reject: (error: unknown) => void;
    }>>();
    private exactRenameLifecycles = new Map<string, ReturnType<ObsidianFileSystem["createRenameLifecycle"]>>();
    private renameLifecycleQueue?: Promise<void>;
    private wakeRenameDrain?: () => void;
    private pendingRenameCallbacks: Array<{
        lifecycle: ReturnType<ObsidianFileSystem["createRenameLifecycle"]>;
        callbackFile: TAbstractFile;
        newFile: AFile;
        displayName: string;
    }> = [];

    public fileNameWarnings: Set<string> = new Set();
    
    public updateFileCache(path: string, cache: FileTypeCache, refresh: boolean, generation?: number) {
        
        if (!cache) return;
        if (generation !== undefined && !this.middleware.isPathGenerationCurrent(path, generation)) return;
        const oldCache = this.cache.get(path);
        const newCache = {...oldCache, ...cache};
        if (oldCache && _.isEqual(newCache, oldCache)) {
            return;
        }
        this.cache.set(path, newCache);
        void this.queuePersistence(path, () => this.persister.store(path, JSON.stringify(newCache), 'file')).catch(error => {
            console.error(`Failed to store persisted file cache for ${path}:`, error);
        });
        if (refresh)
        this.middleware.eventDispatch.dispatchEvent("onCacheUpdated", {path: path});
    }

    private queuePersistence<T>(path: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.persistenceQueues.get(path) ?? Promise.resolve();
        const queued = previous.catch((): void => undefined).then(operation);
        const settled = queued.then((): void => undefined, (): void => undefined);
        this.persistenceQueues.set(path, settled);
        void settled.then(() => {
            if (this.persistenceQueues.get(path) === settled) this.persistenceQueues.delete(path);
        });
        return queued;
    }
    public constructor (public plugin: MakeMDPlugin, middleware: FilesystemMiddleware, public vaultDBPath: string) {
        this.middleware = middleware
        this.plugin = plugin;
    if (Platform.isMobile) {
      this.persister = new MobileCachePersister(".notidian/fileCache.mdc", this.plugin.mdbFileAdapter, ['file']);
    } else {
        this.persister = new LocalStorageCache(".notidian/fileCache.mdc", this.plugin.mdbFileAdapter, ['file']);
    }
        
    }
    public readAllTags () {
        return loadTags(this.plugin.app, this.plugin.superstate.settings);
    }
    public async addTagToFile (path: string, tag: string) {
        const file = this.plugin.app.vault.getAbstractFileByPath(path) as TFile;
        if (!file) return;
        if (file.extension == "md") {
            addTagToProperties(this.plugin.superstate.spaceManager, tag, file.path);
            return;
        }
        const vaultItem = this.cache.get(path);
        if (!vaultItem) return;
        this.updateFileLabel(path, "tags", serializeMultiDisplayString([...vaultItem.tags, tag]))
    }
    public async renameTagForFile (path: string, oldTag: string, newTag: string) {
        const file = this.plugin.app.vault.getAbstractFileByPath(path) as TFile;
        if (file.extension == "md") {
            renameTagInMarkdownFile(this.plugin, oldTag, newTag, file);
            return;
        }
        const vaultItem = this.cache.get(path);
        if (!vaultItem) return;
        this.updateFileLabel(path, "tags", serializeMultiDisplayString([...vaultItem.tags.filter(t => t.toLowerCase() != oldTag.toLowerCase()), newTag]))
    }
    public async removeTagFromFile (path: string, tag: string) {
        const file = this.plugin.app.vault.getAbstractFileByPath(path) as TFile;
        if (file.extension == "md") {
            removeTagFromMarkdownFile(this.plugin, tag, file);
            return;
        }
        const vaultItem = this.cache.get(path);
        if (!vaultItem) return;
        this.updateFileLabel(path, "tags", serializeMultiDisplayString([...vaultItem.tags.filter(t => t.toLowerCase() != tag.toLowerCase())]))
    }
    public spacesDBPath = this.vaultDBPath;
  public checkIllegalCharacters (file: {name: string, path: string}) {
    if (illegalCharacters.some(f => file.name.includes(f)))
    {
            this.fileNameWarnings.add(file.path);
        } else {
            this.fileNameWarnings.delete(file.path);
        }

  }
    public async loadCacheFromObsidianCache () {
        //Load Spaces Database File
        await this.persister.initialize();
        
        
        this.vaultDBCache = getAllAbstractFilesInVault(this.plugin.app).map(file => ({
            path: file.path,
                parent: file.parent?.path,
                created: file instanceof TFile ? file.stat.ctime.toString() : undefined,
                folder: file instanceof TFolder ? "true" : "false",
        })).filter(f => !excludePathPredicate(this.plugin.superstate.settings, f.path));

        const allPaths = await this.persister.loadAll('file');
        const persistedByPath = new Map(allPaths.map(g => [g.path, g]));
        this.fileNameWarnings = new Set();
        // this.persister.reset();
        this.vaultDBCache.forEach(f => {
            const file = tFileToAFile(getAbstractFileAtPath(this.plugin.app, f.path))
            if (file?.path == '/') {
                file.name = "Vault"
                f.name = "Vault"
            }
            this.checkIllegalCharacters(file);
            if (excludePathPredicate(this.plugin.superstate.settings, file.path)) return;
            let cache : Partial<FileCache> = {
                metadata: {},
                tags: [],
                label: {sticker: f.sticker, thumbnail: '', color: f.color, name:f.name} as PathLabel,
            };
                const h = persistedByPath.get(f.path)
                if (h)
                cache = {...cache, ...parsePathState(h.cache)}
                if (file)
                {
                    cache = {...cache,
                    file: file,
                    ctime: cache.ctime > 0 ? cache.ctime : file.ctime,
                    contentTypes: file.isFolder ? [] : ['md', 'canvas', 'folder'],
                    label: {name: file.name, 
                         thumbnail: cache.label.thumbnail ?? '', 
                         sticker: cache.label.sticker ?? '', 
                         color: cache.label.color ?? '',
                         cover: cache.label.cover ?? ''
                        } as PathLabel,
                    parent: file.parent,
                    type: file.isFolder ? "space" : 'file',
                    subtype: file.isFolder ? "folder" : file.extension
                }
            }
                this.updateFileCache(f.path, cache, false)
        })
        const start = Date.now();
        await Promise.all(this.vaultDBCache.map(f => this.middleware.createFileCache(f.path)));

        this.plugin.superstate.ui.notify(`${pluginDisplayName} - File Cache Loaded in ${(Date.now()-start)/1000} seconds ${this.cache.size}`, 'console')
        this.middleware.eventDispatch.dispatchEvent("onFilesystemIndexed", null);
        this.plugin.registerEvent(this.plugin.app.vault.on("create", this.onCreate));
        this.plugin.registerEvent(this.plugin.app.vault.on("modify", this.onModify));
        this.plugin.registerEvent(this.plugin.app.vault.on("delete", this.onVaultDelete));
        this.plugin.registerEvent(this.plugin.app.vault.on("rename", this.onVaultRename));
        this.plugin.registerEvent(this.plugin.app.vault.on("raw", this.onRaw));
        this.plugin.superstate.initialize();
      }
        public onRaw = async (path: string) => {
            
            const fileStat = await this.plugin.app.vault.adapter.stat(path);
            if (!fileStat) return;
            const currentMTime = this.pathLastUpdated.get(path) ?? 0;
            const needsUpdate = fileStat.mtime > currentMTime;
            
            if (!needsUpdate) return;

            this.pathLastUpdated.set(path, fileStat.mtime);
            const parentPath = this.parentPathForPath(path);
            if (parentPath.split('/').pop() == this.plugin.superstate.settings.spaceSubFolder) {
                if (path == `${this.plugin.superstate.settings.spaceSubFolder}/${defaultFocusFile}`) {
                    this.middleware.onFocusesUpdated();
                    return;
                }
                const type = path.split('/').pop();
                const spacePath = this.parentPathForPath(parentPath);
                this.middleware.onSpaceUpdated(spacePath, type);
                return;
            }
            
            if (path == normalizePath(pluginDataPath(this.plugin.app.vault.configDir, "data.json"))) {
                this.plugin.superstate.settings = sanitizeNotidianSettings(await this.plugin.loadData());
                this.plugin.superstate.dispatchEvent("settingsChanged", null);
            } 
        }

      public keysForCacheType (type: string) {
        if (type == 'frontmatter') {
            return getAllFrontmatterKeys(this.plugin);
        }
        return [];
      }
    public allContent () {
        return [...this.cache.values()].flatMap(f => f);
    }
      public allFiles (hidden?: boolean) {
        return getAllAbstractFilesInVault(this.plugin.app).map(f => tFileToAFile(f));
      }
      public getFileCache (path: string, source?: string) {
        return this.cache.get(path);
      }
    public parentPathForPath (path: string) {
        return removeTrailingSlashFromFolder(
            getParentPathFromString(path)
          );
    }
    public resolvePath (path: string, source: string) {
        if (!source || !path) return path;
        const uri = parseURI(path);
        if (uri.refStr?.length > 0)
        {
            if (uri.refType == 'block' || uri.refType == 'heading') {
            const resolvedPath =  this.plugin.app.metadataCache.getFirstLinkpathDest(uri.basePath, source)?.path;
            if (resolvedPath)
            return resolvedPath + "#" + uri.refStr
        }
        return path;
    }
        
        return this.plugin.app.metadataCache.getFirstLinkpathDest(path, source)?.path ?? path
    }
    
    public updateFileLabel (path: string, label: string, content: any) {
    
    const file = this.cache.get(path);
    this.middleware.updateFileCache(path, {label: {...file.label, [label]: content} as PathLabel}, true)

    }
    

    public initiate (middleware: FilesystemMiddleware) {
        this.middleware = middleware
    }

    public resourcePathForPath (path: string) {
        if (!path) return path;
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            return this.plugin.app.vault.getResourcePath(file);
        } 
        else if (path.match(urlRegex)) {
            return path;
        }
        const returnPath = this.parentPathForPath(this.plugin.app.vault.getResourcePath(this.plugin.app.vault.getRoot() as any))
        return `${returnPath}/${path}`;
    }

    onCreate = async (file: TAbstractFile) => {

        if (!file) return;
        this.checkIllegalCharacters(file);
        if (excludePathPredicate(this.plugin.superstate.settings, file.path)) return;
        const afile = tFileToAFile(file);
        const generation = this.middleware.beginPathGeneration(afile.path);
        
    this.cache.set(afile.path, {
        file: afile,
        ctime: afile.ctime,
        metadata: {},
        label: {sticker: "", thumbnail: "", color: "", name:(file as TFile).basename ?? file.name} as PathLabel,
        tags: [],
        parent: afile.parent,
        type: afile.isFolder ? "space" : 'file',
        subtype: afile.isFolder ? "folder" : afile.extension
    } as FileCache)
    await this.middleware.createFileCache(afile.path, generation);
        if (!this.middleware.isPathGenerationCurrent(afile.path, generation)) return;
        return await this.middleware.onCreate(afile)
      };
    onModify = async (file: TAbstractFile) => {
        if (!file) return;
        if (excludePathPredicate(this.plugin.superstate.settings, file.path)) return;
        if (this.plugin.app.vault.getAbstractFileByPath(file.path) !== file) return;
        await this.middleware.onModify(tFileToAFile(file))
    }
      private createDeleteLifecycle(file: TAbstractFile) {
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
        const lifecycle = { file, promise, started: false, physicalComplete: false, resolve, reject };
        void promise.catch((): void => undefined);
        this.deleteLifecycles.set(file.path, lifecycle);
        return lifecycle;
      }

      private startDeleteLifecycle(file: TAbstractFile, lifecycle: ReturnType<ObsidianFileSystem["createDeleteLifecycle"]>) {
        if (lifecycle.started) return lifecycle.promise;
        lifecycle.started = true;
        this.processedDeleteEvents.add(file);
        void this.performDeleteLifecycle(file).then(lifecycle.resolve, lifecycle.reject).finally(() => {
          if (this.deleteLifecycles.get(file.path) === lifecycle) this.deleteLifecycles.delete(file.path);
        });
        return lifecycle.promise;
      }

      onDelete = async (file: TAbstractFile) => {
        if (!file || this.processedDeleteEvents.has(file)) return;
        const existing = this.deleteLifecycles.get(file.path);
        const lifecycle = existing?.file === file ? existing : this.createDeleteLifecycle(file);
        lifecycle.physicalComplete = true;
        return await this.startDeleteLifecycle(file, lifecycle);
      };

      onVaultDelete = (file: TAbstractFile): void => {
        dispatchBestEffort(this.onDelete(file), error => {
            console.error(`Failed to process delete event for ${file?.path ?? "unknown path"}:`, error);
        });
      };

      private async performDeleteLifecycle(file: TAbstractFile) {

        if (!file) return;
        const currentIncarnation = this.plugin.app.vault.getAbstractFileByPath(file.path);
        if (currentIncarnation && currentIncarnation !== file) return;

        this.fileNameWarnings.delete(file.path);
        this.pathLastUpdated.delete(file.path);
        const generation = this.middleware.invalidatePath(file.path);
        const invalidationDispatch = this.middleware.onPathInvalidated(file.path);
        this.cache.delete(file.path);
        const persistedRemoval = this.queuePersistence(file.path, () => this.persister.remove(file.path, 'file'));
        const failures: unknown[] = [];
        try {
            await invalidationDispatch;
        } catch (error) {
            appendFlattenedFailures(failures, error);
        }
        try {
            await persistedRemoval;
        } catch (error) {
            appendFlattenedFailures(failures, error);
        }
        if (this.middleware.isPathGenerationCurrent(file.path, generation)) {
            const deletedFile = typeof (file as any).isFolder === "boolean"
                ? file as unknown as AFile
                : tFileToAFile(file);
            try {
                await this.middleware.onDelete(deletedFile, true);
            } catch (error) {
                appendFlattenedFailures(failures, error);
            }
        }
        if (failures.length > 0) {
            throw new AggregateError(failures, `Delete lifecycle failed for ${file.path}`);
        }
      }
      
      private renameLifecycleKey(oldPath: string, newPath: string) {
        return `${oldPath}\0${newPath}`;
      }

      private createRenameLifecycle(file: TAbstractFile, oldPath: string, newPath: string) {
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
        const lifecycle = { file, oldPath, newPath, promise, started: false, resolve, reject };
        void promise.catch((): void => undefined);
        const lifecyclesForFile = this.renameLifecycles.get(file) ?? new Map();
        const key = this.renameLifecycleKey(oldPath, newPath);
        lifecyclesForFile.set(key, lifecycle);
        this.renameLifecycles.set(file, lifecyclesForFile);
        this.exactRenameLifecycles.set(key, lifecycle);
        return lifecycle;
      }

      private renameLifecycleFor(file: TAbstractFile, oldPath: string, newPath: string) {
        return this.renameLifecycles.get(file)?.get(this.renameLifecycleKey(oldPath, newPath));
      }

      private removeRenameLifecycle(lifecycle: ReturnType<ObsidianFileSystem["createRenameLifecycle"]>) {
        const lifecyclesForFile = this.renameLifecycles.get(lifecycle.file);
        const key = this.renameLifecycleKey(lifecycle.oldPath, lifecycle.newPath);
        if (lifecyclesForFile?.get(key) !== lifecycle) return;
        lifecyclesForFile.delete(key);
        if (lifecyclesForFile.size === 0) this.renameLifecycles.delete(lifecycle.file);
        if (this.exactRenameLifecycles.get(key) === lifecycle) this.exactRenameLifecycles.delete(key);
      }

      private startRenameLifecycle(
        lifecycle: ReturnType<ObsidianFileSystem["createRenameLifecycle"]>,
        file: TAbstractFile,
      ) {
        if (lifecycle.started) return lifecycle.promise;
        lifecycle.started = true;
        const converted = tFileToAFile(file);
        const filename = lifecycle.newPath.split("/").pop() ?? file.name;
        const newFile = converted?.path === lifecycle.newPath
            ? converted
            : {
                ...converted,
                path: lifecycle.newPath,
                filename,
                name: filename.includes(".") ? filename.substring(0, filename.lastIndexOf(".")) : filename,
                parent: this.parentPathForPath(lifecycle.newPath),
            } as AFile;
        const displayName = (file as TFile).basename ?? newFile.name ?? file.name;
        this.pendingRenameCallbacks.push({ lifecycle, callbackFile: file, newFile, displayName });
        this.wakeRenameDrain?.();
        if (!this.renameLifecycleQueue) {
            const drain = this.drainRenameLifecycles();
            this.renameLifecycleQueue = drain.then((): void => undefined, (): void => undefined);
            void this.renameLifecycleQueue.then(() => {
                this.renameLifecycleQueue = undefined;
                if (this.pendingRenameCallbacks.length > 0) void this.onRenameDrainNeeded();
            });
        }
        return lifecycle.promise;
      }

      onRename = (file: TAbstractFile, oldPath: string) => {
        if (!file) return Promise.resolve();
        const lifecycle = this.renameLifecycleFor(file, oldPath, file.path)
            ?? this.createRenameLifecycle(file, oldPath, file.path);
        return this.startRenameLifecycle(lifecycle, file);
      };

      onVaultRename = (file: TAbstractFile, oldPath: string): void => {
        dispatchBestEffort(this.onRename(file, oldPath), error => {
            console.error(`Failed to process rename event ${oldPath} -> ${file?.path ?? "unknown path"}:`, error);
        });
      };

      private onRenameDrainNeeded() {
        if (this.renameLifecycleQueue || this.pendingRenameCallbacks.length === 0) return;
        const drain = this.drainRenameLifecycles();
        this.renameLifecycleQueue = drain.then((): void => undefined, (): void => undefined);
        void this.renameLifecycleQueue.then(() => {
            this.renameLifecycleQueue = undefined;
            if (this.pendingRenameCallbacks.length > 0) this.onRenameDrainNeeded();
        });
      }

      private async drainRenameLifecycles() {
        const activePublications = new Set<Promise<void>>();
        while (this.pendingRenameCallbacks.length > 0 || activePublications.size > 0) {
            while (this.pendingRenameCallbacks.length > 0) {
                const callback = this.pendingRenameCallbacks.shift();
                const { lifecycle } = callback;
                if (this.plugin.app.vault.getAbstractFileByPath(lifecycle.newPath) !== callback.callbackFile) {
                    lifecycle.resolve();
                    this.removeRenameLifecycle(lifecycle);
                    continue;
                }
                try {
                    const preparationFailures = await this.prepareRenameLifecycle(
                        callback.newFile,
                        lifecycle.oldPath,
                        callback.displayName,
                    );
                    let publication!: Promise<void>;
                    publication = Promise.resolve(this.middleware.onRename(callback.newFile, lifecycle.oldPath)).then(
                        () => {
                            if (preparationFailures.length > 0) {
                                lifecycle.reject(new AggregateError(
                                    preparationFailures,
                                    `Rename lifecycle failed for ${lifecycle.oldPath} -> ${lifecycle.newPath}`,
                                ));
                            } else {
                                lifecycle.resolve();
                            }
                        },
                        error => {
                            appendFlattenedFailures(preparationFailures, error);
                            lifecycle.reject(new AggregateError(
                                preparationFailures,
                                `Rename lifecycle failed for ${lifecycle.oldPath} -> ${lifecycle.newPath}`,
                            ));
                        },
                    ).finally(() => {
                        activePublications.delete(publication);
                        this.removeRenameLifecycle(lifecycle);
                        this.wakeRenameDrain?.();
                    });
                    activePublications.add(publication);
                } catch (error) {
                    lifecycle.reject(error);
                    this.removeRenameLifecycle(lifecycle);
                }
            }
            if (activePublications.size > 0 && this.pendingRenameCallbacks.length === 0) {
                await new Promise<void>(resolve => { this.wakeRenameDrain = resolve; });
                this.wakeRenameDrain = undefined;
            }
        }
      }

      private async prepareRenameLifecycle(newFile: AFile, oldPath: string, displayName: string) {
        const failures: unknown[] = [];
        this.checkIllegalCharacters(newFile);
        this.fileNameWarnings.delete(oldPath);
        this.pathLastUpdated.delete(oldPath);

        const oldCache = this.cache.get(oldPath);
        this.middleware.invalidatePath(oldPath);
        const invalidationDispatch = this.middleware.onPathInvalidated(oldPath);
        const destinationGeneration = this.middleware.beginPathGeneration(newFile.path);
        const destinationCache = {
            ...oldCache,
            file: newFile,
            ctime: (oldCache?.ctime ?? 0) > 0 ? oldCache.ctime : newFile.ctime,
            metadata: oldCache?.metadata ?? {},
            label: {
                ...(oldCache?.label ?? {}),
                name: displayName,
            } as PathLabel,
            tags: oldCache?.tags ?? [],
            contentTypes: oldCache?.contentTypes ?? [],
            parent: newFile.parent,
            type: newFile.isFolder ? "space" : 'file',
            subtype: newFile.isFolder ? "folder" : newFile.extension,
        } as FileCache;

        this.cache.delete(oldPath);
        this.cache.set(newFile.path, destinationCache);

        await invalidationDispatch;
        try {
            await this.queuePersistence(oldPath, () => this.persister.remove(oldPath, 'file'));
        } catch (error) {
            appendFlattenedFailures(failures, error);
        }
        if (!this.middleware.isPathGenerationCurrent(newFile.path, destinationGeneration)) return failures;
        try {
            await this.queuePersistence(newFile.path, () =>
                this.persister.store(newFile.path, JSON.stringify(destinationCache), 'file')
            );
        } catch (error) {
            appendFlattenedFailures(failures, error);
        }
        return failures;
      }

    public async getRoot() {
        return tFileToAFile(this.plugin.app.vault.getRoot());
    }

    public async copyFile(path: string, folder: string, newName?: string) {

            const file = await this.getFile(path);
            
            if (!file) return;
            newName = newName ? file.extension?.length > 0 ? newName + '.' + file.extension : newName : file.filename;
            
            let newPath = folder + "/" + newName;
            let newFile: AFile;
            if (file.isFolder) {
                
                
                if (await this.fileExists(newPath)) {
                    const folders = await this.plugin.app.vault.adapter.list(folder).then(g => g.folders)
                    newName = uniqueNameFromString(file.name, folders.map(f => f.split('/').pop()))
                    newPath = folder + "/" + newName;
                }
                const recursiveCopy = async (folder: string, newPath: string) => {
                    
                    const files = await this.plugin.app.vault.adapter.list(folder);
                    for (const f of files.files) {
                        if (newName != file.name) {
                            if (folder == path && f.split('/').pop() == file.name+ '.md') {
                                await this.plugin.app.vault.adapter.copy(f, newPath + "/" + newName + '.md');
                                continue;
                            }
                            
                        }
                        await this.plugin.app.vault.adapter.copy(f, newPath + "/" + f.split('/').pop());
                    }
                    for (const f of files.folders) {
                        await this.createFolder(newPath + "/" + f.split('/').pop());
                        await recursiveCopy(f, newPath + "/" + f.split('/').pop());
                    }
                }
                newFile = await this.createFolder(newPath);
                await recursiveCopy(file.path, newFile.path);
            } else if (file) {
                if (!(await this.fileExists(folder))) {
                    await this.createFolder(folder);
                }
                try {
                    if (await this.fileExists(newPath)) {
                        const files = await this.plugin.app.vault.adapter.list(folder).then(g => g.files)
                        // Dedup from the caller-supplied name (the user's title),
                        // NOT file.name (the template basename). The former `const`
                        // shadowed the outer newName and discarded the typed title,
                        // naming templated rows after the template (Notidian-ksrb).
                        newName = uniqueCopyName(pathToString(newName), files.map(f => pathToString(f)), file.extension)
                        newPath = folder + "/" + newName;
                    }
                    await this.plugin.app.vault.adapter.copy((file.path), newPath)
                } catch(e) {
                }
                newFile = tFileToAFile(this.plugin.app.vault.getAbstractFileByPath(newPath));
            }
            if (!newFile) return;
            
            // Deep clone the original cache to avoid shared references
            // (fixes bug where template changes sync back to new files)
            const originalCache = this.cache.get(file.path);
            const clonedCache = originalCache ? JSON.parse(JSON.stringify(originalCache)) : {};
            this.cache.set(newFile.path, {
                ...clonedCache,
                file: newFile,
                ctime: newFile.ctime,
                label: {...this.cache.get(path)?.label, name:newFile.name} as PathLabel,
                parent: newFile.parent,
                type: newFile.isFolder ? "space" : 'file',
        subtype: newFile.isFolder ? "folder" : newFile.extension
            } as FileCache)
            return newPath;

    }
public async writeTextToFile (path: string, content: string) {
        const newFile = this.plugin.app.vault.getAbstractFileByPath(path) as TFile
        if (!newFile)
        {await this.plugin.app.vault.adapter.write(path, content)} else 
        {await this.plugin.app.vault.modify(newFile, content)}
}
public async readTextFromFile (path: string) {
    const file = this.plugin.app.vault.getAbstractFileByPath(path) as TFile;
    if (file) {
        return this.plugin.app.vault.read(file)
    } 
    if (await this.fileExists(path))
    return this.plugin.app.vault.adapter.read(path);
return null
}

public async writeBinaryToFile (path: string, buffer: ArrayBuffer) {
    await this.plugin.app.vault.adapter.writeBinary(
        path,
        buffer);
    this.pathLastUpdated.set(path, Date.now());
    
}

public async readBinaryToFile (path: string) {
return (this.plugin.app.vault.adapter as ObsidianFileSystemAdapter).readBinary(path);
}
    
    public async renameFile (path: string, newPath: string) {

        const exactLifecycle = this.exactRenameLifecycles.get(this.renameLifecycleKey(path, newPath));
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (exactLifecycle && (!file || exactLifecycle.file === file)) {
            await exactLifecycle.promise;
            return newPath;
        }
        if (file) {
            const existingLifecycle = this.renameLifecycleFor(file, path, newPath);
            if (existingLifecycle) {
                await existingLifecycle.promise;
                return newPath;
            }
            const lifecycle = this.createRenameLifecycle(file, path, newPath);
            try {
                await this.plugin.app.fileManager.renameFile(file, newPath);
            } catch (error) {
                this.removeRenameLifecycle(lifecycle);
                if (!lifecycle.started) lifecycle.resolve();
                throw error;
            }
            if (!lifecycle.started) this.startRenameLifecycle(lifecycle, file);
            await lifecycle.promise;
        } else {
            await this.plugin.app.vault.adapter.rename(path, newPath)
        }
        return newPath
    }

    

public async createFolder (path: string) {

    if (!await this.fileExists(path))
    {
      await this.plugin.app.vault.adapter.mkdir(path);
      return this.getFile(path);
    } else {
        return this.getFile(path)
    }
}
    public async fileExists (path: string) {
            return this.plugin.app.vault.adapter.exists(path)
    }

    public async getFile(path: string, source?: string) {
        let aFile : AFile;
            if (source) {
                aFile = tFileToAFile(this.plugin.app.metadataCache.getFirstLinkpathDest(path, source))
            } else {
                aFile = tFileToAFile(this.plugin.app.vault.getAbstractFileByPath(path))
            }
            if (!aFile) {
                if (!(await this.fileExists(path))) {
                    return null;
                  }
                  const fileStat = await this.plugin.app.vault.adapter.stat(path);
                  if (!fileStat) return null;
                  const type = fileStat?.type;
                  const extension = type == 'file' ? path.split('.').pop() : null;
                  const folder = path.split('/').slice(0, -1).join('/');
                  const filename = path.split('/').pop()
                  const name = type == 'file' ? filename.substring(0, filename.lastIndexOf('.')) : filename;
                  aFile = {
                    path,
                    name,
                    filename,
                    parent: folder,
                    isFolder: type == "folder",
                    extension
                  }
            }
            return aFile;
    }

    public async deleteFile(path: string) {
            const file = this.plugin.app.vault.getAbstractFileByPath(path);
            if (!file) {
                const fileExists = await this.fileExists(path);
                if (fileExists) {
                    const detached = await this.getFile(path);
                    const stat = await this.plugin.app.vault.adapter.stat(path);
                    if (stat.type == 'folder') {
                        await this.plugin.app.vault.adapter.rmdir(path, true);
                    } else {
                        await this.plugin.app.vault.adapter.remove(path);
                    }
                    if (detached) {
                        try {
                            await this.performDeleteLifecycle(detached as unknown as TAbstractFile);
                        } catch (error) {
                            throw postPhysicalLifecycleFailure(
                                `Delete lifecycle failed after physically removing ${path}`,
                                error,
                            );
                        }
                    }
                }
                return;
            }
            const activeLifecycle = this.deleteLifecycles.get(path);
            if (activeLifecycle?.file === file) {
                try {
                    await activeLifecycle.promise;
                } catch (error) {
                    if (activeLifecycle.physicalComplete) {
                        throw postPhysicalLifecycleFailure(
                            `Delete lifecycle failed after physically removing ${path}`,
                            error,
                        );
                    }
                    throw error;
                }
                return;
            }
            const lifecycle = this.createDeleteLifecycle(file);
            const deleteOption = this.plugin.superstate.settings.deleteFileOption;
            try {
                if (deleteOption === "permanent") {
                    await this.plugin.app.vault.delete(file, true);
                } else if (deleteOption === "system-trash") {
                    await this.plugin.app.vault.trash(file, true);
                } else if (deleteOption === "trash") {
                    await this.plugin.app.vault.trash(file, false);
                } else {
                    this.deleteLifecycles.delete(path);
                    return;
                }
            } catch (error) {
                if (this.deleteLifecycles.get(path) === lifecycle) this.deleteLifecycles.delete(path);
                if (!lifecycle.started) lifecycle.resolve();
                throw error;
            }
            lifecycle.physicalComplete = true;
            if (!lifecycle.started) this.startDeleteLifecycle(file, lifecycle);
            try {
                await lifecycle.promise;
            } catch (error) {
                throw postPhysicalLifecycleFailure(
                    `Delete lifecycle failed after physically removing ${path}`,
                    error,
                );
            }
        }
        public filesForTag (tag: string) {
            return getAllFilesForTag(this.plugin, tag);
        }
        
        public childrenForFolder (path: string, type?: string) {
            if (type == 'folder') {
                return this.plugin.app.vault.adapter.list(path).then(g => g.folders)
            } else if (type == 'file') {
                return this.plugin.app.vault.adapter.list(path).then(g => g.files)
            }
            return this.plugin.app.vault.adapter.list(path).then(g => [...g.files, ...g.folders])
        }
        
}
