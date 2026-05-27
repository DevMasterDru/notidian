import { parseFieldValue } from "core/schemas/parseFieldValue";
import { valueForPropertyTypeChange } from "./propertyTypeValue";

describe("valueForPropertyTypeChange", () => {
  it("serializes option configuration once when converting to option", () => {
    const value = valueForPropertyTypeChange({
      field: { name: "status", type: "text", value: "" },
      nextType: "option",
      observedOptions: ["active", "paused"],
    });

    expect(JSON.parse(value)).toEqual({
      options: [
        { name: "active", value: "active" },
        { name: "paused", value: "paused" },
      ],
    });
    expect(parseFieldValue(value, "option").options).toEqual([
      { name: "active", value: "active" },
      { name: "paused", value: "paused" },
    ]);
  });

  it("preserves existing configuration when staying in the same type family", () => {
    const existingValue = JSON.stringify({ format: "0,0.00" });

    expect(
      valueForPropertyTypeChange({
        field: { name: "rating", type: "number", value: existingValue },
        nextType: "number",
        observedOptions: [],
      })
    ).toBe(existingValue);
  });

  it("preserves option configuration when switching between single and multi option", () => {
    const existingValue = JSON.stringify({
      options: [{ name: "active", value: "active", color: "green" }],
      colorScheme: "notidian-status",
    });

    expect(
      valueForPropertyTypeChange({
        field: { name: "status", type: "option-multi", value: existingValue },
        nextType: "option",
        observedOptions: ["paused"],
      })
    ).toBe(existingValue);
  });

  it("clears stale configuration when changing to an unrelated type", () => {
    expect(
      valueForPropertyTypeChange({
        field: {
          name: "status",
          type: "option",
          value: JSON.stringify({
            options: [{ name: "active", value: "active" }],
          }),
        },
        nextType: "number",
        observedOptions: [],
      })
    ).toBe("");
  });
});
