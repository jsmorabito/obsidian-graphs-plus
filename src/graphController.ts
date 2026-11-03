import {
  Component,
  ItemView,
  Keymap,
  Menu,
  Notice,
  debounce,
  type HoverParent,
} from "obsidian";
import { cardPlacement } from "./cardPlacement";
import { toJsonCanvas } from "./canvasExport";
import { ForceSimulation } from "./forceSim";
import { GraphControls } from "./graphControls";
import {
  buildGraph,
  linkedNotes,
  localGraph,
  progressionSpeed,
  removeOrphans,
  toGraphData,
  type GraphData,
  type GraphSource,
  type NodeType,
} from "./graphData";
import { coloredQueries, nodeFilter, queriesNeedContent } from "./graphFilter";
import type { NoteInfo } from "./graphSearch";
import { GraphRenderer, displayName, type Camera, type KeyAction } from "./graphRenderer";
import { defaultGraphState, type GraphViewState } from "./graphState";
import { NodeCard } from "./nodeCard";
import { mergeOverlays, type GraphOverlay } from "./overlay";
import { isAttachment, noteInfo, vaultSource } from "./vaultSource";
import type GraphPlusPlugin from "./main";

export const HOVER_SOURCE = "graph-plus";

/** What a view gives the controller: where to draw and how to persist. */
export type ControllerOwner = {
  view: ItemView & HoverParent;
  /** State changed; save it (layout or file). */
  onStateChange: () => void;
  /** The layout settled or the camera moved; a file view saves positions. */
  onLayoutChange?: () => void;
};

const KEYS: Record<string, KeyAction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Equal: "zoomin",
  NumpadAdd: "zoomin",
  Minus: "zoomout",
  NumpadSubtract: "zoomout",
};

/**
 * Everything a Graph Plus view does, independent of which view hosts it (a
 * vault graph, a local graph or a `.graph` file): builds the data the way
 * core does, drives the renderer and the settings panel, handles clicks,
 * hover previews, the timelapse, overlays and the node card.
 *
 * It is a child component of its view, so its event handlers go away with
 * it when a file view swaps files, not only when the view closes.
 */
export class GraphController extends Component {
  state: GraphViewState;
  readonly sim = new ForceSimulation();
  readonly renderer: GraphRenderer;
  readonly controls: GraphControls;
  readonly host: HTMLElement;
  private emptyEl: HTMLElement;
  private card: NodeCard | null = null;
  private lastPlacement = "";
  private overlays = new Map<string, GraphOverlay>();
  private focusedFile = "";
  private progression = 0;
  private lastData: GraphData | null = null;
  private loadingContent = false;
  private destroyed = false;
  /** The search last rendered, to debounce typing (the panel edits state in place). */
  private lastSearch: string;
  /** What the vault looked like at the last change; rebuilt only when it changes. */
  private source: GraphSource | null = null;
  private notes = new Map<string, NoteInfo>();
  private renderSoon = debounce(() => this.render(), 300, true);
  private searchSoon = debounce(() => this.render(), 250, true);

