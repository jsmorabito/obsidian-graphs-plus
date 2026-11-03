import {
  Component,
  MarkdownRenderer,
  TFile,
  setIcon,
  setTooltip,
  type App,
} from "obsidian";
import { displayName } from "./graphRenderer";
import { isAttachment } from "./vaultSource";

export type NodeCardHandlers = {
  onSelect: (id: string) => void;
  onOpen: (id: string, event: MouseEvent) => void;
  onClose: () => void;
};

type Tab = "links" | "preview";

/**
 * The card beside a selected node: its outgoing links and backlinks (click
 * one to move the selection there) and a rendered preview of the note.
 */
export class NodeCard extends Component {
  readonly el: HTMLElement;
  private id: string | null = null;
  private tab: Tab = "links";
  private bodyEl: HTMLElement;
  private titleEl: HTMLElement;
  private tabEls = new Map<Tab, HTMLElement>();
  /** Child component for the preview's Markdown, replaced on every render. */
  private preview: Component | null = null;

  constructor(
    private app: App,
    host: HTMLElement,
    private handlers: NodeCardHandlers,
  ) {
    super();
    this.el = host.createDiv({ cls: "graphs-plus-card is-hidden" });
    const header = this.el.createDiv({ cls: "graphs-plus-card-header" });
    const tabs = header.createDiv({ cls: "graphs-plus-card-tabs" });
    for (const [tab, label] of [
      ["links", "Links"],
      ["preview", "Preview"],
    ] as const) {
      const el = tabs.createEl("button", { text: label });
      el.addEventListener("click", () => {
        this.tab = tab;
        this.render();
      });
      this.tabEls.set(tab, el);
    }
    const actions = header.createDiv({ cls: "graphs-plus-card-actions" });
    const open = actions.createDiv({ cls: "clickable-icon" });
    setIcon(open, "file-text");
    setTooltip(open, "Open note");
    open.addEventListener("click", (e) => {
      if (this.id) this.handlers.onOpen(this.id, e);
    });
    const close = actions.createDiv({ cls: "clickable-icon" });
    setIcon(close, "x");
    setTooltip(close, "Close");
    close.addEventListener("click", () => this.handlers.onClose());
    this.titleEl = this.el.createDiv({ cls: "graphs-plus-card-title" });
    this.bodyEl = this.el.createDiv({ cls: "graphs-plus-card-body" });
  }

  onunload(): void {
    this.el.remove();
  }

  show(id: string): void {
    this.id = id;
    this.render();
  }

  private render(): void {
    const { id } = this;
    if (!id) return;
    for (const [tab, el] of this.tabEls) el.toggleClass("is-active", tab === this.tab);
    this.titleEl.setText(displayName(id, id.startsWith("#") ? "tag" : ""));
    this.bodyEl.empty();
    if (this.preview) {
      this.removeChild(this.preview);
      this.preview = null;
    }
    if (this.tab === "links") this.renderLinks(id);
    else void this.renderPreview(id);
  }

  private linkList(title: string, ids: string[]): void {
    const section = this.bodyEl.createDiv({ cls: "graphs-plus-card-section" });
    section.createDiv({ cls: "graphs-plus-card-section-title", text: title });
    if (ids.length === 0) {
      section.createDiv({ cls: "graphs-plus-card-empty", text: "None" });
      return;
    }
    const list = section.createDiv({ cls: "graphs-plus-card-list" });
    for (const target of ids) {
      const exists = this.app.vault.getAbstractFileByPath(target) instanceof TFile;
      const item = list.createDiv({
        cls: `graphs-plus-card-link${exists ? "" : " is-unresolved"}`,
        text: displayName(target, ""),
      });
      setTooltip(item, target);
      item.addEventListener("click", () => this.handlers.onSelect(target));
    }
  }

  private renderLinks(id: string): void {
    const { resolvedLinks, unresolvedLinks } = this.app.metadataCache;
    const outgoing = [
      ...Object.keys(resolvedLinks[id] ?? {}),
      ...Object.keys(unresolvedLinks[id] ?? {}),
    ].sort();
    const backlinks = Object.entries(resolvedLinks)
      .filter(([from, targets]) => from !== id && id in targets)
      .map(([from]) => from)
      .sort();
    this.linkList("Outgoing links", outgoing);
    this.linkList("Backlinks", backlinks);
  }

  private async renderPreview(id: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(id);
    if (!(file instanceof TFile) || isAttachment(id)) {
      this.bodyEl.createDiv({
        cls: "graphs-plus-card-empty",
        text: file ? "No preview for this file." : "This note doesn't exist yet.",
      });
      return;
    }
    const preview = this.addChild(new Component());
    this.preview = preview;
    const text = await this.app.vault.cachedRead(file);
    // The card may have moved on while the file was being read.
    if (this.preview !== preview) return;
    const el = this.bodyEl.createDiv({ cls: "graphs-plus-card-preview markdown-rendered" });
    await MarkdownRenderer.render(this.app, text, el, file.path, preview);
  }
}
