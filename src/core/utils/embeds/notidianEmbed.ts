export type NotidianEmbedKind = "table" | "view";

export type NotidianEmbedDescriptor = {
  target: string;
  kind: NotidianEmbedKind;
  id: string;
  height?: number;
  title?: boolean;
  editable?: boolean;
};

export type NotidianEmbedDescriptorInput = {
  target?: unknown;
  kind?: unknown;
  id?: unknown;
  height?: unknown;
  title?: unknown;
  editable?: unknown;
  table?: unknown;
  view?: unknown;
};

export type NotidianEmbedDescriptorError = {
  field: string;
  message: string;
};

export type NotidianEmbedParseResult =
  | {
      ok: true;
      descriptor: NotidianEmbedDescriptor;
    }
  | {
      ok: false;
      errors: NotidianEmbedDescriptorError[];
    };

const parseStringField = (value: unknown): string | undefined => {
  if (typeof value != "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseBooleanField = (
  value: unknown,
  field: string,
  errors: NotidianEmbedDescriptorError[]
): boolean | undefined => {
  if (value == null || value === "") return undefined;
  if (typeof value == "boolean") return value;
  if (typeof value == "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized == "true") return true;
    if (normalized == "false") return false;
  }
  errors.push({ field, message: `${field} must be true or false` });
  return undefined;
};

const parseHeightField = (
  value: unknown,
  errors: NotidianEmbedDescriptorError[]
): number | undefined => {
  if (value == null || value === "") return undefined;
  const height =
    typeof value == "number"
      ? value
      : typeof value == "string"
      ? Number(value.trim())
      : Number.NaN;

  if (Number.isFinite(height) && height > 0) {
    return height;
  }

  errors.push({ field: "height", message: "height must be a positive number" });
  return undefined;
};

const normalizeTarget = (target: string): string => {
  if (target == "/") return "";
  return target.replace(/\/+$/u, "");
};

const parseKind = (
  input: NotidianEmbedDescriptorInput,
  errors: NotidianEmbedDescriptorError[]
): NotidianEmbedKind | undefined => {
  const explicitKind = parseStringField(input.kind)?.toLowerCase();
  const table = parseStringField(input.table);
  const view = parseStringField(input.view);

  if (explicitKind != null) {
    if (explicitKind == "table" || explicitKind == "view") {
      return explicitKind;
    }
    errors.push({ field: "kind", message: "kind must be table or view" });
    return undefined;
  }

  if (table != null && view != null) {
    errors.push({
      field: "kind",
      message: "kind is required when both table and view are provided",
    });
    return undefined;
  }

  if (table != null) return "table";
  if (view != null) return "view";

  errors.push({ field: "kind", message: "kind must be table or view" });
  return undefined;
};

const parseId = (
  input: NotidianEmbedDescriptorInput,
  kind: NotidianEmbedKind | undefined,
  errors: NotidianEmbedDescriptorError[]
): string | undefined => {
  const id = parseStringField(input.id);
  if (id != null) return id;

  const shorthand =
    kind == "table"
      ? parseStringField(input.table)
      : kind == "view"
      ? parseStringField(input.view)
      : undefined;

  if (shorthand != null) return shorthand;

  errors.push({ field: "id", message: "id is required" });
  return undefined;
};

export const parseNotidianEmbedBlockFields = (
  body: string
): NotidianEmbedDescriptorInput => {
  return body.split(/\r?\n/u).reduce<NotidianEmbedDescriptorInput>(
    (fields, line) => {
      const trimmed = line.trim();
      if (trimmed.length == 0 || trimmed.startsWith("#")) return fields;

      const separator = trimmed.indexOf(":");
      if (separator == -1) return fields;

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (key.length == 0) return fields;

      return { ...fields, [key]: value };
    },
    {}
  );
};

export const normalizeNotidianEmbedDescriptor = (
  input: NotidianEmbedDescriptorInput
): NotidianEmbedParseResult => {
  const errors: NotidianEmbedDescriptorError[] = [];
  const target = parseStringField(input.target);
  if (target == null) {
    errors.push({ field: "target", message: "target is required" });
  }

  const kind = parseKind(input, errors);
  const id = parseId(input, kind, errors);
  const height = parseHeightField(input.height, errors);
  const title = parseBooleanField(input.title, "title", errors);
  const editable = parseBooleanField(input.editable, "editable", errors);

  if (errors.length > 0 || target == null || kind == null || id == null) {
    return { ok: false, errors };
  }

  const descriptor: NotidianEmbedDescriptor = {
    target: normalizeTarget(target),
    kind,
    id,
    title: title ?? true,
    editable: editable ?? false,
  };

  if (height != null) {
    descriptor.height = height;
  }

  return { ok: true, descriptor };
};

export const parseNotidianEmbedBlock = (
  body: string
): NotidianEmbedParseResult => {
  return normalizeNotidianEmbedDescriptor(parseNotidianEmbedBlockFields(body));
};

export const parseLegacyNotidianEmbedRef = (
  ref: string
): NotidianEmbedParseResult => {
  const match = /^(.*)\/#([\^*])([^#]+)$/u.exec(ref.trim());
  if (match == null) {
    return {
      ok: false,
      errors: [{ field: "ref", message: "ref must include #^table or #*view" }],
    };
  }

  const [, target, marker, id] = match;
  return normalizeNotidianEmbedDescriptor({
    target: target == "" ? "/" : target,
    kind: marker == "^" ? "table" : "view",
    id,
  });
};

export const descriptorToFragmentPath = (
  descriptor: Pick<NotidianEmbedDescriptor, "target" | "kind" | "id">
): string => {
  const marker = descriptor.kind == "table" ? "^" : "*";
  const target = normalizeTarget(descriptor.target.trim());
  return `${target}/#${marker}${descriptor.id}`;
};

export const serializeNotidianEmbedBlock = (
  descriptor: NotidianEmbedDescriptor
): string => {
  const lines = [
    "```notidian",
    `target: ${descriptor.target}`,
    `kind: ${descriptor.kind}`,
    `id: ${descriptor.id}`,
  ];

  if (descriptor.height != null) {
    lines.push(`height: ${descriptor.height}`);
  }

  lines.push(
    `title: ${descriptor.title ?? true}`,
    `editable: ${descriptor.editable ?? false}`,
    "```"
  );

  return lines.join("\n");
};
