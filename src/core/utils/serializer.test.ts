/**
 * DEPTH (pure seam) net for src/core/utils/serializer.ts — Notidian-aqjz.
 *
 * Two tiny but DATA-BEARING serializers had ZERO co-located coverage. They
 * produce the JSON string that is *persisted* into cells / context defs, so a
 * silent change here is silent corruption of stored data on disk.
 *
 *   export const serializeDefString = (def) => JSON.stringify(def);
 *   export const serializeOptionValue = (newOptions, value) =>
 *     JSON.stringify({
 *       ...value,
 *       options: newOptions.map((f) => ({ name, value, color })),
 *     });
 *
 * serializeOptionValue is the writer for the JSON that backs option/select
 * cells. Its output is consumed by:
 *   - OptionCell.tsx (parses the existing cell JSON into `parsedValue`, then
 *     re-serializes with `serializeOptionValue(newOptions, parsedValue)` — so
 *     the SPREAD BASE must round-trip: fields like `colorScheme` that live
 *     alongside `options` must survive an edit),
 *   - ContextEditorContext.tsx, propertyTypeValue.ts (`serializeOptionValue(opts, {})`),
 *     and spaceManager.ts.
 * A `SelectOption` is a rich UI object (id, fragment, section, icon, sortable,
 * onClick, ...). Persisting the WHOLE option would (a) bloat the cell, (b) try
 * to JSON-serialize React FCs / callbacks. So the contract is: project ONLY
 * {name, value, color} per option, drop everything else, preserve order, and
 * round-trip through JSON.parse.
 *
 * These are CHARACTERIZATION tests: they lock in current behavior so a future
 * refactor of the persisted shape must be deliberate.
 */
import { SelectOption } from "makemd-core";
import { ContextDef } from "shared/types/context";
import { serializeDefString, serializeOptionValue } from "./serializer";

/** Build a fully-populated SelectOption to prove non-projected fields drop. */
const richOption = (over: Partial<SelectOption> = {}): SelectOption => ({
  id: 7,
  name: "Alpha",
  value: "alpha",
  color: "#ff0000",
  section: "sec",
  description: "a description",
  icon: "lucide//star",
  sortable: true,
  removeable: true,
  disabled: false,
  onClick: () => {},
  onRemove: () => {},
  ...over,
});

describe("serializeOptionValue", () => {
  it("projects ONLY {name,value,color} from each option, dropping every other field", () => {
    const out = JSON.parse(serializeOptionValue([richOption()], {}));
    expect(out.options).toEqual([
      { name: "Alpha", value: "alpha", color: "#ff0000" },
    ]);
    // Exactly those three keys — no id/section/icon/sortable/callbacks leaked.
    expect(Object.keys(out.options[0]).sort()).toEqual([
      "color",
      "name",
      "value",
    ]);
  });

  it("does not throw when an option carries a non-serializable callback/FC (it is dropped before stringify)", () => {
    expect(() =>
      serializeOptionValue([richOption({ onClick: () => {} })], {})
    ).not.toThrow();
    const out = JSON.parse(serializeOptionValue([richOption()], {}));
    expect(out.options[0]).not.toHaveProperty("onClick");
    expect(out.options[0]).not.toHaveProperty("fragment");
  });

  it("preserves the spread base value alongside options (colorScheme round-trips through an edit)", () => {
    // Mirrors OptionCell.tsx: parsedValue (the existing cell) is the base, and
    // only `options` is overwritten. Sibling fields MUST survive.
    const base = { colorScheme: "default", custom: { nested: [1, 2] }, foo: "bar" };
    const out = JSON.parse(serializeOptionValue([richOption()], base));
    expect(out.colorScheme).toBe("default");
    expect(out.custom).toEqual({ nested: [1, 2] });
    expect(out.foo).toBe("bar");
  });

  it("lets the spread base be overridden by the projected options (base.options is replaced, not merged)", () => {
    const base = { options: [{ name: "STALE", value: "stale", color: "#000" }] };
    const out = JSON.parse(
      serializeOptionValue([richOption({ name: "Fresh", value: "fresh" })], base)
    );
    expect(out.options).toEqual([
      { name: "Fresh", value: "fresh", color: "#ff0000" },
    ]);
  });

  it("preserves option ORDER", () => {
    const opts = [
      richOption({ name: "A", value: "a" }),
      richOption({ name: "B", value: "b" }),
      richOption({ name: "C", value: "c" }),
    ];
    const out = JSON.parse(serializeOptionValue(opts, {}));
    expect(out.options.map((o: any) => o.value)).toEqual(["a", "b", "c"]);
  });

  it("emits options:[] for an empty option list", () => {
    const out = JSON.parse(serializeOptionValue([], { colorScheme: "x" }));
    expect(out.options).toEqual([]);
    expect(out.colorScheme).toBe("x");
  });

  it("carries undefined value/color through as missing keys after a JSON round-trip", () => {
    // value/color are optional on SelectOption; JSON drops undefined values.
    const out = JSON.parse(
      serializeOptionValue(
        [{ name: "Bare" } as SelectOption],
        {}
      )
    );
    expect(out.options[0]).toEqual({ name: "Bare" });
    expect(out.options[0]).not.toHaveProperty("value");
    expect(out.options[0]).not.toHaveProperty("color");
  });

  it("returns valid JSON that always round-trips through JSON.parse", () => {
    const str = serializeOptionValue(
      [richOption(), richOption({ name: "B", value: "b", color: "#00ff00" })],
      { colorScheme: "default" }
    );
    expect(typeof str).toBe("string");
    expect(() => JSON.parse(str)).not.toThrow();
    expect(JSON.parse(str)).toEqual({
      colorScheme: "default",
      options: [
        { name: "Alpha", value: "alpha", color: "#ff0000" },
        { name: "B", value: "b", color: "#00ff00" },
      ],
    });
  });
});

describe("serializeDefString", () => {
  it("produces stable JSON for a ContextDef[] that round-trips", () => {
    const defs: ContextDef[] = [
      { type: "tag", value: "#projects" },
      { type: "tag", value: "#archive" },
    ];
    const str = serializeDefString(defs);
    expect(str).toBe(JSON.stringify(defs));
    expect(JSON.parse(str)).toEqual(defs);
  });

  it("preserves def order", () => {
    const defs: ContextDef[] = [
      { type: "tag", value: "#a" },
      { type: "tag", value: "#b" },
      { type: "tag", value: "#c" },
    ];
    expect(JSON.parse(serializeDefString(defs)).map((d: ContextDef) => d.value)).toEqual([
      "#a",
      "#b",
      "#c",
    ]);
  });

  it("serializes an empty def array to '[]'", () => {
    expect(serializeDefString([])).toBe("[]");
  });
});
