const {
  buildObsidianArgs,
  createObsidianRunner,
  createFixturePaths,
  parseHarnessArgs,
  runRealVaultSmokeHarness,
  runSchemaAdoptionScenario,
  validateHarnessConfig,
} = require("./notidianRealVaultHarness");

const baseConfig = {
  vault: "Atlas Vault",
  allowWrite: true,
  keepFixture: false,
  includeUi: false,
  pluginId: "notidian",
  fixtureRoot: "Notidian Integration Fixtures",
  timeoutMs: 10000,
  commandTimeoutMs: 20000,
  pollIntervalMs: 0,
  cleanupSettleMs: 0,
  obsidianBin: "obsidian",
};

const cleanLegacyArtifactSnapshot = JSON.stringify({
  ok: true,
  stalePaths: [],
});

describe("notidian real vault harness", () => {
  it("parses explicit CLI options and environment fallbacks", () => {
    expect(
      parseHarnessArgs(
        [
          "vault=Atlas Vault",
          "--allow-write",
          "--keep-fixture",
          "--plugin-id=notidian-dev",
          "--fixture-root=Notidian Smoke Fixtures",
          "--timeout-ms=2500",
          "--command-timeout-ms=15000",
          "--cleanup-settle-ms=1500",
        ],
        { OBSIDIAN_BIN: "obsidian-dev" }
      )
    ).toEqual({
      vault: "Atlas Vault",
      allowWrite: true,
      keepFixture: true,
      includeUi: false,
      includeSchemaAdoption: false,
      pluginId: "notidian-dev",
      fixtureRoot: "Notidian Smoke Fixtures",
      timeoutMs: 2500,
      commandTimeoutMs: 15000,
      pollIntervalMs: 250,
      cleanupSettleMs: 1500,
      obsidianBin: "obsidian-dev",
    });

    expect(parseHarnessArgs([], { NOTIDIAN_REAL_VAULT: "Test Vault" }).vault)
      .toBe("Test Vault");

    expect(
      parseHarnessArgs(["vault=Atlas Vault", "--allow-write", "--ui"], {})
    ).toMatchObject({
      vault: "Atlas Vault",
      allowWrite: true,
      includeUi: true,
    });
  });

  it("rejects live writes without a vault and explicit write approval", () => {
    expect(
      validateHarnessConfig({
        ...baseConfig,
        vault: "",
        allowWrite: false,
        cleanupSettleMs: -1,
      })
    ).toEqual([
      "Set vault=<name> or NOTIDIAN_REAL_VAULT before running the real-vault harness.",
      "Pass --allow-write to permit fixture creation in the selected vault.",
      "Set --cleanup-settle-ms to zero or a positive integer.",
    ]);
  });

  it("creates timestamped fixture paths under the configured root", () => {
    expect(
      createFixturePaths(
        baseConfig,
        new Date("2026-05-25T10:20:30.456Z")
      )
    ).toEqual({
      runId: "notidian-smoke-2026-05-25T10-20-30-456Z",
      folder: "Notidian Integration Fixtures",
      prefix:
        "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z",
      alphaPath:
        "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Alpha.md",
      betaPath:
        "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Beta.md",
      alphaRenamedPath:
        "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Alpha Renamed.md",
      alphaUiRenamedPath:
        "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Alpha UI Renamed.md",
    });
  });

  it("builds Obsidian CLI args with the vault selector first", () => {
    expect(
      buildObsidianArgs(baseConfig, "create", {
        path: "Fixtures/Alpha.md",
        content: "Hello",
        overwrite: true,
        silent: false,
      })
    ).toEqual([
      "vault=Atlas Vault",
      "create",
      "path=Fixtures/Alpha.md",
      "content=Hello",
      "overwrite",
    ]);
  });

  it("runs the source-of-truth smoke scenario and cleans up fixtures", async () => {
    const calls = [];
    const evalResponses = ["=> old", "=> active", "=> active"];
    const runner = jest.fn(async (args) => {
      calls.push(args);
      const command = args[1];
      if (command == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
        if (code.includes("notidianEnsureFixtureFolder")) {
          return JSON.stringify({ ok: true, created: [] });
        }
        if (code.includes("notidianRenameFile")) {
          return JSON.stringify({ ok: true, path: args[0] });
        }
        if (code.includes("notidianCleanupFixtures")) {
          return JSON.stringify({
            ok: true,
            deleted: [
              "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Alpha Renamed.md",
              "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Beta.md",
            ],
            missing: [],
          });
        }
        if (code.includes("notidianLegacyArtifactSnapshot")) {
          return cleanLegacyArtifactSnapshot;
        }
        return evalResponses.shift() ?? "deleted";
      }
      if (command == "read") return "---\nstatus: active\n---\n# Alpha";
      if (command == "dev:errors" && !args.includes("clear")) {
        return "No errors captured.";
      }
      return "";
    });

    const result = await runRealVaultSmokeHarness(
      {
        ...baseConfig,
        now: () => new Date("2026-05-25T10:20:30.456Z"),
      },
      runner
    );

    expect(result).toEqual({
      ok: true,
      fixtureFolder: "Notidian Integration Fixtures",
      cleanedUp: true,
    });
    expect(calls.map((args) => args[1])).toEqual([
      "vault",
      "plugin:reload",
      "dev:errors",
      "eval",
      "create",
      "create",
      "eval",
      "property:set",
      "eval",
      "eval",
      "read",
      "eval",
      "dev:errors",
      "eval",
      "eval",
      "dev:errors",
      "eval",
    ]);
    expect(calls.every((args) => args[0] == "vault=Atlas Vault")).toBe(true);
    expect(calls.map((args) => args[1])).not.toContain("rename");
    expect(
      calls.some(
        (args) =>
          args[1] == "eval" && args.join(" ").includes("notidianRenameFile")
      )
    ).toBe(true);
    expect(
      calls.some(
        (args) =>
          args[1] == "eval" &&
          args.join(" ").includes("notidianCleanupFixtures")
      )
    ).toBe(true);
    expect(calls.map((args) => args[1])).not.toContain("delete");
  });

  it("runs the optional table UI smoke scenario before cleanup", async () => {
    const calls = [];
    const evalResponses = [
      "=> old",
      "=> active",
      "=> active",
      "=> ui-active",
      "=> queued",
      "=> ui-active",
      "=> paste-active",
      "=> 7",
      "=> ui-active",
      "=> 2",
      "=> paste-active",
      "=> 7",
      "=> multi-beta-status",
      "=> 47",
      "=> multi-alpha-status",
      "=> 31",
      "=> option-review",
      "=> todo",
      "=> option-review",
      '=> ["multi-alpha","multi-beta"]',
      "=> conflict-applied",
      "=> multi-beta-status",
    ];
    const uiRenamedPath =
      "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Alpha UI Renamed.md";
    const runner = jest.fn(async (args) => {
      calls.push(args);
      const command = args[1];
      if (command == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
        if (code.includes("notidianEnsureFixtureFolder")) {
          return JSON.stringify({ ok: true, created: [] });
        }
        if (code.includes("notidianRenameFile")) {
          return JSON.stringify({ ok: true });
        }
        if (code.includes("notidianCleanupFixtures")) {
          return JSON.stringify({
            ok: true,
            deleted: [uiRenamedPath],
            missing: [],
          });
        }
        if (code.includes("notidianLegacyArtifactSnapshot")) {
          return cleanLegacyArtifactSnapshot;
        }
        if (code.includes("notidianTableUiSetup")) {
          return JSON.stringify({ ok: true });
        }
        if (code.includes("notidianTableUiEdit")) {
          return JSON.stringify({
            ok: true,
            columns: ["File", "Created", "Status", "Rating", "Owner"],
            rowFound: true,
            editedValue: "ui-active",
          });
        }
        if (code.includes("notidianTableUiPaste")) {
          return JSON.stringify({
            ok: true,
            editedValues: { status: "paste-active", rating: "7" },
          });
        }
        if (code.includes("notidianTableUiMultiPaste")) {
          return JSON.stringify({
            ok: true,
            copiedText: "paste-active\t7\nactive\t1",
            editedValues: ["multi-beta-status", "47", "multi-alpha-status", "31"],
            firstRowIsTop: false,
          });
        }
        if (code.includes("notidianTableUiUndo")) {
          return JSON.stringify({
            ok: true,
            editedValues: { status: "ui-active", rating: "2" },
          });
        }
        if (code.includes("notidianTableUiRedo")) {
          return JSON.stringify({
            ok: true,
            editedValues: { status: "paste-active", rating: "7" },
          });
        }
        if (code.includes("notidianTableUiTypeMatrix")) {
          return JSON.stringify({
            ok: true,
            results: [
              { ok: true, label: "Text", type: "text" },
              { ok: true, label: "Select", type: "option" },
              { ok: true, label: "Multi-select", type: "option-multi" },
            ],
          });
        }
        if (code.includes("notidianTableUiOption")) {
          return JSON.stringify({
            ok: true,
            editedValue: "option-review",
            optionSaved: true,
          });
        }
        if (code.includes("notidianTableUiSelectExistingOption")) {
          return JSON.stringify({
            ok: true,
            editedValue: "todo",
          });
        }
        if (code.includes("notidianTableUiSelectEmptyExistingOption")) {
          return JSON.stringify({
            ok: true,
            editedValue: "option-review",
          });
        }
        if (code.includes("notidianTableUiMultiSelect")) {
          return JSON.stringify({
            ok: true,
            editedValues: ["multi-alpha", "multi-beta"],
            type: "option-multi",
          });
        }
        if (code.includes("notidianTableUiRename")) {
          return JSON.stringify({
            ok: true,
            path: uiRenamedPath,
            title:
              "notidian-smoke-2026-05-25T10-20-30-456Z-Alpha UI Renamed",
          });
        }
        if (code.includes("notidianTableUiConflict")) {
          return JSON.stringify({
            ok: true,
            appliedValue: "conflict-applied",
          });
        }
        return evalResponses.shift() ?? "ui-active";
      }
      if (command == "read") return "---\nstatus: active\n---\n# Alpha";
      if (command == "dev:errors" && !args.includes("clear")) {
        return "No errors captured.";
      }
      return "";
    });

    const result = await runRealVaultSmokeHarness(
      {
        ...baseConfig,
        includeUi: true,
        now: () => new Date("2026-05-25T10:20:30.456Z"),
      },
      runner
    );

    expect(result).toEqual({
      ok: true,
      fixtureFolder: "Notidian Integration Fixtures",
      cleanedUp: true,
    });
    expect(calls.map((args) => args[1]).filter((command) => command == "eval"))
      .toHaveLength(42);
    [
      "notidianTableUiEdit",
      "notidianTableUiPaste",
      "notidianTableUiMultiPaste",
      "notidianTableUiUndo",
      "notidianTableUiRedo",
      "notidianTableUiTypeMatrix",
      "notidianTableUiOption",
      "notidianTableUiSelectExistingOption",
      "notidianTableUiSelectEmptyExistingOption",
      "notidianTableUiMultiSelect",
      "notidianTableUiRename",
      "notidianTableUiConflict",
    ].forEach((marker) => {
      expect(
        calls.some(
          (args) => args[1] == "eval" && args.join(" ").includes(marker)
        )
      ).toBe(true);
    });
    expect(
      calls.some(
        (args) =>
          args[1] == "eval" &&
          args.join(" ").includes('execCommand("insertText"')
      )
    ).toBe(true);
    expect(
      calls.some(
        (args) =>
          args[1] == "eval" && args.join(" ").includes(".mk-cell-option-item")
      )
    ).toBe(true);
    expect(
      calls.some(
        (args) =>
          args[1] == "eval" &&
          args.join(" ").includes("notidianTableUiUndo") &&
          args.join(" ").includes("shortcutAccepted")
      )
    ).toBe(true);
    expect(
      calls.some(
        (args) =>
          args[1] == "eval" &&
          args.join(" ").includes("notidianTableUiRedo") &&
          args.join(" ").includes("shortcutAccepted")
      )
    ).toBe(true);
    expect(
      calls.some(
        (args) =>
          args[1] == "eval" &&
          args.join(" ").includes("waitForOptionColumnReady") &&
          args.join(" ").includes('updatedColumn?.type == "option"') &&
          args.join(" ").includes("const retry = await ensureOptionColumn();")
      )
    ).toBe(true);
    expect(calls.some((args) => args.includes(`path=${uiRenamedPath}`))).toBe(
      true
    );
    expect(calls.map((args) => args[1]).slice(-3)).toEqual([
      "eval",
      "dev:errors",
      "eval",
    ]);
    expect(
      calls.some(
        (args) =>
          args[1] == "eval" &&
          args.join(" ").includes("notidianCleanupFixtures")
      )
    ).toBe(true);
    expect(calls.map((args) => args[1])).not.toContain("delete");
  });

  it("reports API cleanup failures with the affected paths", async () => {
    const evalResponses = ["=> old", "=> active", "=> active"];
    const runner = jest.fn(async (args) => {
      if (args[1] == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
        if (code.includes("notidianEnsureFixtureFolder")) {
          return JSON.stringify({ ok: true, created: [] });
        }
        if (code.includes("notidianRenameFile")) {
          return JSON.stringify({ ok: true });
        }
        if (code.includes("notidianCleanupFixtures")) {
          return JSON.stringify({
            ok: false,
            reason: "delete-failed",
            failed: [
              {
                path: "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Alpha Renamed.md",
                message: "locked",
              },
            ],
          });
        }
        if (code.includes("notidianLegacyArtifactSnapshot")) {
          return cleanLegacyArtifactSnapshot;
        }
        return evalResponses.shift() ?? "active";
      }
      if (args[1] == "read") return "---\nstatus: active\n---\n# Alpha";
      if (args[1] == "dev:errors" && !args.includes("clear")) {
        return "No errors captured.";
      }
      return "";
    });

    await expect(
      runRealVaultSmokeHarness({
        ...baseConfig,
        now: () => new Date("2026-05-25T10:20:30.456Z"),
      }, runner)
    ).rejects.toThrow(
      "Fixture cleanup failed: delete-failed path=Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Alpha Renamed.md message=locked"
    );
  });

  it("fails loudly when the smoke scenario leaves active legacy storage artifacts", async () => {
    const evalResponses = ["=> old", "=> active", "=> active"];
    const runner = jest.fn(async (args) => {
      if (args[1] == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
        if (code.includes("notidianEnsureFixtureFolder")) {
          return JSON.stringify({ ok: true, created: [] });
        }
        if (code.includes("notidianRenameFile")) {
          return JSON.stringify({ ok: true });
        }
        if (code.includes("notidianLegacyArtifactSnapshot")) {
          return JSON.stringify({
            ok: false,
            stalePaths: [
              "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z/.makemd",
            ],
          });
        }
        if (code.includes("notidianCleanupFixtures")) {
          return JSON.stringify({
            ok: true,
            deleted: [
              "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Alpha Renamed.md",
              "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Beta.md",
            ],
            missing: [],
          });
        }
        return evalResponses.shift() ?? "active";
      }
      if (args[1] == "read") return "---\nstatus: active\n---\n# Alpha";
      if (args[1] == "dev:errors" && !args.includes("clear")) {
        return "No errors captured.";
      }
      return "";
    });

    await expect(
      runRealVaultSmokeHarness(
        {
          ...baseConfig,
          now: () => new Date("2026-05-25T10:20:30.456Z"),
        },
        runner
      )
    ).rejects.toThrow(
      "Notidian legacy artifact guard failed after smoke scenario: Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z/.makemd"
    );
  });

  it("fails loudly when the optional table UI smoke reports a missing table", async () => {
    const evalResponses = ["=> old", "=> active", "=> active"];
    const runner = jest.fn(async (args) => {
      const command = args[1];
      if (command == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
        if (code.includes("notidianEnsureFixtureFolder")) {
          return JSON.stringify({ ok: true, created: [] });
        }
        if (code.includes("notidianRenameFile")) {
          return JSON.stringify({ ok: true });
        }
        if (code.includes("notidianTableUiSetup")) {
          return JSON.stringify({ ok: true });
        }
        if (code.includes("notidianTableUiEdit")) {
          return JSON.stringify({
            ok: false,
            reason: "missing-table",
          });
        }
        if (code.includes("notidianLegacyArtifactSnapshot")) {
          return cleanLegacyArtifactSnapshot;
        }
        return evalResponses.shift() ?? "active";
      }
      if (command == "read") return "---\nstatus: active\n---\n# Alpha";
      if (command == "dev:errors" && !args.includes("clear")) {
        return "No errors captured.";
      }
      return "";
    });

    await expect(
      runRealVaultSmokeHarness(
        {
          ...baseConfig,
          includeUi: true,
          now: () => new Date("2026-05-25T10:20:30.456Z"),
        },
        runner
      )
    ).rejects.toThrow("Notidian table UI smoke failed: missing-table");
  });

  it("fails loudly when an expanded table UI workflow fails", async () => {
    const evalResponses = [
      "=> old",
      "=> active",
      "=> active",
      "=> ui-active",
      "=> queued",
      "=> ui-active",
    ];
    const runner = jest.fn(async (args) => {
      const command = args[1];
      if (command == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
        if (code.includes("notidianEnsureFixtureFolder")) {
          return JSON.stringify({ ok: true, created: [] });
        }
        if (code.includes("notidianRenameFile")) {
          return JSON.stringify({ ok: true });
        }
        if (code.includes("notidianTableUiSetup")) {
          return JSON.stringify({ ok: true });
        }
        if (code.includes("notidianTableUiEdit")) {
          return JSON.stringify({
            ok: true,
            columns: ["File", "Created", "Status", "Rating", "Owner"],
            rowFound: true,
            editedValue: "ui-active",
          });
        }
        if (code.includes("notidianTableUiUndo")) {
          return JSON.stringify({
            ok: true,
            editedValues: { status: "queued", rating: "2" },
          });
        }
        if (code.includes("notidianTableUiRedo")) {
          return JSON.stringify({
            ok: true,
            editedValues: { status: "ui-active", rating: "2" },
          });
        }
        if (code.includes("notidianTableUiPaste")) {
          return JSON.stringify({
            ok: false,
            reason: "missing-cell",
          });
        }
        if (code.includes("notidianLegacyArtifactSnapshot")) {
          return cleanLegacyArtifactSnapshot;
        }
        return evalResponses.shift() ?? "ui-active";
      }
      if (command == "read") return "---\nstatus: active\n---\n# Alpha";
      if (command == "dev:errors" && !args.includes("clear")) {
        return "No errors captured.";
      }
      return "";
    });

    await expect(
      runRealVaultSmokeHarness(
        {
          ...baseConfig,
          includeUi: true,
          now: () => new Date("2026-05-25T10:20:30.456Z"),
        },
        runner
      )
    ).rejects.toThrow("Notidian table UI paste failed: missing-cell");
  });

  it("keeps fixtures for inspection when requested", async () => {
    const evalResponses = ["=> old", "=> active", "=> active"];
    const runner = jest.fn(async (args) => {
      if (args[1] == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
        if (code.includes("notidianEnsureFixtureFolder")) {
          return JSON.stringify({ ok: true, created: [] });
        }
        if (code.includes("notidianRenameFile")) {
          return JSON.stringify({ ok: true });
        }
        if (code.includes("notidianLegacyArtifactSnapshot")) {
          return cleanLegacyArtifactSnapshot;
        }
        return evalResponses.shift() ?? "active";
      }
      if (args[1] == "read") return "---\nstatus: active\n---\n# Alpha";
      if (args[1] == "dev:errors" && !args.includes("clear")) {
        return "No errors captured.";
      }
      return "";
    });

    const result = await runRealVaultSmokeHarness(
      {
        ...baseConfig,
        keepFixture: true,
        now: () => new Date("2026-05-25T10:20:30.456Z"),
      },
      runner
    );

    expect(result.cleanedUp).toBe(false);
    expect(runner.mock.calls.map(([args]) => args[1])).not.toContain("delete");
    expect(
      runner.mock.calls.some(
        ([args]) =>
          args[1] == "eval" && args.join(" ").includes("notidianCleanupFixtures")
      )
    ).toBe(false);
  });

  it("times out stuck Obsidian CLI child processes", async () => {
    const runner = createObsidianRunner(process.execPath, 25);

    await expect(
      runner(["-e", "setTimeout(() => {}, 1000)"])
    ).rejects.toThrow("timed out after 25ms");
  });

  it("resolves after the CLI process exits even if a descendant keeps stdio open briefly", async () => {
    const runner = createObsidianRunner("/bin/sh", 25);

    await expect(
      runner(["-c", "printf ready; (sleep 0.2) & exit 0"])
    ).resolves.toBe("ready");
  });

  it("escalates timed out Obsidian CLI children that ignore SIGTERM", async () => {
    const runner = createObsidianRunner("/bin/sh", 25);
    const started = Date.now();

    await expect(
      runner(["-c", "trap '' TERM; sleep 0.5"])
    ).rejects.toThrow("timed out after 25ms");

    expect(Date.now() - started).toBeLessThan(300);
  });

  it("parses --adopt-schema", () => {
    expect(
      parseHarnessArgs(["vault=Atlas Vault", "--allow-write", "--adopt-schema"], {})
    ).toMatchObject({
      vault: "Atlas Vault",
      allowWrite: true,
      includeSchemaAdoption: true,
    });
    expect(parseHarnessArgs(["vault=Atlas Vault", "--allow-write"], {}))
      .toMatchObject({ includeSchemaAdoption: false });
  });
});

