import { describe, expect, it } from "vitest";
import {
  defaultGraphState,
  fromCoreOptions,
  normalizeGraphState,
  toCoreOptions,
} from "../graphState";

describe("graph state", () => {
  it("starts with core's defaults: panel open, sections collapsed", () => {
    const s = defaultGraphState();
    expect(s.collapsed).toBe(false);
    expect(Object.values(s.sections).every(Boolean)).toBe(true);
    expect(s.display).toEqual({
      showArrow: false,
      textFadeMultiplier: 0,
      nodeSizeMultiplier: 1,
      lineSizeMultiplier: 1,
    });
  });

  it("opens the sandbox section for a sandbox", () => {
    expect(defaultGraphState("sandbox").sections.sandbox).toBe(false);
  });

  it("normalizes malformed saved state", () => {
    const s = normalizeGraphState({
      mode: "local",
      members: ["a", 3],
      filters: { showTags: "yes", showOrphans: false },
      groups: [{ query: "x", rgb: 1 }, { query: 2 }],
      scale: -1,
    });
    expect(s.mode).toBe("local");
    expect(s.members).toEqual(["a"]);
    expect(s.filters.showTags).toBe(false);
    expect(s.filters.showOrphans).toBe(false);
    expect(s.groups).toEqual([{ query: "x", rgb: 1 }]);
    expect(s.scale).toBeNull();
    expect(normalizeGraphState(null)).toEqual(defaultGraphState());
  });

  it("writes core's graph.json shape, with forces as slider positions", () => {
    const o = toCoreOptions({
      ...defaultGraphState(),
      groups: [{ query: "tag:#a", rgb: 0x112233 }],
    });
    expect(o.centerStrength).toBeCloseTo(0.5184, 3);
    expect(o.linkStrength).toBeCloseTo(1);
    expect(o.repelStrength).toBe(10);
    expect(o.colorGroups).toEqual([{ query: "tag:#a", color: { a: 1, rgb: 0x112233 } }]);
    expect(o.close).toBe(false);
  });

  it("reads core's graph.json", () => {
    const core = {
      "collapse-filter": false,
      search: "path:notes",
      showTags: true,
      colorGroups: [{ query: "tag:#x", color: { a: 1, rgb: 255 } }],
      textFadeMultiplier: -1.2,
      centerStrength: 0.5184,
      repelStrength: 12,
      linkStrength: 1,
      linkDistance: 100,
      scale: 0.5,
      close: false,
    };
    const s = fromCoreOptions(defaultGraphState(), core);
    expect(s.filters.search).toBe("path:notes");
    expect(s.filters.showTags).toBe(true);
    expect(s.groups).toEqual([{ query: "tag:#x", rgb: 255 }]);
    expect(s.forces.centerStrength).toBeCloseTo(0.1, 3);
    expect(s.forces.repelStrength).toBe(12);
    expect(s.display.textFadeMultiplier).toBe(-1.2);
    expect(s.sections.filter).toBe(false);
    expect(s.scale).toBe(0.5);
    expect(s.collapsed).toBe(false);
  });

  it("round-trips through core's options", () => {
    const s = { ...defaultGraphState("local"), scale: 2, collapsed: false };
    s.local.localJumps = 3;
    s.forces.linkStrength = 0.4;
    const back = fromCoreOptions(defaultGraphState("local"), toCoreOptions(s));
    expect(back.local.localJumps).toBe(3);
    expect(back.forces.linkStrength).toBeCloseTo(0.4, 10);
    expect(back.scale).toBe(2);
    expect(back.collapsed).toBe(false);
  });
});
