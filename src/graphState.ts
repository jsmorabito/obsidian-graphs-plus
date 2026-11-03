import {
  DEFAULT_FILTERS,
  DEFAULT_LOCAL,
  type FilterOptions,
  type LocalOptions,
} from "./graphData";
import { DEFAULT_FORCES, type SimForces } from "./forceSim";
import { sliderToStrength, strengthToSlider } from "./forceSliders";

/** Core's display options. */
export type RenderOptions = {
  showArrow: boolean;
  textFadeMultiplier: number;
  nodeSizeMultiplier: number;
  lineSizeMultiplier: number;
};

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  showArrow: false,
  textFadeMultiplier: 0,
  nodeSizeMultiplier: 1,
  lineSizeMultiplier: 1,
};

/** A color group: notes matching `query` are drawn in `rgb`. */
export type ColorGroup = { query: string; rgb: number };

export type GraphMode = "vault" | "sandbox" | "local";

export const SECTIONS = [
  "sandbox",
  "filter",
  "color-groups",
  "display",
  "forces",
] as const;
export type SectionName = (typeof SECTIONS)[number];

export type GraphViewState = {
  /**
   * `vault` shows every note like core's graph view, `local` the
   * neighborhood of `localFile` like core's local graph, and `sandbox` only
   * the notes in `members`.
   */
  mode: GraphMode;
  members: string[];
  localFile: string | null;
  local: LocalOptions;
  filters: FilterOptions;
  display: RenderOptions;
  forces: SimForces;
  groups: ColorGroup[];
  /** The settings panel is collapsed to its buttons. */
  collapsed: boolean;
  /** Collapsed state per settings section; core starts them all collapsed. */
  sections: Record<SectionName, boolean>;
  /** Zoom to restore, in core's device-pixel scale; null fits the graph. */
  scale: number | null;
};

