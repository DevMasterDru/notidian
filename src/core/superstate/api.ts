import { showRowContextMenu } from "core/react/components/UI/Menus/contexts/rowContextMenu";
import { showPathContextMenu } from "core/react/components/UI/Menus/navigator/pathContextMenu";
import { openContextCreateItemModal } from "core/react/components/UI/Modals/ContextCreateItemModal";
import { parseFieldValue } from "core/schemas/parseFieldValue";
import { addRowInTable, updateTableRow, updateValueInContext } from "core/utils/contexts/context";
import { apiFieldWriteTarget } from "core/utils/contexts/apiValueWrite";
import { formatDate } from "core/utils/date";
import { runFormulaWithContext } from "core/utils/formula/parser";
import { parseContextNode, parseLinkedNode } from "core/utils/frames/frame";
import { SelectOption, SpaceManager } from "makemd-core";
import { SpaceManagerInterface } from "shared/types/spaceManager";
import { PathState } from "shared/types/superstate";
import { SpaceTable } from "shared/types/mdb";
import { stickerForField } from "schemas/mdb";
import { defaultContextSchemaID } from "shared/schemas/context";
import { IAPI } from "shared/types/api";
import { PathPropertyName } from "shared/types/context";
import { FrameContexts } from "shared/types/frameExec";
import { DBRow, SpaceProperty, SpaceTableSchema } from "shared/types/mdb";
import { TargetLocation } from "shared/types/path";
import { windowFromDocument } from "shared/utils/dom";
import { sanitizeTableName } from "shared/utils/sanitizers";
import { parseMDBStringValue } from "utils/properties";
import { ISuperstate } from "shared/types/superstate";
import { newPathInSpace, saveProperties } from "./utils/spaces";

// Interface for the minimal space manager functionality needed by API
export interface APISpaceManager {
    getPathState(path: string): PathState | null;
    resolvePath(path: string, source?: string): string;
    readTable(path: string, table: string): Promise<SpaceTable | null>;
    createTable(path: string, schema: SpaceTableSchema): void;
}

export class API implements IAPI {
    private superstate: ISuperstate;
    private spaceManager: SpaceManager | SpaceManagerInterface | APISpaceManager; // Can be SpaceManager, SpaceManagerInterface or SpaceManagerContext
    public constructor(superstate: ISuperstate, spaceManager?: SpaceManager | SpaceManagerInterface | APISpaceManager) {
        this.superstate = superstate;
        this.spaceManager = spaceManager || superstate.spaceManager;
    }

    // Authority-gated write for api.path.setProperty (bd Notidian-1da). Resolves
    // the property's governing column across every space the path belongs to, then
    // routes the value to its durable home: frontmatter (default), the context MDB
    // (explicit Notidian-owned / context-only column), or nothing (computed).
    private writePathProperty(path: string, property: string, value: string) {
        const spacesMap = this.superstate.spacesMap;
        const memberSpaces = spacesMap ? [...spacesMap.get(path)] : [];
        const contextTables = memberSpaces.map(
            (s) => this.superstate.contextsIndex.get(s)?.contextTable
        );
        const target = apiFieldWriteTarget(property, contextTables, "frontmatter");
        if (target === "skip") return;
        if (target === "context") {
            memberSpaces.forEach((s) => {
                const space = this.superstate.spacesIndex.get(s);
                if (space)
                    updateValueInContext(
                        this.spaceManager as SpaceManager,
                        path,
                        property,
                        value,
                        space.space
                    );
            });
            return;
        }
        saveProperties(this.superstate, path, { [property]: value });
    }
    public frame = {
update: (property: string, value: string, path: string, saveState: (state: any) => void) => {
            if (property.startsWith("$contexts")) {
                const {context, prop} = parseContextNode(property)
                if (context && prop)
                this.context.update(context, path, prop, value)
            } else {
                const linkedNode = parseLinkedNode(property)
                if (linkedNode.node && linkedNode.prop)
                {
                    saveState({
                    [linkedNode.node]: {
                        props: {
                        [linkedNode.prop] : value
                        }
                    }
                })
            }
            }
        }
    }
    public properties = {
        color: (property: SpaceProperty, value: string) => {
            if (property?.type?.includes('option')) {
                const fields = parseFieldValue(property.value, property.type);
                const option = (fields.options as SelectOption[])?.find(f => f.value == value);
                if (option?.color.length > 0)
                return option.color
            }
            return 'var(--mk-ui-background-contrast)'
        },
        sticker: (property: SpaceProperty) => property && stickerForField(property),
        value: ( type: string, value: string) => {
            if (!type) return value
            return parseMDBStringValue(type, value, false)
        }
    }

