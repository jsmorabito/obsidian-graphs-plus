import type { NodeFilter } from "./graphData";
import {
  matchesFilename,
  matchesGraphQuery,
  matchesTag,
  needsContent,
  parseGraphQuery,
  type GraphQuery,
  type NoteInfo,
} from "./graphSearch";
import type { ColorGroup } from "./graphState";

/** The search box (no color) followed by the color groups, as core orders them. */
export type ColoredQuery = { query: GraphQuery; color: number | null };

export const coloredQueries = (
  search: string,
  groups: ColorGroup[],
): ColoredQuery[] => {
  const result: ColoredQuery[] = [];
  const add = (text: string, color: number | null): void => {
    const query = parseGraphQuery(text);
    if (query) result.push({ query, color });
  };
  add(search, null);
  for (const g of groups) add(g.query, g.rgb);
  return result;
};

export const queriesNeedContent = (queries: ColoredQuery[]): boolean =>
  queries.some((q) => needsContent(q.query));

/**
 * Core's node filter. A file must match the search box; the first color
 * group it matches colors it. Tags and attachments must match every
 * uncolored query by tag or file name. Unresolved links always pass. The
 * local graph's own file always passes. `scope` limits files to a set (the
 * sandbox).
 */
export const nodeFilter = (
  queries: ColoredQuery[],
  info: (path: string) => NoteInfo,
  options: { localFile?: string | null; scope?: ReadonlySet<string> | null } = {},
): NodeFilter => {
  const { localFile = null, scope = null } = options;
  return (id, type) => {
    if (type === "unresolved") return true;
    if (type === "tag") {
      return queries.every((q) => q.color !== null || matchesTag(q.query, id));
    }
    if (scope && !scope.has(id)) return false;
    if (type === "attachment") {
      return queries.every(
        (q) => q.color !== null || matchesFilename(q.query, id),
      );
    }
    if (id === localFile) return true;
    if (queries.length === 0) return true;
    const note = info(id);
    for (const q of queries) {
      const match = matchesGraphQuery(q.query, note);
      if (!match && q.color === null) return false;
      if (match && q.color !== null) return q.color;
    }
    return true;
  };
};
