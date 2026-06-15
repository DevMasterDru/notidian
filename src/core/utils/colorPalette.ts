import { Superstate } from "makemd-core";
import { ColorPaletteAsset } from "shared/types/assets";

export interface ColorPaletteColor {
  name: string;
  value: string;
  category?: string;
}


export const getColorPalettes = (superstate: Superstate): ColorPaletteAsset[] => {
  // Check both possible asset manager references
  const assetManager = (superstate as any).assetManager || (superstate as any).assets;
  
  if (!assetManager) {
    console.warn('[ColorPalette] AssetManager not available in superstate');
    return [];
  }
  
  // Asset manager will ensure defaults exist if none are found
  const palettes = assetManager.getColorPalettes() || [];
  
  return palettes;
};

export const getColorPaletteById = (superstate: Superstate, paletteId: string): ColorPaletteAsset | undefined => {
  const palettes = getColorPalettes(superstate);
  return palettes.find(p => p.id === paletteId);
};

export const getDefaultPalette = (superstate: Superstate): ColorPaletteAsset | undefined => {
  return getColorPaletteById(superstate, 'default-palette');
};

export const getMonochromePalette = (superstate: Superstate): ColorPaletteAsset | undefined => {
  return getColorPaletteById(superstate, 'monochrome-palette');
};

export const getThemeColors = (superstate: Superstate): ColorPaletteColor[] => {
  const defaultPalette = getDefaultPalette(superstate);
  return defaultPalette?.colors || [];
};

export const getMonochromeColors = (superstate: Superstate): ColorPaletteColor[] => {
  const monochromePalette = getMonochromePalette(superstate);
  return monochromePalette?.colors || [];
};

export const getAllColors = (superstate: Superstate): ColorPaletteColor[] => {
  const palettes = getColorPalettes(superstate);
  return palettes.flatMap(p => p.colors);
};

export const getColorByName = (superstate: Superstate, name: string): string | undefined => {
  const colors = getAllColors(superstate);
  const color = colors.find(c => c.name.toLowerCase() === name.toLowerCase());
  return color?.value;
};

// Legacy compatibility arrays for easier migration
export const getColors = (superstate: Superstate): [string, string][] => {
  return getThemeColors(superstate).map(c => [c.name, c.value] as [string, string]);
};

export const getColorsBase = (superstate: Superstate): [string, string][] => {
  return getMonochromeColors(superstate).map(c => [c.name, c.value] as [string, string]);
};

// UI color arrays that combine CSS variables with palette colors
export const getBackgroundColors = (): [string, string][] => [
  ["Background", "var(--mk-ui-background)"],
  ["Background Variant", "var(--mk-ui-background-variant)"],
  ["Background Contrast", "var(--mk-ui-background-contrast)"],
  ["Background Active", "var(--mk-ui-background-active)"],
  ["Background Selected", "var(--mk-ui-background-selected)"],
];

export const getTextColors = (): [string, string][] => [
  ["Text Primary", "var(--mk-ui-text-primary)"],
  ["Text Secondary", "var(--mk-ui-text-secondary)"],
  ["Text Tertiary", "var(--mk-ui-text-tertiary)"],
];

// Color math utilities are owned by the canonical, characterization-tested
// module src/shared/utils/color.ts (pinned by color.test.ts; D1-D4 fixed in
// Notidian-cgo). Re-export them here for the historical "core/utils/colorPalette"
// import path so consumers keep working while there is a single source of truth
// and a single test surface (Notidian-qxt). The private hslToHex stays inside
// color.ts (only shiftColor needs it); no import cycle — color.ts imports nothing.
export { hexToRgb, hexToHsl, shiftColor } from "shared/utils/color";

export const getGradientPalettes = (superstate: Superstate): ColorPaletteAsset[] => {
  const assetManager = (superstate as any).assetManager || (superstate as any).assets;
  
  if (!assetManager) {
    console.warn('[ColorPalette] AssetManager not available in superstate');
    return [];
  }
  
  return assetManager.getColorPalettes().filter((palette: ColorPaletteAsset) => 
    palette.gradients && palette.gradients.length > 0
  ) || [];
};

export const getGradientPaletteById = (superstate: Superstate, paletteId: string): ColorPaletteAsset | undefined => {
  const palettes = getGradientPalettes(superstate);
  return palettes.find(p => p.id === paletteId);
};

