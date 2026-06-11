/**
 * Regression test for bd Notidian-44c: a corrupt/partially-synced .notidian MDB
 * file was caught and silently replaced with a fresh empty database, so the next
 * save overwrote recoverable view/context state. The fix distinguishes
 * missing|ok|corrupt and refuses to overwrite a corrupt file.
 *
 * Uses a fake sql.js so the test runs in node without the wasm runtime. The fake
 * Database throws on exec() when constructed from "corrupt" bytes (first byte
 * 0xFF), mirroring sql.js raising "database disk image is malformed".
 */
import { openDBWithStatus, openZippedDBWithStatus, saveDBToPath } from "../db";

const CORRUPT = new Uint8Array([0xff, 0x01, 0x02]).buffer;
const CONSTRUCTOR_CORRUPT = new Uint8Array([0xfe, 0x01, 0x02]).buffer;
const VALID = new Uint8Array([0x53, 0x51, 0x4c]).buffer; // arbitrary non-0xFF bytes

class FakeDB {
  private bytes?: Uint8Array;
  constructor(bytes?: Uint8Array) {
    if (bytes && bytes[0] === 0xfe) {
      throw new Error("file is not a database");
    }
    this.bytes = bytes;
  }
  exec(_sql: string) {
    if (this.bytes && this.bytes[0] === 0xff) {
      throw new Error("database disk image is malformed");
    }
    return [] as any[];
  }
  run() {}
  export() {
    return { buffer: new Uint8Array([0]).buffer };
  }
  close() {}
}

const fakeSqlJS = { Database: FakeDB } as any;

const makePlugin = (opts: {
  fileExists: boolean;
  bytes: ArrayBuffer | null;
  writes: { path: string; bytes: ArrayBuffer }[];
}) =>
  ({
    sqlJS: async () => fakeSqlJS,
    middleware: {
      fileExists: jest.fn(async () => opts.fileExists),
      readBinaryToFile: jest.fn(async () => opts.bytes),
      writeBinaryToFile: jest.fn(async (path: string, bytes: ArrayBuffer) => {
        opts.writes.push({ path, bytes });
      }),
      createFolder: jest.fn(async () => {}),
    },
  }) as any;

describe("44c: corrupt MDB is not silently reset to empty", () => {
  it("classifies an unreadable existing file as corrupt, not missing", async () => {
    const plugin = makePlugin({ fileExists: true, bytes: CORRUPT, writes: [] });
    const { status } = await openDBWithStatus(plugin, fakeSqlJS, "ctx.mdb");
    expect(status).toBe("corrupt");
  });

  it("classifies a constructor failure while opening an existing file as corrupt", async () => {
    const plugin = makePlugin({
      fileExists: true,
      bytes: CONSTRUCTOR_CORRUPT,
      writes: [],
    });
    const { status } = await openDBWithStatus(plugin, fakeSqlJS, "ctx.mdb");
    expect(status).toBe("corrupt");
  });

  it("classifies an existing unreadable zipped file as corrupt, not missing", async () => {
    const plugin = makePlugin({
      fileExists: true,
      bytes: CORRUPT,
      writes: [],
    });

    const { status } = await openZippedDBWithStatus(plugin, fakeSqlJS, "cache.mdc");

    expect(status).toBe("corrupt");
  });

  it("still classifies an absent zipped file as missing", async () => {
    const plugin = makePlugin({
      fileExists: false,
      bytes: null,
      writes: [],
    });

    const { status } = await openZippedDBWithStatus(plugin, fakeSqlJS, "cache.mdc");

    expect(status).toBe("missing");
  });

  it("classifies a readable existing file as ok and an absent file as missing", async () => {
    const ok = await openDBWithStatus(
      makePlugin({ fileExists: true, bytes: VALID, writes: [] }),
      fakeSqlJS,
      "ctx.mdb"
    );
    expect(ok.status).toBe("ok");

    const missing = await openDBWithStatus(
      makePlugin({ fileExists: false, bytes: null, writes: [] }),
      fakeSqlJS,
      "ctx.mdb"
    );
    expect(missing.status).toBe("missing");
  });

  it("refuses to overwrite a corrupt file and quarantines it instead", async () => {
    const writes: { path: string; bytes: ArrayBuffer }[] = [];
    const plugin = makePlugin({ fileExists: true, bytes: CORRUPT, writes });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const result = await saveDBToPath(plugin, "ctx.mdb", {} as any);

      // The destructive overwrite must NOT happen for the original path...
      expect(result).toBe(false);
      expect(writes.some((w) => w.path === "ctx.mdb")).toBe(false);
      // ...and a quarantine copy should have been written.
      expect(writes.some((w) => w.path.startsWith("ctx.mdb.corrupt-"))).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Refusing to overwrite unreadable database")
      );
    } finally {
      warn.mockRestore();
    }
  });
});
