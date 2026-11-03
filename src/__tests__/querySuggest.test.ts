import { describe, expect, it } from "vitest";
import {
  applySuggestion,
  matchingOperators,
  quoteValue,
  suggestContext,
} from "../querySuggest";

const at = (text: string) => suggestContext(text, text.length);

describe("suggestContext", () => {
  it("offers every operator in an empty box, in core's order", () => {
    expect(at("")).toEqual({ kind: "operators", prefix: "", from: 0, to: 0 });
    expect(matchingOperators("").map((o) => o.name)).toEqual([
      "path:", "file:", "tag:", "line:", "section:", "[property]",
    ]);
  });

  it("filters operators by the word being typed", () => {
    expect(at("muscle pa")).toMatchObject({ kind: "operators", prefix: "pa", from: 7 });
    expect(matchingOperators("pa").map((o) => o.name)).toEqual(["path:"]);
    expect(matchingOperators("zz")).toEqual([]);
    expect(at("-ta")).toMatchObject({ kind: "operators", prefix: "ta", from: 1 });
  });

  it("offers tags after tag: and folders after path:", () => {
    expect(at("tag:#cl")).toEqual({ kind: "tag", prefix: "cl", from: 4, to: 7 });
    expect(at("x path:proj")).toMatchObject({ kind: "path", prefix: "proj", from: 7 });
  });

  it("offers property names inside [ until the colon", () => {
    expect(at("[rev")).toEqual({ kind: "property", prefix: "rev", from: 1, to: 4 });
    expect(at('["rev')).toMatchObject({ kind: "property", prefix: "rev" });
    expect(at("[status:")).toBeNull();
    expect(at("[status] ")).toMatchObject({ kind: "operators" });
  });

  it("offers nothing inside quotes, operator parentheses, or mid-word", () => {
    expect(at('"some phr')).toBeNull();
    expect(at("line:(a b")).toBeNull();
    expect(at("file:mus")).toBeNull();
    expect(suggestContext("path:abc", 3)).toBeNull();
    expect(suggestContext("ab", 1, 2)).toBeNull();
    expect(at("(a OR pa")).toMatchObject({ kind: "operators", prefix: "pa" });
  });
});

describe("applying a suggestion", () => {
  it("replaces the word and puts the cursor inside line:()", () => {
    expect(applySuggestion("muscle li", 7, 9, "line:()", 1)).toEqual({
      text: "muscle line:()",
      cursor: 13,
    });
  });

  it("quotes values like core", () => {
    expect(quoteValue("projects/claims")).toBe("projects/claims");
    expect(quoteValue("My notes")).toBe('"My notes"');
    expect(quoteValue("a:b")).toBe('"a:b"');
  });
});