  constructor(
    private plugin: GraphPlusPlugin,
    contentEl: HTMLElement,
    private owner: ControllerOwner,
    state: GraphViewState,
  ) {
    super();
    this.state = state;
    this.lastSearch = state.filters.search;
    const { app } = plugin;
    const view = owner.view;
    contentEl.addClass("graph-plus-content");
    this.host = contentEl.createDiv({ cls: "graph-plus-view" });
    this.renderer = new GraphRenderer(this.host, this.sim);
    this.sim.setForces(state.forces);
    this.renderer.setRenderOptions(state.display);
    this.renderer.onNodeClick = (id, type, e) => this.onNodeClick(id, type, e);
    this.renderer.onNodeRightClick = (id, type, e) => this.nodeMenu(id, type, e);
    this.renderer.onNodeHover = (id, type, e) => this.onNodeHover(id, type, e);
    this.renderer.onBackgroundClick = () => this.select(null);
    this.renderer.onSelectedMoved = (anchor) => this.placeCard(anchor);
    this.renderer.onSettled = () => owner.onLayoutChange?.();
    this.renderer.onCameraChange = () => this.cameraMoved();
    this.emptyEl = this.host.createDiv({ cls: "graph-plus-empty is-hidden" });
    this.controls = new GraphControls(app, this.host, this.state, {
      onFilters: (filters) => {
        const searchChanged = filters.search !== this.lastSearch;
        this.lastSearch = filters.search;
        this.state.filters = filters;
        if (searchChanged) this.searchSoon();
        else this.render();
        this.changed();
      },
      onLocal: (local) => {
        this.state.local = local;
        this.render();
        this.changed();
      },
      onGroups: (groups) => {
        this.state.groups = groups;
        this.searchSoon();
        this.changed();
      },
      onDisplay: (display) => {
        this.state.display = display;
        this.renderer.setRenderOptions(display);
        this.changed();
      },
      onForces: (forces) => {
        this.state.forces = forces;
        this.sim.setForces(forces);
        this.renderer.changed();
        this.changed();
      },
      onCollapsed: (collapsed) => {
        this.state.collapsed = collapsed;
        this.changed();
      },
      onSection: () => this.changed(),
      onReset: () => this.reset(),
      onAnimate: () => void this.animate(),
      onAddNote: (file) => this.addMembers([file.path]),
      onAddActive: () => {
        const active = app.workspace.getActiveFile();
        if (active) this.addMembers([active.path]);
      },
      onClearSandbox: () => {
        this.state.members = [];
        this.render();
        this.changed();
      },
    });

    const vaultChanged = (): void => {
      this.invalidate();
      this.renderSoon();
    };
    this.registerEvent(app.metadataCache.on("resolved", vaultChanged));
    this.registerEvent(app.vault.on("rename", vaultChanged));
    this.registerEvent(app.vault.on("delete", vaultChanged));
    this.registerEvent(app.workspace.on("css-change", () => this.renderer.refreshTheme()));
    this.registerEvent(
      app.workspace.on("file-open", (file) => {
        const path = file?.path ?? "";
        if (path === this.focusedFile) return;
        this.focusedFile = path;
        this.render();
      }),
    );
    // Listen on the view's own window, so keys work in a pop-out too.
    const onKey = (e: KeyboardEvent): void => this.onKey(e);
    this.registerDomEvent(this.host.win, "keydown", onKey);
    this.registerDomEvent(this.host.win, "keyup", onKey);
    this.focusedFile = app.workspace.getActiveFile()?.path ?? "";
    view.addChild(this);
  }

  /** Tears the graph down and drops its handlers. */
  destroy(): void {
    this.owner.view.removeChild(this);
  }

  onunload(): void {
    this.destroyed = true;
    this.progression = 0;
    this.closeCard();
    this.renderer.destroy();
  }

  /** Forgets the cached vault snapshot after the vault or file contents change. */
  private invalidate(): void {
    this.source = null;
    this.notes.clear();
  }

  private note(path: string): NoteInfo {
    let info = this.notes.get(path);
    if (!info) {
      info = noteInfo(this.plugin.app, path, this.plugin.contentIndex);
      this.notes.set(path, info);
    }
    return info;
  }

  /** Replaces the whole state, e.g. restored from the workspace or a file. */
  setState(state: GraphViewState): void {
    this.state = state;
    this.lastSearch = state.filters.search;
    this.sim.setForces(state.forces);
    this.renderer.setRenderOptions(state.display);
    this.controls.setState(state);
    this.render();
  }

  /** Replaces the state as a user change, so it is saved (e.g. copied settings). */
  update(state: GraphViewState): void {
    this.setState(state);
    this.changed();
  }

  private changed(): void {
    this.owner.onStateChange();
  }

  private cameraMoved(): void {
    this.state.scale = this.renderer.zoom;
    this.cameraSaveSoon();
  }

  private cameraSaveSoon = debounce(
    () => {
      this.changed();
      this.owner.onLayoutChange?.();
    },
    2000,
    true,
  );

  private reset(): void {
    const fresh = defaultGraphState(this.state.mode);
    this.setState({
      ...fresh,
      members: this.state.members,
      localFile: this.state.localFile,
      collapsed: false,
      scale: this.state.scale,
    });
    this.changed();
  }

  /** Paints an overlay layer on the graph; null removes the layer. */
  setOverlay(key: string, overlay: GraphOverlay | null): void {
    if (overlay) this.overlays.set(key, overlay);
    else this.overlays.delete(key);
    this.renderer.setOverlay(mergeOverlays(this.overlays.values()));
  }

  addMembers(paths: string[]): void {
    const members = new Set(this.state.members);
    for (const path of paths) members.add(path);
    this.state.members = [...members];
    this.render();
    this.changed();
  }

