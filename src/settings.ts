import { PluginSettingTab, Setting, type App } from "obsidian";
import type GraphPlusPlugin from "./main";

export type GraphPlusSettings = {
  /** What a plain click on a node does; Cmd/Ctrl-click always opens the note. */
  nodeClick: "open" | "card";
};

export const DEFAULT_SETTINGS: GraphPlusSettings = {
  nodeClick: "open",
};

export class GraphPlusSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: GraphPlusPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Clicking a node")
      .setDesc(
        "Open the note, like the core graph, or select it and show a card with its links and a preview. Holding the modifier key while clicking always opens the note.",
      )
      .addDropdown((d) =>
        d
          .addOption("open", "Opens the note")
          .addOption("card", "Shows a card")
          .setValue(this.plugin.settings.nodeClick)
          .onChange(async (value) => {
            this.plugin.settings.nodeClick = value === "card" ? "card" : "open";
            await this.plugin.saveSettings();
          }),
      );
  }
}
