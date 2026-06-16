import {
  isTypeProfileMirrorableType,
  mirrorSchemaChangeToTypeProfile,
  TypeProfileSchemaState,
} from "core/utils/contexts/typeProfileMirror";
import { applyNewRowTypeProfileDefaults } from "core/utils/contexts/typeProfileDefaults";
import { saveFrontmatterProperties } from "core/utils/properties/frontmatterWrite";
import { typeProfileSchemaType } from "core/utils/contexts/typeProfile";

// Both orchestrators funnel every write through saveFrontmatterProperties; the
// real implementation talks to spaceManager.saveProperties + ui.notify. We spy
// on that one seam so the tests assert exactly which path/properties get written
// and can simulate the save succeeding or failing without a real space manager.
jest.mock("core/utils/properties/frontmatterWrite");

const mockSave = saveFrontmatterProperties as jest.MockedFunction<
  typeof saveFrontmatterProperties
>;

beforeEach(() => {
  mockSave.mockReset();
  mockSave.mockResolvedValue({ ok: true });
});

// ---------------------------------------------------------------------------
// Fake Superstate seam (spacesIndex / pathsIndex).
// ---------------------------------------------------------------------------

// A profiled hub note's frontmatter: schema_type marker + a `fields:` map (and
// optionally a `kind_fields:` map) is what parseTypeProfile recognizes.
const profileFrontmatter = (
  fields: Record<string, unknown>,
  kindFields?: Record<string, unknown>
): Record<string, unknown> => ({
  schema_type: typeProfileSchemaType,
  fields,
  ...(kindFields ? { kind_fields: kindFields } : {}),
});

// Build a fake Superstate where contextPath -> hub note path -> frontmatter.
// Passing notePath=null models "the space has no backing hub note"; passing a
// frontmatter of null models "the hub note has no profile".
const makeSuperstate = ({
  contextPath = "Library",
  notePath = "Library/Library.md",
  frontmatter,
}: {
  contextPath?: string;
  notePath?: string | null;
  frontmatter?: Record<string, unknown> | null;
}): any => ({
  spacesIndex: new Map([
    [contextPath, notePath ? { space: { notePath } } : { space: {} }],
  ]),
  pathsIndex: new Map(
    notePath
      ? [[notePath, { metadata: { property: frontmatter ?? undefined } }]]
      : []
  ),
});

describe("isTypeProfileMirrorableType", () => {
  it("mirrors the bare mirrorable kinds", () => {
    for (const type of [
      "text",
      "password",
      "option",
      "date",
      "number",
      "boolean",
      "link",
    ]) {
      expect(isTypeProfileMirrorableType(type)).toBe(true);
    }
  });

  it("mirrors the '<prefix>-' suffixed variants", () => {
    for (const type of [
      "text-multi",
      "option-multi",
      "date-time",
      "link-context",
      "number-currency",
    ]) {
      expect(isTypeProfileMirrorableType(type)).toBe(true);
    }
  });

  it("does NOT mirror computed/relation/layout (and other unknown) kinds", () => {
    for (const type of [
      "fileprop",
      "super",
      "context",
      "aggregate",
      "object",
      "image",
      "space",
      "flex",
      "icon",
      "color",
      "tag",
    ]) {
      expect(isTypeProfileMirrorableType(type)).toBe(false);
    }
  });

  it("rejects prefix-collision false positives — only an exact '<prefix>-' boundary mirrors", () => {
    // These all START WITH a mirrorable prefix but are NOT followed by the
    // exact '-' boundary, so the startsWith(prefix + "-") gate must reject them.
    expect(isTypeProfileMirrorableType("textarea")).toBe(false);
    expect(isTypeProfileMirrorableType("numbery")).toBe(false);
    expect(isTypeProfileMirrorableType("numberfoo")).toBe(false);
    expect(isTypeProfileMirrorableType("linker")).toBe(false);
    expect(isTypeProfileMirrorableType("dateline")).toBe(false);
    expect(isTypeProfileMirrorableType("optional")).toBe(false);
    expect(isTypeProfileMirrorableType("booleanish")).toBe(false);
    expect(isTypeProfileMirrorableType("passwords")).toBe(false);
    // The precise boundary is '<prefix>-'; one char short ('number') is the
    // exact-match branch (true), the suffixed sibling without '-' is false.
    expect(isTypeProfileMirrorableType("number")).toBe(true);
    expect(isTypeProfileMirrorableType("number-")).toBe(true);
    expect(isTypeProfileMirrorableType("number_currency")).toBe(false);
  });

  it("default-denies the empty string and is case-sensitive", () => {
    expect(isTypeProfileMirrorableType("")).toBe(false);
    expect(isTypeProfileMirrorableType("Text")).toBe(false);
    expect(isTypeProfileMirrorableType("LINK")).toBe(false);
    expect(isTypeProfileMirrorableType("Number-multi")).toBe(false);
  });

  it("does not match a prefix appearing mid-string (anchored at the start only)", () => {
    expect(isTypeProfileMirrorableType("super-text")).toBe(false);
    expect(isTypeProfileMirrorableType("my-number")).toBe(false);
    expect(isTypeProfileMirrorableType("a-link")).toBe(false);
  });
});

