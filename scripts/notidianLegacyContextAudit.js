const fs = require("fs");
const path = require("path");
const sharedAuditCore = require("../src/core/utils/contexts/legacyContextMigrationCore");

const DEFAULT_SCHEMA = "files";
const DEFAULT_SPACE_SUBFOLDER = ".space";
const DEFAULT_FORMAT = "markdown";
const PATH_PROPERTY_NAME = sharedAuditCore.PathPropertyName;
const DEFAULT_EXCLUDED_FRONTMATTER_KEYS = new Set([
  "aliases",
  "tags",
  "banner",
  "banner_y",
  "color",
  "sticker",
]);

const parseIntegerOption = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeCliKey = (key) => key.replace(/^--/, "");

const parseAuditArgs = (argv = process.argv.slice(2), env = process.env) => {
  const config = {
    vaultRoot: env.NOTIDIAN_AUDIT_VAULT ?? env.NOTIDIAN_REAL_VAULT ?? "",
    folder: "",
    schema: DEFAULT_SCHEMA,
    spaceSubFolder: DEFAULT_SPACE_SUBFOLDER,
    format: DEFAULT_FORMAT,
    maxFiles: 0,
  };

  for (const arg of argv) {
    if (arg == "--json") {
      config.format = "json";
      continue;
    }

    const separator = arg.indexOf("=");
    if (separator < 0) continue;

    const key = normalizeCliKey(arg.slice(0, separator));
    const value = arg.slice(separator + 1);

    switch (key) {
      case "vault":
      case "vault-root":
        config.vaultRoot = value;
        break;
      case "folder":
        config.folder = value;
        break;
      case "schema":
        config.schema = value;
        break;
      case "space-subfolder":
        config.spaceSubFolder = value;
        break;
      case "format":
        config.format = value;
        break;
      case "max-files":
        config.maxFiles = parseIntegerOption(value, config.maxFiles);
        break;
    }
  }

  return config;
};

const pathParts = (value) =>
  String(value ?? "")
    .split(/[\\/]+/)
    .filter(Boolean);

const containsBlockedPathName = (value) =>
  pathParts(value).some((part) => {
    const lower = part.toLowerCase();
    return lower.includes("archive") || lower.includes("ignore");
  });

const validateAuditConfig = (config) => {
  const errors = [];

  if (!String(config.vaultRoot ?? "").trim()) {
    errors.push("Set --vault=<absolute vault path> or NOTIDIAN_AUDIT_VAULT.");
  }

  if (!String(config.folder ?? "").trim()) {
    errors.push("Set --folder=<vault-relative folder path>.");
  }

  if (containsBlockedPathName(config.folder)) {
    errors.push(
      "Folder paths containing archive or ignore are blocked by repository rules."
    );
  }

  if (!String(config.schema ?? "").trim()) {
    errors.push("Set --schema to a non-empty MDB schema id.");
  }

  if (!["markdown", "json"].includes(config.format)) {
    errors.push("Set --format to markdown or json.");
  }

  if (!Number.isFinite(config.maxFiles) || config.maxFiles < 0) {
    errors.push("Set --max-files to zero or a positive integer.");
  }

  return errors;
};

const getYamlParser = () => {
  try {
    return require("js-yaml");
  } catch (error) {
    return null;
  }
};

const parseScalar = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed == "true") return true;
  if (trimmed == "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
};

const fallbackParseYaml = (yaml) => {
  const result = {};
  const lines = yaml.split(/\r?\n/);
  let currentKey = null;

  for (const line of lines) {
    if (/^\s+-\s+/.test(line) && currentKey) {
      result[currentKey] = [
        ...(Array.isArray(result[currentKey]) ? result[currentKey] : []),
        parseScalar(line.replace(/^\s+-\s+/, "")),
      ];
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      currentKey = null;
      continue;
    }

    currentKey = match[1];
    result[currentKey] = match[2] ? parseScalar(match[2]) : [];
  }

  return result;
};

