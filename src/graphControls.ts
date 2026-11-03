import {
  AbstractInputSuggest,
  ColorComponent,
  Setting,
  TextComponent,
  setIcon,
  setTooltip,
  type App,
  type SearchComponent,
  type TFile,
} from "obsidian";
import type { SimForces } from "./forceSim";
import { sliderToStrength, strengthToSlider } from "./forceSliders";
import type { FilterOptions, LocalOptions } from "./graphData";
import { QuerySuggest } from "./querySuggestUi";
import type {
  ColorGroup,
  GraphViewState,
  RenderOptions,
  SectionName,
} from "./graphState";

/**
 * The settings panel, built from core's own markup and class names
 * (`graph-controls`, `graph-control-section`, `setting-item`), so the theme
 * styles it exactly like the core graph's. Labels and tooltips are core's.
 */

export type GraphControlsHandlers = {
  onFilters: (filters: FilterOptions) => void;
  onLocal: (local: LocalOptions) => void;
  onGroups: (groups: ColorGroup[]) => void;
  onDisplay: (display: RenderOptions) => void;
  onForces: (forces: SimForces) => void;
  onCollapsed: (collapsed: boolean) => void;
  onSection: (name: SectionName, collapsed: boolean) => void;
  onReset: () => void;
  onAnimate: () => void;
  /** Sandbox only. */
  onAddNote: (file: TFile) => void;
  onAddActive: () => void;
  onClearSandbox: () => void;
};

const toRgb = (rgb: number) => ({
  r: (rgb >> 16) & 255,
  g: (rgb >> 8) & 255,
  b: rgb & 255,
});

const fromRgb = ({ r, g, b }: { r: number; g: number; b: number }): number =>
  (r << 16) | (g << 8) | b;

/** Suggests Markdown notes by path as you type into the "add a note" box. */
class NoteSuggest extends AbstractInputSuggest<TFile> {
  constructor(
    app: App,
    private input: HTMLInputElement,
    private onPick: (file: TFile) => void,
  ) {
    super(app, input);
  }

  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase();
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.toLowerCase().includes(q))
      .slice(0, 30);
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path.replace(/\.md$/, ""));
  }

  selectSuggestion(file: TFile): void {
    this.input.value = "";
    this.close();
    this.onPick(file);
  }
}

export class GraphControls {
  readonly el: HTMLElement;
  private searchSetting: Setting | null = null;
  private search: SearchComponent | null = null;

  constructor(
    private app: App,
    host: HTMLElement,
    private state: GraphViewState,
    private handlers: GraphControlsHandlers,
  ) {
    this.el = host.createDiv({ cls: "graph-controls" });
    this.el.dataset.ignoreSwipe = "true";
    this.build();
  }

  /** Rebuilds the panel from a new state (reset, or a state restored from disk). */
  setState(state: GraphViewState): void {
    this.state = state;
    this.el.empty();
    this.build();
  }

  /** Shows core's spinner on the search box while file contents load. */
  setSearching(searching: boolean): void {
    this.searchSetting?.settingEl.toggleClass("is-loading", searching);
  }

  /** Opens the panel and focuses the search box, like core's "Search" hotkey. */
  focusSearch(): void {
    this.el.removeClass("is-close");
    this.handlers.onCollapsed(false);
    this.search?.inputEl.focus();
    this.search?.inputEl.select();
  }

  private button(cls: string, icon: string, label: string, run: () => void) {
    const el = this.el.createDiv({
      cls: `clickable-icon graph-controls-button ${cls}`,
    });
    setIcon(el, icon);
    setTooltip(el, label);
    el.addEventListener("click", run);
  }

  private section(name: SectionName, title: string): HTMLElement {
    const section = this.el.createDiv({
      cls: `tree-item graph-control-section mod-${name}`,
    });
    const self = section.createDiv({
      cls: "tree-item-self mod-collapsible",
    });
    const icon = self.createDiv({ cls: "tree-item-icon collapse-icon" });
    setIcon(icon, "right-triangle");
    self
      .createDiv({ cls: "tree-item-inner" })
      .createEl("header", { cls: "graph-control-section-header", text: title });
    const children = section.createDiv({ cls: "tree-item-children" });
    // Core puts `is-collapsed` on the icon (which rotates it) and hides the
    // children itself; mirror both.
    const collapse = (collapsed: boolean): void => {
      icon.toggleClass("is-collapsed", collapsed);
      section.toggleClass("is-collapsed", collapsed);
      if (collapsed) children.hide();
      else children.show();
    };
    collapse(this.state.sections[name]);
    self.addEventListener("click", () => {
      const collapsed = !icon.hasClass("is-collapsed");
      collapse(collapsed);
      this.state.sections[name] = collapsed;
      this.handlers.onSection(name, collapsed);
    });
    return children;
  }

