import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StickerModal from "./StickerModal";

const ui = {
  allStickers: (): any[] => [],
  getSticker: (sticker: string) => `<svg data-sticker="${sticker}"></svg>`,
} as any;

describe("StickerModal", () => {
  it("does not show the default reset action unless one is provided", () => {
    const html = renderToStaticMarkup(
      <StickerModal ui={ui} selectedSticker={() => null} />
    );

    expect(html).not.toContain("mk-sticker-reset-button");
  });

  it("shows an enabled default reset action when reset is available", () => {
    const html = renderToStaticMarkup(
      <StickerModal
        ui={ui}
        selectedSticker={() => null}
        resetSticker={() => null}
        canResetSticker={true}
      />
    );

    expect(html).toContain("mk-sticker-reset-button");
    expect(html).toContain("Default");
    expect(html).not.toContain("disabled");
  });

  it("shows a disabled default reset action when there is no configured sticker", () => {
    const html = renderToStaticMarkup(
      <StickerModal
        ui={ui}
        selectedSticker={() => null}
        resetSticker={() => null}
        canResetSticker={false}
      />
    );

    expect(html).toContain("mk-sticker-reset-button");
    expect(html).toContain("Default");
    expect(html).toContain("disabled");
  });
});