const parseMarkdownFrontmatter = (content) => {
  const normalized = String(content ?? "").replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return {};
  }

  const firstLineEnd = normalized.indexOf("\n");
  const rest = normalized.slice(firstLineEnd + 1);
  const endMatch = rest.match(/\r?\n---\r?\n/);
  if (!endMatch || endMatch.index == null) return {};

  const yaml = rest.slice(0, endMatch.index);
  const parser = getYamlParser();
  if (parser) {
    const parsed = parser.load(yaml);
    return parsed && typeof parsed == "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  }

  return fallbackParseYaml(yaml);
};

const quoteIdentifier = (identifier) =>
  `"${String(identifier).replace(/"/g, '""')}"`;

const queryRows = (db, sql, params = {}) => {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
};

const normalizeDbRows = (rows) =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value == null ? "" : String(value),
      ])
    )
  );

const inferColumnsFromRows = (rows, schema) =>
  Object.keys(rows[0] ?? {}).map((name) => ({
    name,
    schemaId: schema,
    type: name == PATH_PROPERTY_NAME ? "file" : "text",
    value: "",
  }));

const readContextTableFromDatabase = async (dbPath, schema) => {
  const initSqlJs = require("sql.js");
  const sqlJS = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  });
  const buffer = await fs.promises.readFile(dbPath);
  const db = new sqlJS.Database(new Uint8Array(buffer));

  try {
    let schemaRows = [];
    let fieldRows = [];

    try {
      schemaRows = normalizeDbRows(
        queryRows(db, "SELECT * FROM m_schema WHERE id = $schema", {
          $schema: schema,
        })
      );
    } catch (error) {
      schemaRows = [];
    }

    try {
      fieldRows = normalizeDbRows(
        queryRows(db, "SELECT * FROM m_fields WHERE schemaId = $schema", {
          $schema: schema,
        })
      ).filter((field) => String(field.name ?? "").length > 0);
    } catch (error) {
      fieldRows = [];
    }

    const rows = normalizeDbRows(
      queryRows(db, `SELECT * FROM ${quoteIdentifier(schema)}`)
    );
    return {
      schema: schemaRows[0] ?? { id: schema, name: schema, type: "db" },
      cols:
        fieldRows.length > 0 ? fieldRows : inferColumnsFromRows(rows, schema),
      rows,
    };
  } finally {
    db.close();
  }
};

const contextDbPathForConfig = (config) =>
  path.join(
    path.resolve(config.vaultRoot),
    config.folder,
    config.spaceSubFolder,
    "context.mdb"
  );

const vaultRelativeFromRowPath = (folder, rowPath) => {
  const raw = String(rowPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw) return "";
  return raw.includes("/") ? raw : `${folder.replace(/\/+$/g, "")}/${raw}`;
};

const resolveVaultFilePath = (config, rowPath) => {
  const vaultRoot = path.resolve(config.vaultRoot);
  const vaultRelative = vaultRelativeFromRowPath(config.folder, rowPath);
  const absolutePath = path.resolve(vaultRoot, vaultRelative);
  if (!absolutePath.startsWith(`${vaultRoot}${path.sep}`)) return null;
  return { vaultRelative, absolutePath };
};

const readFrontmatterForTableRows = async (config, table) => {
  const warnings = [];
  const frontmatterByPath = {};
  const filesRead = [];
  const seen = new Set();
  const rowPaths = [];

  for (const row of table.rows ?? []) {
    const rowPath = row[PATH_PROPERTY_NAME];
    const resolved = resolveVaultFilePath(config, rowPath);
    if (!resolved || seen.has(resolved.vaultRelative)) continue;
    seen.add(resolved.vaultRelative);
    rowPaths.push(resolved);
  }

  const limitedRows =
    config.maxFiles > 0 ? rowPaths.slice(0, config.maxFiles) : rowPaths;

  for (const resolved of limitedRows) {
    if (containsBlockedPathName(resolved.vaultRelative)) {
      warnings.push(`Skipped blocked path: ${resolved.vaultRelative}`);
      continue;
    }

    try {
      const content = await fs.promises.readFile(resolved.absolutePath, "utf8");
      frontmatterByPath[resolved.vaultRelative] =
        parseMarkdownFrontmatter(content);
      filesRead.push(resolved.vaultRelative);
    } catch (error) {
      warnings.push(`Could not read ${resolved.vaultRelative}: ${error.message}`);
    }
  }

  return { frontmatterByPath, filesRead, warnings };
};

