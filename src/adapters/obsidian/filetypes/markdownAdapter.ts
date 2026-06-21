import { generateStyleAst } from "core/export/styleAst/generateStyleAst";
import { HTMLExportOptions, noteToHtml, spaceToHtml } from "core/export/toHtml/spaceToHtml";
import { hyphenate } from "core/export/treeToAst/treeToHast";
import { hashCode } from "core/utils/hash";
import MakeMDPlugin from "main";
import { AFile, FileTypeAdapter, FilesystemMiddleware, PathLabel } from "makemd-core";
import { App, CachedMetadata, Platform, TFile, TFolder } from "obsidian";
import { StyleAst } from "shared/types/frameExec";
import { IndexMap } from "shared/types/indexMap";
import { uniq } from "shared/utils/array";
import { sanitizeRenderedHtml } from "shared/utils/sanitize";
import { parseMultiDisplayString, parseProperty } from "utils/parsers";
import { ensureTag } from "utils/tags";
import { getAbstractFileAtPath, tFileToAFile } from "../utils/file";
import { frontMatterForFile } from "./frontmatter/fm";
import { frontMatterKeys } from "./frontmatter/frontMatterKeys";

type CachedMetadataContentTypes = {
    resolvedLinks: string;
    inlinks: string;
    links: string;
    embeds: string;
    tags: string[];
    headings: string;
    sections: string;
    listItems: string;
    frontmatter: any;
    property: any;
    frontmatterLinks: string;
    blocks: string;
    label: string;
}

const removeMarkdown = (str: string) => {
    let output = str || "";
    output = output.replace(/^(-\s*?|\*\s*?|_\s*?){3,}\s*/gm, '');

  try {
        output = output.replace(/^([\s\t]*)([\*\-\+]|\d+\.)\s+/gm, '$1');
      output = output
      // Header
        .replace(/\n={2,}/g, '\n')
        // Fenced codeblocks
        .replace(/~{3}.*\n/g, '')
        // Strikethrough
        .replace(/~~/g, '')
        // Fenced codeblocks
        .replace(/`{3}.*\n/g, '');
    
    output = output
    // Remove HTML tags
      .replace(/<[^>]*>/g, '')

    const htmlReplaceRegex = new RegExp('<[^>]*>', 'g');
    

    output = output
      // Remove HTML tags
      .replace(htmlReplaceRegex, '')
      // Remove setext-style headers
      .replace(/^[=\-]{2,}\s*$/g, '')
      // Remove footnotes?
      .replace(/\[\^.+?\](\: .*?$)?/g, '')
      .replace(/\s{0,2}\[.*?\]: .*?$/g, '')
      // Remove images
      .replace(/\!\[(.*?)\][\[\(].*?[\]\)]/g, '')
      // Remove inline links
      .replace(/\[([^\]]*?)\][\[\(].*?[\]\)]/g, '$1')
      // Remove blockquotes
      .replace(/^(\n)?\s{0,3}>\s?/gm, '$1')
      // .replace(/(^|\n)\s{0,3}>\s?/g, '\n\n')
      // Remove reference-style links?
      .replace(/^\s{1,2}\[(.*?)\]: (\S+)( ".*?")?\s*$/g, '')
      // Remove atx-style headers
      .replace(/^(\n)?\s{0,}#{1,6}\s*( (.+))? +#+$|^(\n)?\s{0,}#{1,6}\s*( (.+))?$/gm, '$1$3$4$6')
      // Remove * emphasis
      .replace(/([\*]+)(\S)(.*?\S)??\1/g, '$2$3')
      // Remove _ emphasis. Unlike *, _ emphasis gets rendered only if 
      //   1. Either there is a whitespace character before opening _ and after closing _.
      //   2. Or _ is at the start/end of the string.
      .replace(/(^|\W)([_]+)(\S)(.*?\S)??\2($|\W)/g, '$1$3$4$5')
      // Remove code blocks
      .replace(/(`{3,})(.*?)\1/gm, '$2')
      // Remove inline code
      .replace(/`(.+?)`/g, '$1')
      // // Replace two or more newlines with exactly two? Not entirely sure this belongs here...
      // .replace(/\n{2,}/g, '\n\n')
      // // Remove newlines in a paragraph
      // .replace(/(\S+)\n\s*(\S+)/g, '$1 $2')
      // Replace strike through
      .replace(/~(.*?)~/g, '$1');
  } catch(e) {
    console.error(e);
    return output;
  }
  return output.replace(/^\s*\n/gm, '');
}

