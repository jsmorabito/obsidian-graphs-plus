import { describe, expect, it } from "vitest";
import { sliderToStrength, strengthToSlider } from "../forceSliders";

describe("force sliders", () => {
  it("shows core's default center force 0.1 as 0.52 on the slider", () => {
    expect(strengthToSlider(0.1)).toBeCloseTo(0.5184, 3);
  });

  it("maps the ends to the ends", () => {
    expect(strengthToSlider(1)).toBeCloseTo(1);
    expect(strengthToSlider(0)).toBeCloseTo(0);
  });

  it("round-trips", () => {
    for (const s of [0, 0.05, 0.1, 0.5, 1]) {
      expect(sliderToStrength(strengthToSlider(s))).toBeCloseTo(s, 10);
    }
  });
});