const countBy = (values) =>
  values.reduce((counts, value) => ({
    ...counts,
    [value]: (counts[value] ?? 0) + 1,
  }), {});

const buildLegacyContextAuditReport = ({
  table,
  frontmatterByPath,
  config,
  contextDbPath,
  filesRead,
  warnings = [],
}) => {
  const audit = sharedAuditCore.auditLegacyContextTable({
    table,
    frontmatterByPath,
    excludedFrontmatterKeys: DEFAULT_EXCLUDED_FRONTMATTER_KEYS,
  });
  const plan = sharedAuditCore.createLegacyContextMigrationPlan(audit);
  const uniqueRowFiles = new Set(
    (table.rows ?? [])
      .map((row) => row[PATH_PROPERTY_NAME])
      .filter((rowPath) => String(rowPath ?? "").length > 0)
  ).size;
  const frontmatterScanComplete = filesRead.length >= uniqueRowFiles;
  const reportWarnings = [
    ...warnings,
    ...(frontmatterScanComplete
      ? []
      : [
          `Frontmatter scan is partial: read ${filesRead.length} of ${uniqueRowFiles} row files.`,
        ]),
  ];
  const columnCounts = {
    file: 0,
    computed: 0,
    "already-frontmatter": 0,
    "frontmatter-candidate": 0,
    "context-only": 0,
    ...countBy(audit.columns.map((column) => column.category)),
  };
  const valueCounts = {
    matching: 0,
    "context-only-value": 0,
    "frontmatter-only-value": 0,
    conflict: 0,
    empty: 0,
    ...countBy(audit.valueIssues.map((issue) => issue.state)),
  };

  return {
    mode: "read-only",
    vaultRoot: config.vaultRoot,
    folder: config.folder,
    schema: config.schema,
    contextDbPath,
    summary: {
      rowCount: table.rows?.length ?? 0,
      columnCount: table.cols?.length ?? 0,
      filesRead: filesRead.length,
      uniqueRowFiles,
      frontmatterScanComplete,
      canApplyAutomatically:
        plan.canApplyAutomatically && frontmatterScanComplete,
      blockingIssueCount: plan.blockingIssues.length,
      columns: columnCounts,
      values: valueCounts,
    },
    plan,
    audit,
    warnings: reportWarnings,
  };
};

const markdownList = (values) =>
  values.length > 0 ? values.join(", ") : "None";

