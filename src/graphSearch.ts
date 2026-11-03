/**
 * The part of Obsidian's search syntax the graph uses: free text, "quoted
 * phrases", /regex/, `-negation`, `OR`, (grouping), the operators `path:`,
 * `file:`, `tag:`, `content:`, `line:` and `section:`, and `[property]` /
 * `[property:value]`. Matching ignores case, like core's graph. Free text
 * matches a file's path or its content. Pure so it can be unit-tested.
 */

export type NoteInfo = {
  path: string;
  /** File name without folder or extension. */
  name: string;
  /** Tags with their leading `#`. */
  tags: string[];
  properties: Record<string, unknown>;
  /** The file's text; free text falls back to the path while it is unknown. */
  content?: string;
};

/** A value to look for: a substring (lowercase) or a regular expression. */
type Needle = { text: string } | { regex: RegExp };

type Operator = "text" | "path" | "file" | "tag" | "content";

export type QueryNode =
  | { kind: "term"; op: Operator; needle: Needle }
  | { kind: "property"; key: string; needle: Needle | null }
  | { kind: "line" | "section"; query: QueryNode }
  | { kind: "not"; query: QueryNode }
  | { kind: "and"; queries: QueryNode[] }
  | { kind: "or"; queries: QueryNode[] };

/** null is the empty query, which matches everything. */
export type GraphQuery = QueryNode | null;

type Token =
  | { kind: "open" | "close" | "or" | "not" }
  | { kind: "word"; value: string; quoted: boolean; regex: boolean }
  | { kind: "op"; op: string }
  | { kind: "property"; body: string };

const OPERATORS = new Set(["path", "file", "tag", "content", "line", "section"]);

const tokenize = (input: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  // A word may follow an operator or a negation without a space.
  let atTermStart = true;
  while (i < input.length) {
    const c = input[i]!;
    if (/\s/.test(c)) {
      i++;
      atTermStart = true;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "open" });
      i++;
      atTermStart = true;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "close" });
      i++;
      continue;
    }
    if (c === "-" && atTermStart) {
      tokens.push({ kind: "not" });
      i++;
      continue;
    }
    if (c === "[") {
      // Find the matching "]", so a regex value may contain brackets.
      let depth = 0;
      let stop = input.length;
      for (let j = i; j < input.length; j++) {
        if (input[j] === "[") depth++;
        else if (input[j] === "]" && --depth === 0) {
          stop = j;
          break;
        }
      }
      tokens.push({ kind: "property", body: input.slice(i + 1, stop) });
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      const end = input.indexOf('"', i + 1);
      const stop = end === -1 ? input.length : end;
      tokens.push({
        kind: "word",
        value: input.slice(i + 1, stop),
        quoted: true,
        regex: false,
      });
      i = stop + 1;
      atTermStart = false;
      continue;
    }
    if (c === "/") {
      const end = input.indexOf("/", i + 1);
      if (end !== -1) {
        tokens.push({
          kind: "word",
          value: input.slice(i + 1, end),
          quoted: false,
          regex: true,
        });
        i = end + 1;
        atTermStart = false;
        continue;
      }
    }
    let j = i;
    while (j < input.length && !/[\s()"]/.test(input[j]!)) {
      if (input[j] === ":" && OPERATORS.has(input.slice(i, j).toLowerCase())) {
        break;
      }
      j++;
    }
    const word = input.slice(i, j);
    if (input[j] === ":" && OPERATORS.has(word.toLowerCase())) {
      tokens.push({ kind: "op", op: word.toLowerCase() });
      i = j + 1;
      atTermStart = false;
      continue;
    }
    tokens.push(
      word === "OR"
        ? { kind: "or" }
        : { kind: "word", value: word, quoted: false, regex: false },
    );
    i = j;
    atTermStart = false;
  }
  return tokens;
};

const needleOf = (value: string, regex: boolean): Needle | null => {
  if (!regex) return value ? { text: value.toLowerCase() } : null;
  try {
    return { regex: new RegExp(value, "i") };
  } catch {
    return null;
  }
};

const parseProperty = (body: string): QueryNode | null => {
  const colon = body.indexOf(":");
  const key = (colon === -1 ? body : body.slice(0, colon))
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .toLowerCase();
  if (!key) return null;
  if (colon === -1) return { kind: "property", key, needle: null };
  let value = body.slice(colon + 1).trim();
  let regex = false;
  if (value.length > 1 && value.startsWith("/") && value.endsWith("/")) {
    value = value.slice(1, -1);
    regex = true;
  } else {
    value = value.replace(/^"/, "").replace(/"$/, "");
  }
  return { kind: "property", key, needle: needleOf(value, regex) };
};

/** Recursive descent over the tokens: OR binds loosest, then AND, then `-`. */
class Parser {
  private at = 0;
  constructor(private tokens: Token[]) {}

  parse(): GraphQuery {
    const result = this.or();
    return result;
  }

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private or(): QueryNode | null {
    const parts: QueryNode[] = [];
    const first = this.and();
    if (first) parts.push(first);
    while (this.peek()?.kind === "or") {
      this.at++;
      const next = this.and();
      if (next) parts.push(next);
    }
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts[0]! : { kind: "or", queries: parts };
  }

  private and(): QueryNode | null {
    const parts: QueryNode[] = [];
    for (;;) {
      const token = this.peek();
      if (!token || token.kind === "or" || token.kind === "close") break;
      const next = this.unary();
      if (next) parts.push(next);
    }
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts[0]! : { kind: "and", queries: parts };
  }

