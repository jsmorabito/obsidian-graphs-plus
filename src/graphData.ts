/**
 * Builds the graph the way Obsidian's core graph view does: every file the
 * filter lets through, its resolved and unresolved links, optional tag and
 * attachment nodes, the local-graph neighborhood, the orphan filter and the
 * timelapse cut-off. Pure, so it can be unit-tested against plain objects.
 */

/** Core's node types; "" is an ordinary note. */
export type NodeType = "" | "focused" | "attachment" | "unresolved" | "tag";

/** The types a filter is asked about (core never filters "focused"). */
export type FilterType = "" | "attachment" | "unresolved" | "tag";

export type RawNode = {
  type: NodeType;
  /** Outgoing links by target id. */
  links: Set<string>;
  /** A color group's color, 0xRRGGBB. */
  color?: number;
};

export type RawGraph = {
  nodes: Map<string, RawNode>;
  /** Set by the local graph, which sizes nodes by distance, not links. */
  weights?: Map<string, number>;
};

/**
 * Decides whether a node is shown: false hides it, true shows it, a number
 * shows it in that color (a color group match).
 */
export type NodeFilter = (id: string, type: FilterType) => boolean | number;

/** Core's filter toggles. */
export type FilterOptions = {
  search: string;
  showTags: boolean;
  showAttachments: boolean;
  hideUnresolved: boolean;
  showOrphans: boolean;
};

export const DEFAULT_FILTERS: FilterOptions = {
  search: "",
  showTags: false,
  showAttachments: false,
  hideUnresolved: false,
  showOrphans: true,
};

/** Core's local-graph options. */
export type LocalOptions = {
  localJumps: number;
  localBacklinks: boolean;
  localForelinks: boolean;
  localInterlinks: boolean;
};

export const DEFAULT_LOCAL: LocalOptions = {
  localJumps: 1,
  localBacklinks: true,
  localForelinks: true,
  localInterlinks: false,
};

/** What the graph needs from the vault; lets tests supply plain objects. */
export type GraphSource = {
  resolvedLinks: Record<string, Record<string, number>>;
  unresolvedLinks: Record<string, Record<string, number>>;
  /** Every file in the vault, in the metadata cache's order. */
  files: string[];
  /** A file's tags, with their `#`, as written. */
  tagsOf: (path: string) => string[];
  /** Every tag in the vault as first written, to merge case variants. */
  allTags: () => string[];
  isAttachment: (path: string) => boolean;
  /** Paths excluded in Obsidian's "Excluded files" setting. */
  isIgnored: (path: string) => boolean;
  /** min(ctime, mtime), the order the timelapse adds files in. */
  fileTime: (path: string) => number;
};

const blank = (type: NodeType = ""): RawNode => ({ type, links: new Set() });

/**
 * Core's graph builder. `progression` > 0 runs the timelapse: only the first
 * `progression` links (counting files as one each when orphans are shown),
 * in file-creation order, are included. Returns the graph and the total link
 * count, which sets the timelapse speed.
 */
export const buildGraph = (
  source: GraphSource,
  options: Omit<FilterOptions, "search">,
  filter: NodeFilter,
  progression = 0,
): { graph: RawGraph; numLinks: number } => {
  const { showAttachments, hideUnresolved, showTags, showOrphans } = options;
  const tagCase = new Map<string, string>();
  if (showTags) {
    for (const tag of source.allTags()) {
      const key = tag.toLowerCase();
      if (!tagCase.has(key)) tagCase.set(key, tag);
    }
  }
  const nodes = new Map<string, RawNode>();
  let count = 0;
  let cutoff = "";
  const files = source.files.slice();
  if (progression) {
    const time = new Map(files.map((f) => [f, source.fileTime(f)]));
    files.sort((a, b) => time.get(a)! - time.get(b)!);
  }
  // Counts one more link; past the cut-off it remembers which file hit it.
  const step = (from: string): boolean => {
    const within = !progression || count < progression;
    if (!within && count === progression) cutoff = from;
    count++;
    return within;
  };

  for (const path of files) {
    const attachment = source.isAttachment(path);
    if (!showAttachments && attachment) continue;
    const type: FilterType = attachment ? "attachment" : "";
    const shown = filter(path, type);
    if (shown === false || source.isIgnored(path)) continue;
    const node = blank(type);
    nodes.set(path, node);
    if (showOrphans) {
      if (count === progression) cutoff = path;
      count++;
    }
    if (typeof shown === "number") node.color = shown;

    for (const to of Object.keys(source.resolvedLinks[path] ?? {})) {
      const toAttachment = source.isAttachment(to);
      if (!showAttachments && toAttachment) continue;
      if (filter(to, toAttachment ? "attachment" : "") === false) continue;
      if (step(path)) node.links.add(to);
    }
    if (!hideUnresolved) {
      for (const to of Object.keys(source.unresolvedLinks[path] ?? {})) {
        if (filter(to, "unresolved") === false) continue;
        if (step(path)) {
          node.links.add(to);
          if (!nodes.has(to)) nodes.set(to, blank("unresolved"));
        }
      }
    }
    if (showTags) {
      for (const tag of source.tagsOf(path)) {
        if (filter(tag, "tag") === false) continue;
        const id = tagCase.get(tag.toLowerCase()) ?? tag;
        if (step(path)) {
          node.links.add(id);
          if (!nodes.has(id)) nodes.set(id, blank("tag"));
        }
      }
    }
  }

  if (progression && cutoff) {
    const index = files.indexOf(cutoff);
    if (index !== -1) {
      for (const later of files.slice(index + 1)) nodes.delete(later);
    }
  }
  return { graph: { nodes }, numLinks: count };
};

