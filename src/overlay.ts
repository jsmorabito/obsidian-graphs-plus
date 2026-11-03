/**
 * Overlays let other features paint on a graph without touching the
 * renderer: per-node color, opacity and size boost, and per-link style,
 * keyed by node id (the vault path) and by `edgeKey`. Pure.
 */
export type NodeStyle = {
  /** Keep the node's own color when undefined. */
  rgb?: number;
  alpha: number;
  /** Added to the node's drawn size. */
  sizeBoost: number;
};

export type EdgeStyle = { rgb?: number; alpha: number; widthScale: number };

export type GraphOverlay = {
  nodes: Map<string, NodeStyle>;
  edges: Map<string, EdgeStyle>;
  /** Opacity for everything the overlay does not mention; 1 leaves it alone. */
  dimAlpha: number;
};

/** Order-independent key for a link. */
export const edgeKey = (a: string, b: string): string =>
  a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;

/**
 * Combines named overlay layers in order: a later layer's style for a node or
 * link wins, and the dimming of unmentioned items is the strongest any layer
 * asks for. Null when there are no layers.
 */
export const mergeOverlays = (
  layers: Iterable<GraphOverlay>,
): GraphOverlay | null => {
  let merged: GraphOverlay | null = null;
  for (const layer of layers) {
    if (!merged) {
      merged = {
        nodes: new Map(layer.nodes),
        edges: new Map(layer.edges),
        dimAlpha: layer.dimAlpha,
      };
      continue;
    }
    for (const [id, style] of layer.nodes) merged.nodes.set(id, style);
    for (const [key, style] of layer.edges) merged.edges.set(key, style);
    merged.dimAlpha = Math.min(merged.dimAlpha, layer.dimAlpha);
  }
  return merged;
};