    public path = 
    {
        label:  (path: string) => {
            return this.spaceManager.getPathState(path)?.label;
        },
        thumbnail: (path: string) => {
            // If path is a URL, return it directly
            if (path && (path.startsWith('http://') || path.startsWith('https://'))) {
                return path;
            }
            // Otherwise get thumbnail from path label
            return this.spaceManager.getPathState(path)?.label?.thumbnail;
        },
        open: (path: string, target?: TargetLocation, source?: string) => {
            const resolvedPath = source 
                ? this.spaceManager.resolvePath(path, source) 
                : path;
            this.superstate.ui.openPath(resolvedPath, target)
        },
        create: (name: string, space: string, type: string, content?: Promise<string> | string): Promise<string> => {
            // Return the created path in BOTH branches (Notidian-0le). The async
            // branch previously used a block-body `.then` that dropped the
            // newPathInSpace result, so it resolved to `Promise<void>` and the
            // caller could not target the actual created path. Returning the
            // inner promise keeps the contract honest: `Promise<string>`.
            if (content instanceof Promise) {
                return content.then(c =>
                    newPathInSpace(this.superstate, this.superstate.spacesIndex.get(space), type, name, true, c)
                )
            }
            return newPathInSpace(this.superstate, this.superstate.spacesIndex.get(space), type, name, true, content)
        },
        setProperty: (path: string, property: string, value:  Promise<string> | string) => {
            // Authority gate (bd Notidian-1da): a path property whose column is
            // explicitly Notidian-owned / context-only must persist to the context
            // MDB, not silently into the file's frontmatter; a computed/read-only
            // column writes nothing. Frontmatter (and any unresolved column) keeps
            // the historical frontmatter write.
            const write = (v: string) => this.writePathProperty(path, property, v);
            if (value instanceof Promise) {
                value.then(write)
                return
            }
            write(value)
        },
        contextMenu: (e: React.MouseEvent, path: string) => {
            showPathContextMenu(this.superstate, path, null, { x: e.clientX, y: e.clientY, width: 0, height: 0 }, windowFromDocument(e.view.document))
        }
    }
    public commands = {
        run : (action: string, parameters?: { [key: string]: any; }, contexts?: FrameContexts) => {
            // Get the command to check parameter types

            const command = this.superstate.cli.commandForAction(action);
            let resolvedParameters = {...parameters};
            
            if (command && contexts?.$space?.path) {
                // Resolve link-type parameters using the context source
                command.fields.forEach(field => {
                    if (field.type === 'link' && parameters?.[field.name]) {
                        resolvedParameters[field.name] = this.spaceManager.resolvePath(
                            parameters[field.name], 
                            contexts.$space.path
                        );
                    }
                });
            }
            
            return this.superstate.cli.runCommand(action,  {instanceProps: {...resolvedParameters, $api: this, $contexts: contexts}, props: {}, iterations: 0})
        },
        formula: (formula: string, parameters: { [key: string]: any; }, contexts?: FrameContexts) => {
            return runFormulaWithContext(this.superstate.formulaContext, this.superstate.pathsIndex, this.superstate.spacesMap, formula, contexts.$properties, parameters, contexts?.$contexts?.$space?.path)
        }
    }

    public buttonCommand = (action: string, parameters: { [key: string]: any }, contexts: FrameContexts, saveState: (state: any) => void) => {
        // Handle button commands by delegating to the regular command runner
        this.commands.run(action, parameters, contexts);
    }
    
    
    
