/** An RGB color as Pixi-style 0xRRGGBB plus an alpha, like core's graph colors. */
export type GraphColor = { rgb: number; a: number };

/** Parses the `rgb()`/`rgba()` strings `getComputedStyle` returns. */
export const parseCssColor = (value: string): GraphColor | null => {
  const match =
    /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)/i.exec(
      value,
    );
  if (!match) return null;
  const [, r, g, b, alpha] = match;
  const a =
    alpha === undefined
      ? 1
      : alpha.endsWith("%")
        ? parseFloat(alpha) / 100
        : parseFloat(alpha);
  return { rgb: (Number(r) << 16) | (Number(g) << 8) | Number(b), a };
};

export const cssRgb = (rgb: number): string =>
  `rgb(${(rgb >> 16) & 255}, ${(rgb >> 8) & 255}, ${rgb & 255})`;

/** Core styles its graph through these class names (see `.graph-view.color-*`). */
export const THEME_CLASSES = {
  fill: "color-fill",
  fillFocused: "color-fill-focused",
  fillTag: "color-fill-tag",
  fillUnresolved: "color-fill-unresolved",
  fillAttachment: "color-fill-attachment",
  arrow: "color-arrow",
  circle: "color-circle",
  line: "color-line",
  text: "color-text",
  fillHighlight: "color-fill-highlight",
  lineHighlight: "color-line-highlight",
} as const;

export type ThemeColors = Record<keyof typeof THEME_CLASSES, GraphColor>;

const FALLBACK: GraphColor = { rgb: 0x888888, a: 1 };

/**
 * Reads the active theme's graph colors by letting the browser resolve core's
 * own CSS classes on the body, exactly as core does, so the graph matches any
 * theme.
 */
export const readThemeColors = (body: HTMLElement): ThemeColors => {
  const result = {} as ThemeColors;
  for (const [key, cls] of Object.entries(THEME_CLASSES)) {
    const probe = body.createDiv({ cls: `graph-view ${cls}` });
    const style = getComputedStyle(probe);
    const color = parseCssColor(style.color) ?? FALLBACK;
    const opacity = parseFloat(style.opacity);
    result[key as keyof ThemeColors] = {
      rgb: color.rgb,
      a: color.a * (Number.isNaN(opacity) ? 1 : opacity),
    };
    probe.remove();
  }
  return result;
};

/**
 * Moves `from` toward `to` channel by channel, keeping `keep` of the old color
 * each call (core's tint easing). A channel the rounding would leave stalled
 * still moves one step, so repeated calls always land exactly on `to`.
 */
export const mixRgb = (from: number, to: number, keep: number): number => {
  let result = 0;
  for (const shift of [16, 8, 0]) {
    const a = (from >> shift) & 255;
    const b = (to >> shift) & 255;
    let mixed = Math.round(a * keep + b * (1 - keep));
    // Rounding can stall a few steps short; always make progress.
    if (mixed === a && a !== b) mixed = a + Math.sign(b - a);
    result |= mixed << shift;
  }
  return result;
};
