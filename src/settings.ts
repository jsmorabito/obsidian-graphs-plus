import {
  PluginSettingTab,
  Setting,
  type App,
  type SettingDefinitionItem,
} from "obsidian";
import type GraphPlusPlugin from "./main";

export type GraphPlusSettings = {
  /** What a plain click on a node does; Cmd/Ctrl-click always opens the note. */
  nodeClick: "open" | "card";
};

export const DEFAULT_SETTINGS: GraphPlusSettings = {
  nodeClick: "open",
};

const NODE_CLICK = {
  name: "Clicking a node",
  desc: "Open the note, like the core graph, or select it and show a card with its links and a preview. Holding the modifier key while clicking always opens the note.",
  options: { open: "Opens the note", card: "Shows a card" },
};

export class GraphPlusSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: GraphPlusPlugin,
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
    ];
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
  }
}
