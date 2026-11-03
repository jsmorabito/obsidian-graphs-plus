import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  DEFAULT_LOCAL,
  buildGraph,
  linkedNotes,
  localGraph,
  progressionSpeed,
  removeOrphans,
  toGraphData,
  type GraphSource,
  type NodeFilter,
} from "../graphData";

const source = (over: Partial<GraphSource> = {}): GraphSource => ({
  resolvedLinks: {
    "a.md": { "b.md": 1, "img.png": 1 },
    "b.md": { "c.md": 1 },
    "c.md": {},
    "lonely.md": {},
  },
  unresolvedLinks: { "a.md": { Missing: 1 }, "b.md": {}, "c.md": {}, "lonely.md": {} },
  files: ["a.md", "b.md", "c.md", "lonely.md", "img.png"],
  tagsOf: (p) => (p === "a.md" ? ["#Topic"] : p === "c.md" ? ["#topic"] : []),
  allTags: () => ["#Topic", "#topic"],
  isAttachment: (p) => !p.endsWith(".md"),
  isIgnored: () => false,
  fileTime: (p) => ["a.md", "b.md", "c.md", "lonely.md", "img.png"].indexOf(p),
  ...over,
});

const all: NodeFilter = () => true;
const options = { ...DEFAULT_FILTERS };

describe("buildGraph", () => {
  it("includes notes and unresolved links, not attachments or tags, by default", () => {
    const { graph } = buildGraph(source(), options, all);
    const data = toGraphData(graph);
    expect([...data.nodes.keys()].sort()).toEqual(
      ["Missing", "a.md", "b.md", "c.md", "lonely.md"],
    );
    expect(data.nodes.get("Missing")!.type).toBe("unresolved");
    expect(data.links).toContainEqual(["a.md", "b.md"]);
    expect(data.links).toContainEqual(["a.md", "Missing"]);
  });

  it("adds attachments and merges tag case variants like core", () => {
    const { graph } = buildGraph(
      source(),
      { ...options, showAttachments: true, showTags: true },
      all,
    );
    const data = toGraphData(graph);
    expect(data.nodes.get("img.png")!.type).toBe("attachment");
    expect(data.nodes.get("#Topic")!.type).toBe("tag");
    expect(data.nodes.has("#topic")).toBe(false);
    expect(data.links).toContainEqual(["c.md", "#Topic"]);
  });

  it("hides unresolved links when asked", () => {
    const { graph } = buildGraph(source(), { ...options, hideUnresolved: true }, all);
    expect(graph.nodes.has("Missing")).toBe(false);
  });

  it("skips ignored files", () => {
    const { graph } = buildGraph(
      source({ isIgnored: (p) => p === "b.md" }),
      options,
      all,
    );
    expect(graph.nodes.has("b.md")).toBe(false);
  });

  it("applies the filter and color groups", () => {
    const filter: NodeFilter = (id) =>
      id === "c.md" ? false : id === "b.md" ? 0xff0000 : true;
    const data = toGraphData(buildGraph(source(), options, filter).graph);
    expect(data.nodes.has("c.md")).toBe(false);
    expect(data.nodes.get("b.md")!.color).toBe(0xff0000);
    // A link to a filtered-out note is dropped.
    expect(data.links).not.toContainEqual(["b.md", "c.md"]);
  });

  it("weights nodes by links out plus links in, like core", () => {
    const data = toGraphData(buildGraph(source(), options, all).graph);
    expect(data.weights.get("a.md")).toBe(2); // b, Missing
    expect(data.weights.get("b.md")).toBe(2); // a, c
    expect(data.weights.get("lonely.md")).toBe(0);
    // A two-way link counts once each way; a self-link counts both ways.
    const s = source();
    s.resolvedLinks["c.md"] = { "b.md": 1, "c.md": 1 };
    const both = toGraphData(buildGraph(s, options, all).graph);
    expect(both.weights.get("b.md")).toBe(3);
    expect(both.weights.get("c.md")).toBe(4); // b both ways, itself both ways
    expect(both.links).not.toContainEqual(["c.md", "c.md"]);
  });

  it("counts links for the timelapse and cuts off later files", () => {
    const full = buildGraph(source(), options, all);
    // 4 notes + a->b, a->Missing, b->c
    expect(full.numLinks).toBe(7);
    // Count 1 is a.md itself; 2 is its first link: later files are dropped.
    const early = buildGraph(source(), options, all, 2);
    expect([...early.graph.nodes.keys()].sort()).toEqual(["a.md"]);
    expect(early.graph.nodes.get("a.md")!.links.size).toBe(1);
  });

  it("orders the timelapse by file time", () => {
    const reversed = source({ fileTime: (p) => -["a.md", "b.md", "c.md", "lonely.md"].indexOf(p) });
    // The file that reaches the cut-off appears too, as in core.
    const early = buildGraph(reversed, options, all, 1);
    expect([...early.graph.nodes.keys()]).toEqual(["lonely.md", "c.md"]);
  });
});

