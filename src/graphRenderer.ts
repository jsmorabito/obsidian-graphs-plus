import { Platform } from "obsidian";
import type { ForceSimulation, SimNode } from "./forceSim";
import type { GraphData, NodeType } from "./graphData";
import {
  cssRgb,
  mixRgb,
  readThemeColors,
  type GraphColor,
  type ThemeColors,
} from "./graphColors";
import { DEFAULT_RENDER_OPTIONS, type RenderOptions } from "./graphState";
import { edgeKey, type GraphOverlay } from "./overlay";
import { wrapText } from "./textWrap";
import { boundsOf, fitTransform } from "./viewFit";

/**
 * Canvas 2D renderer that mirrors Obsidian's core graph view (which draws
 * with Pixi): node size from link count, labels that fade in with zoom and
 * wrap at 300 units, links that dim away from the hovered node, notched
 * arrows, wheel zoom of 1.5x per notch, smoothed pan and zoom, keyboard pan
 * and zoom. The constants below are core's own.
 *
 * Coordinates: `scale` is core's, world units to device pixels; pan is kept
 * in CSS pixels, so a world point lands at `pan + world * scale / ratio`.
 */

const MIN_SCALE = 1 / 128;
const MAX_SCALE = 8;
const ZOOM_PER_NOTCH = 1.5;
const FADE_ALPHA = 0.2;
const SMOOTHING = 0.9;
const ZOOM_SMOOTHING = 0.85;
const IDLE_FRAMES = 60;
const LINE_HEIGHT_PX = 40;
const PAGE_HEIGHT_PX = 800;
const DRAG_SLOP = 5;
const LABEL_WRAP = 300;
/** Core's label font (Pixi text, not the theme's interface font). */
const LABEL_FONT =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Microsoft YaHei Light", sans-serif';

export type KeyAction = "up" | "down" | "left" | "right" | "zoomin" | "zoomout";

export type Camera = { scale: number; x: number; y: number };

type GraphNode = {
  id: string;
  type: NodeType;
  weight: number;
  sim: SimNode;
  /** Opacity from hover dimming, easing toward 1 or 0.2. */
  fade: number;
  /** Color-group color from the data. */
  groupColor: number | null;
  /** Overlay style, applied over everything else. */
  overlay: { rgb?: number; alpha: number; sizeBoost: number } | null;
  forward: Set<string>;
  reverse: Set<string>;
  /** What is on screen now, easing toward the target color and size. */
  draw: { rgb: number; a: number; boost: number } | null;
  /** Label offset while hovered, easing toward 15 device pixels. */
  moveText: number;
  /** Wrapped label, cached per font size. */
  label: { size: number; lines: string[] } | null;
};

type GraphLink = {
  source: GraphNode;
  target: GraphNode;
  key: string;
  line: { rgb: number; a: number; w: number } | null;
  arrowAlpha: number;
};

const lerp = (from: number, to: number, keep: number): number =>
  from * keep + to * (1 - keep);

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

/** Core's label: the file name, without `.md` for notes; tags keep their `#`. */
export const displayName = (id: string, type: string): string => {
  if (type === "tag") return id;
  const name = id.split("/").pop() ?? id;
  return /\.md$/i.test(name) ? name.slice(0, -3) : name;
};

export class GraphRenderer {
  /** Left or middle click on a node (not a drag). */
  onNodeClick: ((id: string, type: NodeType, event: MouseEvent) => void) | null =
    null;
  onNodeRightClick:
    | ((id: string, type: NodeType, event: MouseEvent) => void)
    | null = null;
  onNodeHover: ((id: string, type: NodeType, event: MouseEvent) => void) | null =
    null;
  onNodeUnhover: (() => void) | null = null;
  /** A click on empty canvas (not a drag). */
  onBackgroundClick: (() => void) | null = null;
  /** Where the selected node is on screen each frame, or null when none. */
  onSelectedMoved:
    | ((anchor: { x: number; y: number; r: number } | null) => void)
    | null = null;
  /** The user panned or zoomed. */
  onCameraChange: (() => void) | null = null;
  /** The user dragged a node somewhere. */
  onDragEnd: (() => void) | null = null;
  /** The layout came to rest. */
  onSettled: (() => void) | null = null;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private resizeObserver: ResizeObserver;
  private colors: ThemeColors;
  private options = { ...DEFAULT_RENDER_OPTIONS };
  private nodes: GraphNode[] = [];
  private byId = new Map<string, GraphNode>();
  private links: GraphLink[] = [];
  private overlay: GraphOverlay | null = null;

