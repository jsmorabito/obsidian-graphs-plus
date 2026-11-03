import { TFile, type App, type Plugin } from "obsidian";
import { isAttachment } from "./vaultSource";

/**
 * File contents for content search, read on demand and dropped when a file
 * changes. Shared by every graph view, so a vault is read once.
 */
export class ContentIndex {
  private cache = new Map<string, string>();
  private loading: Promise<void> | null = null;

  constructor(private app: App) {}

  register(plugin: Plugin): void {
    const { vault } = this.app;
    plugin.registerEvent(vault.on("modify", (f) => this.cache.delete(f.path)));
    plugin.registerEvent(vault.on("delete", (f) => this.cache.delete(f.path)));
    plugin.registerEvent(
      vault.on("rename", (f, old) => {
        this.cache.delete(old);
        this.cache.delete(f.path);
      }),
    );
  }

  get(path: string): string | undefined {
    return this.cache.get(path);
  }

  /** Notes, canvases and bases: the files core's search reads. */
  private searchable(): TFile[] {
    return this.app.vault.getFiles().filter((f) => !isAttachment(f.path));
  }

  /** True when every searchable file's content is loaded. */
  get complete(): boolean {
    return this.searchable().every((f) => this.cache.has(f.path));
  }

  /** Reads every searchable file not yet cached; concurrent calls share one load. */
  loadAll(): Promise<void> {
    this.loading ??= this.read().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async read(): Promise<void> {
    const { vault } = this.app;
    const missing = this.searchable().filter((f) => !this.cache.has(f.path));
    const BATCH = 64;
    for (let i = 0; i < missing.length; i += BATCH) {
      await Promise.all(
        missing.slice(i, i + BATCH).map(async (file: TFile) => {
          try {
            this.cache.set(file.path, await vault.cachedRead(file));
          } catch {
            this.cache.set(file.path, "");
          }
        }),
      );
    }
  }
}