type CleanCachedMetadata = Omit<CachedMetadata, 'tags'> & { tags: string[], resolvedLinks: string[], label: PathLabel, inlinks: string[], property: any, tasks: { text: string, status: string }[] }

export class ObsidianMarkdownFiletypeAdapter implements FileTypeAdapter<CleanCachedMetadata, CachedMetadataContentTypes> {
    
    public id = "metadata.obsidian.md"
    public cache : Map<string, CleanCachedMetadata>;
    public supportedFileTypes = ['md'];
    private linksMap: IndexMap;
    public middleware: FilesystemMiddleware;
    public styleAst : StyleAst;
    public thumbnailFreshCache: Map<string, boolean>;
public app: App;
    public constructor (public plugin: MakeMDPlugin) {
        this.app = plugin.app;
    }
    
    public initiate (middleware: FilesystemMiddleware) {
        this.middleware = middleware;
        this.cache = new Map();
        this.linksMap = new IndexMap();
        this.thumbnailFreshCache = new Map();
        
    }
    public metadataChange (file: TFile) {
        
        this.parseCache(tFileToAFile(file), true);
        
    }
    public cacheDirectory = ".notidian/thumbnails";

    public loadFile = async (file: AFile) => {
        
        if (this.plugin.superstate.settings.noteThumbnails) {
            const thumbnailPath = `${this.cacheDirectory}/${hashCode(file.path)}.jpeg`;
            if (!(await this.middleware.fileExists(thumbnailPath)) || !this.thumbnailFreshCache.get(file.path)) 
            {
                if (!Platform.isMobile) {
                    const thumbnailResult = await this.generateThumbnail(file, thumbnailPath);
                    if (thumbnailResult) {
                        this.parseCache(file, true);
                        this.thumbnailFreshCache.set(file.path, true);
                    }
                    
                }
            }
        }

            
    }  

