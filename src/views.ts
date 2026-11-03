import {
  ItemView,
  Menu,
  Notice,
  TFile,
  TextFileView,
  type HoverPopover,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { GraphController, availablePath } from "./graphController";
import {
  GRAPH_EXTENSION,
  GraphFileError,
  parseGraphFile,
  positionsChanged,
  serializeGraphFile,
} from "./graphFile";
import { displayName } from "./graphRenderer";
import {
  defaultGraphState,
  fromCoreOptions,
  normalizeGraphState,
  type GraphMode,
  type GraphViewState,
} from "./graphState";
import type GraphsPlusPlugin from "./main";

export const VIEW_TYPE_GRAPH = "graphs-plus";
export const VIEW_TYPE_LOCAL = "graphs-plus-local";
export const VIEW_TYPE_FILE = "graphs-plus-file";
export const VIEW_TYPES = [VIEW_TYPE_GRAPH, VIEW_TYPE_LOCAL, VIEW_TYPE_FILE];
/** Core's graph view icon. */
export const ICON = "git-fork";

/** Refreshes the tab and view titles; not public API, so only when it exists. */
const updateHeader = (leaf: WorkspaceLeaf): void => {
  (leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
  const view = leaf.view as unknown as { titleEl?: HTMLElement };
  view.titleEl?.setText(leaf.view.getDisplayText());
};

/** Any view that hosts a graph. */
export interface GraphHost {
  controller: GraphController | null;
}

export const isGraphHost = (view: unknown): view is GraphHost & ItemView =>
  view instanceof GraphsPlusView ||
  view instanceof LocalGraphView ||
  view instanceof GraphFileView;

/** Pane-menu items every graph view shares, like core's "Copy screenshot". */
const addGraphMenuItems = (
  plugin: GraphsPlusPlugin,
  menu: Menu,
  controller: GraphController | null,
  name: string,
  saveAs: boolean,
): void => {
  menu.addItem((item) =>
    item
      .setSection("action")
      .setTitle("Copy screenshot")
      .setIcon("lucide-image")
      .setDisabled(!controller)
      .onClick(() => void controller?.copyScreenshot()),
  );
  if (saveAs) {
    menu.addItem((item) =>
      item
        .setSection("action")
        .setTitle("Save as graph file")
        .setIcon("save")
        .setDisabled(!controller)
        .onClick(() => controller && void saveAsGraphFile(plugin, controller, name)),
    );
  }
  menu.addItem((item) =>
    item
      .setSection("action")
      .setTitle("Export as canvas")
      .setIcon("layout-dashboard")
      .setDisabled(!controller)
      .onClick(() => void controller?.exportCanvas(name)),
  );
  menu.addItem((item) =>
    item
      .setSection("action")
      .setTitle("Copy settings from core graph")
      .setIcon("download")
      .setDisabled(!controller)
      .onClick(() => controller && void copyCoreSettings(plugin, controller)),
  );
};

/** Writes the view's state, camera and layout to a new `.graph` file and opens it. */
export const saveAsGraphFile = async (
  plugin: GraphsPlusPlugin,
  controller: GraphController,
  name: string,
): Promise<void> => {
  const { app } = plugin;
  const folder = app.fileManager.getNewFileParent("");
  const path = availablePath(app, folder.path, name, GRAPH_EXTENSION);
  const text = serializeGraphFile({
    state: controller.state,
    camera: controller.camera(),
    positions: controller.renderer.positions(),
  });
  const file = await app.vault.create(path, text);
  await app.workspace.getLeaf("tab").openFile(file);
};

/** Applies the core graph's saved settings (`graph.json`) to a view. */
export const copyCoreSettings = async (
  plugin: GraphsPlusPlugin,
  controller: GraphController,
): Promise<void> => {
  const { adapter, configDir } = plugin.app.vault;
  try {
    const options: unknown = JSON.parse(await adapter.read(`${configDir}/graph.json`));
    controller.update(fromCoreOptions(controller.state, options));
    new Notice("Copied the core graph's settings.");
  } catch {
    new Notice("Couldn't read the core graph's settings.");
  }
};

/**
 * The graph view: the whole vault like core's graph view, or a sandbox that
 * starts empty and shows only the notes you add. Its state lives in the
 * workspace layout.
 */
export class GraphsPlusView extends ItemView implements GraphHost {
  controller: GraphController | null = null;
  hoverPopover: HoverPopover | null = null;
  private state: GraphViewState = defaultGraphState();

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: GraphsPlusPlugin,
  ) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return VIEW_TYPE_GRAPH;
  }

  getDisplayText(): string {
    return this.state.mode === "sandbox" ? "Graphs Plus sandbox" : "Graphs Plus";
  }

  getIcon(): string {
    return ICON;
  }

  getState(): Record<string, unknown> {
    const state = this.controller?.state ?? this.state;
    return { ...super.getState(), ...state };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.state = normalizeGraphState(state);
    await super.setState(state, result);
    if (this.controller) {
      this.controller.setState(this.state);
    } else this.mount();
  }

  onOpen(): Promise<void> {
    // setState usually follows; open now in case it doesn't.
    window.setTimeout(() => this.mount(), 0);
    return Promise.resolve();
  }

  private mount(): void {
    if (this.controller) return;
    this.contentEl.empty();
    this.controller = new GraphController(
      this.plugin,
      this.contentEl,
      {
        view: this,
        onStateChange: () => this.app.workspace.requestSaveLayout(),
      },
      this.state,
    );
    this.controller.renderer.setInitialCamera(
      this.state.scale ? { scale: this.state.scale } : "fit",
    );
    this.controller.render();
  }

  onClose(): Promise<void> {
    this.controller?.destroy();
    this.controller = null;
    return Promise.resolve();
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    addGraphMenuItems(this.plugin, menu, this.controller, this.getDisplayText(), true);
  }
}

