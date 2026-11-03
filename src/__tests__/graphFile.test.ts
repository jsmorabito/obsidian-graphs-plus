import { describe, expect, it } from "vitest";
import {
  GraphFileError,
  parseGraphFile,
  positionsChanged,
  serializeGraphFile,
} from "../graphFile";
import { defaultGraphState } from "../graphState";

describe(".graph files", () => {
  it("treats an empty file as a new default graph", () => {
    const f = parseGraphFile("");
    expect(f.state).toEqual(defaultGraphState());
    expect(f.camera).toBeNull();
    expect(f.positions.size).toBe(0);
  });

  it("round-trips a sandbox with camera and positions", () => {
    const state = { ...defaultGraphState("sandbox"), members: ["a.md", "b.md"] };
    state.filters.search = "tag:#x";
    const text = serializeGraphFile({
      state,
      camera: { scale: 1.5, x: 12.345, y: -3 },
      positions: new Map([
        ["b.md", { x: 1.26, y: 2 }],
        ["a.md", { x: -5, y: 0 }],
      ]),
    });
    const json = JSON.parse(text) as { format: string; version: number; positions: object };
    expect(json.format).toBe("graphs-plus");
    expect(json.version).toBe(1);
    expect(Object.keys(json.positions)).toEqual(["a.md", "b.md"]);
    const back = parseGraphFile(text);
    expect(back.state.mode).toBe("sandbox");
    expect(back.state.members).toEqual(["a.md", "b.md"]);
    expect(back.state.filters.search).toBe("tag:#x");
    expect(back.camera).toEqual({ scale: 1.5, x: 12.3, y: -3 });
    expect(back.positions.get("b.md")).toEqual({ x: 1.3, y: 2 });
  });

  it("keeps the local file of a local graph", () => {
    const state = { ...defaultGraphState("local"), localFile: "x.md" };
    const back = parseGraphFile(
      serializeGraphFile({ state, camera: null, positions: new Map() }),
    );
    expect(back.state.localFile).toBe("x.md");
  });

  it("refuses files that are not ours or are newer", () => {
    expect(() => parseGraphFile("p 4 3\n1 2\n")).toThrow(GraphFileError);
    expect(() => parseGraphFile('{"nodes": []}')).toThrow(GraphFileError);
    expect(() =>
      parseGraphFile('{"format": "graphs-plus", "version": 99, "options": {}}'),
    ).toThrow(/newer version/);
  });

  it("still opens files saved before the rename from Graph Plus", () => {
    const back = parseGraphFile(
      '{"format": "graph-plus", "version": 1, "mode": "sandbox", "members": ["a.md"], "options": {}}',
    );
    expect(back.state.mode).toBe("sandbox");
    expect(back.state.members).toEqual(["a.md"]);
  });

  it("only reports meaningful layout changes", () => {
    const a = new Map([["x", { x: 0, y: 0 }]]);
    expect(positionsChanged(a, new Map([["x", { x: 0.5, y: 0 }]]))).toBe(false);
    expect(positionsChanged(a, new Map([["x", { x: 5, y: 0 }]]))).toBe(true);
    expect(positionsChanged(a, new Map())).toBe(true);
  });
});
