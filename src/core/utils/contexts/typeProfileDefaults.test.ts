import { applyNewRowTypeProfileDefaults } from "core/utils/contexts/typeProfileDefaults";
import { typeProfileSchemaType } from "core/utils/contexts/typeProfile";

// ===========================================================================
// AUTHORITY net for applyNewRowTypeProfileDefaults (Notidian-3foh) — the
// frontmatter-seeding WRITE path of the new-row Type Profile defaults feature
// (Notidian-drv). The orchestrator reads the database hub note's declared
// profile and seeds a freshly-created row's frontmatter with each field's
// default. It is superstate-bound but driven here through the same fake-index
// stub convention used by this directory's other Superstate-seam tests
// (lookup.test.ts, tableRollupRuntime.property.test.ts): a hand-rolled
// spacesIndex/pathsIndex Map pair + a spaceManager.saveProperties sink.
//
// DELIBERATELY DOES NOT MOCK the frontmatterWrite seam (unlike the seam-level
// assertions in typeProfileMirror.test.ts). The never-throw authority invariant
// lives in saveFrontmatterProperties's try/catch, and the orchestrator itself
// has NO try/catch — it delegates the catch to the seam. Mocking the seam (as
// the mirror suite does) bypasses that try/catch, so it can only prove
// never-throw for a RESOLVED {ok:false}, never for a sink that actually
// THROWS/REJECTS. This file drives the REAL stack end to end so a save sink
// that throws is provably swallowed — the true authority boundary.
//
// LOCKED authority invariants (a regression in any is a corruption or a blocked
// row creation, never a cosmetic break):
//   NEVER-SEED-THE-HUB  the write targets the new row's filePath, never the
//                       hub/profile note's notePath. Seeding the hub would
//                       corrupt the schema source. Includes the explicit
//                       notePath == filePath self-seed guard.
//   NEVER-THROW         a missing/failed default must not block row creation.
//                       Every guard returns silently; a throwing save sink is
//                       swallowed and the orchestrator resolves to void.
//   EXACT-DEFAULTS      the happy path writes EXACTLY the profile's non-empty
//                       field-value defaults — no more, no less.
//   NO-OP GUARDS        no notePath / hub-self / no profile / empty defaults
//                       each short-circuit before any write reaches the sink.
// ===========================================================================

// A profiled hub note's frontmatter: the schema_type marker + a `fields:` map
// (with per-field `value` defaults) is what parseTypeProfile recognizes and
// newRowFrontmatterFromProfile harvests into seed values.
const profileFrontmatter = (
  fields: Record<string, unknown>
): Record<string, unknown> => ({
  schema_type: typeProfileSchemaType,
  fields,
});

type SaveCall = { path: string; properties: Record<string, unknown> };

// Build a fake Superstate wiring contextPath -> hub notePath -> frontmatter,
// plus a recording spaceManager.saveProperties sink and a ui.notify spy. The
// sink is real (not a jest.mock of the frontmatterWrite module), so the write
// flows through the production saveFrontmatterProperties try/catch.
//   notePath:null        -> the space has no backing hub note
//   frontmatter:null     -> the hub note has no profile
//   saveImpl override    -> simulate the sink succeeding/failing/throwing
const makeSuperstate = ({
  contextPath = "Library",
  notePath = "Library/Library.md",
  frontmatter,
  saveImpl,
}: {
  contextPath?: string;
  notePath?: string | null;
  frontmatter?: Record<string, unknown> | null;
  saveImpl?: (
    path: string,
    properties: Record<string, unknown>
  ) => Promise<unknown>;
}) => {
  const saveCalls: SaveCall[] = [];
  const notices: string[] = [];
  const saveProperties = jest.fn(
    async (path: string, properties: Record<string, unknown>) => {
      saveCalls.push({ path, properties });
      if (saveImpl) return saveImpl(path, properties);
      return true;
    }
  );
  const superstate = {
    spacesIndex: new Map([
      [contextPath, notePath ? { space: { notePath } } : { space: {} }],
    ]),
    pathsIndex: new Map(
      notePath
        ? [[notePath, { metadata: { property: frontmatter ?? undefined } }]]
        : []
    ),
    spaceManager: { saveProperties },
    ui: { notify: (msg: string) => notices.push(msg) },
  } as any;
  return { superstate, saveProperties, saveCalls, notices };
};

const seededProfile = (value = "infrastructure") =>
  profileFrontmatter({ Database: { kind: "text", value } });

