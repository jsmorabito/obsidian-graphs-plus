/**
 * Force simulation for the graph view, tuned to Obsidian's core
 * graph: a pull toward the center, many-body repulsion (Barnes-Hut), and
 * degree-weighted springs, cooled by a decaying alpha. Pure and
 * deterministic for a given `random`, so it can be unit-tested.
 */

export type SimNode = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned position while dragging. */
  fx: number | null;
  fy: number | null;
};

export type SimForces = {
  /** Pull toward the origin, 0-1. */
  centerStrength: number;
  /** Core's slider value; the charge is `-repelStrength^3`. */
  repelStrength: number;
  /** Spring stiffness, 0-1. */
  linkStrength: number;
  linkDistance: number;
};

/** Core's defaults for the same four sliders. */
export const DEFAULT_FORCES: SimForces = {
  centerStrength: 0.1,
  repelStrength: 10,
  linkStrength: 1,
  linkDistance: 250,
};

const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);
const VELOCITY_DECAY = 0.4;
const THETA_SQUARED = 0.81;
const MIN_DISTANCE_SQUARED = 1;

type Cell = {
  /** Sum of charge, weighted center of charge. */
  mass: number;
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  size: number;
  node: SimNode | null;
  children: (Cell | null)[] | null;
};

const newCell = (x0: number, y0: number, size: number): Cell => ({
  mass: 0,
  cx: 0,
  cy: 0,
  x0,
  y0,
  size,
  node: null,
  children: null,
});

const MAX_DEPTH = 40;

const insert = (cell: Cell, node: SimNode, depth = 0): void => {
  // Mass is only filled in after the tree is built, so test for an empty leaf.
  if (cell.node === null && cell.children === null) {
    cell.node = node;
    return;
  }
  if (cell.children === null && depth < MAX_DEPTH) {
    const existing = cell.node;
    cell.node = null;
    cell.children = [null, null, null, null];
    if (existing) insertChild(cell, existing, depth);
  }
  if (cell.children === null) return;
  insertChild(cell, node, depth);
};

const insertChild = (cell: Cell, node: SimNode, depth: number): void => {
  const half = cell.size / 2;
  const right = node.x >= cell.x0 + half ? 1 : 0;
  const bottom = node.y >= cell.y0 + half ? 1 : 0;
  const index = bottom * 2 + right;
  const children = cell.children!;
  children[index] ??= newCell(
    cell.x0 + right * half,
    cell.y0 + bottom * half,
    half,
  );
  insert(children[index], node, depth + 1);
};

/** Fills mass and center of charge bottom-up. */
const accumulate = (cell: Cell): void => {
  if (cell.children === null) {
    if (cell.node) {
      cell.mass = 1;
      cell.cx = cell.node.x;
      cell.cy = cell.node.y;
    }
    return;
  }
  let mass = 0;
  let cx = 0;
  let cy = 0;
  for (const child of cell.children) {
    if (!child) continue;
    accumulate(child);
    mass += child.mass;
    cx += child.cx * child.mass;
    cy += child.cy * child.mass;
  }
  cell.mass = mass;
  cell.cx = mass ? cx / mass : 0;
  cell.cy = mass ? cy / mass : 0;
};

const buildTree = (nodes: SimNode[]): Cell | null => {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  const size = Math.max(maxX - minX, maxY - minY, 1) + 1;
  const root = newCell(minX, minY, size);
  for (const n of nodes) insert(root, n);
  accumulate(root);
  return root;
};

export class ForceSimulation {
  nodes: SimNode[] = [];
  forces: SimForces = { ...DEFAULT_FORCES };
  alpha = 1;
  alphaTarget = 0;
  private links: [number, number][] = [];
  private degree: number[] = [];
  private byId = new Map<string, SimNode>();

  constructor(private random: () => number = Math.random) {}

  /** True while the layout is still moving. */
  get running(): boolean {
    return this.alpha > ALPHA_MIN || this.alphaTarget > ALPHA_MIN;
  }

  /** Warms the simulation back up, as core does when data or forces change. */
  reheat(alpha = 0.3): void {
    this.alpha = Math.max(this.alpha, alpha);
  }

  setForces(forces: Partial<SimForces>): void {
    this.forces = { ...this.forces, ...forces };
    this.reheat();
  }

  node(id: string): SimNode | undefined {
    return this.byId.get(id);
  }

  /** Puts nodes at saved positions; call before `setData` so they count as placed. */
  seed(positions: ReadonlyMap<string, { x: number; y: number }>): void {
    for (const [id, p] of positions) {
      const kept = this.byId.get(id);
      if (kept) {
        kept.x = p.x;
        kept.y = p.y;
        continue;
      }
      const node: SimNode = { id, x: p.x, y: p.y, vx: 0, vy: 0, fx: null, fy: null };
      this.byId.set(id, node);
    }
  }