    public generateThumbnail = async(file: AFile, thumbnail: string) => {


        const htmlToDataURL = async (
            html: string,
            width: number,
            height: number,
            backgroundColor = '#fff',
          ): Promise<ArrayBuffer> => {
            
            const xmlns = 'http://www.w3.org/2000/svg'
            const svg = document.createElementNS(xmlns, 'svg')
            const foreignObject = document.createElementNS(xmlns, 'foreignObject')
          
            svg.setAttribute('width', `${width}`)
            svg.setAttribute('height', `${height}`)
            svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
          
            foreignObject.setAttribute('width', '100%')
            foreignObject.setAttribute('height', '100%')
            foreignObject.setAttribute('x', '0')
            foreignObject.setAttribute('y', '0')
            foreignObject.setAttribute('externalResourcesRequired', 'true')
          
            svg.appendChild(foreignObject)
            const node = document.createElement('div')
            // Defence-in-depth: the foreignObject is serialized to a data: image
            // (no script execution), but sanitizing also blocks remote-fetch
            // beacons in the thumbnail (Notidian-3yb).
            node.innerHTML = sanitizeRenderedHtml(html);
            foreignObject.appendChild(node)
            const dataURI = await Promise.resolve()
            .then(() => new XMLSerializer().serializeToString(svg))
            .then(encodeURIComponent)
            .then((html) => `data:image/svg+xml;charset=utf-8,${html}`)
            const img : HTMLImageElement = await new Promise((resolve, reject) => {
                const img = new Image()
                img.onload = () => {
                  img.decode().then(() => {
                    requestAnimationFrame(() => resolve(img))
                  })
                }
                img.onerror = reject
                img.crossOrigin = 'anonymous'
                img.decoding = 'async'
                img.src = dataURI
              })

            const canvas = document.createElement('canvas')
            const context = canvas.getContext('2d')!
            const ratio = 1;
            const canvasWidth = width
            const canvasHeight = height

            canvas.width = canvasWidth * ratio
            canvas.height = canvasHeight * ratio

            canvas.style.width = `${canvasWidth}`
            canvas.style.height = `${canvasHeight}`
            context.fillStyle = backgroundColor;
            context.fillRect(0, 0, canvas.width, canvas.height)
            context.drawImage(img, 0, 0, canvas.width, canvas.height)
            
            const blob : Blob = await new Promise((resolve) => {
                canvas.toBlob(
                  resolve,
                  'image/jpeg',
                1,
                )
              })

              const resizedBinary = await blob.arrayBuffer();
              return resizedBinary;
                
          }
          if (!this.styleAst) {
            this.styleAst = await generateStyleAst(true);
            
          }
          const baseStyle = (Object.entries(this.styleAst.styles).map(([key, value]) => `${hyphenate(key)}: ${(value.replace(/"/g, '&quot;').replace((/  |\r\n|\n|\r/gm),""))}${this.styleAst.type == 'slide' ? '!important' : ''};`).join(" "))
          const exportOptions: HTMLExportOptions = {
            header: {
                enabled: true,
                cover: false,
            },
            styleAst: this.styleAst,
            images: {
                embed: true,
            },
            nav: {
              enabled: false,
            },
            head: {
                enabled: false,
            },
            body: {
                main: {
                    enabled: true,
                    styles: baseStyle,
                },
            }
          }

          let html : string;
          if (file.isFolder) {
          html = await spaceToHtml(this.plugin.superstate, file.path, exportOptions);
          } else {
            html = await noteToHtml(this.plugin.superstate, file.path, exportOptions); 
          }

          const binary = await htmlToDataURL(html, 512, 800, this.styleAst.styles['--mk-ui-background-contrast']);
            if (!(await this.middleware.fileExists(this.cacheDirectory))) {
                await this.middleware.createFolder(this.cacheDirectory);
            }
            await this.middleware.writeBinaryToFile(thumbnail, binary);
            return true;
            
    }
    public async parseCache (file: AFile, refresh?: boolean) {
        if (!file) return;
        const fCache = this.app.metadataCache.getCache(file.path);
        if (!fCache) return;
            const rt = [];
            
            const resolved = this.app.metadataCache.resolvedLinks;
                const incoming = new Set<string>(this.linksMap.getInverse(file.path));
                const currentCache = this.cache.get(file.path);
                if (!currentCache)
                {for (const [key, value] of Object.entries(resolved)) {
                    if (file.path in value) incoming.add(key);
                }}
                if (fCache && fCache.tags)
                rt.push(...(fCache.tags?.map((f) => f.tag) ?? []));
                if (fCache && fCache.frontmatter?.tags)
                rt.push(
                    ...(typeof fCache.frontmatter?.tags === "string"
                    ? parseMultiDisplayString(fCache.frontmatter.tags.replace(/ /g, ""))
                    : Array.isArray(fCache.frontmatter?.tags)
                    ? fCache.frontmatter?.tags ?? []
                    : []
                    )
                    .filter((f) => typeof f === "string")
                    .map((f) => ensureTag(f))
                );
                if (fCache && fCache.frontmatter?.tag)
                rt.push(
                    ...(typeof fCache.frontmatter?.tag === "string"
                    ? parseMultiDisplayString(fCache.frontmatter.tag.replace(/ /g, ""))
                    : Array.isArray(fCache.frontmatter?.tag)
                    ? fCache.frontmatter?.tag ?? []
                    : []
                    )
                    .filter((f) => typeof f === "string")
                    .map((f) => ensureTag(f))
                );
                
                
                // Build the forward-link graph from BOTH body links and FRONTMATTER
                // links (Notidian-bk7e). Obsidian splits frontmatter wikilinks into
                // fCache.frontmatterLinks (separate from fCache.links); Notidian's
                // relations live in frontmatter, so omitting them left every
                // frontmatter relation invisible to the inlinks index (getInverse) —
                // breaking all back-relations on live update (the resolvedLinks
                // fallback only runs on a file's FIRST index).
                const resolveLink = (link: string) =>
                  this.plugin.app.metadataCache.getFirstLinkpathDest(link, file.path)?.path;
                const links = [
                  ...(fCache.links?.map((f) => resolveLink(f.link)) ?? []),
                  ...(fCache.frontmatterLinks?.map((f) => resolveLink(f.link)) ?? []),
                ].filter((f) => f);
                this.linksMap.set(file.path, new Set(links));
        const updatedCache : CleanCachedMetadata = {
            resolvedLinks: links ?? [],
            inlinks: Array.from(incoming),
            tags: rt.filter(f => f),
            property: fCache.frontmatter,
            tasks: [],
            label: {
            name: file.name,
            cover: fCache.frontmatter?.[this.plugin.superstate.settings.fmKeyBanner],
            thumbnail: fCache.frontmatter?.[this.plugin.superstate.settings.fmKeyBanner],
            sticker: fCache.frontmatter?.[this.plugin.superstate.settings.fmKeySticker],
            color: fCache.frontmatter?.[this.plugin.superstate.settings.fmKeyColor],

        },
        }
        
        
        if (this.plugin.superstate.settings.noteThumbnails) {
            const thumbnailPath = `${this.cacheDirectory}/${hashCode(file.path)}.jpeg`;
            if ((await this.middleware.fileExists(thumbnailPath)))
            {
                this.thumbnailFreshCache.set(file.path, true);
                updatedCache.label.thumbnail = thumbnailPath;   
            }
        }
        if (this.plugin.superstate.settings.notesPreview) {
            const contents = await this.plugin.app.vault.cachedRead(getAbstractFileAtPath(this.plugin.app, file.path)as TFile)
            const newContent = removeMarkdown(contents.slice(fCache.frontmatterPosition?.end.offset ?? 0, 1000));
            if (currentCache?.label?.preview && newContent !== currentCache.label.preview) {
                this.thumbnailFreshCache.set(file.path, false);
            }
            updatedCache.label.preview = newContent;
            const tasks = this.plugin.app.metadataCache.getFileCache(getAbstractFileAtPath(this.plugin.app, file.path) as TFile)?.listItems?.filter(f => f.task);
            if (tasks) {
                updatedCache.tasks = tasks.map(f => ({
                    text: contents.slice(f.position.start.offset, f.position.end.offset),
                    status: f.task,
                }));
            }
        }
        // Live back-relation freshness (Notidian-xwgw): when THIS file's outgoing
        // links change, re-index the targets it newly links to / no longer links
        // to, so their cached metadata.inlinks (the snapshot back-relations read)
        // refresh immediately — otherwise a parent's "Children" column / %-rollup
        // stays stale until the PARENT itself re-indexes. Re-enabled now that
        // resolvedLinks includes frontmatter links (Notidian-bk7e fix B), so a
        // frontmatter relation change (e.g. "+ Add sub-item") actually triggers it.
        // The guard fires ONLY on a real link change (most edits don't change
        // links). It terminates: re-indexing a target does not change THAT
        // target's own outgoing links, so the guard is false there — no cascade.
        if (currentCache) {
          const oldLinks = currentCache.resolvedLinks ?? [];
          const newLinksAll = updatedCache.resolvedLinks ?? [];
          const added = newLinksAll.filter((l) => !oldLinks.includes(l));
          const removed = oldLinks.filter((l) => !newLinksAll.includes(l));
          // Dedup (a path can appear via both a body and a frontmatter link).
          for (const link of new Set([...added, ...removed])) {
            const target = this.plugin.app.vault.getAbstractFileByPath(link);
            if (target && target instanceof TFile) {
              // Two steps, in order: (1) re-run the target's parseCache so its
              // adapter-cache inlinks SNAPSHOT is recomputed from the now-updated
              // link graph (getInverse); (2) reloadPath to rebuild the target's
              // superstate PathState from that fresh snapshot — which is what the
              // back-relation (path.metadata.inlinks) reads. parseCache alone
              // refreshes only the adapter cache; reloadPath alone propagates a
              // stale snapshot. Re-indexing the target does not change ITS OWN
              // outgoing links, so this does not recurse.
              void this.parseCache(tFileToAFile(target), true)
                .then(() => this.plugin.superstate.reloadPath(link, true))
                // Best-effort freshness: a non-indexable target (e.g. a file with
                // no Obsidian metadata) must never break the originating edit.
                .catch((): void => {});
            }
          }
        }
        this.cache.set(file.path, updatedCache);
        
        this.middleware.updateFileCache(file.path, updatedCache, refresh);
    }
    private metadataKeys = ['property', 'links', 'embeds', 'tags', 'headings', 'sections', 'listItems', 'frontmatter', 'frontmatterPosition', 'frontmatterLinks', 'blocks'] as Array<keyof CachedMetadata>;
    public cacheTypes (file: AFile) : (keyof CleanCachedMetadata)[] {
        return this.metadataKeys;
    }
    public contentTypes (file: AFile) {
        return ["tags", 'frontmatter', 'property', 'label'] as Array<keyof CachedMetadataContentTypes>;
    }
    public getCacheTypeByRefString (file: AFile, refString: string) {
        const refType = refString.charAt(0);
        if (refType == '^') {
            return "blocks"
        } else {
            return 'headings'
        }
    }
    public getCache (file: AFile, fragmentType: keyof CleanCachedMetadata, query?: any) {
        return this.cache.get(file.path)?.[fragmentType] as CleanCachedMetadata[typeof fragmentType]
    }

