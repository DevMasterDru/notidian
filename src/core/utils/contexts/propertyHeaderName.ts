import { nameForField } from "core/utils/frames/frames";
import { isFrontmatterBackedProperty } from "core/utils/properties/allProperties";
import type { SpaceTableColumn } from "shared/types/mdb";

const propertyHeaderTokenLabels: Record<string, string> = {
  adc: "ADC",
  ai: "AI",
  api: "API",
  csv: "CSV",
  css: "CSS",
  dac: "DAC",
  db: "DB",
  dns: "DNS",
  esp: "ESP",
  esp32: "ESP32",
  gpio: "GPIO",
  gpu: "GPU",
  html: "HTML",
  http: "HTTP",
  https: "HTTPS",
  i2c: "I2C",
  id: "ID",
  ip: "IP",
  json: "JSON",
  led: "LED",
  llm: "LLM",
  mcp: "MCP",
  md: "MD",
  mqtt: "MQTT",
  pdf: "PDF",
  ph: "pH",
  pwm: "PWM",
  ram: "RAM",
  s3: "S3",
  spi: "SPI",
  sql: "SQL",
  tls: "TLS",
  tsv: "TSV",
  uart: "UART",
  uid: "UID",
  ui: "UI",
  uri: "URI",
  url: "URL",
  usb: "USB",
  uuid: "UUID",
  ux: "UX",
  xml: "XML",
  yaml: "YAML",
};

const capitalizePropertyHeaderToken = (token: string): string => {
  const normalized = token.toLowerCase();
  return (
    propertyHeaderTokenLabels[normalized] ??
    `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
  );
};

export const propertyHeaderLabelForKey = (key: string): string => {
  const tokens = key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0);

  if (tokens.length == 0) return key;
  return tokens.map(capitalizePropertyHeaderToken).join(" ");
};

export type PropertyHeaderNameInfo = {
  displayName: string;
  tooltipName: string;
  canonicalName?: string;
  hasGeneratedDisplayName?: boolean;
};

export const propertyHeaderNameInfo = (
  field: Pick<SpaceTableColumn, "name" | "type" | "value" | "source">
): PropertyHeaderNameInfo => {
  if (isFrontmatterBackedProperty(field)) {
    const displayName = propertyHeaderLabelForKey(field.name);
    return {
      displayName,
      tooltipName: displayName,
      canonicalName: field.name,
      hasGeneratedDisplayName: displayName != field.name,
    };
  }
  const displayName = nameForField(field) ?? field.name;
  return {
    displayName,
    tooltipName: displayName,
  };
};

export const propertyHeaderDisplayName = (
  field: Pick<SpaceTableColumn, "name" | "type" | "value" | "source">
): string => propertyHeaderNameInfo(field).displayName;
