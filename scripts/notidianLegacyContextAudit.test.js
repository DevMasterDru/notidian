const {
  buildLegacyContextAuditReport,
  parseAuditArgs,
  parseMarkdownFrontmatter,
  renderMarkdownReport,
  validateAuditConfig,
} = require("./notidianLegacyContextAudit");

const table = {
  schema: { id: "files", name: "Files", type: "db" },
  cols: [
    { name: "File", type: "file", schemaId: "files" },
    { name: "Created", type: "fileprop", value: "File.ctime", schemaId: "files" },
    { name: "status", type: "text", value: "", schemaId: "files" },
    { name: "manual", type: "text", value: "", schemaId: "files" },
  ],
  rows: [
    {
      File: "Relays & Devices/A.md",
      status: "active",
      manual: "context-a",
    },
    {
      File: "Relays & Devices/B.md",
      status: "paused",
      manual: "context-b",
    },
  ],
};

describe("notidian legacy context audit CLI", () => {
  it("parses explicit CLI options and environment fallbacks", () => {
    expect(
      parseAuditArgs(
        [
          '--vault=/Users/druker/Atlas Vault',
          '--folder=Relays & Devices',
          "--schema=projects",
          "--space-subfolder=.notidian",
          "--format=json",
          "--max-files=3",
        ],
        {}
      )
    ).toEqual({
      vaultRoot: "/Users/druker/Atlas Vault",
      folder: "Relays & Devices",
      schema: "projects",
      spaceSubFolder: ".notidian",
      format: "json",
      maxFiles: 3,
    });

    expect(
      parseAuditArgs(["folder=Relays & Devices"], {
        NOTIDIAN_AUDIT_VAULT: "/tmp/Vault",
      }).vaultRoot
    ).toBe("/tmp/Vault");
  });

  it("validates required inputs and blocked path names", () => {
    expect(
      validateAuditConfig({
        vaultRoot: "",
        folder: "Archive Notes",
        schema: "",
        spaceSubFolder: ".space",
        format: "markdown",
        maxFiles: -1,
      })
    ).toEqual([
      "Set --vault=<absolute vault path> or NOTIDIAN_AUDIT_VAULT.",
      "Folder paths containing archive or ignore are blocked by repository rules.",
      "Set --schema to a non-empty MDB schema id.",
      "Set --max-files to zero or a positive integer.",
    ]);
  });

  it("parses YAML frontmatter without reading body content", () => {
    expect(
      parseMarkdownFrontmatter(
        "---\nstatus: active\nrating: 5\nups: true\ntags:\n  - pump\n---\n# Body"
      )
    ).toEqual({
      status: "active",
      rating: 5,
      ups: true,
      tags: ["pump"],
    });
  });

  it("builds a read-only report that preserves blockers and context-only columns", () => {
    const report = buildLegacyContextAuditReport({
      table,
      frontmatterByPath: {
        "Relays & Devices/A.md": {
          status: "active",
          rating: 5,
        },
        "Relays & Devices/B.md": {
          status: "frontmatter-paused",
          rating: 4,
        },
      },
      config: {
        vaultRoot: "/Users/druker/Atlas Vault",
        folder: "Relays & Devices",
        schema: "files",
        spaceSubFolder: ".space",
        format: "markdown",
        maxFiles: 0,
      },
      contextDbPath:
        "/Users/druker/Atlas Vault/Relays & Devices/.space/context.mdb",
      filesRead: [
        "Relays & Devices/A.md",
        "Relays & Devices/B.md",
      ],
    });

    expect(report.mode).toBe("read-only");
    expect(report.summary).toEqual({
      rowCount: 2,
      columnCount: 4,
      filesRead: 2,
      uniqueRowFiles: 2,
      frontmatterScanComplete: true,
      canApplyAutomatically: false,
      blockingIssueCount: 1,
      columns: {
        file: 1,
        computed: 1,
        "already-frontmatter": 0,
        "frontmatter-candidate": 1,
        "context-only": 1,
      },
      values: {
        matching: 1,
        "context-only-value": 0,
        "frontmatter-only-value": 0,
        conflict: 1,
        empty: 0,
      },
    });
    expect(report.plan.columnsToMarkFrontmatter).toEqual([]);
    expect(report.plan.columnsToStripFromRows).toEqual(["Created"]);
    expect(report.plan.preservedContextColumns).toEqual(["manual"]);
    expect(report.plan.blockingIssues).toEqual([
      expect.objectContaining({
        columnName: "status",
        path: "Relays & Devices/B.md",
        state: "conflict",
      }),
    ]);
    expect(report.plan.columnsToAdd.map((column) => column.name)).toEqual([
      "rating",
    ]);
  });

  it("does not allow automatic apply from a partial frontmatter scan", () => {
    const report = buildLegacyContextAuditReport({
      table,
      frontmatterByPath: {
        "Relays & Devices/A.md": {
          status: "active",
        },
      },
      config: {
        vaultRoot: "/Users/druker/Atlas Vault",
        folder: "Relays & Devices",
        schema: "files",
        spaceSubFolder: ".space",
        format: "markdown",
        maxFiles: 1,
      },
      contextDbPath:
        "/Users/druker/Atlas Vault/Relays & Devices/.space/context.mdb",
      filesRead: ["Relays & Devices/A.md"],
    });

    expect(report.summary.uniqueRowFiles).toBe(2);
    expect(report.summary.frontmatterScanComplete).toBe(false);
    expect(report.summary.canApplyAutomatically).toBe(false);
    expect(report.warnings).toEqual([
      "Frontmatter scan is partial: read 1 of 2 row files.",
    ]);
  });

  it("renders a compact markdown report for human review", () => {
    const report = buildLegacyContextAuditReport({
      table,
      frontmatterByPath: {
        "Relays & Devices/A.md": { status: "active" },
        "Relays & Devices/B.md": { status: "paused" },
      },
      config: {
        vaultRoot: "/Vault",
        folder: "Relays & Devices",
        schema: "files",
        spaceSubFolder: ".space",
        format: "markdown",
        maxFiles: 0,
      },
      contextDbPath: "/Vault/Relays & Devices/.space/context.mdb",
      filesRead: ["Relays & Devices/A.md", "Relays & Devices/B.md"],
    });

    expect(renderMarkdownReport(report)).toContain(
      "# Notidian Legacy Context Audit"
    );
    expect(renderMarkdownReport(report)).toContain(
      "| Can apply automatically | Yes |"
    );
    expect(renderMarkdownReport(report)).toContain(
      "| Frontmatter scan complete | Yes |"
    );
    expect(renderMarkdownReport(report)).toContain(
      "| Frontmatter candidates | 1 |"
    );
    expect(renderMarkdownReport(report)).toContain(
      "| Context-only columns preserved | manual |"
    );
  });
});