describe("timelapse speed", () => {
  it("follows core's clamp(0.5 * sqrt(links), 5, 100)", () => {
    expect(progressionSpeed(4)).toBe(5);
    expect(progressionSpeed(10000)).toBe(50);
    expect(progressionSpeed(1e6)).toBe(100);
  });
});

describe("removeOrphans", () => {
  it("drops nodes with no links either way", () => {
    const { graph } = buildGraph(source(), options, all);
    removeOrphans(graph);
    expect(graph.nodes.has("lonely.md")).toBe(false);
    expect(graph.nodes.has("c.md")).toBe(true);
  });
});

describe("localGraph", () => {
  const graph = () => buildGraph(source(), { ...options, showTags: true }, all).graph;

  it("shows one jump both ways with distance weights", () => {
    const local = localGraph(graph(), "b.md", DEFAULT_LOCAL);
    expect([...local.nodes.keys()].sort()).toEqual(["a.md", "b.md", "c.md"]);
    expect(local.weights!.get("b.md")).toBe(30);
    expect(local.weights!.get("a.md")).toBe(0);
  });

  it("goes further with more jumps", () => {
    const local = localGraph(graph(), "b.md", { ...DEFAULT_LOCAL, localJumps: 2 });
    expect(local.nodes.has("Missing")).toBe(true);
    expect(local.nodes.has("#Topic")).toBe(true);
    expect(local.weights!.get("a.md")).toBe(15);
  });

  it("respects the direction toggles", () => {
    const out = localGraph(graph(), "b.md", { ...DEFAULT_LOCAL, localBacklinks: false });
    expect([...out.nodes.keys()].sort()).toEqual(["b.md", "c.md"]);
    const back = localGraph(graph(), "b.md", { ...DEFAULT_LOCAL, localForelinks: false });
    expect([...back.nodes.keys()].sort()).toEqual(["a.md", "b.md"]);
  });

  it("does not walk through tags", () => {
    const local = localGraph(graph(), "c.md", { ...DEFAULT_LOCAL, localJumps: 3 });
    // c -> #Topic, but #Topic must not lead on to a.md through a's tag link.
    expect(local.nodes.has("#Topic")).toBe(true);
    expect(local.nodes.has("a.md")).toBe(true); // via b.md backlinks, two jumps
    const one = localGraph(graph(), "c.md", DEFAULT_LOCAL);
    expect(one.nodes.has("a.md")).toBe(false);
  });

  it("adds links between neighbors only with neighbor links on", () => {
    const g = graph();
    g.nodes.get("a.md")!.links.add("c.md");
    const off = toGraphData(localGraph(g, "b.md", DEFAULT_LOCAL));
    expect(off.links).not.toContainEqual(["a.md", "c.md"]);
    const on = toGraphData(localGraph(g, "b.md", { ...DEFAULT_LOCAL, localInterlinks: true }));
    expect(on.links).toContainEqual(["a.md", "c.md"]);
  });

  it("shows a lone node for a file not in the graph", () => {
    const local = localGraph(graph(), "new.md", DEFAULT_LOCAL);
    expect([...local.nodes.keys()]).toEqual(["new.md"]);
  });
});

describe("linkedNotes", () => {
  it("lists notes linked either way, without attachments", () => {
    expect(linkedNotes(source(), "b.md")).toEqual(["a.md", "c.md"]);
  });
});