  private build(): void {
    const { state, handlers } = this;
    this.el.toggleClass("is-close", state.collapsed);
    this.button("mod-close", "x", "Close", () => {
      this.el.addClass("is-close");
      handlers.onCollapsed(true);
    });
    this.button("mod-open", "settings", "Open graph settings", () => {
      this.el.removeClass("is-close");
      handlers.onCollapsed(false);
    });
    if (state.mode !== "local") {
      this.button("mod-animate", "wand-2", "Start timelapse animation", () =>
        handlers.onAnimate(),
      );
    }
    this.button("mod-reset", "rotate-ccw", "Restore default settings", () =>
      handlers.onReset(),
    );

    if (state.mode === "sandbox") this.buildSandbox();
    this.buildFilters();
    this.buildGroups();
    this.buildDisplay();
    this.buildForces();
  }

  private buildSandbox(): void {
    const el = this.section("sandbox", "Sandbox");
    new Setting(el).setClass("mod-search-setting").addSearch((search) => {
      search.setPlaceholder("Add a note...");
      new NoteSuggest(this.app, search.inputEl, this.handlers.onAddNote);
    });
    new Setting(el)
      .addButton((b) =>
        b.setButtonText("Add active note").onClick(this.handlers.onAddActive),
      )
      .addButton((b) =>
        b.setButtonText("Clear").onClick(this.handlers.onClearSandbox),
      );
  }

  private buildFilters(): void {
    const el = this.section("filter", "Filters");
    const { filters, local } = this.state;
    const update = (patch: Partial<FilterOptions>): void => {
      Object.assign(this.state.filters, patch);
      this.handlers.onFilters({ ...this.state.filters });
    };
    this.searchSetting = new Setting(el)
      .setClass("mod-search-setting")
      .addSearch((search) => {
        this.search = search;
        search
          .setPlaceholder("Search files...")
          .setValue(filters.search)
          .onChange((value) => update({ search: value }));
        setTooltip(search.clearButtonEl, "Clear search");
        new QuerySuggest(this.app, search.inputEl);
      });

    const toggle = (
      name: string,
      tooltip: string,
      value: boolean,
      onChange: (value: boolean) => void,
    ) =>
      new Setting(el)
        .setName(name)
        .setTooltip(tooltip)
        .setClass("mod-toggle")
        .addToggle((t) => t.setValue(value).onChange(onChange));

    if (this.state.mode === "local") {
      const updateLocal = (patch: Partial<LocalOptions>): void => {
        Object.assign(this.state.local, patch);
        this.handlers.onLocal({ ...this.state.local });
      };
      new Setting(el)
        .setName("Depth")
        .setTooltip("Show nodes this number of links away")
        .setClass("mod-slider")
        .addSlider((s) =>
          s
            .setLimits(1, 5, 1)
            .setValue(local.localJumps)
            .setInstant(true)
            .onChange((v) => updateLocal({ localJumps: v })),
        );
      toggle(
        "Incoming links",
        "Show links from other files",
        local.localBacklinks,
        (v) => updateLocal({ localBacklinks: v }),
      );
      toggle(
        "Outgoing links",
        "Show links to other files",
        local.localForelinks,
        (v) => updateLocal({ localForelinks: v }),
      );
      toggle(
        "Neighbor links",
        "Show links between neighbors",
        local.localInterlinks,
        (v) => updateLocal({ localInterlinks: v }),
      );
    }
    toggle(
      "Tags",
      "Tags are linked to the files that contain them",
      filters.showTags,
      (v) => update({ showTags: v }),
    );
    toggle("Attachments", "Show attachments", filters.showAttachments, (v) =>
      update({ showAttachments: v }),
    );
    toggle(
      "Existing files only",
      "When enabled, links to nonexistent files are not shown",
      filters.hideUnresolved,
      (v) => update({ hideUnresolved: v }),
    );
    if (this.state.mode !== "local") {
      toggle(
        "Orphans",
        "Show files that are not linked to any other file",
        filters.showOrphans,
        (v) => update({ showOrphans: v }),
      );
    }
  }

  private buildGroups(): void {
    const el = this.section("color-groups", "Groups");
    const groups = this.state.groups;
    const rows = el.createDiv({ cls: "graph-color-groups-container" });
    const commit = (): void =>
      this.handlers.onGroups(groups.map((g) => ({ ...g })));
    const rowEls: HTMLElement[] = [];
    groups.forEach((group, index) => {
      // Core's row: a bare text field, a color swatch and a delete icon.
      const row = rows.createDiv({ cls: "graph-color-group" });
      rowEls.push(row);
      const query = new TextComponent(row)
        .setPlaceholder("Enter query...")
        .setValue(group.query)
        .onChange((value) => {
          group.query = value;
          commit();
        });
      new QuerySuggest(this.app, query.inputEl);
      const color = new ColorComponent(row)
        .setValueRgb(toRgb(group.rgb))
        .onChange(() => {
          group.rgb = fromRgb(color.getValueRgb());
          commit();
        });
      const picker = row.querySelector<HTMLInputElement>("input[type=color]");
      if (picker) {
        setTooltip(picker, "Click to change color\nDrag to reorder groups");
        picker.addEventListener("pointerdown", (e) =>
          this.dragGroup(e, index, rowEls, groups, commit),
        );
      }
      const remove = row.createDiv({ cls: "clickable-icon" });
      setIcon(remove, "x");
      setTooltip(remove, "Delete group");
      remove.addEventListener("click", () => {
        groups.splice(index, 1);
        commit();
        this.setState(this.state);
      });
    });
    el.createDiv({ cls: "graph-color-button-container" }).createEl(
      "button",
      { text: "New group" },
      (button) =>
        button.addEventListener("click", () => {
          const dark = button.doc.body.hasClass("theme-dark");
          groups.push({
            query: "",
            rgb: hslColor((groups.length * 360) / 9, dark ? 0.7 : 0.6, 0.6),
          });
          commit();
          this.setState(this.state);
        }),
    );
  }