    public table = {
        select: (path: string, table: string) => {
            return this.spaceManager.readTable(path, table)?.then(f => f?.rows)
        },
        update: (path: string, table:string, index: number, row: DBRow) => {
            const space = this.superstate.spacesIndex.get(path)
            if (space)
            return updateTableRow(this.spaceManager as SpaceManager, space.space, table, index, row)
        },
        insert: (path: string, schema: string, _row: DBRow) => {
            const row: DBRow = Object.keys(_row).reduce((f, g) => {
                if (g == 'undefined' || g == 'null') return f
                return {
                    ...f, [g]: _row[g]}
            }, {});
            if (schema == defaultContextSchemaID) {
                this.context.insert(path, schema, row[PathPropertyName], row)
                return;
            }
            const space = this.superstate.spacesIndex.get(path)
            if (space)
            return addRowInTable(this.spaceManager as SpaceManager, row, space.space, schema)
        return Promise.resolve()
        },
        
         create: (path: string, table: string, properties: SpaceProperty[]) => {
            const newSchema: SpaceTableSchema = {
                id: sanitizeTableName(table),
                name: table,
                type: "db",
              };
            this.spaceManager.createTable(
                path,
                newSchema
              );
        },
        open: async (space: string, table: string, index: number, target?: TargetLocation) => {
            const context = await this.spaceManager.readTable(space, table)
            if (table == defaultContextSchemaID) {
                const path = this.spaceManager.resolvePath(context?.rows[index]?.[PathPropertyName], space)
                this.superstate.ui.openPath(path, target)
            } else {
                // For non-default schemas, open the edit modal instead of a path
                this.table.editModal(space, table, index)
            }
        },
        contextMenu: async (e: React.MouseEvent, space: string, table: string, index: number) => {
            // This verb is itself async and awaits readTable() BELOW, but the
            // React synthetic event reaches us through a synchronous chain
            // (FrameView onContextMenu -> executeAction -> ContextListView
            // contextMenu action -> here). e.currentTarget is the bound frame
            // element ONLY until that synchronous dispatch returns; after the
            // await below React has nulled it. So capture the row anchor rect +
            // owning window from e.currentTarget NOW, at the true synchronous
            // boundary, and forward them to showRowContextMenu — otherwise it
            // would re-read e.currentTarget post-await (null) and fall back to
            // the clicked SVG child, the e.target anti-pattern (Notidian-74n).
            const anchorEl = (e.currentTarget ?? e.target) as HTMLElement;
            const anchorRect = anchorEl.getBoundingClientRect();
            const anchorWindow = windowFromDocument(
                e.view?.document ?? anchorEl.ownerDocument
            );
            const context = await this.spaceManager.readTable(space, table);
            if (table == defaultContextSchemaID) {
                const path = context?.rows[index]?.[PathPropertyName]
                showPathContextMenu(this.superstate, path, space, { x: e.clientX, y: e.clientY, width: 0, height: 0 }, windowFromDocument(e.view.document))
            } else {
                showRowContextMenu(e, this.superstate, space, table, index, anchorRect, anchorWindow)
            }
        },
        editModal: async (space: string, table: string, index: number, properties?: DBRow, win?: Window) => {
            const context = await this.spaceManager.readTable(space, table);
            const rowData = {...(properties ?? {}), ...context?.rows[index]};
            
            // Open modal in edit mode when index >= 0, create mode when index = -1
            openContextCreateItemModal(
                this.superstate,
                space,
                table,
                undefined, // frameSchema
                win,
                index, // Row index: -1 for new, >= 0 for edit
                rowData // Initial data for editing
            );
        },
        createModal: async (space: string, table: string, properties?:  DBRow, win?: Window) => {
            // Open modal in create mode with index = -1
            await this.table.editModal(space, table, -1, properties, win);
        }
    }
    public context = {
        select: (path: string, table: string) => {
            return this.spaceManager.readTable(path, table).then(f => f?.rows)
        },
        update: (path: string, file: string, field: string, value: string) => {

            const space = this.superstate.spacesIndex.get(path)
            if (!space) return
            // Authority gate (bd Notidian-1da): context.update historically wrote
            // the context MDB unconditionally. A frontmatter-backed column edited
            // through this verb leaked file data into the hidden store, so route a
            // frontmatter-authority column to the file's YAML, a computed column to
            // nothing, and Notidian-owned / unresolved columns to the context MDB
            // (the pre-gate default).
            const target = apiFieldWriteTarget(
                field,
                [this.superstate.contextsIndex.get(path)?.contextTable],
                "context"
            )
            if (target === "skip") return
            if (target === "frontmatter") {
                saveProperties(this.superstate, file, { [field]: value })
                return
            }
            updateValueInContext(this.spaceManager as SpaceManager, file, field, value, space.space)
        },
        insert: async (path: string, schema: string, name: string, row: DBRow) => {
            if (schema == defaultContextSchemaID)
            {
                newPathInSpace(this.superstate, this.superstate.spacesIndex.get(path), "md", name, true).then(f =>
                {
                    if (row)
                    {
                        delete row[PathPropertyName]
                        saveProperties(this.superstate, f, {
                        ...(row ?? {}),
                    })
                }
                })
        } else {
            const table = await this.spaceManager.readTable(path, schema)
            
            if (table) {
                const prop = table.cols.find(f => f.primary == "true")
                
                const newRow = prop ? {
                    ...(row ?? {}), 
                    [prop.name]: name
                } : row
                this.table.insert(path, schema, newRow)
            }
                
        }
    }
    }

public date = {
    parse: (date: string) => {
        return new Date(date?.replace(/-/g, '\/').replace(/T.+/, ''));
    },
    daysInMonth: (date: Date) => {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    },
    format: (date: Date, format?: string) => {
        return formatDate(this.superstate.settings, date, format ?? 'yyyy-MM-dd')
    },
    component: (date: Date, component: string) => {
        if (component == 'year') return date.getFullYear()
        if (component == 'month') return date.getMonth() + 1
        if (component == 'day') return date.getDate()
        if (component == 'dayOfWeek') return date.getDay()
        if (component == "hour") return date.getHours()
        if (component == "minute") return date.getMinutes()
        if (component == "second") return date.getSeconds()
    },
    offset: (date: Date, offset: number, type: string) => {
        const newDate = new Date(date)
        if (type == 'day') newDate.setDate(newDate.getDate() + offset)
        if (type == 'month') newDate.setMonth(newDate.getMonth() + offset)
        if (type == 'year') newDate.setFullYear(newDate.getFullYear() + offset)
        return newDate
    },
    now: () => {
        return new Date();
    },
    range: (start: Date, end: Date, format?: string) => {
        const dates = []
        const current = new Date(start)
        while (current <= end) {
            dates.push(formatDate(this.superstate.settings, current, format ?? 'yyyy-MM-dd'))
            current.setDate(current.getDate() + 1)
        }
        return dates;
    }
}

    

    
}