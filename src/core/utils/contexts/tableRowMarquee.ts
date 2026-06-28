export type TableMarqueeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type TableMarqueeScroll = {
  left: number;
  top: number;
};

export const rectFromPoints = (
  startX: number,
  startY: number,
  endX: number,
  endY: number
): TableMarqueeRect => ({
  left: Math.min(startX, endX),
  top: Math.min(startY, endY),
  width: Math.max(1, Math.abs(endX - startX)),
  height: Math.max(1, Math.abs(endY - startY)),
});

export const rectsIntersect = (
  a: Pick<TableMarqueeRect, "left" | "top" | "width" | "height">,
  b: Pick<TableMarqueeRect, "left" | "top" | "width" | "height">
): boolean =>
  a.left < b.left + b.width &&
  a.left + a.width > b.left &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;

export const rectRelativeToScrolledContainer = (
  rect: TableMarqueeRect,
  container: Pick<DOMRect, "left" | "top">,
  scroll: TableMarqueeScroll
): TableMarqueeRect => ({
  left: rect.left - container.left + scroll.left,
  top: rect.top - container.top + scroll.top,
  width: rect.width,
  height: rect.height,
});

export const pointRelativeToScrolledContainer = (
  clientX: number,
  clientY: number,
  container: Pick<DOMRect, "left" | "top">,
  scroll: TableMarqueeScroll
): TableMarqueeRect => ({
  left: clientX - container.left + scroll.left,
  top: clientY - container.top + scroll.top,
  width: 0,
  height: 0,
});
