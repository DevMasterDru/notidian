import { PathPropertyName } from "shared/types/context";
import { frontmatterPropertySource } from "./allProperties";
import {
  propertyAuthorityForColumn,
  shouldPersistAuthorityValueToContext,
  shouldWriteAuthorityValueToFrontmatter,
} from "./propertyAuthority";

describe("propertyAuthorityForColumn", () => {
  it("classifies file identity, frontmatter, formula, and Notidian-owned columns", () => {
    expect(
      propertyAuthorityForColumn({ name: PathPropertyName, type: "file" })
    ).toBe("file");
    expect(
      propertyAuthorityForColumn({
        name: "status",
        type: "text",
        source: frontmatterPropertySource,
      })
    ).toBe("frontmatter");
    expect(propertyAuthorityForColumn({ name: "age", type: "fileprop" })).toBe(
      "computed"
    );
    expect(propertyAuthorityForColumn({ name: "manual", type: "text" })).toBe(
      "notidian"
    );
  });

  it("only frontmatter authority writes through to frontmatter", () => {
    expect(
      shouldWriteAuthorityValueToFrontmatter(
        {
          name: "status",
          type: "text",
          source: frontmatterPropertySource,
        }
      )
    ).toBe(true);
    expect(
      shouldWriteAuthorityValueToFrontmatter(
        { name: "manual", type: "text" }
      )
    ).toBe(false);
  });

  it("does not persist frontmatter or computed values as durable context values", () => {
    expect(
      shouldPersistAuthorityValueToContext({
        name: PathPropertyName,
        type: "file",
      })
    ).toBe(true);
    expect(
      shouldPersistAuthorityValueToContext({
        name: "status",
        type: "text",
        source: frontmatterPropertySource,
      })
    ).toBe(false);
    expect(
      shouldPersistAuthorityValueToContext({ name: "age", type: "fileprop" })
    ).toBe(false);
    expect(
      shouldPersistAuthorityValueToContext({ name: "manual", type: "text" })
    ).toBe(true);
  });
});
