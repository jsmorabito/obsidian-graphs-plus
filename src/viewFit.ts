export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export type ViewTransform = { scale: number; panX: number; panY: number };

/** The bounding box of some points, or null when there are none. */
export const boundsOf = (
  points: Iterable<{ x: number; y: number }>,
): Bounds | null => {
  let result: Bounds | null = null;
  for (const { x, y } of points) {
    result = result
      ? {
          minX: Math.min(result.minX, x),
          minY: Math.min(result.minY, y),
          maxX: Math.max(result.maxX, x),
          maxY: Math.max(result.maxY, y),
        }
      : { minX: x, minY: y, maxX: x, maxY: y };
  }
  return result;
};

/**
 * Scale and pan that center `bounds` in a `width` x `height` view with
 * `padding` to spare. Never zooms in past `maxScale`, so a small graph is not
 * blown up and a big one is shrunk to fit.
 */
export const fitTransform = (
  bounds: Bounds,
  size: { width: number; height: number },
  padding: number,
  maxScale: number,
  minScale: number,
): ViewTransform => {
  const w = Math.max(bounds.maxX - bounds.minX, 1);
  const h = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(
    maxScale,
    Math.max(
      minScale,
      Math.min((size.width - 2 * padding) / w, (size.height - 2 * padding) / h),
    ),
  );
  return {
    scale,
    panX: size.width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    panY: size.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  };
};
