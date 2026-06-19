export type PropertyHeaderTooltipRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PropertyHeaderTooltipSize = {
  width: number;
  height: number;
};

export type PropertyHeaderTooltipPosition = {
  left: number;
  top: number;
  arrowLeft: number;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const propertyHeaderTooltipPosition = ({
  anchorRect,
  tooltipSize,
  viewportWidth,
  gap = 8,
  viewportPadding = 8,
  arrowPadding = 14,
}: {
  anchorRect: PropertyHeaderTooltipRect;
  tooltipSize: PropertyHeaderTooltipSize;
  viewportWidth: number;
  gap?: number;
  viewportPadding?: number;
  arrowPadding?: number;
}): PropertyHeaderTooltipPosition => {
  const anchorCenter = anchorRect.left + anchorRect.width / 2;
  const maxLeft = Math.max(
    viewportPadding,
    viewportWidth - tooltipSize.width - viewportPadding
  );
  const left = clamp(
    anchorCenter - tooltipSize.width / 2,
    viewportPadding,
    maxLeft
  );
  const arrowLeft = clamp(
    anchorCenter - left,
    arrowPadding,
    Math.max(arrowPadding, tooltipSize.width - arrowPadding)
  );

  return {
    left,
    top: Math.max(viewportPadding, anchorRect.top - tooltipSize.height - gap),
    arrowLeft,
  };
};