  /**
   * Replaces the data, keeping the position of nodes already present. A new
   * node starts near the average of its already-placed neighbors, else on a
   * ring just outside the current layout, like core.
   */
  setData(ids: string[], links: [string, string][]): void {
    const wanted = new Set(ids);
    const next: SimNode[] = [];
    const added: SimNode[] = [];
    for (const id of ids) {
      const kept = this.byId.get(id);
      if (kept) next.push(kept);
      else {
        const fresh: SimNode = {
          id,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          fx: null,
          fy: null,
        };
        next.push(fresh);
        added.push(fresh);
      }
    }
    for (const id of [...this.byId.keys()]) {
      if (!wanted.has(id)) this.byId.delete(id);
    }
    for (const n of next) this.byId.set(n.id, n);
    this.nodes = next;

    // Core's placement: a new node starts near its already-placed neighbors,
    // else in a ring just outside the current layout sized to fit the newcomers.
    const placed = new Set(next.filter((n) => !added.includes(n)));
    let radius2 = 0;
    for (const n of placed) radius2 = Math.max(radius2, n.x * n.x + n.y * n.y);
    const radius = Math.sqrt(radius2);
    const neighbors = new Map<string, string[]>();
    for (const [a, b] of links) {
      neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
      neighbors.set(b, [...(neighbors.get(b) ?? []), a]);
    }
    const area = added.length * 60 * 60;
    const ring = Math.sqrt(area / Math.PI + radius * radius) - radius;
    const spread = Math.sqrt(area);
    for (const n of added) {
      const near = (neighbors.get(n.id) ?? [])
        .map((id) => this.byId.get(id))
        .filter((m): m is SimNode => !!m && placed.has(m));
      if (near.length > 0) {
        n.x =
          near.reduce((sum, m) => sum + m.x, 0) / near.length +
          (this.random() - 0.5) * spread;
        n.y =
          near.reduce((sum, m) => sum + m.y, 0) / near.length +
          (this.random() - 0.5) * spread;
      } else {
        const angle = this.random() * 2 * Math.PI;
        const r = radius + Math.sqrt(this.random()) * ring;
        n.x = r * Math.cos(angle);
        n.y = r * Math.sin(angle);
      }
    }

    const index = new Map(next.map((n, i) => [n.id, i]));
    this.links = [];
    this.degree = next.map(() => 0);
    for (const [a, b] of links) {
      const i = index.get(a);
      const j = index.get(b);
      if (i === undefined || j === undefined || i === j) continue;
      this.links.push([i, j]);
      this.degree[i] = (this.degree[i] ?? 0) + 1;
      this.degree[j] = (this.degree[j] ?? 0) + 1;
    }
    this.reheat(added.length > 0 ? 0.3 : 0.1);
  }

  /** Advances one step; returns false once the layout has settled. */
  tick(): boolean {
    if (!this.running) return false;
    this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY;
    const { alpha, nodes, forces } = this;

    for (const [i, j] of this.links) {
      const s = nodes[i]!;
      const t = nodes[j]!;
      let dx = t.x + t.vx - s.x - s.vx || this.jiggle();
      let dy = t.y + t.vy - s.y - s.vy || this.jiggle();
      const length = Math.sqrt(dx * dx + dy * dy);
      const strength =
        forces.linkStrength /
        Math.max(1, Math.min(this.degree[i] ?? 1, this.degree[j] ?? 1));
      const k = ((length - forces.linkDistance) / length) * alpha * strength;
      dx *= k;
      dy *= k;
      const bias =
        (this.degree[i] ?? 1) / ((this.degree[i] ?? 1) + (this.degree[j] ?? 1));
      t.vx -= dx * bias;
      t.vy -= dy * bias;
      s.vx += dx * (1 - bias);
      s.vy += dy * (1 - bias);
    }

    const charge = -(forces.repelStrength ** 3);
    const root = buildTree(nodes);
    if (root) {
      for (const n of nodes) this.repel(root, n, charge * alpha);
    }

    for (const n of nodes) {
      n.vx -= n.x * forces.centerStrength * alpha;
      n.vy -= n.y * forces.centerStrength * alpha;
    }

    for (const n of nodes) {
      if (n.fx !== null) {
        n.x = n.fx;
        n.vx = 0;
      } else {
        n.vx *= 1 - VELOCITY_DECAY;
        n.x += n.vx;
      }
      if (n.fy !== null) {
        n.y = n.fy;
        n.vy = 0;
      } else {
        n.vy *= 1 - VELOCITY_DECAY;
        n.y += n.vy;
      }
    }
    return this.running;
  }

  /** A tiny non-zero nudge, so coincident nodes never divide by zero. */
  private jiggle(): number {
    return (this.random() - 0.5) * 1e-6 || 1e-6;
  }

  private repel(cell: Cell, node: SimNode, strength: number): void {
    if (cell.mass === 0) return;
    const dx = cell.cx - node.x;
    const dy = cell.cy - node.y;
    let d2 = dx * dx + dy * dy;
    if (cell.children === null) {
      if (cell.node === node) return;
      if (d2 < MIN_DISTANCE_SQUARED) d2 = Math.sqrt(MIN_DISTANCE_SQUARED * d2);
      const k = (strength * cell.mass) / (d2 || 1);
      node.vx += (dx || this.jiggle()) * k;
      node.vy += (dy || this.jiggle()) * k;
      return;
    }
    if ((cell.size * cell.size) / THETA_SQUARED < d2) {
      if (d2 < MIN_DISTANCE_SQUARED) d2 = Math.sqrt(MIN_DISTANCE_SQUARED * d2);
      const k = (strength * cell.mass) / d2;
      node.vx += dx * k;
      node.vy += dy * k;
      return;
    }
    for (const child of cell.children) {
      if (child) this.repel(child, node, strength);
    }
  }
}