// ---------------------------------------------------------------------------
// runSchemaAdoptionScenario (Notidian-loan.3, ADR-0056 D9): drafts a v3 Type
// Profile from a fixture "Sensor Registry" database (bounded-cardinality
// sensor_class + a board_id field overlapping a sibling "Board Registry"
// fixture), confirms through the preview modal via a real DOM click (mocked
// here), and asserts the write only lands after confirm.
// ---------------------------------------------------------------------------
describe("runSchemaAdoptionScenario", () => {
  const SCHEMA_ADOPTION_ROOT =
    "Notidian Integration Fixtures/run-1-SchemaAdoption";
  const SCHEMA_ADOPTION_BOARD_FOLDER = `${SCHEMA_ADOPTION_ROOT}/Board Registry`;
  const SCHEMA_ADOPTION_HUB_PATH = `${SCHEMA_ADOPTION_ROOT}/Sensor Registry.md`;
  // Mirrors notidianRealVaultHarness.js's SCHEMA_ADOPTION_SENSOR_ROWS /
  // SCHEMA_ADOPTION_BOARD_IDS (not exported — restated here, same convention
  // as SCHEMA_ADOPTION_ROOT above) so the mock can answer each row's own
  // waitForMetadataValue poll with its OWN value, not one fixed value for
  // every row.
  const SENSOR_ROWS = [
    { id: "sn-001", sensorClass: "temperature" },
    { id: "sn-002", sensorClass: "humidity" },
    { id: "sn-003", sensorClass: "temperature" },
    { id: "sn-004", sensorClass: "pressure" },
    { id: "sn-005", sensorClass: "temperature" },
  ];
  const BOARD_IDS = ["board-1", "board-2"];

  const defaultAfterFields = {
    sensor_class: {
      kind: "text",
      enum: {
        values: ["temperature", "humidity", "pressure"],
        strict: false,
      },
    },
    board_id: {
      kind: "text",
      reference: {
        targetFolder: SCHEMA_ADOPTION_BOARD_FOLDER,
        targetKey: "board_id",
        onBrokenWrite: "warn",
        onReferencedChange: "warn",
      },
    },
  };

  const buildSchemaAdoptionRunner = ({
    modalResult = {
      ok: true,
      modalText:
        "sensor_class ... Looks like a reference to Board Registry ...",
      closed: true,
    },
    beforeSnapshot = {},
    afterFields = defaultAfterFields,
    deleteOk = true,
  } = {}) => {
    let frontmatterSnapshotCallCount = 0;
    const runner = jest.fn(async (args) => {
      const command = args[1];
      if (command != "eval") return "";

      const codeArg = args.find((arg) => arg.startsWith("code=")) ?? "";
      if (codeArg.includes("notidianSchemaAdoptionSetup")) {
        return JSON.stringify({
          ok: true,
          hubPath: SCHEMA_ADOPTION_HUB_PATH,
          enableFolderNote: false,
        });
      }
      if (codeArg.includes("notidianSchemaAdoptionModal")) {
        return JSON.stringify(modalResult);
      }
      if (codeArg.includes("notidianDeleteFolder")) {
        return JSON.stringify(
          deleteOk ? { ok: true } : { ok: false, reason: "exception" }
        );
      }
      if (codeArg.includes("JSON.stringify(cache?.frontmatter")) {
        frontmatterSnapshotCallCount++;
        return JSON.stringify(
          frontmatterSnapshotCallCount == 1
            ? beforeSnapshot
            : { schema_type: "notidian_type_profile", fields: afterFields }
        );
      }
      if (codeArg.includes('"sensor_class"')) {
        const row = SENSOR_ROWS.find((r) => codeArg.includes(r.id));
        return `=> ${row ? row.sensorClass : "temperature"}`;
      }
      if (codeArg.includes('"board_id"')) {
        const boardId = BOARD_IDS.find((id) => codeArg.includes(id));
        return `=> ${boardId ?? "board-1"}`;
      }
      if (codeArg.includes('"schema_type"')) return "=> notidian_type_profile";
      return "";
    });
    return runner;
  };

  const scenarioConfig = (overrides = {}) => ({
    ...baseConfig,
    timeoutMs: 500,
    pollIntervalMs: 0,
    ...overrides,
  });

  it("drives folder/row fixture setup, the confirm-gated modal, and cleanup in order", async () => {
    const runner = buildSchemaAdoptionRunner();

    const result = await runSchemaAdoptionScenario({
      config: scenarioConfig(),
      runner,
      runId: "run-1",
    });

    expect(result).toEqual({
      ok: true,
      folder: SCHEMA_ADOPTION_ROOT,
      hubPath: SCHEMA_ADOPTION_HUB_PATH,
    });

    const commandSequence = runner.mock.calls.map(([args]) => args[1]);
    expect(commandSequence).toEqual([
      "eval",
      "eval", // ensure Sensor Registry / Board Registry folders
      "create",
      "create",
      "create",
      "create",
      "create", // 5 sensor rows
      "create",
      "create", // 2 board rows
      "eval",
      "eval",
      "eval",
      "eval",
      "eval", // waitForMetadataValue(sensor_class) per sensor row (5)
      "eval",
      "eval", // waitForMetadataValue(board_id) per board row (2)
      "eval", // context setup #1
      "create", // hub note, no Type Profile yet
      "eval", // context setup #2 (re-settle after hub note appears)
      "eval", // before-confirm frontmatter snapshot
      "open",
      "command", // notidian-adopt-schema
      "eval", // modal confirm click
      "eval", // waitForMetadataValue(schema_type)
      "eval", // after-confirm frontmatter snapshot
      "eval", // fixture cleanup (delete folder)
    ]);
    expect(
      runner.mock.calls.some(([args]) =>
        args.join(" ").includes("id=notidian:notidian-adopt-schema")
      )
    ).toBe(true);
  });

  it("throws when the hub note already declares a Type Profile before confirm (fixture corruption guard)", async () => {
    const runner = buildSchemaAdoptionRunner({
      beforeSnapshot: { schema_type: "notidian_type_profile" },
    });

    await expect(
      runSchemaAdoptionScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow("already declares schema_type");

    // Cleanup still runs even though the scenario failed early.
    expect(
      runner.mock.calls.some(([args]) => args.join(" ").includes("notidianDeleteFolder"))
    ).toBe(true);
  });

  it("throws when the confirm-gated modal never appears or has no confirm button", async () => {
    const runner = buildSchemaAdoptionRunner({
      modalResult: { ok: false, reason: "missing-modal" },
    });

    await expect(
      runSchemaAdoptionScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow("Schema adoption modal interaction failed: missing-modal");
  });

  it("throws when the preview does not surface the drafted enum/FK candidates", async () => {
    const runner = buildSchemaAdoptionRunner({
      modalResult: { ok: true, modalText: "nothing useful here", closed: true },
    });

    await expect(
      runSchemaAdoptionScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow("did not surface the drafted sensor_class field");
  });

  it("throws when the adopted enum is missing an expected value or is strict", async () => {
    const runner = buildSchemaAdoptionRunner({
      afterFields: {
        sensor_class: {
          kind: "text",
          enum: { values: ["temperature"], strict: false },
        },
      },
    });

    await expect(
      runSchemaAdoptionScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow("Adopted sensor_class enum missing expected values");
  });

  it("throws when the adopted enum was written strict (must always be suggested-only)", async () => {
    const runner = buildSchemaAdoptionRunner({
      afterFields: {
        sensor_class: {
          kind: "text",
          enum: {
            values: ["temperature", "humidity", "pressure"],
            strict: true,
          },
        },
      },
    });

    await expect(
      runSchemaAdoptionScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow("must be suggested-only");
  });

  it("throws when the adopted board_id reference does not target the Board Registry fixture", async () => {
    const runner = buildSchemaAdoptionRunner({
      afterFields: {
        sensor_class: defaultAfterFields.sensor_class,
        board_id: { kind: "text" },
      },
    });

    await expect(
      runSchemaAdoptionScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow("did not target the Board Registry fixture");
  });

  it("skips cleanup when --keep-fixture is set", async () => {
    const runner = buildSchemaAdoptionRunner();

    await runSchemaAdoptionScenario({
      config: scenarioConfig({ keepFixture: true }),
      runner,
      runId: "run-1",
    });

    expect(
      runner.mock.calls.some(([args]) => args.join(" ").includes("notidianDeleteFolder"))
    ).toBe(false);
  });

  it("surfaces a cleanup failure when the scenario itself succeeded", async () => {
    const runner = buildSchemaAdoptionRunner({ deleteOk: false });

    await expect(
      runSchemaAdoptionScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow("Schema adoption fixture cleanup failed");
  });
});
