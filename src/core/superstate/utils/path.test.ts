import {
    deletePath,
    movePathToSpace,
    renamePathByName,
} from "./path";

// ---------------------------------------------------------------------------
// Row-as-child-hub cascade wiring (Notidian-z21a, Atlas Method ADR-0042 D1).
//
// Fixture: "Knowledge/Gidi.md" is a row of the Knowledge database AND
// (adjacent mode, ADR 0008) the configured hub note of "Knowledge/Gidi" — the
// live vault's seeded pattern (Knowledge.md, rows_folder: Knowledge). These
// tests exercise renamePathByName/movePathToSpace/deletePath, the actual
// row-op entry points every UI surface (title-cell rename, drag-move, delete
// menu) funnels through.
//
// The "flag OFF" tests are the CURRENT/legacy-behavior characterization
// (verify-then-build step 1): today, without this bead's wiring, renaming or
// deleting a hub row's file silently orphans its nested folder. They double
// as the regression safety net — proving existing (non-hub, or flag-off)
// behavior is provably byte-for-byte unchanged.
// ---------------------------------------------------------------------------

const HUB_ROW_PATH = "Knowledge/Gidi.md";
const HUB_ROW_FOLDER = "Knowledge/Gidi";

type MockSuperstate = {
    settings: { enableNestedHubRows: boolean };
    spacesIndex: Map<string, { type?: string; space: { notePath: string } }>;
    contextsIndex: Map<string, { path: string }>;
    spaceManager: {
        renamePath: jest.Mock;
        renameSpace: jest.Mock;
        deletePath: jest.Mock;
    };
    ui: { notify: jest.Mock };
    onPathDeleted: jest.Mock;
    onSpaceDeleted: jest.Mock;
};

const buildSuperstate = (opts: {
    enableNestedHubRows: boolean;
    hubFolder?: boolean; // index HUB_ROW_FOLDER as a space whose note IS HUB_ROW_PATH
    renamePathImpl?: jest.Mock;
    renameSpaceImpl?: jest.Mock;
    deletePathImpl?: jest.Mock;
}): MockSuperstate => {
    const spacesIndex = new Map<
        string,
        { type?: string; space: { notePath: string } }
    >();
    const contextsIndex = new Map<string, { path: string }>();
    if (opts.hubFolder) {
        spacesIndex.set(HUB_ROW_FOLDER, { space: { notePath: HUB_ROW_PATH } });
        contextsIndex.set(HUB_ROW_FOLDER, { path: HUB_ROW_FOLDER });
    }
    return {
        settings: { enableNestedHubRows: opts.enableNestedHubRows },
        spacesIndex,
        contextsIndex,
        spaceManager: {
            renamePath:
                opts.renamePathImpl ??
                jest.fn((oldPath: string, newPath: string) =>
                    Promise.resolve(newPath)
                ),
            renameSpace:
                opts.renameSpaceImpl ??
                jest.fn(() => Promise.resolve(undefined)),
            deletePath:
                opts.deletePathImpl ??
                jest.fn(() => Promise.resolve(undefined)),
        },
        ui: { notify: jest.fn() },
        onPathDeleted: jest.fn(),
        // Mirrors superstate.ts's real onSpaceDeleted closely enough to prove
        // the cascade wires it up: purges the folder from spacesIndex/
        // contextsIndex (the two production caches the real implementation
        // deletes first).
        onSpaceDeleted: jest.fn((path: string) => {
            spacesIndex.delete(path);
            contextsIndex.delete(path);
        }),
    };
};