  /** Builds the graph like core and hands it to the renderer; returns the link count. */
  render(): number {
    if (this.destroyed) return 0;
    const { app } = this.plugin;
    const { state } = this;
    const isLocal = state.mode === "local";
    if (isLocal) this.progression = 0;
    if (isLocal && !state.localFile) {
      this.renderer.setData({ nodes: new Map(), links: [], weights: new Map() });
      this.showEmpty("Open a note to see its local graph.");
      return 0;
    }
    const source = (this.source ??= vaultSource(app));
    const queries = coloredQueries(state.filters.search, state.groups);
    const content = this.plugin.contentIndex;
    if (queriesNeedContent(queries) && !content.complete && !this.loadingContent) {
      // Like core, show what matches so far and fill in as contents load.
      this.loadingContent = true;
      this.controls.setSearching(true);
      void content.loadAll().then(() => {
        this.loadingContent = false;
        this.notes.clear();
        this.controls.setSearching(false);
        this.render();
      });
    }
    let scope: Set<string> | null = null;
    if (state.mode === "sandbox") {
      // A sandbox shows its notes and the attachments they link to.
      scope = new Set(state.members);
      for (const member of state.members) {
        for (const to of Object.keys(source.resolvedLinks[member] ?? {})) {
          if (isAttachment(to)) scope.add(to);
        }
      }
    }
    const filter = nodeFilter(queries, (path) => this.note(path), {
      localFile: isLocal ? state.localFile : null,
      scope,
    });
    const built = buildGraph(source, state.filters, filter, this.progression);
    let graph = built.graph;
    if (isLocal && state.localFile) graph = localGraph(graph, state.localFile, state.local);
    if (!state.filters.showOrphans && !isLocal) removeOrphans(graph);
    const focused = graph.nodes.get(this.focusedFile);
    if (focused) focused.type = "focused";
    const data = toGraphData(graph);
    this.lastData = data;
    this.renderer.setData(data);
    if (state.mode === "sandbox" && state.members.length === 0) {
      this.showEmpty(
        "This sandbox is empty. Add a note from the settings panel, or right-click a note in another graph.",
      );
    } else this.showEmpty(null);
    return built.numLinks;
  }

  private showEmpty(text: string | null): void {
    this.emptyEl.toggleClass("is-hidden", text === null);
    if (text) this.emptyEl.setText(text);
  }

  /** Core's timelapse: replays the vault's links in file-creation order. */
  async animate(): Promise<void> {
    if (this.state.mode === "local") return;
    this.progression = 1;
    const numLinks = this.render();
    const speed = progressionSpeed(numLinks);
    const start = Date.now();
    const win = this.host.win;
    while (this.progression > 0 && !this.destroyed) {
      const current = this.progression;
      await new Promise((resolve) => win.setTimeout(resolve, 0));
      if (current !== this.progression) return;
      const next = 1 + Math.floor((speed * (Date.now() - start)) / 1000);
      if (next === this.progression) continue;
      if (next > numLinks) {
        this.progression = 0;
        this.render();
        return;
      }
      this.progression = next;
      this.render();
    }
  }

  private onKey(e: KeyboardEvent): void {
    const action = KEYS[e.code];
    if (!action) return;
    const down = e.type === "keydown";
    if (down) {
      const doc = this.host.doc;
      const active = this.plugin.app.workspace.getActiveViewOfType(ItemView);
      if (
        e.repeat ||
        e.defaultPrevented ||
        active !== this.owner.view ||
        doc.activeElement !== doc.body
      ) {
        return;
      }
    }
    this.renderer.setKey(action, down, e.shiftKey);
  }

  private onNodeClick(id: string, type: NodeType, event: MouseEvent): void {
    const { app } = this.plugin;
    if (type === "tag") {
      openGlobalSearch(this.plugin, `tag:${id}`);
      return;
    }
    if (this.plugin.settings.nodeClick === "card" && !Keymap.isModEvent(event)) {
      this.select(id);
      return;
    }
    void app.workspace.openLinkText(id, "", Keymap.isModEvent(event));
  }

  private onNodeHover(id: string, type: NodeType, event: MouseEvent): void {
    if (type !== "" && type !== "focused" && type !== "attachment") return;
    this.plugin.app.workspace.trigger("hover-link", {
      event,
      source: HOVER_SOURCE,
      hoverParent: this.owner.view,
      targetEl: null,
      linktext: id,
    });
  }

  private nodeMenu(id: string, type: NodeType, event: MouseEvent): void {
    const { app } = this.plugin;
    if (type === "tag") {
      openGlobalSearch(this.plugin, `tag:${id}`);
      return;
    }
    const file = app.metadataCache.getFirstLinkpathDest(id, "");
    const sandbox = this.state.mode === "sandbox";
    if (!file && !sandbox) return;
    const menu = new Menu();
    if (file) {
      menu.addItem((item) =>
        item.setSection("title").setTitle(file.basename).setIsLabel(true),
      );
      menu.addItem((item) =>
        item
          .setSection("open")
          .setTitle("Open in new tab")
          .setIcon("lucide-file-plus")
          .onClick(() => void app.workspace.getLeaf("tab").openFile(file)),
      );
      if (this.plugin.settings.nodeClick === "card") {
        menu.addItem((item) =>
          item
            .setSection("open")
            .setTitle("Show card")
            .setIcon("panel-right")
            .onClick(() => this.select(id)),
        );
      }
    }
    if (sandbox) {
      menu.addItem((item) =>
        item
          .setSection("action")
          .setTitle("Add linked notes")
          .setIcon("git-fork")
          .onClick(() => this.addMembers(linkedNotes(vaultSource(app), id))),
      );
      if (this.state.members.includes(id)) {
        menu.addItem((item) =>
          item
            .setSection("action")
            .setTitle("Remove from sandbox")
            .setIcon("x")
            .onClick(() => {
              this.state.members = this.state.members.filter((m) => m !== id);
              this.render();
              this.changed();
            }),
        );
      }
    }
    if (file) {
      app.workspace.trigger("file-menu", menu, file, "graph-context-menu", this.owner.view.leaf);
      menu.addItem((item) => {
        item
          .setSection("danger")
          .setTitle("Delete file")
          .setIcon("lucide-trash-2")
          .onClick(() => void app.fileManager.promptForDeletion(file));
        item.setWarning(true);
      });
    }
    menu.showAtMouseEvent(event);
  }

