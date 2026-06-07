import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyHeaderDisplayModeMenuComponent } from "./PropertyHeaderDisplayModeMenu";

describe("PropertyHeaderDisplayModeMenuComponent", () => {
  test("renders header display modes as one compact segmented row", () => {
    const markup = renderToStaticMarkup(
      <PropertyHeaderDisplayModeMenuComponent
        headerDisplayMode="text"
        setHeaderDisplayMode={() => undefined}
        hide={() => undefined}
      />
    );

    expect(markup).toContain("mk-property-header-display-menu");
    expect(markup).toContain("mk-property-header-display-options");
    expect(markup.match(/<button/g) ?? []).toHaveLength(4);
    expect(markup).toContain("mk-property-header-display-option--active");
    expect(markup).toContain("Header Display");
    expect(markup).toContain("Adaptive");
    expect(markup).toContain("Icon+Text");
    expect(markup).toContain("Text");
    expect(markup).toContain("Icon");
  });
});
