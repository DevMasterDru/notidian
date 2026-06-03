const {
  createLiveVerificationSteps,
  createSourceVerificationSteps,
  parseVerifyArgs,
  runVerificationSteps,
} = require("./notidianVerify");

describe("notidian verification gate", () => {
  it("parses source and live verification options", () => {
    expect(parseVerifyArgs(["source", "--require-clean"], {})).toMatchObject({
      mode: "source",
      requireClean: true,
      vaultPath: "/Users/druker/Atlas Vault",
      vault: "Atlas Vault",
      pluginId: "notidian",
      ui: false,
    });

    expect(
      parseVerifyArgs(
        ["live", "--vault-path=/vaults/Atlas Vault", "--plugin-id=notidian-dev", "--ui"],
        {}
      )
    ).toMatchObject({
      mode: "live",
      vaultPath: "/vaults/Atlas Vault",
      vault: "Atlas Vault",
      pluginId: "notidian-dev",
      ui: true,
    });

    expect(parseVerifyArgs([], { NOTIDIAN_VERIFY_MODE: "live" }).mode).toBe(
      "live"
    );
  });

  it("plans the full source verification sequence", () => {
    expect(createSourceVerificationSteps({ requireClean: true })).toEqual([
      {
        label: "git status before source verification",
        command: "git",
        args: ["status", "--short"],
        requireEmptyStdout: true,
      },
      {
        label: "Jest test suite",
        command: "npm",
        args: ["test", "--", "--runInBand"],
      },
      {
        label: "TypeScript",
        command: "npx",
        args: ["tsc", "-noEmit", "-skipLibCheck"],
      },
      { label: "npm audit", command: "npm", args: ["audit"] },
      { label: "production build", command: "npm", args: ["run", "build"] },
      {
        label: "git whitespace check",
        command: "git",
        args: ["diff", "--check", "HEAD^", "HEAD", "--", "."],
      },
      {
        label: "git status after source verification",
        command: "git",
        args: ["status", "--short"],
        requireEmptyStdout: true,
      },
    ]);
  });

  it("plans the live vault verification sequence with post-smoke settling", () => {
    expect(
      createLiveVerificationSteps({
        vaultPath: "/vaults/Atlas Vault",
        vault: "Atlas Vault",
        pluginId: "notidian",
        ui: true,
        settleMs: 8000,
      })
    ).toEqual([
      {
        label: "live health audit before smoke",
        command: "npm",
        args: [
          "run",
          "health:audit",
          "--",
          "--vault-path=/vaults/Atlas Vault",
          "--live",
        ],
      },
      {
        label: "legacy storage migration dry-run",
        command: "npm",
        args: [
          "run",
          "migrate:space-store",
          "--",
          "--vault-path=/vaults/Atlas Vault",
          "--json",
        ],
      },
      {
        label: "real-vault smoke",
        command: "npm",
        args: [
          "run",
          "test:real-vault",
          "--",
          "vault=Atlas Vault",
          "--allow-write",
          "--plugin-id=notidian",
          "--ui",
        ],
      },
      { label: "post-smoke settle", sleepMs: 8000 },
      {
        label: "live health audit after smoke",
        command: "npm",
        args: [
          "run",
          "health:audit",
          "--",
          "--vault-path=/vaults/Atlas Vault",
          "--live",
        ],
      },
      {
        label: "Obsidian developer errors",
        command: "obsidian",
        args: ["vault=Atlas Vault", "dev:errors"],
      },
    ]);
  });

  it("stops the gate when a command exits non-zero", async () => {
    const calls = [];
    const runner = jest.fn((command, args) => {
      calls.push([command, args]);
      return { status: command == "npx" ? 1 : 0, stdout: "", stderr: "" };
    });

    await expect(
      runVerificationSteps(
        [
          { label: "tests", command: "npm", args: ["test"] },
          { label: "types", command: "npx", args: ["tsc"] },
          { label: "build", command: "npm", args: ["run", "build"] },
        ],
        { runner, sleep: async () => {}, log: () => {} }
      )
    ).rejects.toThrow("Verification step failed: types");

    expect(calls).toEqual([
      ["npm", ["test"]],
      ["npx", ["tsc"]],
    ]);
  });
});