  private scale = 1;
  private targetScale = 1;
  private panX = 0;
  private panY = 0;
  private panVX = 0;
  private panVY = 0;
  private zoomCenter: { x: number; y: number } | null = null;
  private width = 0;
  private height = 0;
  private ratio = 1;
  private keys = new Set<KeyAction>();
  private shift = false;

  private hovered: GraphNode | null = null;
  private selected: GraphNode | null = null;
  private dragging: GraphNode | null = null;
  /** Pan the view is easing toward, set by `focus`. */
  private flyTo: { x: number; y: number } | null = null;
  private panning = false;
  private pointer: { x: number; y: number } | null = null;
  private lastMouse: MouseEvent | null = null;
  private idleFrames = 0;
  private frame: number | null = null;
  private destroyed = false;
  private wasRunning = false;
  /**
   * Keep the graph framed while it settles, until the user moves the view:
   * "fit" fits it, "center" keeps the zoom and centers it.
   */
  private autoFrame: "fit" | "center" | null = null;
  /** First data: how to frame it (set by `setInitialCamera`). */
  private initialCamera: Camera | "fit" | { scale: number } = "fit";
  /** The first data has been framed; later data never moves the camera. */
  private framed = false;
  /** A fit was asked for while the view had no size (a background tab). */
  private fitWhenSized = false;

  constructor(
    private containerEl: HTMLElement,
    private sim: ForceSimulation,
  ) {
    this.canvas = containerEl.createEl("canvas", { cls: "graphs-plus-canvas" });
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.colors = readThemeColors(containerEl.doc.body);
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(containerEl);
    this.resize();
    this.resetPan();
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    if (this.frame !== null) {
      this.containerEl.win.cancelAnimationFrame(this.frame);
    }
    this.canvas.remove();
  }

  /** Re-reads theme colors, e.g. after a theme or light/dark change. */
  refreshTheme(): void {
    this.colors = readThemeColors(this.containerEl.doc.body);
    this.changed();
  }

  /**
   * How to frame the first data: a saved camera, a saved zoom (centered on
   * the graph), or "fit" to fit the graph in view.
   */
  setInitialCamera(camera: Camera | { scale: number } | "fit"): void {
    this.initialCamera = camera;
  }

  setData(data: GraphData): void {
    const previous = this.byId;
    this.sim.setData([...data.nodes.keys()], data.links);
    this.byId = new Map();
    this.nodes = [...data.nodes.values()].map((n) => {
      const kept = previous.get(n.id);
      const node: GraphNode = {
        id: n.id,
        type: n.type,
        weight: data.weights.get(n.id) ?? 0,
        sim: this.sim.node(n.id)!,
        fade: kept?.fade ?? 1,
        groupColor: n.color,
        overlay: null,
        forward: new Set(),
        reverse: new Set(),
        draw: kept?.draw ?? null,
        moveText: kept?.moveText ?? 0,
        label: kept?.label ?? null,
      };
      this.byId.set(n.id, node);
      return node;
    });
    const prevLinks = new Map(this.links.map((l) => [`${l.source.id}>${l.target.id}`, l]));
    this.links = [];
    for (const [a, b] of data.links) {
      const source = this.byId.get(a);
      const target = this.byId.get(b);
      if (!source || !target || source.forward.has(b)) continue;
      source.forward.add(b);
      target.reverse.add(a);
      const kept = prevLinks.get(`${a}>${b}`);
      this.links.push({
        source,
        target,
        key: edgeKey(a, b),
        line: kept?.line ?? null,
        arrowAlpha: kept?.arrowAlpha ?? 0,
      });
    }
    this.applyOverlay();
    // Nodes are rebuilt on every data change; keep hover and selection by id.
    this.hovered = (this.hovered && this.byId.get(this.hovered.id)) || null;
    this.selected = (this.selected && this.byId.get(this.selected.id)) || null;
    if (!this.framed && this.nodes.length > 0) {
      this.framed = true;
      this.frameFirstData();
    }
    this.changed();
  }