  private unary(): QueryNode | null {
    if (this.peek()?.kind === "not") {
      this.at++;
      const inner = this.unary();
      return inner ? { kind: "not", query: inner } : null;
    }
    return this.atom();
  }

  private group(): QueryNode | null {
    // Called with the cursor on "(".
    this.at++;
    const inner = this.or();
    if (this.peek()?.kind === "close") this.at++;
    return inner;
  }

  private atom(): QueryNode | null {
    const token = this.tokens[this.at];
    if (!token) return null;
    switch (token.kind) {
      case "open":
        return this.group();
      case "close":
      case "or":
      case "not":
        this.at++;
        return null;
      case "property":
        this.at++;
        return parseProperty(token.body);
      case "word": {
        this.at++;
        const needle = needleOf(token.value, token.regex);
        return needle ? { kind: "term", op: "text", needle } : null;
      }
      case "op": {
        this.at++;
        const next = this.peek();
        if (token.op === "line" || token.op === "section") {
          // `line:(a b)` scopes a sub-query to single lines, `section:(a b)`
          // to the text under one heading; `line:a` works too.
          const inner = next?.kind === "open" ? this.group() : this.atom();
          return inner ? { kind: token.op, query: inner } : null;
        }
        if (next?.kind === "open") {
          const inner = this.group();
          return inner ? retarget(inner, token.op as Operator) : null;
        }
        if (next?.kind !== "word") return null;
        this.at++;
        const needle = needleOf(next.value, next.regex);
        return needle
          ? { kind: "term", op: token.op as Operator, needle }
          : null;
      }
    }
  }
}

/** `path:(a OR b)` applies the operator to every term inside. */
const retarget = (query: QueryNode, op: Operator): QueryNode => {
  switch (query.kind) {
    case "term":
      return query.op === "text" ? { ...query, op } : query;
    case "not":
      return { kind: "not", query: retarget(query.query, op) };
    case "and":
    case "or":
      return {
        kind: query.kind,
        queries: query.queries.map((q) => retarget(q, op)),
      };
    default:
      return query;
  }
};

export const parseGraphQuery = (query: string): GraphQuery =>
  new Parser(tokenize(query)).parse();

/** True when matching needs file contents (free text, `content:`, `line:`). */
export const needsContent = (query: GraphQuery): boolean => {
  if (!query) return false;
  switch (query.kind) {
    case "term":
      return query.op === "text" || query.op === "content";
    case "line":
    case "section":
      return true;
    case "property":
      return false;
    case "not":
      return needsContent(query.query);
    case "and":
    case "or":
      return query.queries.some(needsContent);
  }
};

/** Splits text at Markdown headings; each part runs from a heading to the next. */
const sections = (content: string): string[] => {
  const parts: string[] = [];
  let current: string[] = [];
  for (const line of content.split("\n")) {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      parts.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  parts.push(current.join("\n"));
  return parts;
};

const found = (haystack: string, needle: Needle): boolean =>
  "regex" in needle
    ? needle.regex.test(haystack)
    : haystack.toLowerCase().includes(needle.text);

const propertyText = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value])
    .filter((v) => v !== undefined && v !== null)
    .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)));

const tagMatches = (tag: string, needle: Needle): boolean => {
  const bare = tag.replace(/^#/, "");
  if ("regex" in needle) return needle.regex.test(bare);
  const wanted = needle.text.replace(/^#/, "");
  const lower = bare.toLowerCase();
  // Core: `tag:a` matches #a and nested tags like #a/b, not #ab.
  return lower === wanted || lower.startsWith(`${wanted}/`);
};

const evaluate = (query: QueryNode, note: NoteInfo): boolean => {
  switch (query.kind) {
    case "term": {
      const { needle } = query;
      switch (query.op) {
        case "text":
          return (
            found(note.path, needle) ||
            (note.content !== undefined && found(note.content, needle))
          );
        case "path":
          return found(note.path, needle);
        case "file":
          return found(note.name, needle);
        case "tag":
          return note.tags.some((t) => tagMatches(t, needle));
        case "content":
          return note.content !== undefined && found(note.content, needle);
      }
      return false;
    }
    case "property": {
      // Core matches property names by substring: [status] finds project_status.
      const entries = Object.entries(note.properties).filter(([key]) =>
        key.toLowerCase().includes(query.key),
      );
      if (!query.needle) return entries.length > 0;
      const needle = query.needle;
      return entries.some(([, value]) =>
        propertyText(value).some((v) => found(v, needle)),
      );
    }
    case "line":
    case "section": {
      if (note.content === undefined) return false;
      const parts =
        query.kind === "line" ? note.content.split("\n") : sections(note.content);
      return parts.some((part) =>
        evaluate(query.query, {
          ...note,
          // Inside line: and section:, free text looks at that part only.
          path: "",
          content: part,
        }),
      );
    }
    case "not":
      return !evaluate(query.query, note);
    case "and":
      return query.queries.every((q) => evaluate(q, note));
    case "or":
      return query.queries.some((q) => evaluate(q, note));
  }
};

/** An empty query matches every note. */
export const matchesGraphQuery = (query: GraphQuery, note: NoteInfo): boolean =>
  query === null || evaluate(query, note);

/** Core matches tag nodes against the query as if the tag were the text. */
export const matchesTag = (query: GraphQuery, tag: string): boolean =>
  matchesGraphQuery(query, {
    path: tag,
    name: tag,
    tags: [tag],
    properties: {},
    content: tag,
  });

/** Core matches attachment nodes by file name and path only. */
export const matchesFilename = (query: GraphQuery, path: string): boolean => {
  const name = (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
  return matchesGraphQuery(query, { path, name, tags: [], properties: {} });
};
