const {
  buildObsidianArgs,
  createObsidianRunner,
  createFixturePaths,
  parseHarnessArgs,
  runRealVaultSmokeHarness,
  runSchemaAdoptionScenario,
  runReconcilerScenario,
  runHealthSurfacesScenario,
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
      includeReconciler: false,
      includeHealthSurfaces: false,
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

  it("parses --reconciler", () => {
    expect(
      parseHarnessArgs(["vault=Atlas Vault", "--allow-write", "--reconciler"], {})
    ).toMatchObject({
      vault: "Atlas Vault",
      allowWrite: true,
      includeReconciler: true,
    });
    expect(parseHarnessArgs(["vault=Atlas Vault", "--allow-write"], {}))
      .toMatchObject({ includeReconciler: false });
  });

  it("parses --health", () => {
    expect(
      parseHarnessArgs(["vault=Atlas Vault", "--allow-write", "--health"], {})
    ).toMatchObject({
      vault: "Atlas Vault",
      allowWrite: true,
      includeHealthSurfaces: true,
    });
    expect(parseHarnessArgs(["vault=Atlas Vault", "--allow-write"], {}))
      .toMatchObject({ includeHealthSurfaces: false });
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

// ---------------------------------------------------------------------------
// runReconcilerScenario (Notidian-loan.4, ADR-0057): declares a v3 Type
// Profile directly in a fixture hub note's frontmatter (no adoption UI, no
// modal, no enum/FK drafting — simpler than runSchemaAdoptionScenario), then
// drives two EXTERNAL raw-text edits to a single fixture row through the
// harness's own `create --overwrite` primitive and asserts the reconciler
// (plugin.reconciler.getRowViolations) surfaces the right violation after
// each one: a `required` violation for a value dropped while staying valid
// YAML, and a dedicated `malformed-row` violation for YAML that fails to
// parse outright (ADR-0057 D4).
// ---------------------------------------------------------------------------
describe("runReconcilerScenario", () => {
  const RECONCILER_ROOT = "Notidian Integration Fixtures/run-1-Reconciler";
  const RECONCILER_ROW_PATH = `${RECONCILER_ROOT}/Reconciler Row.md`;
  const RECONCILER_HUB_PATH = `${RECONCILER_ROOT}/Reconciler Hub.md`;

  const REQUIRED_VIOLATION = {
    field: "model",
    code: "required",
    severity: "error",
    message: "model is required but missing.",
    repairTier: "manual-only",
    suggestedFix: 'Provide a value for "model".',
  };

  const MALFORMED_ROW_VIOLATION = {
    code: "malformed-row",
    severity: "error",
    message:
      '"Reconciler Row" (Reconciler Row.md): frontmatter is missing or failed to parse.',
    repairTier: "manual-only",
  };

  // Each waitForReconcilerViolations call in the scenario resolves on its
  // FIRST poll (the canned response already satisfies that call's own
  // predicate), so the Nth distinct violations-eval call maps 1:1 to the
  // scenario's own step order: baseline clean, required violation, restored
  // clean, malformed-row violation.
  const buildReconcilerRunner = ({
    violationsSequence = [
      [],
      [REQUIRED_VIOLATION],
      [],
      [MALFORMED_ROW_VIOLATION],
    ],
    hubPathResult = { ok: true, hubPath: RECONCILER_HUB_PATH },
    deleteOk = true,
  } = {}) => {
    let violationsCallCount = 0;
    const runner = jest.fn(async (args) => {
      const command = args[1];
      if (command != "eval") return "";

      const codeArg = args.find((arg) => arg.startsWith("code=")) ?? "";
      if (codeArg.includes("notidianReconcilerHubPath")) {
        return JSON.stringify(hubPathResult);
      }
      if (codeArg.includes("notidianReconcilerRowViolations")) {
        const violations = violationsSequence[violationsCallCount] ?? [];
        violationsCallCount++;
        return JSON.stringify({ ok: true, violations });
      }
      if (codeArg.includes("notidianDeleteFolder")) {
        return JSON.stringify(
          deleteOk ? { ok: true } : { ok: false, reason: "exception" }
        );
      }
      if (codeArg.includes('"model"')) return "=> Widget A";
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

  it("drives fixture setup, both external-edit violations, and cleanup in order", async () => {
    const runner = buildReconcilerRunner();

    const result = await runReconcilerScenario({
      config: scenarioConfig(),
      runner,
      runId: "run-1",
    });

    expect(result).toEqual({
      ok: true,
      folder: RECONCILER_ROOT,
      hubPath: RECONCILER_HUB_PATH,
      rowPath: RECONCILER_ROW_PATH,
    });

    const commandSequence = runner.mock.calls.map(([args]) => args[1]);
    expect(commandSequence).toEqual([
      "eval", // ensure fixture folder
      "create", // row, valid frontmatter
      "eval", // waitForMetadataValue(model)
      "eval", // resolve hub path
      "create", // hub note declaring Type Profile directly
      "eval", // waitForMetadataValue(schema_type)
      "eval", // baseline clean
      "create", // external edit A: drop required field (still valid YAML)
      "eval", // required violation surfaces
      "create", // restore valid content
      "eval", // clean again
      "create", // external edit B: malformed YAML
      "eval", // malformed-row violation surfaces
      "dev:errors",
      "eval", // cleanup (delete folder)
    ]);
  });

  it("throws when the hub path cannot be resolved", async () => {
    const runner = buildReconcilerRunner({
      hubPathResult: { ok: false, reason: "missing-note-path" },
    });

    await expect(
      runReconcilerScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow("Reconciler fixture hub path resolution failed");

    // Cleanup still runs even though the scenario failed early.
    expect(
      runner.mock.calls.some(([args]) => args.join(" ").includes("notidianDeleteFolder"))
    ).toBe(true);
  });

  it("times out waiting for the required violation to surface", async () => {
    const runner = buildReconcilerRunner({
      // Stays clean instead of ever surfacing the "required" violation.
      violationsSequence: [[]],
    });

    await expect(
      runReconcilerScenario({
        config: scenarioConfig({ timeoutMs: 50 }),
        runner,
        runId: "run-1",
      })
    ).rejects.toThrow(/Timed out waiting for reconciler violations \(required violation\)/);
  });

  it("skips cleanup when --keep-fixture is set", async () => {
    const runner = buildReconcilerRunner();

    await runReconcilerScenario({
      config: scenarioConfig({ keepFixture: true }),
      runner,
      runId: "run-1",
    });

    expect(
      runner.mock.calls.some(([args]) => args.join(" ").includes("notidianDeleteFolder"))
    ).toBe(false);
  });

  it("surfaces a cleanup failure when the scenario itself succeeded", async () => {
    const runner = buildReconcilerRunner({ deleteOk: false });

    await expect(
      runReconcilerScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow("Reconciler fixture cleanup failed");
  });
});

// ---------------------------------------------------------------------------
// runHealthSurfacesScenario (Notidian-loan.5, ADR-0057 D3/D4): declares a
// Type Profile directly in a fixture hub note's frontmatter (same
// no-adoption-UI convention runReconcilerScenario uses) with a required
// `model` field and a `code` field declared `empty: "empty-string"`, then
// drives two fixture rows through the LIVE table DOM: a malformed-YAML row
// that must render as `tr.mk-row-broken`, and a row whose `code` value is
// entirely absent that must show an autofix-tier `.mk-row-health-badge`,
// have that autofix DOM-driven through the real repair menu (proving the
// write lands on disk as an explicit empty string AND goes through the same
// funnel every other direct cell edit uses), and clear once the reconciler
// revalidates. Finally asserts the FilterBar's `.mk-db-health-chip` count
// equals the Database Health panel's `data-panel-violation-count` AND the
// live `reconciler.getViolationCount` for the fixture database.
// ---------------------------------------------------------------------------
describe("runHealthSurfacesScenario", () => {
  const HEALTH_ROOT = "Notidian Integration Fixtures/run-1-Health";
  const HEALTH_EMPTY_ROW_PATH = `${HEALTH_ROOT}/Health Empty Row.md`;
  const HEALTH_BROKEN_ROW_PATH = `${HEALTH_ROOT}/Health Broken Row.md`;
  const HEALTH_HUB_PATH = `${HEALTH_ROOT}/Health Fixture Hub.md`;

  const EMPTY_ENCODING_VIOLATION = {
    field: "code",
    code: "empty-encoding",
    severity: "error",
    message:
      'code: empty value is encoded as absent, but the declared policy is "empty-string".',
    repairTier: "autofix",
    suggestedFix:
      'Set "code" to an explicit empty string ("") instead of omitting or nulling it.',
  };

  const MALFORMED_ROW_VIOLATION = {
    code: "malformed-row",
    severity: "error",
    message:
      '"Health Broken Row" (Health Broken Row.md): frontmatter is missing or failed to parse.',
    repairTier: "manual-only",
  };

  const BROKEN_ROW_DOM = {
    ok: true,
    isBroken: true,
    hasBadge: false,
    violationCount: 0,
    violationCode: null,
    repairTier: null,
  };
  const AUTOFIX_BADGE_DOM = {
    ok: true,
    isBroken: false,
    hasBadge: true,
    violationCount: 1,
    violationCode: "empty-encoding",
    repairTier: "autofix",
  };
  const CLEARED_BADGE_DOM = {
    ok: true,
    isBroken: false,
    hasBadge: false,
    violationCount: 0,
    violationCode: null,
    repairTier: null,
  };

  // Each waitForX call in the scenario resolves on its FIRST poll (the
  // canned response already satisfies that call's own predicate), so the
  // Nth distinct call for a given marker maps 1:1 to the scenario's own
  // step order -- same convention buildReconcilerRunner's
  // `violationsSequence` uses.
  const buildHealthRunner = ({
    violationsSequence = [
      [EMPTY_ENCODING_VIOLATION],
      [MALFORMED_ROW_VIOLATION],
      [],
    ],
    rowDomSequence = [BROKEN_ROW_DOM, AUTOFIX_BADGE_DOM, CLEARED_BADGE_DOM],
    hubPathResult = { ok: true, hubPath: HEALTH_HUB_PATH },
    tableSetupResult = { ok: true },
    autofixResult = { ok: true },
    fieldStateResult = { hasKey: true, value: "" },
    chipCountResult = { ok: true, violationCount: 1 },
    chipPanelResult = { ok: true, chipCount: 1, panelCount: 1, liveCount: 1 },
    deleteOk = true,
  } = {}) => {
    let violationsCallCount = 0;
    let rowDomCallCount = 0;
    const runner = jest.fn(async (args) => {
      const command = args[1];
      if (command != "eval") return "";

      const codeArg = args.find((arg) => arg.startsWith("code=")) ?? "";
      if (codeArg.includes("notidianEnsureFixtureFolder")) {
        return JSON.stringify({ ok: true, created: [] });
      }
      if (codeArg.includes("notidianReconcilerHubPath")) {
        return JSON.stringify(hubPathResult);
      }
      if (codeArg.includes("notidianReconcilerRowViolations")) {
        const violations = violationsSequence[violationsCallCount] ?? [];
        violationsCallCount++;
        return JSON.stringify({ ok: true, violations });
      }
      if (codeArg.includes("notidianTableUiSetup")) {
        return JSON.stringify(tableSetupResult);
      }
      if (codeArg.includes("notidianHealthRowDom")) {
        const result = rowDomSequence[rowDomCallCount] ?? {
          ok: false,
          reason: "missing-row",
        };
        rowDomCallCount++;
        return JSON.stringify(result);
      }
      if (codeArg.includes("notidianHealthAutofix")) {
        return JSON.stringify(autofixResult);
      }
      if (codeArg.includes("notidianHealthFieldState")) {
        return JSON.stringify(fieldStateResult);
      }
      if (codeArg.includes("notidianHealthChipCount")) {
        return JSON.stringify(chipCountResult);
      }
      if (codeArg.includes("notidianHealthChipPanel")) {
        return JSON.stringify(chipPanelResult);
      }
      if (codeArg.includes("notidianDeleteFolder")) {
        return JSON.stringify(
          deleteOk ? { ok: true } : { ok: false, reason: "exception" }
        );
      }
      if (codeArg.includes('"model"')) return "=> Widget A";
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

  it("drives fixture setup, DOM assertions, the autofix funnel, chip==panel, and cleanup in order", async () => {
    const runner = buildHealthRunner();

    const result = await runHealthSurfacesScenario({
      config: scenarioConfig(),
      runner,
      runId: "run-1",
    });

    expect(result).toEqual({
      ok: true,
      folder: HEALTH_ROOT,
      hubPath: HEALTH_HUB_PATH,
      emptyRowPath: HEALTH_EMPTY_ROW_PATH,
      brokenRowPath: HEALTH_BROKEN_ROW_PATH,
    });

    const commandSequence = runner.mock.calls.map(([args]) => args[1]);
    expect(commandSequence).toEqual([
      "eval", // ensure fixture folder
      "create", // empty row (valid model, code absent)
      "eval", // waitForMetadataValue(model) on empty row
      "create", // broken row (malformed YAML)
      "eval", // resolve hub path
      "create", // hub note declaring Type Profile directly
      "eval", // waitForMetadataValue(schema_type)
      "eval", // empty-encoding autofix violation surfaces
      "eval", // malformed-row violation surfaces
      "eval", // table view setup
      "eval", // broken row rendered as mk-row-broken
      "eval", // autofix badge visible
      "eval", // DOM-drive the autofix (click badge -> menu -> fix)
      "eval", // on-disk explicit empty string settles
      "eval", // empty-encoding violation clears
      "eval", // badge cleared in DOM
      "eval", // chip settles to the post-fix count
      "eval", // chip click -> panel open -> chip==panel compare
      "dev:errors",
      "eval", // cleanup (delete folder)
    ]);
  });

  it("throws when the hub path cannot be resolved", async () => {
    const runner = buildHealthRunner({
      hubPathResult: { ok: false, reason: "missing-note-path" },
    });

    await expect(
      runHealthSurfacesScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow("Health fixture hub path resolution failed");

    // Cleanup still runs even though the scenario failed early.
    expect(
      runner.mock.calls.some(([args]) => args.join(" ").includes("notidianDeleteFolder"))
    ).toBe(true);
  });

  it("times out waiting for the broken row to render as mk-row-broken", async () => {
    const runner = buildHealthRunner({
      rowDomSequence: [{ ok: true, isBroken: false, hasBadge: false }],
    });

    await expect(
      runHealthSurfacesScenario({
        config: scenarioConfig({ timeoutMs: 50 }),
        runner,
        runId: "run-1",
      })
    ).rejects.toThrow(/Timed out waiting for health row DOM \(broken row rendered\)/);
  });

  it("throws when the autofix menu interaction fails", async () => {
    const runner = buildHealthRunner({
      autofixResult: { ok: false, reason: "missing-repair-menu" },
    });

    await expect(
      runHealthSurfacesScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow("Health autofix DOM interaction failed: missing-repair-menu");
  });

  it("times out waiting for the on-disk value to become an explicit empty string", async () => {
    const runner = buildHealthRunner({
      fieldStateResult: { hasKey: false, value: null },
    });

    await expect(
      runHealthSurfacesScenario({
        config: scenarioConfig({ timeoutMs: 50 }),
        runner,
        runId: "run-1",
      })
    ).rejects.toThrow(/Timed out waiting for an explicit empty string/);
  });

  it("throws when the chip count and panel count disagree", async () => {
    const runner = buildHealthRunner({
      chipPanelResult: { ok: true, chipCount: 1, panelCount: 2, liveCount: 1 },
    });

    await expect(
      runHealthSurfacesScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow(/chip count \(1\) does not match panel count \(2\)/);
  });

  it("throws when the chip count disagrees with the live reconciler count", async () => {
    const runner = buildHealthRunner({
      chipPanelResult: { ok: true, chipCount: 1, panelCount: 1, liveCount: 2 },
    });

    await expect(
      runHealthSurfacesScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow(/live reconciler count \(2\)/);
  });

  it("skips cleanup when --keep-fixture is set", async () => {
    const runner = buildHealthRunner();

    await runHealthSurfacesScenario({
      config: scenarioConfig({ keepFixture: true }),
      runner,
      runId: "run-1",
    });

    expect(
      runner.mock.calls.some(([args]) => args.join(" ").includes("notidianDeleteFolder"))
    ).toBe(false);
  });

  it("surfaces a cleanup failure when the scenario itself succeeded", async () => {
    const runner = buildHealthRunner({ deleteOk: false });

    await expect(
      runHealthSurfacesScenario({ config: scenarioConfig(), runner, runId: "run-1" })
    ).rejects.toThrow("Health fixture cleanup failed");
  });
});