  private frameFirstData(): void {
    const camera = this.initialCamera;
    if (camera !== "fit" && "x" in camera) {
      this.setCamera(camera);
      return;
    }
    // Run the layout ahead of the first frame, so the graph opens settled
    // instead of animating out of a blob; whatever is left finishes live.
    this.warmUp(250);
    if (camera === "fit") {
      this.fit();
      this.autoFrame = "fit";
    } else {
      this.scale = this.targetScale = clamp(camera.scale, MIN_SCALE, MAX_SCALE);
      this.center();
      this.autoFrame = "center";
    }
  }

  private warmUp(budgetMs: number): void {
    const start = performance.now();
    while (this.sim.running && performance.now() - start < budgetMs) {
      this.sim.tick();
    }
  }

  /** Fits the whole graph in view, never zooming in past 1x. */
  fit(padding = 40): void {
    const bounds = boundsOf(this.nodes.map((n) => n.sim));
    if (!bounds) return;
    if (this.width === 0 || this.height === 0) {
      // Hidden tab: fit once it is shown and has a size.
      this.fitWhenSized = true;
      return;
    }
    const t = fitTransform(
      bounds,
      { width: this.width, height: this.height },
      padding,
      1 / this.ratio,
      MIN_SCALE / this.ratio,
    );
    this.scale = this.targetScale = t.scale * this.ratio;
    this.panX = t.panX;
    this.panY = t.panY;
    this.panVX = this.panVY = 0;
    this.zoomCenter = null;
  }

  /** Centers the graph's bounding box at the current zoom. */
  private center(): void {
    const bounds = boundsOf(this.nodes.map((n) => n.sim));
    if (!bounds) return;
    const css = this.scale / this.ratio;
    this.panX = this.width / 2 - ((bounds.minX + bounds.maxX) / 2) * css;
    this.panY = this.height / 2 - ((bounds.minY + bounds.maxY) / 2) * css;
  }

  /** The current zoom and the world point at the view's center. */
  getCamera(): Camera {
    const css = this.targetScale / this.ratio;
    return {
      scale: this.targetScale,
      x: (this.width / 2 - this.panX) / css,
      y: (this.height / 2 - this.panY) / css,
    };
  }

  setCamera(camera: Camera): void {
    this.scale = this.targetScale = clamp(camera.scale, MIN_SCALE, MAX_SCALE);
    const css = this.scale / this.ratio;
    this.panX = this.width / 2 - camera.x * css;
    this.panY = this.height / 2 - camera.y * css;
    this.panVX = this.panVY = 0;
    this.autoFrame = null;
    this.fitWhenSized = false;
    this.changed();
  }

  get zoom(): number {
    return this.targetScale;
  }

