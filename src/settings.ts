import {
  PluginSettingTab,
  Setting,
  type App,
  type SettingDefinitionItem,
} from "obsidian";
import type GraphsPlusPlugin from "./main";

export type GraphsPlusSettings = {
  /** What a plain click on a node does; Cmd/Ctrl-click always opens the note. */
  nodeClick: "open" | "card";
  /** Show a ribbon icon that opens the graph view. Off by default. */
  showRibbonIcon: boolean;
};

export const DEFAULT_SETTINGS: GraphsPlusSettings = {
  nodeClick: "open",
  showRibbonIcon: false,
};

const RIBBON = {
  name: "Show ribbon icon",
  desc: "Add an icon to the left ribbon that opens Graphs Plus.",
};

const NODE_CLICK = {
  name: "Clicking a node",
  desc: "Open the note, like the core graph, or select it and show a card with its links and a preview. Holding the modifier key while clicking always opens the note.",
  options: { open: "Opens the note", card: "Shows a card" },
};

export class GraphsPlusSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: GraphsPlusPlugin,
  ) {
    super(app, plugin);
  }

  /** Obsidian 1.13+ renders these and indexes them for settings search. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: NODE_CLICK.name,
        desc: NODE_CLICK.desc,
        control: {
          type: "dropdown",
          key: "nodeClick",
          defaultValue: DEFAULT_SETTINGS.nodeClick,
          options: NODE_CLICK.options,
        },
      },
      {
        name: RIBBON.name,
        desc: RIBBON.desc,
        control: {
          type: "toggle",
          key: "showRibbonIcon",
          defaultValue: DEFAULT_SETTINGS.showRibbonIcon,
        },
      },
    ];
  }

  /**
   * Called by Obsidian 1.13+ when a definition control changes. Mirrors the base
   * (assign, then save) but goes through `saveSettings` so live settings apply.
   */
  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
  }

  /** Fallback for Obsidian versions before 1.13, which don't read the definitions. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName(NODE_CLICK.name)
      .setDesc(NODE_CLICK.desc)
      .addDropdown((d) =>
        d
          .addOptions(NODE_CLICK.options)
          .setValue(this.plugin.settings.nodeClick)
          .onChange(async (value) => {
            this.plugin.settings.nodeClick = value === "card" ? "card" : "open";
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName(RIBBON.name)
      .setDesc(RIBBON.desc)
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showRibbonIcon).onChange(async (value) => {
          this.plugin.settings.showRibbonIcon = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
