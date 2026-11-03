import { TFile, getAllTags, type App } from "obsidian";
import type { GraphSource } from "./graphData";
import type { NoteInfo } from "./graphSearch";
import type { ContentIndex } from "./contentIndex";

/** Core treats everything but notes, canvases and bases as an attachment. */
const NOT_ATTACHMENTS = new Set(["md", "canvas", "base"]);

const extensionOf = (path: string): string => {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot <= 0 || dot === name.length - 1 ? "" : name.slice(dot + 1).toLowerCase();
};

export const isAttachment = (path: string): boolean =>
  !NOT_ATTACHMENTS.has(extensionOf(path));

/** Obsidian's "Excluded files" check isn't public; use it when it exists. */
type IgnoreCheck = { isUserIgnored?: (path: string) => boolean };

/** Reads what the graph needs from Obsidian's vault and metadata cache. */
export const vaultSource = (app: App): GraphSource => {
  const { metadataCache, vault } = app;
  const tagCache = new Map<string, string[]>();
  const tagsOf = (path: string): string[] => {
    let tags = tagCache.get(path);
    if (!tags) {
      const file = vault.getAbstractFileByPath(path);
      const cache = file instanceof TFile ? metadataCache.getFileCache(file) : null;
      tags = cache ? (getAllTags(cache) ?? []) : [];
      tagCache.set(path, tags);
    }
    return tags;
  };
  const files = vault.getFiles().map((f) => f.path);
  const ignore = metadataCache as unknown as IgnoreCheck;
  return {
    resolvedLinks: metadataCache.resolvedLinks,
    unresolvedLinks: metadataCache.unresolvedLinks,
    files,
    tagsOf,
    allTags: () => files.flatMap(tagsOf),
    isAttachment,
    isIgnored: (path) => ignore.isUserIgnored?.(path) ?? false,
    fileTime: (path) => {
      const file = vault.getAbstractFileByPath(path);
      return file instanceof TFile
        ? Math.min(file.stat.ctime, file.stat.mtime)
        : Infinity;
    },
  };
};

/** What search matches a note against. */
export const noteInfo = (
  app: App,
  path: string,
  content: ContentIndex | null,
): NoteInfo => {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const file = app.vault.getAbstractFileByPath(path);
  const cache = file instanceof TFile ? app.metadataCache.getFileCache(file) : null;
  return {
    path,
    name: base,
    tags: cache ? (getAllTags(cache) ?? []) : [],
    properties: { ...(cache?.frontmatter ?? {}) },
    content: content?.get(path),
  };
};
