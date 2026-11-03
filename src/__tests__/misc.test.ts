import { describe, expect, it } from "vitest";
import { cardPlacement } from "../cardPlacement";
import { toJsonCanvas } from "../canvasExport";
import { mixRgb, parseCssColor } from "../graphColors";
import { edgeKey, mergeOverlays } from "../overlay";
import { wrapText } from "../textWrap";
import { boundsOf, fitTransform } from "../viewFit";

describe("colors", () => {
  it("parses computed colors", () => {
    expect(parseCssColor("rgb(255, 0, 16)")).toEqual({ rgb: 0xff0010, a: 1 });
    expect(parseCssColor("rgba(1, 2, 3, 0.5)")).toEqual({ rgb: 0x010203, a: 0.5 });
    expect(parseCssColor("rgb(1 2 3 / 50%)")).toEqual({ rgb: 0x010203, a: 0.5 });
    expect(parseCssColor("red")).toBeNull();
  });

  it("eases toward a color and always arrives", () => {
    let c = 0x000000;
    for (let i = 0; i < 500 && c !== 0xffffff; i++) c = mixRgb(c, 0xffffff, 0.9);
    expect(c).toBe(0xffffff);
    expect(mixRgb(0x000000, 0xffffff, 0.9)).toBe(0x191919);
  });
});

describe("overlays", () => {
  it("keys links regardless of direction", () => {
    expect(edgeKey("a", "b")).toBe(edgeKey("b", "a"));
  });

  it("merges layers: later wins, strongest dimming", () => {
    const one = { nodes: new Map([["a", { alpha: 1, sizeBoost: 0, rgb: 1 }]]), edges: new Map(), dimAlpha: 0.5 };
    const two = { nodes: new Map([["a", { alpha: 1, sizeBoost: 4 }]]), edges: new Map(), dimAlpha: 0.2 };
    const merged = mergeOverlays([one, two])!;
    expect(merged.nodes.get("a")!.sizeBoost).toBe(4);
    expect(merged.dimAlpha).toBe(0.2);
    expect(one.nodes.get("a")!.sizeBoost).toBe(0);
    expect(mergeOverlays([])).toBeNull();
  });
});

describe("wrapText", () => {
  const measure = (s: string) => s.length * 10;
  it("wraps at spaces within the width", () => {
    expect(wrapText("aaa bbb ccc", 75, measure)).toEqual(["aaa bbb", "ccc"]);
  });
  it("never breaks inside a word, like Pixi without breakWords", () => {
    expect(wrapText("abcdefghij", 40, measure)).toEqual(["abcdefghij"]);
    expect(wrapText("ab abcdefghij c", 40, measure)).toEqual(["ab", "abcdefghij", "c"]);
  });
  it("keeps short text on one line", () => {
    expect(wrapText("hi", 300, measure)).toEqual(["hi"]);
    expect(wrapText("", 300, measure)).toEqual([""]);
  });
});

describe("view fit", () => {
  it("centers and never zooms past the max", () => {
    const b = boundsOf([{ x: -10, y: 0 }, { x: 10, y: 0 }])!;
    const t = fitTransform(b, { width: 200, height: 100 }, 10, 1, 0.01);
    expect(t.scale).toBe(1);
    expect(t.panX).toBe(100);
    expect(boundsOf([])).toBeNull();
  });
});

describe("card placement", () => {
  it("goes right, or left when there is no room", () => {
    const view = { width: 800, height: 600 };
    const card = { width: 300, height: 200 };
    expect(cardPlacement({ x: 100, y: 100, r: 10 }, view, card).side).toBe("right");
    expect(cardPlacement({ x: 700, y: 100, r: 10 }, view, card).side).toBe("left");
  });
});

describe("canvas export", () => {
  it("makes file cards, text cards and edges", () => {
    const data = {
      nodes: new Map([
        ["a.md", { id: "a.md", type: "" as const, color: 0xff0000 }],
        ["Missing", { id: "Missing", type: "unresolved" as const, color: null }],
      ]),
      links: [["a.md", "Missing"], ["a.md", "Missing"]] as [string, string][],
      weights: new Map(),
    };
    const canvas = toJsonCanvas(data, new Map([["a.md", { x: 10, y: 0 }]]), (id) => id);
    expect(canvas.nodes[0]).toMatchObject({ type: "file", file: "a.md", color: "#ff0000", x: -160 });
    expect(canvas.nodes[1]).toMatchObject({ type: "text", text: "Missing" });
    expect(canvas.edges).toHaveLength(1);
  });
});
