import { describe, expect, it } from "vitest";
import { DEFAULT_FORCES, ForceSimulation } from "../forceSim";

/** A seeded random so layouts are repeatable. */
const seeded = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const spread = (sim: ForceSimulation): number => {
  let max = 0;
  for (const a of sim.nodes) {
    for (const b of sim.nodes) max = Math.max(max, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return max;
};

const settle = (sim: ForceSimulation, ticks = 400): void => {
  for (let i = 0; i < ticks && sim.tick(); i++);
};

describe("ForceSimulation", () => {
  it("uses core's default forces", () => {
    expect(DEFAULT_FORCES).toEqual({
      centerStrength: 0.1,
      repelStrength: 10,
      linkStrength: 1,
      linkDistance: 250,
    });
  });

  it("keeps unlinked nodes apart (repulsion survives the Barnes-Hut tree)", () => {
    // Regression: testing for an empty leaf by mass === 0 (mass is filled in
    // after the build) dropped every node but one, so repulsion vanished and
    // the layout collapsed into a lump.
    const sim = new ForceSimulation(seeded());
    const ids = Array.from({ length: 60 }, (_, i) => `n${i}`);
    sim.setData(ids, []);
    settle(sim);
    let closest = Infinity;
    for (const a of sim.nodes) {
      for (const b of sim.nodes) {
        if (a !== b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    expect(closest).toBeGreaterThan(5);
    expect(spread(sim)).toBeGreaterThan(100);
  });

  it("collapses without repulsion, so the test above means something", () => {
    const sim = new ForceSimulation(seeded());
    sim.setData(Array.from({ length: 60 }, (_, i) => `n${i}`), []);
    sim.setForces({ repelStrength: 0 });
    settle(sim);
    expect(spread(sim)).toBeLessThan(5);
  });

  it("pulls linked nodes toward the link distance", () => {
    const sim = new ForceSimulation(seeded());
    sim.setData(["a", "b"], [["a", "b"]]);
    sim.setForces({ repelStrength: 0, centerStrength: 0 });
    settle(sim, 2000);
    const [a, b] = sim.nodes;
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeCloseTo(250, -1);
  });

  it("keeps existing positions when data changes and places newcomers near neighbors", () => {
    const sim = new ForceSimulation(seeded());
    sim.setData(["a", "b"], [["a", "b"]]);
    settle(sim);
    const a = { ...sim.node("a")! };
    sim.setData(["a", "b", "c"], [["a", "b"], ["c", "a"]]);
    expect(sim.node("a")!.x).toBe(a.x);
    const c = sim.node("c")!;
    expect(Math.hypot(c.x - a.x, c.y - a.y)).toBeLessThan(60);
  });

  it("restores seeded positions", () => {
    const sim = new ForceSimulation(seeded());
    sim.seed(new Map([["a", { x: 500, y: -20 }]]));
    sim.setData(["a", "b"], []);
    expect(sim.node("a")).toMatchObject({ x: 500, y: -20 });
  });

  it("settles and stops", () => {
    const sim = new ForceSimulation(seeded());
    sim.setData(["a", "b", "c"], [["a", "b"]]);
    settle(sim, 5000);
    expect(sim.running).toBe(false);
    expect(sim.tick()).toBe(false);
  });

  it("pins a dragged node", () => {
    const sim = new ForceSimulation(seeded());
    sim.setData(["a", "b"], [["a", "b"]]);
    const a = sim.node("a")!;
    a.fx = 42;
    a.fy = 7;
    sim.tick();
    expect(a.x).toBe(42);
    expect(a.y).toBe(7);
  });
});