export const defaultGraphState = (
  mode: GraphMode = "vault",
): GraphViewState => ({
  mode,
  members: [],
  localFile: null,
  local: { ...DEFAULT_LOCAL },
  filters: { ...DEFAULT_FILTERS },
  display: { ...DEFAULT_RENDER_OPTIONS },
  forces: { ...DEFAULT_FORCES },
  groups: [],
  // Core opens a new graph with the panel open and its sections collapsed.
  collapsed: false,
  sections: {
    sandbox: mode !== "sandbox",
    filter: true,
    "color-groups": true,
    display: true,
    forces: true,
  },
  scale: null,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pick = <T extends object>(defaults: T, saved: unknown): T => {
  const result = { ...defaults } as Record<string, unknown>;
  if (!isRecord(saved)) return result as T;
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = saved[key];
    if (typeof value === typeof fallback) result[key] = value;
  }
  return result as T;
};

const isGroup = (g: unknown): g is ColorGroup =>
  isRecord(g) && typeof g.query === "string" && typeof g.rgb === "number";

/** Reads saved state defensively: unknown or malformed fields fall back. */
export const normalizeGraphState = (saved: unknown): GraphViewState => {
  const mode =
    isRecord(saved) && (saved.mode === "sandbox" || saved.mode === "local")
      ? saved.mode
      : "vault";
  const base = defaultGraphState(mode);
  if (!isRecord(saved)) return base;
  return {
    mode,
    members: Array.isArray(saved.members)
      ? saved.members.filter((m): m is string => typeof m === "string")
      : [],
    localFile: typeof saved.localFile === "string" ? saved.localFile : null,
    local: pick(base.local, saved.local),
    filters: pick(base.filters, saved.filters),
    display: pick(base.display, saved.display),
    forces: pick(base.forces, saved.forces),
    groups: Array.isArray(saved.groups) ? saved.groups.filter(isGroup) : [],
    collapsed:
      typeof saved.collapsed === "boolean" ? saved.collapsed : base.collapsed,
    sections: pick(base.sections, saved.sections),
    scale:
      typeof saved.scale === "number" && saved.scale > 0 ? saved.scale : null,
  };
};

/**
 * Core's own option object, as stored in `.obsidian/graph.json` and in a
 * local graph's view state. Forces are stored as slider positions.
 */
export type CoreGraphOptions = Record<string, unknown>;

export const toCoreOptions = (state: GraphViewState): CoreGraphOptions => ({
  "collapse-filter": state.sections.filter,
  search: state.filters.search,
  showTags: state.filters.showTags,
  showAttachments: state.filters.showAttachments,
  hideUnresolved: state.filters.hideUnresolved,
  showOrphans: state.filters.showOrphans,
  ...(state.mode === "local" ? { ...state.local } : {}),
  "collapse-color-groups": state.sections["color-groups"],
  colorGroups: state.groups.map((g) => ({
    query: g.query,
    color: { a: 1, rgb: g.rgb },
  })),
  "collapse-display": state.sections.display,
  ...state.display,
  "collapse-forces": state.sections.forces,
  centerStrength: strengthToSlider(state.forces.centerStrength),
  repelStrength: state.forces.repelStrength,
  linkStrength: strengthToSlider(state.forces.linkStrength),
  linkDistance: state.forces.linkDistance,
  ...(state.scale !== null ? { scale: state.scale } : {}),
  close: state.collapsed,
});

/** Applies core's options (e.g. from `graph.json`) on top of `state`. */
export const fromCoreOptions = (
  state: GraphViewState,
  options: unknown,
): GraphViewState => {
  if (!isRecord(options)) return state;
  const o = options;
  const bool = (key: string, fallback: boolean): boolean =>
    typeof o[key] === "boolean" ? o[key] : fallback;
  const num = (key: string, fallback: number): number =>
    typeof o[key] === "number" && Number.isFinite(o[key]) ? o[key] : fallback;
  const groups = Array.isArray(o.colorGroups)
    ? o.colorGroups.flatMap((g: unknown): ColorGroup[] =>
        isRecord(g) &&
        typeof g.query === "string" &&
        isRecord(g.color) &&
        typeof g.color.rgb === "number"
          ? [{ query: g.query, rgb: g.color.rgb }]
          : [],
      )
    : state.groups;
  return {
    ...state,
    filters: {
      search: typeof o.search === "string" ? o.search : state.filters.search,
      showTags: bool("showTags", state.filters.showTags),
      showAttachments: bool("showAttachments", state.filters.showAttachments),
      hideUnresolved: bool("hideUnresolved", state.filters.hideUnresolved),
      showOrphans: bool("showOrphans", state.filters.showOrphans),
    },
    local: {
      localJumps: num("localJumps", state.local.localJumps),
      localBacklinks: bool("localBacklinks", state.local.localBacklinks),
      localForelinks: bool("localForelinks", state.local.localForelinks),
      localInterlinks: bool("localInterlinks", state.local.localInterlinks),
    },
    groups,
    display: {
      showArrow: bool("showArrow", state.display.showArrow),
      textFadeMultiplier: num(
        "textFadeMultiplier",
        state.display.textFadeMultiplier,
      ),
      nodeSizeMultiplier: num(
        "nodeSizeMultiplier",
        state.display.nodeSizeMultiplier,
      ),
      lineSizeMultiplier: num(
        "lineSizeMultiplier",
        state.display.lineSizeMultiplier,
      ),
    },
    forces: {
      centerStrength:
        typeof o.centerStrength === "number"
          ? sliderToStrength(o.centerStrength)
          : state.forces.centerStrength,
      repelStrength: num("repelStrength", state.forces.repelStrength),
      linkStrength:
        typeof o.linkStrength === "number"
          ? sliderToStrength(o.linkStrength)
          : state.forces.linkStrength,
      linkDistance: num("linkDistance", state.forces.linkDistance),
    },
    sections: {
      ...state.sections,
      filter: bool("collapse-filter", state.sections.filter),
      "color-groups": bool("collapse-color-groups", state.sections["color-groups"]),
      display: bool("collapse-display", state.sections.display),
      forces: bool("collapse-forces", state.sections.forces),
    },
    scale: typeof o.scale === "number" && o.scale > 0 ? o.scale : state.scale,
    collapsed: bool("close", state.collapsed),
  };
};
