const {
  buildObsidianArgs,
  createObsidianRunner,
  createFixturePaths,
  parseHarnessArgs,
  runRealVaultSmokeHarness,
  validateHarnessConfig,
} = require("./notidianRealVaultHarness");

const baseConfig = {
  vault: "Atlas Vault",
  allowWrite: true,
  keepFixture: false,
  includeUi: false,
  includeBaseExport: false,
  includeBaseView: false,
  pluginId: "notidian",
  fixtureRoot: "Notidian Integration Fixtures",
  timeoutMs: 10000,
  commandTimeoutMs: 20000,
  pollIntervalMs: 0,
  cleanupSettleMs: 0,
  obsidianBin: "obsidian",
};

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
          "--base-export",
          "--base-view",
        ],
        { OBSIDIAN_BIN: "obsidian-dev" }
      )
    ).toEqual({
      vault: "Atlas Vault",
      allowWrite: true,
      keepFixture: true,
      includeUi: false,
      includeBaseExport: true,
      includeBaseView: true,
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
      includeBaseExport: false,
      includeBaseView: false,
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
      baseViewPath:
        "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Notidian Table.base",
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
        if (code.includes("notidianRenameFile")) {
          return JSON.stringify({ ok: true, path: args[0] });
        }
        return evalResponses.shift() ?? "deleted";
      }
      if (command == "property:read") return "active";
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
      "create",
      "create",
      "eval",
      "property:set",
      "property:read",
      "eval",
      "eval",
      "read",
      "eval",
      "dev:errors",
      "delete",
      "delete",
      "dev:errors",
    ]);
    expect(calls.every((args) => args[0] == "vault=Atlas Vault")).toBe(true);
    expect(calls.map((args) => args[1])).not.toContain("rename");
    expect(
      calls.some(
        (args) =>
          args[1] == "eval" && args.join(" ").includes("notidianRenameFile")
      )
    ).toBe(true);
  });

  it("runs the optional table UI smoke scenario before cleanup", async () => {
    const calls = [];
    const evalResponses = [
      "=> old",
      "=> active",
      "=> active",
      "=> ui-active",
      "=> paste-active",
      "=> 7",
      "=> ui-active",
      "=> 2",
      "=> conflict-applied",
      "=> active",
    ];
    const uiRenamedPath =
      "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Alpha UI Renamed.md";
    const runner = jest.fn(async (args) => {
      calls.push(args);
      const command = args[1];
      if (command == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
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
        if (code.includes("notidianTableUiPaste")) {
          return JSON.stringify({
            ok: true,
            editedValues: { status: "paste-active", rating: "7" },
          });
        }
        if (code.includes("notidianTableUiUndo")) {
          return JSON.stringify({
            ok: true,
            editedValues: { status: "ui-active", rating: "2" },
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
      if (command == "property:read") return "active";
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
      .toHaveLength(17);
    [
      "notidianTableUiEdit",
      "notidianTableUiPaste",
      "notidianTableUiUndo",
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
    expect(calls.some((args) => args.includes(`path=${uiRenamedPath}`))).toBe(
      true
    );
    expect(calls.map((args) => args[1]).slice(-3)).toEqual([
      "delete",
      "delete",
      "dev:errors",
    ]);
  });

  it("runs the optional base export smoke scenario and cleans up the exported file", async () => {
    const calls = [];
    const evalResponses = ["=> old", "=> active", "=> active"];
    const exportedPath = "Notidian Integration Fixtures.base";
    const runner = jest.fn(async (args) => {
      calls.push(args);
      const command = args[1];
      if (command == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
        if (code.includes("notidianRenameFile")) {
          return JSON.stringify({ ok: true });
        }
        if (code.includes("notidianBaseExport")) {
          return JSON.stringify({
            ok: true,
            outputPath: exportedPath,
            content: 'filters:\n  and:\n    - "file.inFolder(\\"Notidian Integration Fixtures\\")"\nviews:\n  - type: "table"\n',
          });
        }
        return evalResponses.shift() ?? "active";
      }
      if (command == "property:read") return "active";
      if (command == "read") return "---\nstatus: active\n---\n# Alpha";
      if (command == "dev:errors" && !args.includes("clear")) {
        return "No errors captured.";
      }
      return "";
    });

    const result = await runRealVaultSmokeHarness(
      {
        ...baseConfig,
        includeBaseExport: true,
        now: () => new Date("2026-05-25T10:20:30.456Z"),
      },
      runner
    );

    expect(result).toEqual({
      ok: true,
      fixtureFolder: "Notidian Integration Fixtures",
      cleanedUp: true,
      baseExportPath: exportedPath,
    });
    expect(
      calls.some(
        (args) =>
          args[1] == "eval" && args.join(" ").includes("notidianBaseExport")
      )
    ).toBe(true);
    expect(calls.some((args) => args.includes(`path=${exportedPath}`))).toBe(
      true
    );
    expect(calls.map((args) => args[1]).slice(-4)).toEqual([
      "delete",
      "delete",
      "delete",
      "dev:errors",
    ]);
  });

  it("runs the optional custom Bases view smoke scenario and cleans up the .base file", async () => {
    const calls = [];
    const evalResponses = ["=> old", "=> active", "=> active"];
    const baseViewPath =
      "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Notidian Table.base";
    const runner = jest.fn(async (args) => {
      calls.push(args);
      const command = args[1];
      if (command == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
        if (code.includes("notidianRenameFile")) {
          return JSON.stringify({ ok: true });
        }
        if (code.includes("notidianBaseView")) {
          return JSON.stringify({
            ok: true,
            basePath: baseViewPath,
            rowCount: 2,
            tableText: "Notidian Table status rating Beta active",
          });
        }
        return evalResponses.shift() ?? "active";
      }
      if (command == "property:read") return "active";
      if (command == "read") return "---\nstatus: active\n---\n# Alpha";
      if (command == "dev:errors" && !args.includes("clear")) {
        return "No errors captured.";
      }
      return "";
    });

    const result = await runRealVaultSmokeHarness(
      {
        ...baseConfig,
        includeBaseView: true,
        now: () => new Date("2026-05-25T10:20:30.456Z"),
      },
      runner
    );

    expect(result).toEqual({
      ok: true,
      fixtureFolder: "Notidian Integration Fixtures",
      cleanedUp: true,
      baseViewPath,
    });
    expect(
      calls.some(
        (args) =>
          args[1] == "eval" && args.join(" ").includes("notidianBaseView")
      )
    ).toBe(true);
    expect(calls.some((args) => args.includes(`path=${baseViewPath}`))).toBe(
      true
    );
    expect(calls.map((args) => args[1]).slice(-4)).toEqual([
      "delete",
      "delete",
      "delete",
      "dev:errors",
    ]);
  });

  it("fails loudly when the optional custom Bases view smoke does not render", async () => {
    const evalResponses = ["=> old", "=> active", "=> active"];
    const runner = jest.fn(async (args) => {
      const command = args[1];
      if (command == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
        if (code.includes("notidianRenameFile")) {
          return JSON.stringify({ ok: true });
        }
        if (code.includes("notidianBaseView")) {
          return JSON.stringify({
            ok: false,
            reason: "missing-custom-view",
          });
        }
        return evalResponses.shift() ?? "active";
      }
      if (command == "property:read") return "active";
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
          includeBaseView: true,
          now: () => new Date("2026-05-25T10:20:30.456Z"),
        },
        runner
      )
    ).rejects.toThrow(
      "Notidian custom Bases view smoke failed: missing-custom-view"
    );
  });

  it("fails loudly when the optional base export smoke reports invalid YAML", async () => {
    const evalResponses = ["=> old", "=> active", "=> active"];
    const runner = jest.fn(async (args) => {
      const command = args[1];
      if (command == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
        if (code.includes("notidianRenameFile")) {
          return JSON.stringify({ ok: true });
        }
        if (code.includes("notidianBaseExport")) {
          return JSON.stringify({
            ok: false,
            reason: "missing-folder-filter",
          });
        }
        return evalResponses.shift() ?? "active";
      }
      if (command == "property:read") return "active";
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
          includeBaseExport: true,
          now: () => new Date("2026-05-25T10:20:30.456Z"),
        },
        runner
      )
    ).rejects.toThrow("Notidian base export smoke failed: missing-folder-filter");
  });

  it("fails loudly when the optional table UI smoke reports a missing table", async () => {
    const evalResponses = ["=> old", "=> active", "=> active"];
    const runner = jest.fn(async (args) => {
      const command = args[1];
      if (command == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
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
        return evalResponses.shift() ?? "active";
      }
      if (command == "property:read") return "active";
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
    const evalResponses = ["=> old", "=> active", "=> active", "=> ui-active"];
    const runner = jest.fn(async (args) => {
      const command = args[1];
      if (command == "eval") {
        const code = args.find((arg) => arg.startsWith("code=")) ?? "";
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
        if (code.includes("notidianTableUiPaste")) {
          return JSON.stringify({
            ok: false,
            reason: "missing-cell",
          });
        }
        return evalResponses.shift() ?? "ui-active";
      }
      if (command == "property:read") return "active";
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
        if (code.includes("notidianRenameFile")) {
          return JSON.stringify({ ok: true });
        }
        return evalResponses.shift() ?? "active";
      }
      if (args[1] == "property:read") return "active";
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
  });

  it("times out stuck Obsidian CLI child processes", async () => {
    const runner = createObsidianRunner(process.execPath, 25);

    await expect(
      runner(["-e", "setTimeout(() => {}, 1000)"])
    ).rejects.toThrow("timed out after 25ms");
  });
});