const renderMarkdownReport = (report) => {
  const lines = [
    "# Notidian Legacy Context Audit",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Mode | ${report.mode} |`,
    `| Folder | ${report.folder} |`,
    `| Schema | ${report.schema} |`,
    `| Context MDB | ${report.contextDbPath} |`,
    `| Rows | ${report.summary.rowCount} |`,
    `| Columns | ${report.summary.columnCount} |`,
    `| Files read | ${report.summary.filesRead} |`,
    `| Unique row files | ${report.summary.uniqueRowFiles} |`,
    `| Frontmatter scan complete | ${
      report.summary.frontmatterScanComplete ? "Yes" : "No"
    } |`,
    `| Can apply automatically | ${
      report.summary.canApplyAutomatically ? "Yes" : "No"
    } |`,
    `| Blocking issues | ${report.summary.blockingIssueCount} |`,
    "",
    "## Column Summary",
    "",
    "| Category | Count |",
    "| --- | ---: |",
    `| File identity | ${report.summary.columns.file} |`,
    `| Computed/projection | ${report.summary.columns.computed} |`,
    `| Already frontmatter-backed | ${report.summary.columns["already-frontmatter"]} |`,
    `| Frontmatter candidates | ${report.summary.columns["frontmatter-candidate"]} |`,
    `| Context-only | ${report.summary.columns["context-only"]} |`,
    "",
    "## Migration Preview",
    "",
    `| Mark as frontmatter-backed | ${markdownList(
      report.plan.columnsToMarkFrontmatter
    )} |`,
    `| Strip from MDB rows | ${markdownList(report.plan.columnsToStripFromRows)} |`,
    `| Add discovered frontmatter columns | ${markdownList(
      report.plan.columnsToAdd.map((column) => column.name)
    )} |`,
    `| Context-only columns preserved | ${markdownList(
      report.plan.preservedContextColumns
    )} |`,
  ];

  if (report.plan.blockingIssues.length > 0) {
    lines.push("", "## Blocking Issues", "", "| Path | Column | State | Context | Frontmatter |", "| --- | --- | --- | --- | --- |");
    for (const issue of report.plan.blockingIssues.slice(0, 25)) {
      lines.push(
        `| ${issue.path} | ${issue.columnName} | ${issue.state} | ${
          issue.contextValue ?? ""
        } | ${issue.frontmatterValue ?? ""} |`
      );
    }
  }

  if (report.warnings.length > 0) {
    lines.push("", "## Warnings", "");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  return `${lines.join("\n")}\n`;
};

const runLegacyContextAudit = async (config) => {
  const contextDbPath = contextDbPathForConfig(config);
  const table = await readContextTableFromDatabase(contextDbPath, config.schema);
  const frontmatterResult = await readFrontmatterForTableRows(config, table);
  return buildLegacyContextAuditReport({
    table,
    frontmatterByPath: frontmatterResult.frontmatterByPath,
    config,
    contextDbPath,
    filesRead: frontmatterResult.filesRead,
    warnings: frontmatterResult.warnings,
  });
};

const usage = () => [
  "Usage:",
  '  npm run audit:legacy-context -- --vault="/Users/druker/Atlas Vault" --folder="Relays & Devices"',
  "",
  "Options:",
  "  --vault=<path>             Absolute vault path. Can also use NOTIDIAN_AUDIT_VAULT.",
  "  --folder=<path>            Required vault-relative folder/context path.",
  `  --schema=<id>              Defaults to ${DEFAULT_SCHEMA}.`,
  `  --space-subfolder=<path>   Defaults to ${DEFAULT_SPACE_SUBFOLDER}.`,
  "  --format=markdown|json     Defaults to markdown.",
  "  --json                     Alias for --format=json.",
  "  --max-files=<n>            Read only the first n row files. Zero means all row files.",
].join("\n");

const main = async (argv = process.argv.slice(2), env = process.env) => {
  const config = parseAuditArgs(argv, env);
  const errors = validateAuditConfig(config);

  if (errors.length > 0) {
    console.error(`${errors.join("\n")}\n\n${usage()}`);
    process.exitCode = 1;
    return;
  }

  try {
    const report = await runLegacyContextAudit(config);
    console.log(
      config.format == "json"
        ? JSON.stringify(report, null, 2)
        : renderMarkdownReport(report)
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main();
}

module.exports = {
  auditLegacyContextTable: sharedAuditCore.auditLegacyContextTable,
  buildLegacyContextAuditReport,
  createLegacyContextMigrationPlan:
    sharedAuditCore.createLegacyContextMigrationPlan,
  parseAuditArgs,
  parseMarkdownFrontmatter,
  readContextTableFromDatabase,
  renderMarkdownReport,
  runLegacyContextAudit,
  validateAuditConfig,
};