export const getDefaultGradientPalette = (superstate: Superstate): ColorPaletteAsset | undefined => {
  return getGradientPaletteById(superstate, 'default-gradient-palette');
};

export const getAllGradients = (superstate: Superstate): ColorPaletteColor[] => {
  const palettes = getGradientPalettes(superstate);
  
  // Get gradients from the gradients property
  const gradientsFromGradientsProp = palettes.flatMap(p => p.gradients?.map(g => ({
    name: g.name,
    value: createGradientCssValue(g),
    category: 'gradient'
  })) || []);
  
  // Get gradients from the colors array (for palettes that store gradients as colors)
  const gradientsFromColors = palettes.flatMap(p => 
    p.colors?.filter(c => c.value && (
      c.value.includes('linear-gradient') || 
      c.value.includes('radial-gradient') || 
      c.value.includes('conic-gradient')
    )).map(c => ({
      name: c.name,
      value: c.value,
      category: c.category || 'gradient'
    })) || []
  );
  
  // Combine both sources
  const allGradients = [...gradientsFromGradientsProp, ...gradientsFromColors];
  
  // If no gradients found from palettes, return defaults
  if (allGradients.length === 0) {
    return getDefaultGradients();
  }
  
  return allGradients;
};

export const getGradientByName = (superstate: Superstate, name: string): string | undefined => {
  const gradients = getAllGradients(superstate);
  const gradient = gradients.find(g => g.name.toLowerCase() === name.toLowerCase());
  return gradient?.value;
};

export const createGradientCssValue = (gradient: { type: 'linear' | 'radial', stops: Array<{color: string, position: number}>, direction?: number, center?: {x: number, y: number}, radius?: number }): string => {
  const stops = gradient.stops
    .sort((a, b) => a.position - b.position)
    .map(stop => `${stop.color} ${Math.round(stop.position * 100)}%`)
    .join(', ');

  if (gradient.type === 'linear') {
    const direction = gradient.direction || 0;
    return `linear-gradient(${direction}deg, ${stops})`;
  } else {
    const center = gradient.center || { x: 0.5, y: 0.5 };
    const radius = gradient.radius || 0.5;
    return `radial-gradient(circle ${Math.round(radius * 100)}% at ${Math.round(center.x * 100)}% ${Math.round(center.y * 100)}%, ${stops})`;
  }
};

export const getDefaultGradients = (): ColorPaletteColor[] => [
  {
    name: "Warm Sunset",
    value: "linear-gradient(135deg, rgba(255, 255, 196, 1.000) 0.000%, rgba(255, 97, 100, 1.000) 50.000%, rgba(176, 0, 18, 1.000) 100.000%)",
    category: "gradient"
  },
  {
    name: "Earth Tones",
    value: "linear-gradient(90deg, rgba(164, 116, 81, 1.000) 0.000%, rgba(156, 152, 129, 1.000) 16.667%, rgba(115, 160, 157, 1.000) 33.333%, rgba(59, 137, 154, 1.000) 50.000%, rgba(9, 91, 121, 1.000) 66.667%, rgba(0, 40, 71, 1.000) 83.333%, rgba(0, 1, 22, 1.000) 100.000%)",
    category: "gradient"
  },
  {
    name: "Golden Pink",
    value: "linear-gradient(45deg, rgba(250, 218, 97, 1.000) 0.000%, rgba(255, 145, 136, 1.000) 50.000%, rgba(255, 90, 205, 1.000) 100.000%)",
    category: "gradient"
  },
  {
    name: "Soft Pink",
    value: "linear-gradient(45deg, rgba(252, 142, 197, 1.000) 0.000%, rgba(255, 141, 211, 1.000) 25.000%, rgba(255, 161, 216, 1.000) 50.000%, rgba(255, 193, 210, 1.000) 75.000%, rgba(255, 224, 195, 1.000) 100.000%)",
    category: "gradient"
  },
  {
    name: "Purple Gold",
    value: "linear-gradient(45deg, rgba(65, 89, 208, 1.000) 0.000%, rgba(200, 79, 192, 1.000) 50.000%, rgba(255, 205, 112, 1.000) 100.000%)",
    category: "gradient"
  },
  {
    name: "Cyan Purple",
    value: "linear-gradient(45deg, rgba(35, 212, 253, 1.000) 0.000%, rgba(58, 152, 240, 1.000) 50.000%, rgba(183, 33, 255, 1.000) 100.000%)",
    category: "gradient"
  }
];