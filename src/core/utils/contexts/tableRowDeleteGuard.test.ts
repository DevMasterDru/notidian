import { runGuardedRowDelete } from "./tableRowDeleteGuard";

describe("runGuardedRowDelete", () => {
  it("commits undo + selection clear only after the delete write succeeds", async () => {
    const calls: string[] = [];
    const ok = await runGuardedRowDelete({
      deleteRows: async () => {
        calls.push("delete");
      },
      onDeleted: () => calls.push("deleted"),
      onError: () => calls.push("error"),
    });

    expect(ok).toBe(true);
    expect(calls).toEqual(["delete", "deleted"]);
  });

  it("notifies and skips the undo entry when the delete write rejects (Notidian-1lkz)", async () => {
    const calls: string[] = [];
    const ok = await runGuardedRowDelete({
      deleteRows: async () => {
        calls.push("delete");
        throw new Error("MDB write failed");
      },
      onDeleted: () => calls.push("deleted"),
      onError: () => calls.push("error"),
    });

    // The rejection is caught (no unhandled promise), the user is notified, and
    // the undo entry + selection clear are NOT applied — the selection stays so
    // the delete can be retried.
    expect(ok).toBe(false);
    expect(calls).toEqual(["delete", "error"]);
    expect(calls).not.toContain("deleted");
  });

  it("does not throw even though the underlying write rejects (no floating rejection)", async () => {
    await expect(
      runGuardedRowDelete({
        deleteRows: () => Promise.reject(new Error("disk full")),
        onDeleted: () => undefined,
        onError: () => undefined,
      })
    ).resolves.toBe(false);
  });
});
