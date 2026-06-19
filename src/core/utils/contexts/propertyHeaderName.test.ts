import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import {
  propertyHeaderDisplayName,
  propertyHeaderNameInfo,
} from "./propertyHeaderName";

describe("propertyHeaderDisplayName", () => {
  it("shows generated labels for frontmatter-backed table headers", () => {
    expect(
      propertyHeaderDisplayName({
        name: "sensor_id",
        type: "text",
        value: JSON.stringify({ alias: "Sensor Identifier" }),
        source: frontmatterPropertySource,
      })
    ).toBe("Sensor ID");
  });

  it("formats common technical snake-case keys for frontmatter-backed headers", () => {
    expect(
      [
        "mqtt_state_topic",
        "ai_model",
        "llm_prompt_id",
        "gpio_signal_voltage",
        "firmware_component",
        "sensor_supply_voltage",
        "created_at",
      ].map((name) =>
        propertyHeaderDisplayName({
          name,
          type: "text",
          value: "",
          source: frontmatterPropertySource,
        })
      )
    ).toEqual([
      "MQTT State Topic",
      "AI Model",
      "LLM Prompt ID",
      "GPIO Signal Voltage",
      "Firmware Component",
      "Sensor Supply Voltage",
      "Created At",
    ]);
  });

  it("keeps aliases for Notidian-owned fields", () => {
    expect(
      propertyHeaderDisplayName({
        name: "manual_status",
        type: "text",
        value: JSON.stringify({ alias: "Status" }),
      })
    ).toBe("Status");
  });

  it("falls back to the canonical field name when no alias is present", () => {
    expect(
      propertyHeaderDisplayName({
        name: "priority",
        type: "text",
        value: "",
      })
    ).toBe("priority");
  });
});

describe("propertyHeaderNameInfo", () => {
  it("returns a generated display name and canonical key for frontmatter-backed headers", () => {
    expect(
      propertyHeaderNameInfo({
        name: "sensor_id",
        type: "text",
        value: "",
        source: frontmatterPropertySource,
      })
    ).toEqual({
      displayName: "Sensor ID",
      tooltipName: "Sensor ID",
      canonicalName: "sensor_id",
      hasGeneratedDisplayName: true,
    });
  });

  it("does not mark frontmatter-backed headers as generated when the label matches the key", () => {
    expect(
      propertyHeaderNameInfo({
        name: "Status",
        type: "text",
        value: "",
        source: frontmatterPropertySource,
      })
    ).toEqual({
      displayName: "Status",
      tooltipName: "Status",
      canonicalName: "Status",
      hasGeneratedDisplayName: false,
    });
  });

  it("returns only a display name for Notidian-owned aliases", () => {
    expect(
      propertyHeaderNameInfo({
        name: "manual_status",
        type: "text",
        value: JSON.stringify({ alias: "Status" }),
      })
    ).toEqual({
      displayName: "Status",
      tooltipName: "Status",
    });
  });
});