    public async readContent (file: AFile, fragmentType: keyof CachedMetadataContentTypes, fragmentId: any) {
        if (fragmentType == 'tags') {
            const fCache = this.app.metadataCache.getFileCache(getAbstractFileAtPath(this.app, file.path) as TFile)
            const rt = [];
                if (fCache && fCache.tags)
                rt.push(...(fCache.tags?.map((f) => f.tag) ?? []));
                if (fCache && fCache.frontmatter?.tags)
                rt.push(
                    ...(typeof fCache.frontmatter?.tags === "string"
                    ? parseMultiDisplayString(fCache.frontmatter.tags.replace(/ /g, ""))
                    : Array.isArray(fCache.frontmatter?.tags)
                    ? fCache.frontmatter?.tags ?? []
                    : []
                    )
                    .filter((f) => typeof f === "string")
                    .map((f) => ensureTag(f))
                );
                if (fCache && fCache.frontmatter?.tag)
                rt.push(
                    ...(typeof fCache.frontmatter?.tag === "string"
                    ? parseMultiDisplayString(fCache.frontmatter.tag.replace(/ /g, ""))
                    : Array.isArray(fCache.frontmatter?.tag)
                    ? fCache.frontmatter?.tag ?? []
                    : []
                    )
                    .filter((f) => typeof f === "string")
                    .map((f) => ensureTag(f))
                );
            return uniq(rt) ?? [];
        }
        if (fragmentType == 'frontmatter' || fragmentType == 'property' ) {
            const tfile = getAbstractFileAtPath(this.app, file.path);
            const fm = frontMatterForFile(this.app, tfile);
            const fmKeys = frontMatterKeys(fm);
            const rows = fmKeys.reduce(
                (p, c) => ({ ...p, [c]: parseProperty(c, fm[c]) }),
                {}
            );
            return rows;
        }
        if (fragmentType == 'label') {
            const tfile = getAbstractFileAtPath(this.app, file.path);
            const fm = frontMatterForFile(this.app, tfile);
            const rows = { 
                sticker: parseProperty("sticker", fm[this.plugin.superstate.settings.fmKeySticker]),
                color: parseProperty("color", fm[this.plugin.superstate.settings.fmKeyColor]),
                name: parseProperty("color", fm[this.plugin.superstate.settings.fmKeyAlias])[0],
            }
            return rows;
        }
    }