  setRenderOptions(options: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...options };
    for (const node of this.nodes) node.label = null;
    this.changed();
  }

  /** Paints a scenario over the graph; null restores the plain graph. */
  setOverlay(overlay: GraphOverlay | null): void {
    this.overlay = overlay;
    this.applyOverlay();
    this.changed();
  }

  /** Keeps a node highlighted with its neighbors lit; null clears. */
  select(id: string | null): void {
    this.selected = (id && this.byId.get(id)) || null;
    this.changed();
  }

  /** Eases the view so `id` is centered in the area right of an `inset`-wide panel. */
  focus(id: string, inset = 0): void {
    const node = this.byId.get(id);
    if (!node) return;
    this.autoFrame = null;
    const css = this.scale / this.ratio;
    this.flyTo = {
      x: inset + (this.width - inset) / 2 - node.sim.x * css,
      y: this.height / 2 - node.sim.y * css,
    };
    this.panVX = this.panVY = 0;
    this.changed();
  }

  resetPan(): void {
    this.panX = this.width / 2;
    this.panY = this.height / 2;
    this.changed();
  }

  /** Arrow keys pan and +/- zoom while held, as in core. */
  setKey(action: KeyAction, down: boolean, shift: boolean): void {
    this.shift = shift;
    if (down) this.keys.add(action);
    else this.keys.delete(action);
    if (down) this.autoFrame = null;
    this.changed();
  }

  /** Positions by node id, for saving a layout. */
  positions(): Map<string, { x: number; y: number }> {
    return new Map(this.nodes.map((n) => [n.id, { x: n.sim.x, y: n.sim.y }]));
  }

  /** The graph as a PNG with a transparent background, like core's screenshot. */
  screenshot(): Promise<Blob | null> {
    this.paint();
    return new Promise((resolve) => this.canvas.toBlob(resolve, "image/png"));
  }

  changed(): void {
    this.idleFrames = 0;
    if (this.frame === null && !this.destroyed) {
      this.frame = this.containerEl.win.requestAnimationFrame(() =>
        this.draw(),
      );
    }
  }

  private applyOverlay(): void {
    const { overlay } = this;
    for (const node of this.nodes) {
      node.overlay = overlay
        ? (overlay.nodes.get(node.id) ?? {
            alpha: overlay.dimAlpha,
            sizeBoost: 0,
          })
        : null;
    }
  }

  private get emphasis(): GraphNode | null {
    return this.dragging ?? this.hovered ?? this.selected;
  }

  /** Core's fill: highlight, focused (if the theme gives it a color), group, type. */
  private fillColor(node: GraphNode): GraphColor {
    const { colors } = this;
    if (node === this.dragging || node === this.hovered || node === this.selected) {
      return colors.fillHighlight;
    }
    let base: GraphColor;
    if (node.type === "focused" && colors.fillFocused.a > 0) {
      base = colors.fillFocused;
    } else if (node.groupColor !== null && node.type !== "focused") {
      base = { rgb: node.groupColor, a: 1 };
    } else if (node.type === "tag") base = colors.fillTag;
    else if (node.type === "unresolved") base = colors.fillUnresolved;
    else if (node.type === "attachment") base = colors.fillAttachment;
    else base = colors.fill;
    const style = node.overlay;
    return style
      ? { rgb: style.rgb ?? base.rgb, a: base.a * style.alpha }
      : base;
  }

  /** Core's size: node size slider times clamp(sqrt(weight + 1) * 3, 8, 30). */
  private nodeSize(node: GraphNode): number {
    return (
      this.options.nodeSizeMultiplier *
        clamp(Math.sqrt(node.weight + 1) * 3, 8, 30) +
      (node.draw?.boost ?? 0)
    );
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.containerEl;
    const ratio = this.containerEl.win.devicePixelRatio || 1;
    if (w === this.width && h === this.height && ratio === this.ratio) return;
    // Keep the view centered on the same world point through a resize.
    this.panX += (w - this.width) / 2;
    this.panY += (h - this.height) / 2;
    if (ratio !== this.ratio) {
      // Scale is in device pixels; keep the same on-screen zoom.
      this.scale *= ratio / this.ratio;
      this.targetScale *= ratio / this.ratio;
    }
    this.width = w;
    this.height = h;
    this.ratio = ratio;
    this.canvas.width = Math.round(w * ratio);
    this.canvas.height = Math.round(h * ratio);
    this.canvas.setCssStyles({ width: `${w}px`, height: `${h}px` });
    if (this.fitWhenSized && w > 0 && h > 0) {
      this.fitWhenSized = false;
      this.fit();
    }
    this.changed();
  }

  private toWorld(x: number, y: number): { x: number; y: number } {
    const css = this.scale / this.ratio;
    return { x: (x - this.panX) / css, y: (y - this.panY) / css };
  }

  private nodeAt(x: number, y: number): GraphNode | null {
    const world = this.toWorld(x, y);
    const nodeScale = Math.sqrt(1 / this.scale);
    let best: GraphNode | null = null;
    let bestDistance = Infinity;
    for (const node of this.nodes) {
      const dx = node.sim.x - world.x;
      const dy = node.sim.y - world.y;
      const reach = this.nodeSize(node) * nodeScale + 2;
      const d2 = dx * dx + dy * dy;
      if (d2 <= reach * reach && d2 < bestDistance) {
        best = node;
        bestDistance = d2;
      }
    }
    return best;
  }

  private userMoved(): void {
    this.autoFrame = null;
    this.flyTo = null;
    this.onCameraChange?.();
  }

  private bindEvents(): void {
    const { canvas } = this;
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.userMoved();
        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= LINE_HEIGHT_PX;
        else if (e.deltaMode === 2) delta *= PAGE_HEIGHT_PX;
        const next = clamp(
          this.targetScale * Math.pow(ZOOM_PER_NOTCH, -delta / 120),
          MIN_SCALE,
          MAX_SCALE,
        );
        // Core zooms toward the pointer when zooming in, the view center out.
        this.zoomCenter =
          next < this.scale ? null : { x: e.offsetX, y: e.offsetY };
        this.targetScale = next;
        this.changed();
      },
      { passive: false },
    );

    let downAt: { x: number; y: number } | null = null;
    let moved = false;
    let panStart: { x: number; y: number; px: number; py: number } | null =
      null;
    let lastMove = performance.now();
    // Touch pointers, for two-finger pinch zoom.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { distance: number; mid: { x: number; y: number } } | null =
      null;
    const pinchState = () => {
      const [a, b] = [...touches.values()];
      if (!a || !b) return null;
      return {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    };

    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") {
        touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        if (touches.size === 2) {
          // A second finger turns a drag or pan into a pinch.
          pinch = pinchState();
          if (this.dragging) {
            this.dragging.sim.fx = this.dragging.sim.fy = null;
            this.dragging = null;
            this.sim.alphaTarget = 0;
          }
          this.panning = false;
          downAt = null;
          return;
        }
      }
      if (e.button !== 0 && e.button !== 1) return;
      // On macOS ctrl-click is a right-click: leave it to the context menu.
      if (Platform.isMacOS && e.ctrlKey && e.button === 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.userMoved();
      downAt = { x: e.offsetX, y: e.offsetY };
      moved = false;
      const node = this.nodeAt(e.offsetX, e.offsetY);
      if (node) {
        this.dragging = node;
      } else if (e.button === 0) {
        this.panning = true;
        panStart = { x: e.offsetX, y: e.offsetY, px: this.panX, py: this.panY };
        this.panVX = this.panVY = 0;
        canvas.doc.body.addClass("is-grabbing");
      }
      this.changed();
    });

    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch" && touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        if (pinch && touches.size === 2) {
          const next = pinchState();
          if (next && pinch.distance > 0) {
            this.targetScale = clamp(
              this.targetScale * (next.distance / pinch.distance),
              MIN_SCALE,
              MAX_SCALE,
            );
            this.panX += next.mid.x - pinch.mid.x;
            this.panY += next.mid.y - pinch.mid.y;
            this.zoomCenter = next.mid;
            pinch = next;
            this.onCameraChange?.();
            this.changed();
          }
          return;
        }
      }
      this.pointer = { x: e.offsetX, y: e.offsetY };
      this.lastMouse = e;
      if (
        downAt &&
        Math.hypot(e.offsetX - downAt.x, e.offsetY - downAt.y) > DRAG_SLOP
      ) {
        moved = true;
      }
      if (this.dragging && moved) {
        const w = this.toWorld(e.offsetX, e.offsetY);
        this.dragging.sim.fx = w.x;
        this.dragging.sim.fy = w.y;
        this.sim.alphaTarget = 0.3;
        this.sim.reheat(0.3);
      } else if (this.panning && panStart) {
        const now = performance.now();
        const nx = panStart.px + e.offsetX - panStart.x;
        const ny = panStart.py + e.offsetY - panStart.y;
        const dt = Math.max(1, now - lastMove);
        this.panVX = lerp(this.panVX, (nx - this.panX) / dt, 0.8);
        this.panVY = lerp(this.panVY, (ny - this.panY) / dt, 0.8);
        lastMove = now;
        this.panX = nx;
        this.panY = ny;
        this.onCameraChange?.();
      }
      this.changed();
    });

    const release = (e: PointerEvent): void => {
      if (e.pointerType === "touch") {
        touches.delete(e.pointerId);
        if (pinch) {
          if (touches.size < 2) pinch = null;
          return;
        }
      }
      if (this.dragging) {
        const node = this.dragging;
        node.sim.fx = node.sim.fy = null;
        this.sim.alphaTarget = 0;
        this.dragging = null;
        if (!moved && e.type === "pointerup") {
          this.onNodeClick?.(node.id, node.type, e);
        } else if (moved) {
          this.onDragEnd?.();
        }
      }
      if (this.panning) {
        this.panning = false;
        canvas.doc.body.removeClass("is-grabbing");
        if (!moved && e.type === "pointerup") this.onBackgroundClick?.();
        if (performance.now() - lastMove > 100) this.panVX = this.panVY = 0;
      }
      downAt = null;
      panStart = null;
      this.changed();
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointerleave", () => {
      this.pointer = null;
      this.changed();
    });
    // Keep middle-click from starting the browser's autoscroll.
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault();
    });
    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const node = this.nodeAt(e.offsetX, e.offsetY);
      if (node) this.onNodeRightClick?.(node.id, node.type, e);
    });
  }

  private draw(): void {
    this.frame = null;
    if (this.destroyed) return;
    if (this.idleFrames > IDLE_FRAMES) return;
    const running = this.sim.running;
    if (running) {
      this.sim.tick();
      this.idleFrames = 0;
      if (this.autoFrame === "fit") this.fit();
      else if (this.autoFrame === "center") this.center();
    } else if (this.wasRunning) {
      this.autoFrame = null;
      this.onSettled?.();
    }
    this.wasRunning = running;
    this.updateView();
    this.updateHover();
    this.paint();
    this.idleFrames++;
    this.frame = this.containerEl.win.requestAnimationFrame(() => this.draw());
  }

  private updateHover(): void {
    if (this.panning || this.dragging) return;
    const over = this.pointer ? this.nodeAt(this.pointer.x, this.pointer.y) : null;
    if (over === this.hovered) return;
    this.hovered = over;
    this.canvas.toggleClass("is-pointer", over !== null);
    this.idleFrames = 0;
    if (over && this.lastMouse) {
      this.onNodeHover?.(over.id, over.type, this.lastMouse);
    } else {
      this.onNodeUnhover?.();
    }
  }

  private updateView(): void {
    if (this.flyTo && !this.panning) {
      this.panX = lerp(this.panX, this.flyTo.x, ZOOM_SMOOTHING);
      this.panY = lerp(this.panY, this.flyTo.y, ZOOM_SMOOTHING);
      this.idleFrames = 0;
      if (
        Math.abs(this.panX - this.flyTo.x) < 0.5 &&
        Math.abs(this.panY - this.flyTo.y) < 0.5
      ) {
        this.panX = this.flyTo.x;
        this.panY = this.flyTo.y;
        this.flyTo = null;
      }
    }
    if (!this.panning) {
      this.panX += this.panVX * (1000 / 60);
      this.panY += this.panVY * (1000 / 60);
      // Arrow keys push the pan velocity, three times faster with shift.
      let dx = 0;
      let dy = 0;
      if (this.keys.has("up")) dy += 1;
      if (this.keys.has("down")) dy -= 1;
      if (this.keys.has("left")) dx += 1;
      if (this.keys.has("right")) dx -= 1;
      const speed = (this.shift ? 3 : 1) / this.ratio;
      this.panVX = lerp(this.panVX, dx * speed, 0.9);
      this.panVY = lerp(this.panVY, dy * speed, 0.9);
      if (dx || dy || Math.abs(this.panVX) + Math.abs(this.panVY) > 1e-4) {
        this.idleFrames = 0;
      }
    }
    const step = 1 + (this.shift ? 0.1 : 0.03);
    if (this.keys.has("zoomin") || this.keys.has("zoomout")) {
      if (this.keys.has("zoomin")) this.targetScale *= step;
      if (this.keys.has("zoomout")) this.targetScale /= step;
      this.targetScale = clamp(this.targetScale, MIN_SCALE, MAX_SCALE);
      this.zoomCenter = null;
      this.idleFrames = 0;
    }
    const { scale, targetScale } = this;
    if (
      (scale > targetScale ? scale / targetScale : targetScale / scale) - 1 >=
      0.01
    ) {
      const center = this.zoomCenter ?? {
        x: this.width / 2,
        y: this.height / 2,
      };
      const world = this.toWorld(center.x, center.y);
      this.scale = lerp(scale, targetScale, ZOOM_SMOOTHING);
      const css = this.scale / this.ratio;
      this.panX = center.x - world.x * css;
      this.panY = center.y - world.y * css;
      this.idleFrames = 0;
    }
  }

  /**
   * Pixi lays text out by the font's measured ascent and descent (scanned
   * from "|ÉqÅ"), not the em box; match it so labels sit where core's do.
   */
  private fontMetrics = new Map<number, { ascent: number; lineHeight: number }>();

  private metrics(fontSize: number): { ascent: number; lineHeight: number } {
    let m = this.fontMetrics.get(fontSize);
    if (!m) {
      this.ctx.font = `${fontSize}px ${LABEL_FONT}`;
      const box = this.ctx.measureText("|ÉqÅ");
      const ascent = box.actualBoundingBoxAscent;
      m = { ascent, lineHeight: ascent + box.actualBoundingBoxDescent };
      this.fontMetrics.set(fontSize, m);
    }
    return m;
  }

  private wrapped(node: GraphNode, fontSize: number): string[] {
    if (node.label && node.label.size === fontSize) return node.label.lines;
    const { ctx } = this;
    ctx.font = `${fontSize}px ${LABEL_FONT}`;
    const lines = wrapText(
      displayName(node.id, node.type),
      LABEL_WRAP,
      (s) => ctx.measureText(s).width,
    );
    node.label = { size: fontSize, lines };
    return lines;
  }

  private paint(): void {
    const { ctx, colors, scale, options, ratio } = this;
    const emphasis = this.emphasis;
    const css = scale / ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const nodeScale = Math.sqrt(1 / scale);
    // Core: labels fade in from half zoom; the slider shifts the threshold.
    const textAlpha = clamp(
      Math.log2(scale) + 1 - options.textFadeMultiplier,
      0,
      1,
    );
    const view = {
      left: -this.panX / css,
      right: (this.width - this.panX) / css,
      top: -this.panY / css,
      bottom: (this.height - this.panY) / css,
    };
    const outside = (l: number, r: number, t: number, b: number): boolean =>
      r < view.left || l > view.right || b < view.top || t > view.bottom;
    const isLit = (node: GraphNode): boolean =>
      !emphasis ||
      node === emphasis ||
      node.forward.has(emphasis.id) ||
      node.reverse.has(emphasis.id);

    // Ease fades, colors and sizes toward their targets; never snap.
    for (const node of this.nodes) {
      const fade = lerp(node.fade, isLit(node) ? 1 : FADE_ALPHA, SMOOTHING);
      if (Math.abs(fade - node.fade) > 0.002) this.idleFrames = 0;
      node.fade = fade;
      const target = this.fillColor(node);
      const boost = node.overlay?.sizeBoost ?? 0;
      const d = node.draw;
      if (!d) {
        node.draw = { rgb: target.rgb, a: target.a, boost };
        continue;
      }
      d.rgb = mixRgb(d.rgb, target.rgb, SMOOTHING);
      d.a = lerp(d.a, target.a, SMOOTHING);
      d.boost = lerp(d.boost, boost, SMOOTHING);
      if (
        d.rgb !== target.rgb ||
        Math.abs(d.a - target.a) > 0.002 ||
        Math.abs(d.boost - boost) > 0.05
      ) {
        this.idleFrames = 0;
      }
    }

    const lineWidth = options.lineSizeMultiplier / scale;
    const arrowRamp = clamp((scale - 0.3) * 2, 0, 1);
    for (const link of this.links) {
      const { source, target } = link;
      const touches = emphasis !== null && (source === emphasis || target === emphasis);
      const fade = !emphasis || touches ? 1 : FADE_ALPHA;
      const style = this.overlay?.edges.get(link.key);
      const overlayAlpha = this.overlay
        ? (style?.alpha ?? this.overlay.dimAlpha)
        : 1;
      const base = touches ? colors.lineHighlight : colors.line;
      const lineTarget = {
        rgb: style?.rgb ?? base.rgb,
        a: fade * base.a * overlayAlpha,
        w: style?.widthScale ?? 1,
      };
      const line = (link.line ??= { ...lineTarget, a: FADE_ALPHA * base.a });
      line.rgb = mixRgb(line.rgb, lineTarget.rgb, SMOOTHING);
      line.a = lerp(line.a, lineTarget.a, SMOOTHING);
      line.w = lerp(line.w, lineTarget.w, SMOOTHING);
      const arrowTarget = fade * arrowRamp * colors.arrow.a * overlayAlpha;
      link.arrowAlpha = lerp(link.arrowAlpha, arrowTarget, SMOOTHING);
      if (
        line.rgb !== lineTarget.rgb ||
        Math.abs(line.a - lineTarget.a) > 0.002 ||
        Math.abs(line.w - lineTarget.w) > 0.01 ||
        Math.abs(link.arrowAlpha - arrowTarget) > 0.002
      ) {
        this.idleFrames = 0;
      }

      const x1 = source.sim.x;
      const y1 = source.sim.y;
      const x2 = target.sim.x;
      const y2 = target.sim.y;
      if (
        outside(
          Math.min(x1, x2) - lineWidth,
          Math.max(x1, x2) + lineWidth,
          Math.min(y1, y2) - lineWidth,
          Math.max(y1, y2) + lineWidth,
        )
      ) {
        continue;
      }
      // A two-way link is drawn once; each direction still gets its arrow.
      const drawLine = !(
        source.reverse.has(target.id) && source.id.localeCompare(target.id) < 0
      );
      const drawArrow = options.showArrow && link.arrowAlpha > 0.001;
      if (!drawLine && !drawArrow) continue;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const r1 = this.nodeSize(source) * nodeScale;
      let r2 = this.nodeSize(target) * nodeScale;
      if (drawLine) {
        const visible = Math.max(0, length - r1 - r2);
        ctx.globalAlpha = line.a;
        ctx.strokeStyle = cssRgb(line.rgb);
        ctx.lineWidth = lineWidth * line.w * css;
        ctx.beginPath();
        ctx.moveTo(this.panX + (x1 + ux * r1) * css, this.panY + (y1 + uy * r1) * css);
        ctx.lineTo(
          this.panX + (x1 + ux * (r1 + visible)) * css,
          this.panY + (y1 + uy * (r1 + visible)) * css,
        );
        ctx.stroke();
      }
      if (drawArrow && length > lineWidth) {
        // Core's notched arrow: (0,0) (-4,-2) (-3,0) (-4,2), at the target's edge.
        r2 += 1;
        const tipX = this.panX + (x2 - ux * r2) * css;
        const tipY = this.panY + (y2 - uy * r2) * css;
        const k = (2 * Math.sqrt(options.lineSizeMultiplier)) / ratio;
        const point = (ax: number, ay: number): [number, number] => [
          tipX + (ax * ux - ay * uy) * k,
          tipY + (ax * uy + ay * ux) * k,
        ];
        ctx.globalAlpha = link.arrowAlpha;
        ctx.fillStyle = cssRgb(colors.arrow.rgb);
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(...point(-4, -2));
        ctx.lineTo(...point(-3, 0));
        ctx.lineTo(...point(-4, 2));
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const node of this.nodes) {
      const { x, y } = node.sim;
      const size = this.nodeSize(node);
      const lit = node === emphasis;
      const moveTarget = lit ? 15 : 0;
      node.moveText = lerp(node.moveText, moveTarget, SMOOTHING);
      if (Math.abs(node.moveText - moveTarget) > 0.05) this.idleFrames = 0;
      const reach = size * nodeScale + 1;
      const fill = node.draw!;
      const sx = this.panX + x * css;
      const sy = this.panY + y * css;
      if (lit || !outside(x - reach, x + reach, y - reach, y + reach)) {
        ctx.globalAlpha = fill.a * node.fade;
        ctx.fillStyle = cssRgb(fill.rgb);
        ctx.beginPath();
        ctx.arc(sx, sy, size * nodeScale * css, 0, Math.PI * 2);
        ctx.fill();
        if (lit) {
          // Core's ring: at least one device pixel wide, just outside the node.
          const ring = Math.max(1, 1 / scale / nodeScale);
          ctx.globalAlpha = colors.circle.a;
          ctx.strokeStyle = cssRgb(colors.circle.rgb);
          ctx.lineWidth = ring * nodeScale * css;
          ctx.beginPath();
          ctx.arc(sx, sy, (size + ring / 2) * nodeScale * css, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      let alpha = (lit ? 1 : textAlpha * node.fade) * colors.text.a;
      if (node.overlay) alpha *= node.overlay.alpha;
      if (alpha <= 0.001) continue;
      if (!lit && outside(x - 300, x + 300, y, y + 200)) continue;
      const fontSize = 14 + size / 4;
      // Labels scale with nodes; a hovered label stays readable when zoomed out.
      const textScale = lit && scale < 1 ? 1 / scale : nodeScale;
      const k = textScale * css;
      const top = sy + (size + 5) * nodeScale * css + node.moveText / ratio;
      const lines = this.wrapped(node, fontSize);
      const { ascent, lineHeight } = this.metrics(fontSize);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = cssRgb(colors.text.rgb);
      ctx.save();
      ctx.translate(sx, top);
      ctx.scale(k, k);
      ctx.font = `${fontSize}px ${LABEL_FONT}`;
      lines.forEach((text, i) => ctx.fillText(text, 0, ascent + i * lineHeight));
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    const selected = this.selected;
    this.onSelectedMoved?.(
      selected
        ? {
            x: this.panX + selected.sim.x * css,
            y: this.panY + selected.sim.y * css,
            r: this.nodeSize(selected) * nodeScale * css,
          }
        : null,
    );
  }
}