describe("renamePathByName — hub-row cascade", () => {
    it("flag ON + hub row: cascades the sibling folder rename", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: true,
        });

        const result = await renamePathByName(
            superstate as any,
            HUB_ROW_PATH,
            "Gidi Renamed"
        );

        expect(result).toBe("Knowledge/Gidi Renamed.md");
        expect(superstate.spaceManager.renamePath).toHaveBeenCalledWith(
            HUB_ROW_PATH,
            "Knowledge/Gidi Renamed.md"
        );
        expect(superstate.spaceManager.renameSpace).toHaveBeenCalledWith(
            HUB_ROW_FOLDER,
            "Knowledge/Gidi Renamed"
        );
    });

    it("CURRENT BEHAVIOR — flag OFF: renames only the file, folder orphaned (no cascade call at all)", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: false,
            hubFolder: true,
        });

        const result = await renamePathByName(
            superstate as any,
            HUB_ROW_PATH,
            "Gidi Renamed"
        );

        expect(result).toBe("Knowledge/Gidi Renamed.md");
        expect(superstate.spaceManager.renameSpace).not.toHaveBeenCalled();
    });

    it("flag ON but NOT a hub row (no sibling folder indexed): no cascade call", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: false,
        });

        await renamePathByName(superstate as any, "Knowledge/Plain.md", "New Name");

        expect(superstate.spaceManager.renameSpace).not.toHaveBeenCalled();
    });

    it("a cascade failure notifies but does not throw or roll back the primary rename", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: true,
            renameSpaceImpl: jest.fn(() =>
                Promise.reject(new Error("disk full"))
            ),
        });

        const result = await renamePathByName(
            superstate as any,
            HUB_ROW_PATH,
            "Gidi Renamed"
        );

        expect(result).toBe("Knowledge/Gidi Renamed.md");
        expect(superstate.ui.notify).toHaveBeenCalledTimes(1);
    });

    it("a failed primary rename (renamePath resolves falsy) never cascades the sibling folder — no desync", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: true,
            renamePathImpl: jest.fn(() => Promise.resolve(null)),
        });

        const result = await renamePathByName(
            superstate as any,
            HUB_ROW_PATH,
            "Gidi Renamed"
        );

        expect(result).toBeNull();
        expect(superstate.spaceManager.renameSpace).not.toHaveBeenCalled();
    });

    it("existing space-path branch (renaming an actual space/tag) is untouched — never runs the hub-row cascade", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: false,
        });
        // oldPath is ITSELF an indexed space (folder-row case), matching the
        // `spacesIndex.has(oldPath)` branch — a completely different code path.
        superstate.spacesIndex.set(HUB_ROW_FOLDER, {
            space: { notePath: "Knowledge/Gidi/Gidi.md" }, // inside-mode
        });

        await renamePathByName(superstate as any, HUB_ROW_FOLDER, "New Folder Name");

        expect(superstate.spaceManager.renameSpace).toHaveBeenCalledWith(
            HUB_ROW_FOLDER,
            "Knowledge/New Folder Name"
        );
        expect(superstate.spaceManager.renamePath).not.toHaveBeenCalled();
    });
});

describe("movePathToSpace — hub-row cascade", () => {
    it("flag ON + hub row: cascades the sibling folder move to the new parent", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: true,
        });

        await movePathToSpace(superstate as any, HUB_ROW_PATH, "Archive");

        expect(superstate.spaceManager.renamePath).toHaveBeenCalledWith(
            HUB_ROW_PATH,
            "Archive/Gidi.md"
        );
        expect(superstate.spaceManager.renameSpace).toHaveBeenCalledWith(
            HUB_ROW_FOLDER,
            "Archive/Gidi"
        );
    });

    it("CURRENT BEHAVIOR — flag OFF: moves only the file", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: false,
            hubFolder: true,
        });

        await movePathToSpace(superstate as any, HUB_ROW_PATH, "Archive");

        expect(superstate.spaceManager.renameSpace).not.toHaveBeenCalled();
    });

    it("a failed primary move (renamePath resolves falsy) never cascades the sibling folder — no desync", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: true,
            renamePathImpl: jest.fn(() => Promise.resolve(undefined)),
        });

        await movePathToSpace(superstate as any, HUB_ROW_PATH, "Archive");

        expect(superstate.spaceManager.renameSpace).not.toHaveBeenCalled();
    });
});

