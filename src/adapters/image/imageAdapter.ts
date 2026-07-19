
import { hashCode } from "core/utils/hash";
import MakeMDPlugin from "main";
import { AFile, FileTypeAdapter, FilesystemMiddleware } from "makemd-core";
import { Platform } from "obsidian";
import pica from "pica";
type ImageTypeCache = Record<never, never>


type ImageTypeContent = Record<never, never>
export class ImageFileTypeAdapter implements FileTypeAdapter<ImageTypeCache, ImageTypeContent> {
    private invalidatedSources = new Set<string>();
    private freshThumbnails = new Set<string>();
private picaInstance;
    public constructor (public plugin: MakeMDPlugin) {
        this.plugin = plugin;
        
this.picaInstance = pica();
    }
    public cacheDirectory = ".notidian/thumbnails";
    public supportedFileTypes = ["png", "jpg", "jpeg", "webp", "gif", "avif"];
    public id = 'images.notidian';
    public middleware: FilesystemMiddleware;
    public cache: Map<string, ImageTypeCache>;
    public initiate (middleware: FilesystemMiddleware) {
        this.middleware = middleware;
        this.cache = new Map();
        this.freshThumbnails = new Set();
    }
    public invalidatePath(path: string) {
        this.cache.delete(path);
        this.invalidatedSources.add(path);
        this.freshThumbnails.delete(path);
        const extension = path.split('.').pop()?.toLowerCase();
        if (!extension || !this.supportedFileTypes.includes(extension)) return;
        const thumbnailPath = `${this.cacheDirectory}/${hashCode(path)}.${extension}`;
        void this.middleware.deleteDerivedCacheFile(thumbnailPath).catch(error => {
            console.error(`Failed to delete derived image thumbnail ${thumbnailPath}:`, error);
        });
    }
    public async generateThumbnail (file: AFile, thumbnail: string, size=256, generation = this.middleware.capturePathGeneration(file.path)) {
        const binary = await this.middleware.readBinaryToFile(file.path);
            if (!this.middleware.isPathGenerationCurrent(file.path, generation)) return false;
            if (!binary) return false;
            const srcImage = new Image();
            srcImage.src = this.middleware.resourcePathForPath(file.path);
            const result = await new Promise((resolve, reject) => { srcImage.onload = () => resolve(true); srcImage.onerror = () => resolve(false) });
            if (!result) return false;
            const srcCanvas = document.createElement('canvas');
            srcCanvas.width = srcImage.width;
            srcCanvas.height = srcImage.height;
            const aspect_ratio = Math.max(size / srcImage.width, size / srcImage.height);
            const ctx =  srcCanvas.getContext('2d');
            ctx.drawImage(srcImage, 0, 0);
            const resize = document.createElement("canvas");
	        resize.width = aspect_ratio * srcCanvas.width; // 512
	        resize.height = aspect_ratio * srcCanvas.height; // 288
	        
            await this.picaInstance.resize(srcCanvas, resize)
            const resizedBlob = await this.picaInstance.toBlob(resize, 'image/jpeg', 0.8);
            const resizedBinary = await resizedBlob.arrayBuffer();
            if (!this.middleware.isPathGenerationCurrent(file.path, generation)) return false;
            if (!(await this.middleware.fileExists(this.cacheDirectory))) {
                await this.middleware.createFolder(this.cacheDirectory);
            }
            if (!this.middleware.isPathGenerationCurrent(file.path, generation)) return false;
            await this.middleware.writeDerivedCacheFile(thumbnail, resizedBinary, file.path, generation);
            if (!this.middleware.isPathGenerationCurrent(file.path, generation)) return false;
            return true;
}
public loadFile: (file: AFile) => Promise<void>;
    public async parseCache (file: AFile, refresh: boolean, generation?: number) {
        
        
        if (!file) return;
        generation = generation ?? this.middleware.capturePathGeneration(file.path);
        const thumbnailPath = `${this.cacheDirectory}/${hashCode(file.path)}.${file.extension}`;
        let thumbnail = file.path
        if (this.plugin.superstate.settings.imageThumbnails) {
            if (!this.freshThumbnails.has(file.path)
                || this.invalidatedSources.has(file.path)
                || !(await this.middleware.derivedCacheFileExists(thumbnailPath)))
            {
                if (!Platform.isMobile) {
                const thumbnailResult = await this.generateThumbnail(file, thumbnailPath, 256, generation);
                    if (!this.middleware.isPathGenerationCurrent(file.path, generation)) return;
                    if (thumbnailResult) {
                        thumbnail = thumbnailPath
                        this.invalidatedSources.delete(file.path);
                        this.freshThumbnails.add(file.path);
                    }
                }
            } else {
                thumbnail = thumbnailPath
            }
        }
        const label = this.middleware.getFileCache(file.path)?.label
        const updatedCache = { 
            subtype: "image",
            label: {
            name: file.name,
            sticker: label?.sticker.length > 0 ? label.sticker : "ui//mk-make-image",
            color: label?.color,
            thumbnail: thumbnail,
            cover: thumbnail,
        },
        preview: {
            thumbnail: thumbnail,
        }
    }
        if (!this.middleware.isPathGenerationCurrent(file.path, generation)) return;
        this.cache.set(file.path, updatedCache);
        this.middleware.updateFileCache(file.path, this.cache.get(file.path), refresh, generation);
    }
    
    public cacheTypes (file: AFile) { return [] as Array<keyof ImageTypeCache>}
    public contentTypes (file: AFile) { return [] as Array<keyof ImageTypeContent>}
    
    public newFile: (path: string, type: string, parent: string, content?: any) => Promise<AFile>;

    public getCacheTypeByRefString: (file: AFile, refString: string) => any;
    public getCache: (file: AFile, fragmentType: keyof ImageTypeContent, query?: string) => never;
    public readContent: (file: AFile, fragmentType: keyof ImageTypeContent, fragmentId: any) => any
    public newContent: (file: AFile, fragmentType: keyof ImageTypeContent, name: string, content: ImageTypeContent[typeof fragmentType], options: {[key: string]: any}) => Promise<any>;
    public saveContent: (file: AFile, fragmentType: keyof ImageTypeContent, fragmentId: any, content: (prev: ImageTypeContent[typeof fragmentType]) => any) => Promise<boolean>;
    public deleteContent: (file: AFile, fragmentType: keyof ImageTypeContent, fragmentId: any) => void
    
}