    public async newFile (parent: string, name: string, type: string, content?: string)  {

        let parentFolder = getAbstractFileAtPath(this.app, parent);
        if (!parentFolder) {
            await this.middleware.createFolder(parent);
            parentFolder = getAbstractFileAtPath(this.app, parent);
        }
        const fileName = name?.length > 0 ? name : this.plugin.superstate.settings.newNotePlaceholder
        return this.app.fileManager.createNewMarkdownFile(
        parentFolder ? (parentFolder instanceof TFolder) ? parentFolder : parentFolder.parent : this.app.vault.getRoot(),
        fileName).then(async f => {
            if (content) {
                await this.app.vault.modify(f, content);
            }
        return tFileToAFile(f)
        })
    }
    public newContent: (file: AFile, fragmentType: keyof CachedMetadataContentTypes, fragmentId: string, content: CachedMetadataContentTypes[keyof CachedMetadataContentTypes], options: { [key: string]: any; }) => Promise<any>;
    
    public async saveContent (file: AFile, fragmentType: keyof CachedMetadataContentTypes, fragmentId: string, content: (prev: any) => any) {
        if (fragmentType == 'label') {
            const afile = this.app.vault.getAbstractFileByPath(file.path);
            if (afile && afile instanceof TFile) {
                if (this.app.fileManager.processFrontMatter) {
                await this.app.fileManager.processFrontMatter(afile, (frontmatter: any) => {
                    if (fragmentId == 'sticker') {
                        frontmatter[this.plugin.superstate.settings.fmKeySticker] = content(frontmatter);
                    } else if (fragmentId == 'color') {
                        frontmatter[this.plugin.superstate.settings.fmKeyColor] = content(frontmatter);
                    } else if (fragmentId == 'name') {
                        frontmatter[this.plugin.superstate.settings.fmKeyAlias] = [content(frontmatter)];
                    }else if (fragmentId == 'cover') {
                        frontmatter[this.plugin.superstate.settings.fmKeyBanner] = content(frontmatter);
                    }
                    
                    
                });
                
                }
            }
        }
        if (fragmentType == 'frontmatter' || fragmentType == 'property') {
            const afile = this.app.vault.getAbstractFileByPath(file.path);
            if (afile && afile instanceof TFile) {
                if (this.app.fileManager.processFrontMatter) {
                await this.app.fileManager.processFrontMatter(afile, (frontmatter: any) => {
                    
                    const newFrontmatter = content(frontmatter);
                    const newKeys = Object.keys(newFrontmatter);
                    newKeys.forEach((f) => {
                            frontmatter[f] = newFrontmatter?.[f];
                    })
                    Object.keys(frontmatter).filter(f => !newKeys.includes(f)).forEach(f => delete frontmatter[f]);

                });
                }
            }
        }
        
        return true;
    }
    public async deleteContent (file: AFile, fragmentType: keyof CachedMetadataContentTypes, fragmentId: any) {

        if (fragmentType == 'frontmatter' || fragmentType == 'property') {
            const afile = this.app.vault.getAbstractFileByPath(file.path);
            if (afile && afile instanceof TFile) {
                if (this.app.fileManager.processFrontMatter) {
                return this.app.fileManager.processFrontMatter(afile, (frontmatter: any) => {
                    delete frontmatter[fragmentId]
                });
                }
            }
        }
        
        return;
    }
    
}