describe("deletePath — hub-row cascade", () => {
    it("flag ON + hub row: cascades the sibling folder delete via deletePath (deleteSpace is tag-only and must never be used for a folder path)", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: true,
        });

        await deletePath(superstate as any, HUB_ROW_PATH);

        expect(superstate.spaceManager.deletePath).toHaveBeenCalledWith(
            HUB_ROW_PATH
        );
        expect(superstate.spaceManager.deletePath).toHaveBeenCalledWith(
            HUB_ROW_FOLDER
        );
        expect(superstate.onPathDeleted).toHaveBeenCalledWith(HUB_ROW_PATH);
    });

    it("flag ON + hub row: pairs the folder deletePath with onSpaceDeleted, clearing spacesIndex/contextsIndex for the folder", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: true,
        });

        expect(superstate.spacesIndex.has(HUB_ROW_FOLDER)).toBe(true);
        expect(superstate.contextsIndex.has(HUB_ROW_FOLDER)).toBe(true);

        await deletePath(superstate as any, HUB_ROW_PATH);

        expect(superstate.onSpaceDeleted).toHaveBeenCalledWith(HUB_ROW_FOLDER);
        expect(superstate.spacesIndex.has(HUB_ROW_FOLDER)).toBe(false);
        expect(superstate.contextsIndex.has(HUB_ROW_FOLDER)).toBe(false);
    });

    it("CURRENT BEHAVIOR — flag OFF: deletes only the file, folder left behind", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: false,
            hubFolder: true,
        });

        await deletePath(superstate as any, HUB_ROW_PATH);

        expect(superstate.spaceManager.deletePath).toHaveBeenCalledTimes(1);
        expect(superstate.spaceManager.deletePath).toHaveBeenCalledWith(
            HUB_ROW_PATH
        );
    });

    it("flag ON but not a hub row (plain file): no cascade call", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: false,
        });

        await deletePath(superstate as any, "Knowledge/Plain.md");

        expect(superstate.spaceManager.deletePath).toHaveBeenCalledTimes(1);
        expect(superstate.spaceManager.deletePath).toHaveBeenCalledWith(
            "Knowledge/Plain.md"
        );
    });

    it("a cascade failure notifies but does not throw, and never calls onSpaceDeleted (the folder was not actually deleted)", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: true,
            deletePathImpl: jest.fn((path: string) =>
                path === HUB_ROW_FOLDER
                    ? Promise.reject(new Error("locked"))
                    : Promise.resolve(undefined)
            ),
        });

        await expect(
            deletePath(superstate as any, HUB_ROW_PATH)
        ).resolves.toBeUndefined();
        expect(superstate.ui.notify).toHaveBeenCalledTimes(1);
        expect(superstate.onSpaceDeleted).not.toHaveBeenCalled();
    });

    it("a failed primary delete (spaceManager.deletePath rejects for the row's own path) never cascades the sibling folder deletion — no desync", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: true,
            deletePathImpl: jest.fn((path: string) =>
                path === HUB_ROW_PATH
                    ? Promise.reject(new Error("locked"))
                    : Promise.resolve(undefined)
            ),
        });

        await expect(
            deletePath(superstate as any, HUB_ROW_PATH)
        ).resolves.toBeUndefined();

        expect(superstate.spaceManager.deletePath).toHaveBeenCalledTimes(1);
        expect(superstate.spaceManager.deletePath).toHaveBeenCalledWith(
            HUB_ROW_PATH
        );
        expect(superstate.spaceManager.deletePath).not.toHaveBeenCalledWith(
            HUB_ROW_FOLDER
        );
        expect(superstate.onSpaceDeleted).not.toHaveBeenCalled();
    });

    it("a failed primary delete never calls onPathDeleted and never runs the cascade (Notidian-z21a fix)", async () => {
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: true,
            deletePathImpl: jest.fn((path: string) =>
                path === HUB_ROW_PATH
                    ? Promise.reject(new Error("locked"))
                    : Promise.resolve(undefined)
            ),
        });

        await expect(
            deletePath(superstate as any, HUB_ROW_PATH)
        ).resolves.toBeUndefined();

        expect(superstate.onPathDeleted).not.toHaveBeenCalled();
        expect(superstate.spaceManager.deletePath).not.toHaveBeenCalledWith(
            HUB_ROW_FOLDER
        );
    });

    it("a successful primary delete calls onPathDeleted before running the cascade (Notidian-z21a fix)", async () => {
        const callOrder: string[] = [];
        const superstate = buildSuperstate({
            enableNestedHubRows: true,
            hubFolder: true,
            deletePathImpl: jest.fn((path: string) => {
                if (path === HUB_ROW_FOLDER) {
                    callOrder.push("cascade-delete");
                }
                return Promise.resolve(undefined);
            }),
        });
        superstate.onPathDeleted.mockImplementation(() => {
            callOrder.push("onPathDeleted");
        });

        await deletePath(superstate as any, HUB_ROW_PATH);

        expect(superstate.onPathDeleted).toHaveBeenCalledWith(HUB_ROW_PATH);
        expect(superstate.spaceManager.deletePath).toHaveBeenCalledWith(
            HUB_ROW_FOLDER
        );
        expect(callOrder).toEqual(["onPathDeleted", "cascade-delete"]);
    });
});