/**
 * The local graph: the active note and its neighbors, like core's local
 * graph. It follows the active note unless the tab is pinned.
 */
export class LocalGraphView extends ItemView implements GraphHost {
  controller: GraphController | null = null;
  hoverPopover: HoverPopover | null = null;
  private state: GraphViewState = defaultGraphState("local");

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: GraphsPlusPlugin,
  ) {
    super(leaf);
    this.navigation = false;
  }

  getViewType(): string {
    return VIEW_TYPE_LOCAL;
  }

  getDisplayText(): string {
    const file = this.controller?.state.localFile ?? this.state.localFile;
    return file ? `Graph of ${displayName(file, "")}` : "Graphs Plus local graph";
  }

  getIcon(): string {
    return ICON;
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), ...(this.controller?.state ?? this.state) };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const next = normalizeGraphState({ ...(state as object), mode: "local" });
    this.state = next;
    await super.setState(state, result);
    if (this.controller) this.controller.setState(next);
    else this.mount();
    updateHeader(this.leaf);
  }

  onOpen(): Promise<void> {
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file || this.leaf.getViewState().pinned) return;
        if (file.path === this.controller?.state.localFile) return;
        if (this.controller) {
          this.controller.state.localFile = file.path;
          this.controller.renderer.resetPan();
          this.controller.render();
          updateHeader(this.leaf);
          this.app.workspace.requestSaveLayout();
        }
      }),
    );
    window.setTimeout(() => this.mount(), 0);
    return Promise.resolve();
  }

  private mount(): void {
    if (this.controller) return;
    this.contentEl.empty();
    if (!this.state.localFile) {
      this.state.localFile = this.app.workspace.getActiveFile()?.path ?? null;
    }
    this.controller = new GraphController(
      this.plugin,
      this.contentEl,
      {
        view: this,
        onStateChange: () => this.app.workspace.requestSaveLayout(),
      },
      this.state,
    );
    this.controller.renderer.setInitialCamera(
      this.state.scale ? { scale: this.state.scale } : "fit",
    );
    this.controller.render();
    updateHeader(this.leaf);
  }

  onClose(): Promise<void> {
    this.controller?.destroy();
    this.controller = null;
    return Promise.resolve();
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    addGraphMenuItems(this.plugin, menu, this.controller, this.getDisplayText(), true);
  }
}

/**
 * A `.graph` file: a saved graph view. Everything you change (filters,
 * groups, forces, sandbox notes, camera, layout) is saved back to the file.
 */
