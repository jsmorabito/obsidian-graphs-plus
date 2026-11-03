/**
 * Works out what core's search-box suggester would offer at the cursor:
 * the operator list (filtered by the word being typed), tags after `tag:`,
 * folders after `path:`, property names after `[`, or nothing (inside a
 * quote, a property value, or an operator's parentheses). Pure, so the
 * rules can be tested without a DOM.
 */

export type SuggestContext =
  | { kind: "operators" | "tag" | "path" | "property"; prefix: string; from: number; to: number }
  | null;

export type OperatorOption = {
  name: string;
  /** What is inserted; the cursor lands before a trailing ")" or "]". */
  token: string;
  description: string;
};

/** Core's list, in core's order, with core's descriptions. */
export const OPERATOR_OPTIONS: OperatorOption[] = [
  { name: "path:", token: "path:", description: "match path of the file" },
  { name: "file:", token: "file:", description: "match file name" },
  { name: "tag:", token: "tag:", description: "search for tags" },
  { name: "line:", token: "line:()", description: "search keywords on same line" },
  { name: "section:", token: "section:()", description: "search keywords under same heading" },
  { name: "[property]", token: "[]", description: "match property" },
];

export const suggestContext = (
  text: string,
  cursor: number,
  selectionEnd = cursor,
): SuggestContext => {
  if (selectionEnd !== cursor) return null;
  // Like core: only suggest at the end of a word.
  if (cursor < text.length && !/\s/.test(text.charAt(cursor))) return null;
  const before = text.slice(0, cursor);

  // Inside an unclosed quote: nothing.
  if ((before.match(/"/g)?.length ?? 0) % 2 === 1) {
    // ...unless the quote opened a property name: `["na`.
    const bracket = before.lastIndexOf("[");
    const quote = before.lastIndexOf('"');
    if (!(bracket !== -1 && quote === bracket + 1 && !before.slice(bracket).includes("]"))) {
      return null;
    }
  }

  // Inside `[...`: property names until the colon, then nothing.
  const open = before.lastIndexOf("[");
  if (open !== -1 && !before.slice(open).includes("]")) {
    const inner = before.slice(open + 1);
    if (inner.includes(":")) return null;
    return { kind: "property", prefix: inner.replace(/^"/, ""), from: open + 1, to: cursor };
  }

  // Inside an operator's parentheses, e.g. `line:(a b`: nothing.
  let depth = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const c = before[i];
    if (c === ")") depth++;
    else if (c === "(") {
      if (depth > 0) depth--;
      else if (/[a-z]:$/i.test(before.slice(0, i))) return null;
    }
  }

  const start = Math.max(before.lastIndexOf(" "), before.lastIndexOf("(")) + 1;
  let word = before.slice(start);
  let from = start;
  if (word.startsWith("-")) {
    word = word.slice(1);
    from++;
  }
  const operator = /^([a-z]+):(.*)$/i.exec(word);
  if (operator) {
    const name = operator[1]!.toLowerCase();
    const value = operator[2]!;
    const valueFrom = from + name.length + 1;
    if (name === "tag") {
      return { kind: "tag", prefix: value.replace(/^#/, ""), from: valueFrom, to: cursor };
    }
    if (name === "path") {
      return { kind: "path", prefix: value.replace(/^"/, ""), from: valueFrom, to: cursor };
    }
    return null;
  }
  return { kind: "operators", prefix: word.toLowerCase(), from, to: cursor };
};

export const matchingOperators = (prefix: string): OperatorOption[] =>
  OPERATOR_OPTIONS.filter((o) => o.name.startsWith(prefix));

/** Core quotes a tag or folder that contains brackets, parentheses, spaces or colons. */
export const quoteValue = (value: string): string =>
  /[[\]()\s:]/.test(value) ? `"${value}"` : value;

/** Replaces `from..to` with `insert`, returning the new text and cursor. */
export const applySuggestion = (
  text: string,
  from: number,
  to: number,
  insert: string,
  cursorBack = 0,
): { text: string; cursor: number } => {
  const rest = text.slice(to).trimStart();
  const next = text.slice(0, from) + insert + rest;
  return { text: next, cursor: from + insert.length - cursorBack };
};