  /** Core lets you drag a group by its color swatch to reorder it. */
  private dragGroup(
    start: PointerEvent,
    index: number,
    rowEls: HTMLElement[],
    groups: ColorGroup[],
    commit: () => void,
  ): void {
    const picker = start.currentTarget as HTMLElement;
    const doc = picker.doc;
    let dragging = false;
    let target = index;
    const move = (e: PointerEvent): void => {
      if (!dragging && Math.abs(e.clientY - start.clientY) < 5) return;
      if (!dragging) {
        dragging = true;
        rowEls[index]?.addClass("is-dragging");
      }
      target = index;
      rowEls.forEach((row, i) => {
        const box = row.getBoundingClientRect();
        if (e.clientY > box.top + box.height / 2) target = i;
        else if (i === 0 && e.clientY <= box.top + box.height / 2) target = 0;
      });
      if (e.clientY < (rowEls[0]?.getBoundingClientRect().top ?? 0)) target = 0;
    };
    const stop = (): void => {
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", stop);
      if (!dragging) return;
      rowEls[index]?.removeClass("is-dragging");
      if (target !== index) {
        const [moved] = groups.splice(index, 1);
        if (moved) groups.splice(target, 0, moved);
        commit();
        this.setState(this.state);
      }
    };
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", stop);
  }

  private buildDisplay(): void {
    const el = this.section("display", "Display");
    const { display } = this.state;
    const update = (patch: Partial<RenderOptions>): void => {
      Object.assign(this.state.display, patch);
      this.handlers.onDisplay({ ...this.state.display });
    };
    new Setting(el)
      .setName("Arrows")
      .setTooltip("Show arrows when zoomed in")
      .setClass("mod-toggle")
      .addToggle((t) =>
        t.setValue(display.showArrow).onChange((v) => update({ showArrow: v })),
      );
    const slider = (
      name: string,
      key: "textFadeMultiplier" | "nodeSizeMultiplier" | "lineSizeMultiplier",
      min: number,
      max: number,
      step: number | "any",
    ) =>
      new Setting(el)
        .setName(name)
        .setClass("mod-slider")
        .addSlider((s) =>
          s
            .setLimits(min, max, step)
            .setValue(display[key])
            .setInstant(true)
            .onChange((v) => update({ [key]: v })),
        );
    slider("Text fade threshold", "textFadeMultiplier", -3, 3, 0.1);
    slider("Node size", "nodeSizeMultiplier", 0.1, 5, "any");
    slider("Link thickness", "lineSizeMultiplier", 0.1, 5, "any");
    if (this.state.mode !== "local") {
      new Setting(el).addButton((b) =>
        b
          .setButtonText("Animate")
          .onClick(() => this.handlers.onAnimate()),
      );
    }
  }

  private buildForces(): void {
    const el = this.section("forces", "Forces");
    const { forces } = this.state;
    const update = (patch: Partial<SimForces>): void => {
      Object.assign(this.state.forces, patch);
      this.handlers.onForces({ ...this.state.forces });
    };
    const slider = (
      name: string,
      key: keyof SimForces,
      min: number,
      max: number,
      step: number | "any",
      curved = false,
    ) =>
      new Setting(el)
        .setName(name)
        .setClass("mod-slider")
        .addSlider((s) =>
          s
            .setLimits(min, max, step)
            .setValue(curved ? strengthToSlider(forces[key]) : forces[key])
            .setInstant(true)
            .onChange((v) =>
              update({ [key]: curved ? sliderToStrength(v) : v }),
            ),
        );
    slider("Center force", "centerStrength", 0, 1, "any", true);
    slider("Repel force", "repelStrength", 0, 20, "any");
    slider("Link force", "linkStrength", 0, 1, "any", true);
    slider("Link distance", "linkDistance", 30, 500, 1);
  }
}

/**
 * Core's new-group colors step the hue around the wheel (40 degrees each),
 * a little more saturated in dark mode.
 */
const hslColor = (hue: number, s: number, l: number): number => {
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return fromRgb({
    r: Math.round(f(0) * 255),
    g: Math.round(f(8) * 255),
    b: Math.round(f(4) * 255),
  });
};