export class GraphFileView extends TextFileView implements GraphHost {
  controller: GraphController | null = null;
  hoverPopover: HoverPopover | null = null;
  /** Set when the file isn't ours; we then never write to it. */
  private error: string | null = null;
  private lastPositions = new Map<string, { x: number; y: number }>();
  /**
   * You changed something here (settings, a drag, the camera) and the
   * layout that follows should be saved. A layout that settles after a
   * change from elsewhere (the same file open in another tab) is never
   * written back, or the two tabs would keep saving over each other.
   */
  private layoutDirty = false;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: GraphsPlusPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_FILE;
  }

  getIcon(): string {
    return ICON;
  }

  canAcceptExtension(extension: string): boolean {
    return extension === GRAPH_EXTENSION;
  }

  getViewData(): string {
    if (this.error || !this.controller) return this.data;
    const positions = this.controller.renderer.positions();
    this.lastPositions = positions;
    return serializeGraphFile({
      state: this.controller.state,
      camera: this.controller.camera(),
      positions,
    });
  }

  setViewData(data: string, clear: boolean): void {
    this.data = data;
    let parsed;
    try {
      parsed = parseGraphFile(data);
      this.error = null;
    } catch (e) {
      this.error = e instanceof GraphFileError ? e.message : String(e);
      this.controller?.destroy();
      this.controller = null;
      this.contentEl.empty();
      this.contentEl.createDiv({ cls: "graphs-plus-empty", text: this.error });
      return;
    }
    if (this.controller && !clear) {
      // Changed elsewhere (another tab, or by hand): apply new settings and
      // keep this tab's own layout and camera. A change of layout or camera
      // alone needs nothing here.
      const settings = (state: GraphViewState): string =>
        serializeGraphFile({ state, camera: null, positions: new Map() });
      if (settings(parsed.state) !== settings(this.controller.state)) {
        this.controller.setState(parsed.state);
      }
      return;
    }
    this.controller?.destroy();
    this.contentEl.empty();
    const controller = new GraphController(
      this.plugin,
      this.contentEl,
      {
        view: this,
        onStateChange: () => {
          this.layoutDirty = true;
          this.requestSave();
        },
        onLayoutChange: () => {
          if (!this.controller || !this.layoutDirty) return;
          this.layoutDirty = false;
          if (positionsChanged(this.controller.renderer.positions(), this.lastPositions)) {
            this.requestSave();
          }
        },
      },
      parsed.state,
    );
    this.controller = controller;
    this.lastPositions = parsed.positions;
    if (parsed.positions.size > 0) controller.sim.seed(parsed.positions);
    controller.renderer.setInitialCamera(
      parsed.camera ?? (parsed.state.scale ? { scale: parsed.state.scale } : "fit"),
    );
    controller.render();
    if (parsed.positions.size > 0) {
      // A saved layout opens exactly as saved; it only warms up to place
      // notes added to the vault since.
      const placed = controller.sim.nodes.every((n) => parsed.positions.has(n.id));
      controller.sim.alpha = placed ? 0 : 0.1;
    }
  }

  clear(): void {
    this.controller?.destroy();
    this.controller = null;
    this.contentEl.empty();
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    addGraphMenuItems(
      this.plugin,
      menu,
      this.controller,
      this.file?.basename ?? "Graph",
      false,
    );
  }
}

/** Opens a new graph view of the given mode. */
export const openGraphView = async (
  plugin: GraphsPlusPlugin,
  mode: Exclude<GraphMode, "local">,
  newTab: boolean,
): Promise<void> => {
  const leaf = plugin.app.workspace.getLeaf(newTab ? "tab" : false);
  await leaf.setViewState({
    type: VIEW_TYPE_GRAPH,
    active: true,
    state: { ...defaultGraphState(mode) },
  });
};

/** Opens a local graph of `file` in a split beside the active tab, like core. */
export const openLocalGraph = async (
  plugin: GraphsPlusPlugin,
  file: TFile,
  leaf?: WorkspaceLeaf,
): Promise<void> => {
  const { workspace } = plugin.app;
  const target = leaf
    ? workspace.createLeafBySplit(leaf, "vertical")
    : workspace.getLeaf("split", "vertical");
  await target.setViewState({
    type: VIEW_TYPE_LOCAL,
    active: true,
    state: { ...defaultGraphState("local"), localFile: file.path },
  });
};