const copyNode = (node: RawNode | undefined): RawNode => {
  const copy = blank(node?.type ?? "");
  if (node?.color !== undefined) copy.color = node.color;
  return copy;
};

/**
 * Core's local graph: the file plus everything within `localJumps` links, in
 * the directions enabled. Weights shrink with distance (30 at the center),
 * which is what sizes the nodes. Tags are reached but never walked through.
 */
export const localGraph = (
  graph: RawGraph,
  file: string,
  options: LocalOptions,
): RawGraph => {
  const all = graph.nodes;
  const nodes = new Map<string, RawNode>();
  const weights = new Map<string, number>([[file, 30]]);
  const center = all.get(file);
  if (!center) {
    nodes.set(file, blank());
    return { nodes, weights };
  }
  nodes.set(file, copyNode(center));
  const expand = (weight: number): void => {
    const found = new Map<string, RawNode>();
    for (const [from, node] of all) {
      if (node.type === "tag") continue;
      for (const to of node.links) {
        const source = nodes.get(from);
        if (
          options.localForelinks &&
          source &&
          !nodes.has(to) &&
          source.type !== "tag"
        ) {
          if (!found.has(to)) found.set(to, copyNode(all.get(to)));
          source.links.add(to);
        } else if (
          options.localBacklinks &&
          nodes.has(to) &&
          !nodes.has(from) &&
          nodes.get(to)!.type !== "tag"
        ) {
          if (!found.has(from)) found.set(from, copyNode(all.get(from)));
          found.get(from)!.links.add(to);
        }
      }
    }
    for (const [id, node] of found) {
      nodes.set(id, node);
      weights.set(id, weight);
    }
  };
  const jumps = Math.max(1, Math.round(options.localJumps));
  const stepSize = 30 / jumps;
  for (let i = 0; i < jumps; i++) expand(30 - stepSize * (i + 1));
  if (options.localInterlinks) {
    for (const id of [...nodes.keys()]) {
      const original = all.get(id);
      if (original) nodes.set(id, original);
    }
  }
  return { nodes, weights };
};

/** Core's orphan filter: drops nodes with no link to or from another node. */
export const removeOrphans = (graph: RawGraph): void => {
  const linkedTo = new Set<string>();
  for (const [id, node] of graph.nodes) {
    for (const to of node.links) if (to !== id) linkedTo.add(to);
  }
  for (const [id, node] of [...graph.nodes]) {
    if (linkedTo.has(id)) continue;
    let linked = false;
    for (const to of node.links) {
      if (to !== id && graph.nodes.has(to)) {
        linked = true;
        break;
      }
    }
    if (!linked) graph.nodes.delete(id);
  }
};

/** What the renderer draws. */
export type GraphData = {
  nodes: Map<string, { id: string; type: NodeType; color: number | null }>;
  /** Directed pairs, from the linking note to what it links to. */
  links: [string, string][];
  /**
   * Core's node weight: links out plus links in, each direction counted once
   * per pair (so a two-way link counts twice and a self-link counts too), or
   * the local graph's distance weight.
   */
  weights: Map<string, number>;
};

/** Flattens a raw graph into renderer data, dropping links to missing nodes. */
export const toGraphData = (graph: RawGraph): GraphData => {
  const nodes: GraphData["nodes"] = new Map();
  for (const [id, node] of graph.nodes) {
    nodes.set(id, { id, type: node.type, color: node.color ?? null });
  }
  const links: [string, string][] = [];
  const degree = new Map<string, number>();
  const bump = (id: string): void => {
    degree.set(id, (degree.get(id) ?? 0) + 1);
  };
  for (const [from, node] of graph.nodes) {
    for (const to of node.links) {
      if (!graph.nodes.has(to)) continue;
      bump(from);
      bump(to);
      // A self-link adds to the weight but isn't drawn or simulated.
      if (to !== from) links.push([from, to]);
    }
  }
  const weights = new Map<string, number>();
  for (const id of nodes.keys()) {
    weights.set(
      id,
      graph.weights
        ? (graph.weights.get(id) ?? 0)
        : (degree.get(id) ?? 0),
    );
  }
  return { nodes, links, weights };
};

/** Core's timelapse speed: links added per second. */
export const progressionSpeed = (numLinks: number): number =>
  Math.min(100, Math.max(5, 0.5 * Math.sqrt(numLinks)));

/** Notes linked to or from `id`, in path order: what "add linked notes" adds. */
export const linkedNotes = (
  source: Pick<GraphSource, "resolvedLinks" | "files" | "isAttachment">,
  id: string,
): string[] => {
  const notes = new Set(source.files.filter((f) => !source.isAttachment(f)));
  const linked = new Set<string>();
  for (const to of Object.keys(source.resolvedLinks[id] ?? {})) {
    if (notes.has(to)) linked.add(to);
  }
  for (const [from, targets] of Object.entries(source.resolvedLinks)) {
    if (notes.has(from) && id in targets) linked.add(from);
  }
  linked.delete(id);
  return [...linked].sort();
};