describe("mirrorSchemaChangeToTypeProfile", () => {
  const addColumn = { kind: "add-column" as const, name: "Status", type: "text" };

  it("no-ops with {ok:false,state:null} when the space has no hub note", async () => {
    const superstate = makeSuperstate({ notePath: null });

    const result = await mirrorSchemaChangeToTypeProfile(
      superstate,
      "Library",
      addColumn
    );

    expect(result).toEqual({ ok: false, state: null });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("no-ops with {ok:false,state:null} when the hub note declares no profile", async () => {
    // A real note, but its frontmatter lacks the schema_type marker.
    const superstate = makeSuperstate({
      frontmatter: { title: "Library" },
    });

    const result = await mirrorSchemaChangeToTypeProfile(
      superstate,
      "Library",
      addColumn
    );

    expect(result).toEqual({ ok: false, state: null });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("returns {ok:true} and forwards state but writes nothing when the plan is unchanged", async () => {
    // The column the change adds already exists in the hub `fields` map, so
    // planTypeProfileMirror reports changed=false (echo/loop prevention).
    const fields = { Status: { kind: "text" } };
    const superstate = makeSuperstate({
      frontmatter: profileFrontmatter(fields),
    });

    const result = await mirrorSchemaChangeToTypeProfile(superstate, "Library", {
      kind: "add-column",
      name: "Status",
      type: "text",
    });

    expect(result.ok).toBe(true);
    // State forwarded = the current (unchanged) maps, so the serializer can
    // thread them to the next write in the burst.
    expect(result.state).toEqual({ fields, kindFields: {} });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("writes only the changed `fields` map (not kind_fields) for a common-field change", async () => {
    const fields = { Title: { kind: "text" } };
    const kindFields = { task: { Priority: { kind: "number" } } };
    const superstate = makeSuperstate({
      frontmatter: profileFrontmatter(fields, kindFields),
    });

    const result = await mirrorSchemaChangeToTypeProfile(superstate, "Library", {
      kind: "add-column",
      name: "Status",
      type: "text",
    });

    expect(result.ok).toBe(true);
    expect(mockSave).toHaveBeenCalledTimes(1);
    const arg = mockSave.mock.calls[0][0];
    expect(arg.path).toBe("Library/Library.md");
    // Only `fields` is written; the untouched kind_fields map is NOT in the
    // properties payload (never writes both when one is unchanged).
    expect(Object.keys(arg.properties)).toEqual(["fields"]);
    expect(arg.properties).toEqual({
      fields: { Title: { kind: "text" }, Status: { kind: "text" } },
    });
    // The forwarded state still carries BOTH current maps for the next write.
    expect(result.state).toEqual({
      fields: { Title: { kind: "text" }, Status: { kind: "text" } },
      kindFields,
    });
  });

  it("writes only the changed `kind_fields` map (not fields) for a kind-owned change", async () => {
    // Adding an option to a field that lives inside a kind sub-schema must
    // rewrite kind_fields only, leaving the common fields map untouched.
    const fields = { Title: { kind: "text" } };
    const kindFields = {
      task: { Stage: { kind: "select", options: ["a"] } },
    };
    const superstate = makeSuperstate({
      frontmatter: profileFrontmatter(fields, kindFields),
    });

    const result = await mirrorSchemaChangeToTypeProfile(superstate, "Library", {
      kind: "add-option",
      name: "Stage",
      option: "b",
    });

    expect(result.ok).toBe(true);
    expect(mockSave).toHaveBeenCalledTimes(1);
    const arg = mockSave.mock.calls[0][0];
    expect(Object.keys(arg.properties)).toEqual(["kind_fields"]);
    expect(arg.properties).toEqual({
      kind_fields: { task: { Stage: { kind: "select", options: ["a", "b"] } } },
    });
  });

  it("feeds baseOverride maps to the planner so a lagging cache can't resurrect a stale map (Notidian-lg1)", async () => {
    // The metadata cache (frontmatter) still shows the PRE-burst state: only
    // option `a`. The previous mirror in this burst already added `b` and
    // threaded that forward as baseOverride. Without the override the planner
    // would read the stale cache, see `b` missing, and re-add it onto the stale
    // base — clobbering nothing here but, in a multi-option burst, dropping the
    // earlier change. With the override the planner builds on { a, b }.
    const staleFields = { Status: { kind: "select", options: ["a"] } };
    const superstate = makeSuperstate({
      frontmatter: profileFrontmatter(staleFields),
    });
    const baseOverride: TypeProfileSchemaState = {
      fields: { Status: { kind: "select", options: ["a", "b"] } },
      kindFields: {},
    };

    const result = await mirrorSchemaChangeToTypeProfile(
      superstate,
      "Library",
      { kind: "add-option", name: "Status", option: "c" },
      baseOverride
    );

    expect(result.ok).toBe(true);
    expect(mockSave).toHaveBeenCalledTimes(1);
    // The written map preserves the threaded `b` AND adds `c` — proof the
    // override (not the stale cache) seeded the plan.
    expect(mockSave.mock.calls[0][0].properties).toEqual({
      fields: { Status: { kind: "select", options: ["a", "b", "c"] } },
    });
    expect(result.state).toEqual({
      fields: { Status: { kind: "select", options: ["a", "b", "c"] } },
      kindFields: {},
    });
  });

  it("treats a baseOverride that already reflects the change as a no-op (no duplicate write)", async () => {
    // The threaded base already has option `b`; re-mirroring `b` must report no
    // change and write nothing, even though the stale cache lacks it.
    const staleFields = { Status: { kind: "select", options: ["a"] } };
    const superstate = makeSuperstate({
      frontmatter: profileFrontmatter(staleFields),
    });
    const baseOverride: TypeProfileSchemaState = {
      fields: { Status: { kind: "select", options: ["a", "b"] } },
      kindFields: {},
    };

    const result = await mirrorSchemaChangeToTypeProfile(
      superstate,
      "Library",
      { kind: "add-option", name: "Status", option: "b" },
      baseOverride
    );

    expect(result.ok).toBe(true);
    expect(mockSave).not.toHaveBeenCalled();
    // The unchanged state still forwards the threaded maps.
    expect(result.state).toEqual(baseOverride);
  });

  it("returns {ok:false,state:null} when the save fails and never rolls back (failure is a notice)", async () => {
    // saveFrontmatterProperties owns the notice; the orchestrator just relays
    // the failure. Critically it does NOT re-write / undo the table-side change
    // — it issues exactly the one (failed) write and surfaces ok:false.
    mockSave.mockResolvedValue({ ok: false });
    const fields = { Title: { kind: "text" } };
    const superstate = makeSuperstate({
      frontmatter: profileFrontmatter(fields),
    });

    const result = await mirrorSchemaChangeToTypeProfile(superstate, "Library", {
      kind: "add-column",
      name: "Status",
      type: "text",
    });

    expect(result).toEqual({ ok: false, state: null });
    // Exactly one write attempt, no compensating rollback write.
    expect(mockSave).toHaveBeenCalledTimes(1);
    // The failure message is carried so the seam can surface a notice.
    expect(mockSave.mock.calls[0][0].failureMessage).toMatch(/hub note/);
  });
});

describe("applyNewRowTypeProfileDefaults", () => {
  const seeded = (value = "infrastructure") =>
    profileFrontmatter({
      Database: { kind: "text", value },
    });

  it("no-ops when the space has no hub note (notePath missing)", async () => {
    const superstate = makeSuperstate({ notePath: null });

    await applyNewRowTypeProfileDefaults(superstate, "Library", "Library/Row.md");

    expect(mockSave).not.toHaveBeenCalled();
  });

  it("no-ops when notePath == filePath (never seeds the hub note itself)", async () => {
    const superstate = makeSuperstate({
      notePath: "Library/Library.md",
      frontmatter: seeded(),
    });

    // Self-seed guard: filePath IS the hub note path.
    await applyNewRowTypeProfileDefaults(
      superstate,
      "Library",
      "Library/Library.md"
    );

    expect(mockSave).not.toHaveBeenCalled();
  });

  it("no-ops when the hub note declares no profile", async () => {
    const superstate = makeSuperstate({
      frontmatter: { title: "Library" },
    });

    await applyNewRowTypeProfileDefaults(superstate, "Library", "Library/Row.md");

    expect(mockSave).not.toHaveBeenCalled();
  });

  it("no-ops when the profile has no field defaults (empty defaults map)", async () => {
    // A valid profile, but no field declares a non-empty `value` default.
    const superstate = makeSuperstate({
      frontmatter: profileFrontmatter({ Title: { kind: "text" } }),
    });

    await applyNewRowTypeProfileDefaults(superstate, "Library", "Library/Row.md");

    expect(mockSave).not.toHaveBeenCalled();
  });

  it("writes the profile defaults to filePath (the new row), not notePath (the hub)", async () => {
    const superstate = makeSuperstate({
      notePath: "Library/Library.md",
      frontmatter: seeded("infrastructure"),
    });

    await applyNewRowTypeProfileDefaults(superstate, "Library", "Library/Row.md");

    expect(mockSave).toHaveBeenCalledTimes(1);
    const arg = mockSave.mock.calls[0][0];
    // Target the new row file, never the hub note.
    expect(arg.path).toBe("Library/Row.md");
    expect(arg.path).not.toBe("Library/Library.md");
    expect(arg.properties).toEqual({ Database: "infrastructure" });
  });

  it("does not throw when the save fails — a missing default must not block row creation", async () => {
    mockSave.mockResolvedValue({ ok: false });
    const superstate = makeSuperstate({
      notePath: "Library/Library.md",
      frontmatter: seeded(),
    });

    await expect(
      applyNewRowTypeProfileDefaults(superstate, "Library", "Library/Row.md")
    ).resolves.toBeUndefined();
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it("returns void (never a value) on the successful seed path so callers can fire-and-forget", async () => {
    // The contract is intentionally void: the empty-create paths await it only
    // to order writes, never to branch on a result. saveFrontmatterProperties
    // (the seam) owns the notify-on-failure, so the orchestrator stays thin and
    // never throws — proven by the no-profile/no-default/ok:false cases above.
    const superstate = makeSuperstate({
      notePath: "Library/Library.md",
      frontmatter: seeded(),
    });

    const result = await applyNewRowTypeProfileDefaults(
      superstate,
      "Library",
      "Library/Row.md"
    );

    expect(result).toBeUndefined();
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});
