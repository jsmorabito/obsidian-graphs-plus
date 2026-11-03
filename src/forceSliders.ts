/**
 * Core maps the center and link sliders non-linearly, so the 0-1 slider and
 * the force strength differ (default center strength 0.1 shows as 0.52).
 */
export const strengthToSlider = (strength: number, min = 0.01): number =>
  1 - Math.log(strength * (1 - min) + min) / Math.log(min);
export const sliderToStrength = (slider: number, min = 0.01): number =>
  (Math.pow(min, 1 - slider) - min) / (1 - min);