describe("applyNewRowTypeProfileDefaults — no-op guards (no write reaches the sink)", () => {
  it("no-ops when the space has no hub note (notePath missing)", async () => {
    const { superstate, saveProperties } = makeSuperstate({ notePath: null });

    await applyNewRowTypeProfileDefaults(
      superstate,
      "Library",
      "Library/Row.md"
    );

    expect(saveProperties).not.toHaveBeenCalled();
  });

  it("no-ops when notePath == filePath (NEVER seeds the hub note itself)", async () => {
    // Self-seed guard: filePath IS the hub note path. Seeding it would write
    // schema defaults back over the schema source.
    const { superstate, saveProperties } = makeSuperstate({
      notePath: "Library/Library.md",
      frontmatter: seededProfile(),
    });

    await applyNewRowTypeProfileDefaults(
      superstate,
      "Library",
      "Library/Library.md"
    );

    expect(saveProperties).not.toHaveBeenCalled();
  });

  it("no-ops when the hub note declares no profile (frontmatter present, not a profile)", async () => {
    const { superstate, saveProperties } = makeSuperstate({
      frontmatter: { title: "Library" },
    });

    await applyNewRowTypeProfileDefaults(
      superstate,
      "Library",
      "Library/Row.md"
    );

    expect(saveProperties).not.toHaveBeenCalled();
  });

  it("no-ops when the hub note's frontmatter is entirely absent (undefined property)", async () => {
    // pathsIndex holds the note but with no metadata.property at all — the
    // optional-chain in the orchestrator must collapse to a no-profile no-op.
    const { superstate, saveProperties } = makeSuperstate({
      frontmatter: null,
    });

    await applyNewRowTypeProfileDefaults(
      superstate,
      "Library",
      "Library/Row.md"
    );

    expect(saveProperties).not.toHaveBeenCalled();
  });

  it("no-ops when the profile has zero field defaults (every field default empty/absent)", async () => {
    // A VALID profile, but no field declares a non-empty `value` default, so
    // newRowFrontmatterFromProfile yields {} and there is nothing to seed.
    const { superstate, saveProperties } = makeSuperstate({
      frontmatter: profileFrontmatter({
        Title: { kind: "text" },
        Status: { kind: "text", value: "" },
      }),
    });

    await applyNewRowTypeProfileDefaults(
      superstate,
      "Library",
      "Library/Row.md"
    );

    expect(saveProperties).not.toHaveBeenCalled();
  });
});

describe("applyNewRowTypeProfileDefaults — happy path (writes EXACTLY the profile defaults)", () => {
  it("seeds filePath (the new row) with exactly the non-empty field defaults, never notePath (the hub)", async () => {
    const { superstate, saveProperties, saveCalls } = makeSuperstate({
      notePath: "Library/Library.md",
      frontmatter: seededProfile("infrastructure"),
    });

    await applyNewRowTypeProfileDefaults(
      superstate,
      "Library",
      "Library/Row.md"
    );

    expect(saveProperties).toHaveBeenCalledTimes(1);
    expect(saveCalls).toHaveLength(1);
    // NEVER-SEED-THE-HUB: target is the new row, not the hub note.
    expect(saveCalls[0].path).toBe("Library/Row.md");
    expect(saveCalls[0].path).not.toBe("Library/Library.md");
    // EXACT-DEFAULTS: precisely the profile's non-empty defaults, nothing else.
    expect(saveCalls[0].properties).toEqual({ Database: "infrastructure" });
  });

  it("writes ONLY fields with a non-empty default — empty/absent-default fields are left for the user", async () => {
    const { superstate, saveCalls } = makeSuperstate({
      notePath: "Library/Library.md",
      frontmatter: profileFrontmatter({
        Database: { kind: "text", value: "infrastructure" },
        Status: { kind: "select", value: "active", options: ["active", "done"] },
        Title: { kind: "text" }, // no default -> excluded
        Notes: { kind: "text", value: "" }, // empty default -> excluded
      }),
    });

    await applyNewRowTypeProfileDefaults(
      superstate,
      "Library",
      "Library/Row.md"
    );

    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0].properties).toEqual({
      Database: "infrastructure",
      Status: "active",
    });
    expect(saveCalls[0].properties).not.toHaveProperty("Title");
    expect(saveCalls[0].properties).not.toHaveProperty("Notes");
  });

  it("returns void on the successful seed path so empty-create callers can fire-and-forget", async () => {
    const { superstate } = makeSuperstate({
      notePath: "Library/Library.md",
      frontmatter: seededProfile(),
    });

    const result = await applyNewRowTypeProfileDefaults(
      superstate,
      "Library",
      "Library/Row.md"
    );

    expect(result).toBeUndefined();
  });
});

describe("applyNewRowTypeProfileDefaults — NEVER-THROW authority invariant", () => {
  it("swallows a save sink that RESOLVES failure (saveProperties -> false) and resolves to void", async () => {
    const { superstate, saveProperties, notices } = makeSuperstate({
      notePath: "Library/Library.md",
      frontmatter: seededProfile(),
      saveImpl: async () => false,
    });

    await expect(
      applyNewRowTypeProfileDefaults(superstate, "Library", "Library/Row.md")
    ).resolves.toBeUndefined();

    expect(saveProperties).toHaveBeenCalledTimes(1);
    // The failure surfaces as a notice (the failureMessage), not an exception.
    expect(notices).toEqual([
      "Could not apply database defaults to the new row.",
    ]);
  });

  it("swallows a save sink that THROWS/REJECTS — a missing default must NOT block row creation", async () => {
    // The orchestrator has no try/catch of its own; this proves the real
    // saveFrontmatterProperties try/catch absorbs a throwing spaceManager so the
    // row-creation chain that awaits this never rejects. Mocking the seam (the
    // mirror suite) cannot reach this branch — the rejection is the whole point.
    const boom = new Error("space manager unavailable");
    const { superstate, saveProperties, notices } = makeSuperstate({
      notePath: "Library/Library.md",
      frontmatter: seededProfile(),
      saveImpl: async () => {
        throw boom;
      },
    });

    await expect(
      applyNewRowTypeProfileDefaults(superstate, "Library", "Library/Row.md")
    ).resolves.toBeUndefined();

    expect(saveProperties).toHaveBeenCalledTimes(1);
    expect(notices).toEqual([
      "Could not apply database defaults to the new row.",
    ]);
  });

  it("does not even notify on any no-op guard — a guarded no-op is silent, not a failure", async () => {
    // No notePath -> the earliest guard -> the sink is never touched, so there
    // is nothing to fail and nothing to notify.
    const { superstate, saveProperties, notices } = makeSuperstate({
      notePath: null,
    });

    await applyNewRowTypeProfileDefaults(
      superstate,
      "Library",
      "Library/Row.md"
    );

    expect(saveProperties).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
  });
});
