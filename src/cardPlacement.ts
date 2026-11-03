export type CardAnchor = { x: number; y: number; r: number };
export type Size = { width: number; height: number };

/**
 * Where to put a card next to a node: to its right if it fits, else its left,
 * nudged vertically to stay inside the view. Pure so the clamping can be
 * tested without a DOM.
 */
export const cardPlacement = (
  anchor: CardAnchor,
  view: Size,
  card: Size,
  gap = 16,
  margin = 8,
): { x: number; y: number; side: "right" | "left" } => {
  let side: "right" | "left" = "right";
  let x = anchor.x + anchor.r + gap;
  if (x + card.width > view.width - margin) {
    side = "left";
    x = anchor.x - anchor.r - gap - card.width;
  }
  x = Math.max(margin, Math.min(x, view.width - card.width - margin));
  const maxY = view.height - card.height - margin;
  const y = Math.max(margin, Math.min(anchor.y - 24, Math.max(margin, maxY)));
  return { x, y, side };
};
