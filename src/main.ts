import { Notice, Plugin, TFile, TFolder } from "obsidian";
import { createApi, type GraphsPlusApi } from "./api";
import { ContentIndex } from "./contentIndex";
import { HOVER_SOURCE, availablePath } from "./graphController";
import { GRAPH_EXTENSION, serializeGraphFile } from "./graphFile";
import { defaultGraphState } from "./graphState";
import { DEFAULT_SETTINGS, GraphsPlusSettingTab, type GraphsPlusSettings } from "./settings";
import {
  GraphFileView,
  GraphsPlusView,
  ICON,
  LocalGraphView,
  VIEW_TYPE_FILE,
  VIEW_TYPE_GRAPH,
  VIEW_TYPE_LOCAL,
  copyCoreSettings,
  isGraphHost,
  openGraphView,
  openLocalGraph,
  saveAsGraphFile,
} from "./views";

export default class GraphsPlusPlugin extends Plugin {
  settings: GraphsPlusSettings = { ...DEFAULT_SETTINGS };
  contentIndex = new ContentIndex(this.app);
  api: GraphsPlusApi = createApi(this);
  private ribbonIconEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.contentIndex.register(this);
    this.addSettingTab(new GraphsPlusSettingTab(this.app, this));

    this.registerView(VIEW_TYPE_GRAPH, (leaf) => new GraphsPlusView(leaf, this));
    this.registerView(VIEW_TYPE_LOCAL, (leaf) => new LocalGraphView(leaf, this));
    this.registerView(VIEW_TYPE_FILE, (leaf) => new GraphFileView(leaf, this));
    try {
      this.registerExtensions([GRAPH_EXTENSION], VIEW_TYPE_FILE);
    } catch {
      // Another plugin (or a future Obsidian) already owns `.graph`.
      new Notice(
        "Graphs Plus: another plugin already opens .graph files, so they won't open as graphs. Everything else still works.",
      );
    }
    this.registerHoverLinkSource(HOVER_SOURCE, {
      display: "Graphs Plus",
      defaultMod: true,
    });

    this.updateRibbonIcon();

    this.addCommand({
      id: "open",
      name: "Open graph view",
      callback: () => void openGraphView(this, "vault", false),
    });
    this.addCommand({
      id: "open-sandbox",
      name: "Open sandbox",
      callback: () => void openGraphView(this, "sandbox", false),
    });
    this.addCommand({
      id: "open-local",
      name: "Open local graph",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) void openLocalGraph(this, file);
        return true;
      },
    });
    this.addCommand({
      id: "new-graph-file",
      name: "Create new graph file",
      callback: () => void this.createGraphFile(),
    });
    this.addCommand({
      id: "new-empty-graph",
      name: "Create new empty graph",
      callback: () => void this.createGraphFile(undefined, "sandbox"),
    });
    this.addCommand({
      id: "animate",
      name: "Start timelapse animation",
      checkCallback: (checking) => {
        const controller = this.activeController();
        if (!controller || controller.state.mode === "local") return false;
        if (!checking) void controller.animate();
        return true;
      },
    });
    this.addCommand({
      id: "search",
      name: "Search in the active graph",
      checkCallback: (checking) => {
        const controller = this.activeController();
        if (!controller) return false;
        if (!checking) controller.controls.focusSearch();
        return true;
      },
    });
    this.addCommand({
      id: "save-as",
      name: "Save the active graph as a graph file",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(GraphsPlusView)
          ?? this.app.workspace.getActiveViewOfType(LocalGraphView);
        const controller = view?.controller;
        if (!view || !controller) return false;
        if (!checking) void saveAsGraphFile(this, controller, view.getDisplayText());
        return true;
      },
    });
    this.addCommand({
      id: "export-canvas",
      name: "Export the active graph as a canvas",
      checkCallback: (checking) => {
        const controller = this.activeController();
        if (!controller) return false;
        if (!checking) void controller.exportCanvas("Graph");
        return true;
      },
    });
    this.addCommand({
      id: "copy-core-settings",
      name: "Copy settings from the core graph into the active graph",
      checkCallback: (checking) => {
        const controller = this.activeController();
        if (!controller) return false;
        if (!checking) void copyCoreSettings(this, controller);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setSection("action-primary")
              .setTitle("New graph")
              .setIcon(ICON)
              .onClick(() => void this.createGraphFile(file)),
          );
          return;
        }
        if (
          file instanceof TFile &&
          file.extension === "md" &&
          source !== "sidebar-context-menu"
        ) {
          menu.addItem((item) =>
            item
              .setSection("view.linked")
              .setTitle("Open local graph in Graphs Plus")
              .setIcon(ICON)
              .onClick(() => void openLocalGraph(this, file, leaf)),
          );
        }
      }),
    );
  }

  private activeController() {
    const leaf = this.app.workspace.getMostRecentLeaf();
    return leaf && isGraphHost(leaf.view) ? leaf.view.controller : null;
  }

  /**
   * Creates `Untitled graph.graph` (in `folder`, or where new notes go) and
   * opens it with its title selected for renaming, like a new canvas. A
   * sandbox graph starts blank; you add notes to it.
   */
  async createGraphFile(folder?: TFolder, mode: "vault" | "sandbox" = "vault"): Promise<void> {
    const parent = folder ?? this.app.fileManager.getNewFileParent("");
    const path = availablePath(this.app, parent.path, "Untitled graph", GRAPH_EXTENSION);
    const text = serializeGraphFile({
      state: defaultGraphState(mode),
      camera: null,
      positions: new Map(),
    });
    const file = await this.app.vault.create(path, text);
    await this.app.workspace.getLeaf("tab").openFile(file, { eState: { rename: "all" } });
  }

  /**
   * Shows or hides the ribbon icon to match `settings.showRibbonIcon`. The icon
   * is only added once it's first wanted, then hidden rather than removed, so
   * toggling never registers duplicate ribbon items.
   */
  updateRibbonIcon(): void {
    const show = this.settings.showRibbonIcon;
    if (show && !this.ribbonIconEl) {
      this.ribbonIconEl = this.addRibbonIcon(ICON, "Open Graphs Plus", (e) =>
        void openGraphView(this, "vault", e.metaKey || e.ctrlKey),
      );
    }
    this.ribbonIconEl?.toggle(show);
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<GraphsPlusSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    // Installs from before this setting existed always had the icon; keep it.
    if (saved && saved.showRibbonIcon === undefined) {
      this.settings.showRibbonIcon = true;
      await this.saveSettings();
    }
  }

  /** Persists the settings and applies the ones that take effect live. */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.updateRibbonIcon();
  }
}
