import {
  pointRelativeToScrolledContainer,
  rectFromPoints,
  rectRelativeToScrolledContainer,
} from "./tableRowMarquee";

const container = (left: number, top: number) =>
  ({ left, top } as Pick<DOMRect, "left" | "top">);

describe("table row marquee geometry", () => {
  it("builds a viewport rect from the cursor origin and current pointer", () => {
    expect(rectFromPoints(160, 260, 120, 230)).toEqual({
      left: 120,
      top: 230,
      width: 40,
      height: 30,
    });
  });

  it("places the overlay at the cursor inside an unscrolled table", () => {
    expect(
      pointRelativeToScrolledContainer(120, 230, container(100, 200), {
        left: 0,
        top: 0,
      })
    ).toEqual({
      left: 20,
      top: 30,
      width: 0,
      height: 0,
    });
  });

  it("adds scroll offsets so the overlay still begins under the cursor", () => {
    expect(
      pointRelativeToScrolledContainer(120, 230, container(100, 200), {
        left: 40,
        top: 60,
      })
    ).toEqual({
      left: 60,
      top: 90,
      width: 0,
      height: 0,
    });
  });

  it("keeps a dragged viewport rectangle visually anchored when the table is scrolled", () => {
    const viewportRect = rectFromPoints(120, 230, 160, 260);
    expect(
      rectRelativeToScrolledContainer(viewportRect, container(100, 200), {
        left: 40,
        top: 60,
      })
    ).toEqual({
      left: 60,
      top: 90,
      width: 40,
      height: 30,
    });
  });
});
