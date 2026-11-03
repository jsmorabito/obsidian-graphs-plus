import {
  AbstractInputSuggest,
  TFolder,
  getAllTags,
  prepareFuzzySearch,
  setIcon,
  setTooltip,
  type App,
} from "obsidian";
import {
  applySuggestion,
  matchingOperators,
  quoteValue,
  suggestContext,
  type OperatorOption,
  type SuggestContext,
} from "./querySuggest";

type Item =
  | { type: "group"; name: string }
  | { type: "operator"; option: OperatorOption }
  | { type: "string"; name: string }
  | { type: "property"; name: string };

const HELP_URL = "https://help.obsidian.md/plugins/search";

/** The parts of the suggest popover that aren't public API, used only when present. */
type SuggestInternals = {
  suggestEl?: HTMLElement;
  suggestions?: { values?: Item[]; setSelectedItem?: (index: number, evt: Event | null) => void };
};

/**
 * Core's search-box suggester: "Search options" with descriptions, tags
 * after `tag:`, folders after `path:` and property names after `[`, with the
 * same markup (`mod-search-suggestion`, `search-suggest-item`) so the theme
 * styles it the same way.
 */
export class QuerySuggest extends AbstractInputSuggest<Item> {
  private context: SuggestContext = null;

  constructor(
    app: App,
    private input: HTMLInputElement,
  ) {
    super(app, input);
    this.internals.suggestEl?.addClass("mod-search-suggestion");
  }

  private get internals(): SuggestInternals {
    return this as unknown as SuggestInternals;
  }

  protected getSuggestions(): Item[] {
    const { input } = this;
    const end = input.value.length;
    const ctx = (this.context = suggestContext(
      input.value,
      input.selectionStart ?? end,
      input.selectionEnd ?? end,
    ));
    if (!ctx) return [];
    switch (ctx.kind) {
      case "operators": {
        const options = matchingOperators(ctx.prefix);
        return options.length > 0
          ? [
              { type: "group", name: "Search options" },
              ...options.map((option): Item => ({ type: "operator", option })),
            ]
          : [];
      }
      case "tag": {
        const tags = this.ranked(this.allTags(), ctx.prefix, (t) => t.slice(1));
        return tags.length > 0
          ? [{ type: "group", name: "Tags" }, ...tags.map((name): Item => ({ type: "string", name }))]
          : [];
      }
      case "path":
        return this.ranked(this.allFolders(), ctx.prefix).map(
          (name): Item => ({ type: "string", name }),
        );
      case "property": {
        const keys = this.ranked(this.allProperties(), ctx.prefix);
        return keys.length > 0
          ? [
              { type: "group", name: "Properties" },
              ...keys.map((name): Item => ({ type: "property", name })),
            ]
          : [];
      }
    }
  }

  /** Fuzzy-matches like core, best first; an empty prefix keeps everything in order. */
  private ranked(values: string[], prefix: string, key = (v: string) => v): string[] {
    if (!prefix) return values;
    const match = prepareFuzzySearch(prefix);
    return values
      .map((v) => ({ v, result: match(key(v)) }))
      .filter((x) => x.result !== null)
      .sort((a, b) => b.result!.score - a.result!.score)
      .map((x) => x.v);
  }

  private allTags(): string[] {
    const tags = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      for (const tag of (cache && getAllTags(cache)) ?? []) tags.add(tag);
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }

  private allFolders(): string[] {
    return this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
      .map((f) => f.path)
      .sort((a, b) => a.localeCompare(b));
  }

  private allProperties(): string[] {
    const keys = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      for (const key of Object.keys(fm ?? {})) keys.add(key);
    }
    return [...keys].sort((a, b) => a.localeCompare(b));
  }

  open(): void {
    super.open();
    const { suggestEl, suggestions } = this.internals;
    suggestEl?.setCssStyles({ width: `${Math.max(this.input.offsetWidth, 300)}px` });
    // Core skips the group header and selects the first real option.
    if (suggestions?.values?.[0]?.type === "group") suggestions.setSelectedItem?.(1, null);
  }

  renderSuggestion(item: Item, el: HTMLElement): void {
    el.addClass("mod-complex", "search-suggest-item");
    const content = el.createDiv({ cls: "suggestion-content" });
    const aux = el.createDiv({ cls: "suggestion-aux" });
    const title = content.createDiv({ cls: "suggestion-title" });
    switch (item.type) {
      case "group": {
        el.addClass("mod-group");
        title.addClass("list-item-part", "mod-extended");
        title.createSpan({ text: item.name });
        const icon = aux.createDiv({
          cls: "list-item-part search-suggest-icon clickable-icon",
        });
        setIcon(icon, "lucide-info");
        setTooltip(icon, "Read more");
        icon.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.open(HELP_URL, "_blank");
        });
        break;
      }
      case "operator":
        title.createSpan({ text: item.option.name });
        title.createSpan({
          cls: "search-suggest-info-text",
          text: item.option.description,
        });
        break;
      default:
        title.createSpan({ text: item.name });
    }
  }

  selectSuggestion(item: Item, evt: MouseEvent | KeyboardEvent): void {
    const ctx = this.context;
    if (item.type === "group" || !ctx) return;
    let insert: string;
    let back = 0;
    if (item.type === "operator") {
      insert = item.option.token;
      if (/[)\]]$/.test(insert)) back = 1;
    } else if (item.type === "property") {
      // `["name":` to type a value, or with Shift `["name"] ` to just test for it.
      insert = evt.shiftKey ? `"${item.name}"] ` : `"${item.name}":`;
    } else {
      insert = `${quoteValue(item.name)} `;
    }
    const next = applySuggestion(this.input.value, ctx.from, ctx.to, insert, back);
    this.input.value = next.text;
    this.input.setSelectionRange(next.cursor, next.cursor);
    // Let the setting see the change, and let the suggester offer what comes next.
    this.input.dispatchEvent(new Event("input"));
  }
}
