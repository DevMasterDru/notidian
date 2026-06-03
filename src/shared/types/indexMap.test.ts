import { IndexMap } from "./indexMap";

describe("IndexMap", () => {
  it("removes stale inverse entries when replacing forward values", () => {
    const index = new IndexMap();

    index.set("note-a", new Set(["tag-one", "tag-two"]));
    index.set("note-a", new Set(["tag-two", "tag-three"]));

    expect(index.getInverse("tag-one").has("note-a")).toBe(false);
    expect(index.getInverse("tag-two").has("note-a")).toBe(true);
    expect(index.getInverse("tag-three").has("note-a")).toBe(true);
  });

  it("removes stale forward entries when replacing inverse values", () => {
    const index = new IndexMap();

    index.setInverse("tag-one", new Set(["note-a", "note-b"]));
    index.setInverse("tag-one", new Set(["note-b", "note-c"]));

    expect(index.get("note-a").has("tag-one")).toBe(false);
    expect(index.get("note-b").has("tag-one")).toBe(true);
    expect(index.get("note-c").has("tag-one")).toBe(true);
  });
});
