import type { GraphData } from "./graphData";

/**
 * Turns the graph on screen into a JSON Canvas (Obsidian's `.canvas`
 * format): files become file cards, unresolved links and tags become text
 * cards, links become edges, laid out where the graph has them. Pure.
 */

type CanvasNode =
  | {
      id: string;
      type: "file";
      file: string;
      x: number;
      y: number;
      width: number;
      height: number;
      color?: string;
    }
  | {
      id: string;
      type: "text";
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      color?: string;
    };

type CanvasEdge = {
  id: string;
  fromNode: string;
  toNode: string;
  toEnd?: "arrow" | "none";
};

export type JsonCanvas = { nodes: CanvasNode[]; edges: CanvasEdge[] };

const CARD_WIDTH = 400;
const CARD_HEIGHT = 240;
/** Graph units are small next to cards; spread the layout so cards don't overlap. */
const SPREAD = 4;

const hex = (rgb: number): string => `#${rgb.toString(16).padStart(6, "0")}`;

export const toJsonCanvas = (
  data: GraphData,
  positions: ReadonlyMap<string, { x: number; y: number }>,
  label: (id: string, type: string) => string,
): JsonCanvas => {
  const ids = new Map<string, string>();
  const nodes: CanvasNode[] = [];
  let n = 0;
  for (const [id, node] of data.nodes) {
    const p = positions.get(id) ?? { x: 0, y: 0 };
    const canvasId = `n${(n++).toString(36)}`;
    ids.set(id, canvasId);
    const box = {
      id: canvasId,
      x: Math.round(p.x * SPREAD - CARD_WIDTH / 2),
      y: Math.round(p.y * SPREAD - CARD_HEIGHT / 2),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      ...(node.color !== null ? { color: hex(node.color) } : {}),
    };
    if (node.type === "unresolved" || node.type === "tag") {
      nodes.push({ ...box, type: "text", text: label(id, node.type), height: 60 });
    } else {
      nodes.push({ ...box, type: "file", file: id });
    }
  }
  const edges: CanvasEdge[] = [];
  const seen = new Set<string>();
  data.links.forEach(([from, to], i) => {
    const a = ids.get(from);
    const b = ids.get(to);
    if (!a || !b || seen.has(`${a}>${b}`)) return;
    seen.add(`${a}>${b}`);
    edges.push({ id: `e${i.toString(36)}`, fromNode: a, toNode: b });
  });
  return { nodes, edges };
};