  /** Selects a node: highlights it, eases the view to it and shows its card. */
  select(id: string | null): void {
    this.renderer.select(id);
    if (!id) {
      this.closeCard();
      return;
    }
    this.renderer.focus(id);
    if (!this.card) {
      this.card = new NodeCard(this.plugin.app, this.host, {
        onSelect: (next) => this.select(next),
        onOpen: (path, e) =>
          void this.plugin.app.workspace.openLinkText(path, "", Keymap.isModEvent(e) || "tab"),
        onClose: () => this.select(null),
      });
      this.card.load();
    }
    this.card.show(id);
  }

  private closeCard(): void {
    this.renderer.select(null);
    this.card?.unload();
    this.card = null;
    this.lastPlacement = "";
  }

  /** Keeps the card beside the selected node as the view pans and zooms. */
  private placeCard(anchor: { x: number; y: number; r: number } | null): void {
    const card = this.card?.el;
    if (!card) return;
    if (!anchor) {
      card.addClass("is-hidden");
      return;
    }
    // Keep clear of the settings panel when it's open.
    const panel = this.controls.el;
    const panelWidth = panel.hasClass("is-close") ? 0 : panel.offsetWidth + 12;
    const { x, y, side } = cardPlacement(
      anchor,
      { width: this.host.clientWidth - panelWidth, height: this.host.clientHeight },
      { width: card.offsetWidth, height: card.offsetHeight },
    );
    const key = `${Math.round(x)},${Math.round(y)},${side}`;
    if (key === this.lastPlacement) return;
    this.lastPlacement = key;
    card.setCssProps({
      "--graph-plus-card-x": `${Math.round(x)}px`,
      "--graph-plus-card-y": `${Math.round(y)}px`,
    });
    card.removeClass("is-hidden");
  }

  camera(): Camera {
    return this.renderer.getCamera();
  }

  /** Copies the graph as a PNG, like core's "Copy screenshot". */
  async copyScreenshot(): Promise<void> {
    const blob = await this.renderer.screenshot();
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      new Notice("Screenshot copied to the clipboard.");
    } catch (e) {
      new Notice(String(e));
    }
  }

  /** Writes the graph on screen as a `.canvas` file next to `near` and opens it. */
  async exportCanvas(baseName: string): Promise<void> {
    const data = this.lastData;
    if (!data) return;
    const { app } = this.plugin;
    const canvas = toJsonCanvas(data, this.renderer.positions(), displayName);
    const folder = app.fileManager.getNewFileParent("");
    const path = availablePath(app, folder.path, baseName, "canvas");
    const file = await app.vault.create(path, JSON.stringify(canvas, null, "\t"));
    await app.workspace.getLeaf("tab").openFile(file);
  }
}

/** A free path like `folder/Name.ext`, `folder/Name 1.ext`, ... */
export const availablePath = (
  app: GraphPlusPlugin["app"],
  folder: string,
  base: string,
  extension: string,
): string => {
  const prefix = folder && folder !== "/" ? `${folder}/` : "";
  for (let i = 0; ; i++) {
    const path = `${prefix}${base}${i ? ` ${i}` : ""}.${extension}`;
    if (!app.vault.getAbstractFileByPath(path)) return path;
  }
};

type GlobalSearch = { openGlobalSearch: (query: string) => void };
type InternalPlugins = {
  internalPlugins?: {
    getEnabledPluginById?: (id: string) => GlobalSearch | null;
  };
};

/** Clicking a tag opens core search for it, as core's graph does (if search is on). */
const openGlobalSearch = (plugin: GraphPlusPlugin, query: string): void => {
  const internal = (plugin.app as unknown as InternalPlugins).internalPlugins;
  internal?.getEnabledPluginById?.("global-search")?.openGlobalSearch(query);
};

