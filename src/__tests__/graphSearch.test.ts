import { describe, expect, it } from "vitest";
import {
  matchesFilename,
  matchesGraphQuery,
  matchesTag,
  needsContent,
  parseGraphQuery,
  type NoteInfo,
} from "../graphSearch";

const note: NoteInfo = {
  path: "projects/claims/Muscle loss.md",
  name: "Muscle loss",
  tags: ["#cma/autophagy", "#claim"],
  properties: { reviewed_by: "Ann", year: 2024, aliases: ["ML", "Loss"] },
  content: "No supporting evidence linked.\nSee hendrixson2024loss for more.",
};

const m = (q: string, n: NoteInfo = note) => matchesGraphQuery(parseGraphQuery(q), n);

describe("graph search", () => {
  it("matches everything with an empty query", () => {
    expect(m("")).toBe(true);
    expect(m("   ")).toBe(true);
  });

  it("matches free text in the path or content, ignoring case", () => {
    expect(m("muscle")).toBe(true);
    expect(m("SUPPORTING")).toBe(true);
    expect(m("unrelated")).toBe(false);
  });

  it("falls back to the path while content is unknown", () => {
    const bare = { ...note, content: undefined };
    expect(m("muscle", bare)).toBe(true);
    expect(m("supporting", bare)).toBe(false);
  });

  it("requires all terms, unless joined by OR", () => {
    expect(m("muscle evidence")).toBe(true);
    expect(m("muscle unrelated")).toBe(false);
    expect(m("unrelated OR muscle")).toBe(true);
  });

  it("supports quoted phrases and negation", () => {
    expect(m('"supporting evidence"')).toBe(true);
    expect(m('"evidence supporting"')).toBe(false);
    expect(m("-muscle")).toBe(false);
    expect(m("-unrelated")).toBe(true);
  });

  it("groups with parentheses", () => {
    expect(m("(unrelated OR muscle) evidence")).toBe(true);
    expect(m("-(unrelated OR muscle)")).toBe(false);
  });

  it("handles path:, file: and content:", () => {
    expect(m("path:claims")).toBe(true);
    expect(m("path:evidence")).toBe(false);
    expect(m("file:muscle")).toBe(true);
    expect(m("file:claims")).toBe(false);
    expect(m("content:hendrixson2024loss")).toBe(true);
    expect(m("content:projects")).toBe(false);
    expect(m("path:(evidence OR claims)")).toBe(true);
  });

  it("matches tags and nested tags, not prefixes", () => {
    expect(m("tag:#claim")).toBe(true);
    expect(m("tag:cma")).toBe(true);
    expect(m("tag:cla")).toBe(false);
  });

  it("matches properties", () => {
    expect(m("[reviewed_by]")).toBe(true);
    expect(m("[promotion_score]")).toBe(false);
    expect(m("[reviewed_by:ann]")).toBe(true);
    expect(m("[year:2024]")).toBe(true);
    expect(m("[aliases:ml]")).toBe(true);
    expect(m('[reviewed_by:"Bob"]')).toBe(false);
    expect(m("[year:/20[0-9]{2}/]")).toBe(true);
    // Names match by substring, like core; an empty value still counts.
    expect(m("[reviewed]")).toBe(true);
    expect(m("[status]", { ...note, properties: { project_status: null } })).toBe(true);
  });

  it("supports regular expressions", () => {
    expect(m("/hendrixson\\d{4}/")).toBe(true);
    expect(m("file:/^muscle/")).toBe(true);
    expect(m("file:/^loss/")).toBe(false);
    // An invalid regex is ignored rather than throwing.
    expect(() => parseGraphQuery("/(/")).not.toThrow();
  });

  it("scopes line: to single lines", () => {
    expect(m("line:(supporting evidence)")).toBe(true);
    expect(m("line:(supporting hendrixson)")).toBe(false);
    expect(m("line:hendrixson")).toBe(true);
  });

  it("scopes section: to the text under one heading", () => {
    const doc = { ...note, content: "# One\nalpha here\n## Two\nbeta here\ngamma" };
    expect(m("section:(beta gamma)", doc)).toBe(true);
    expect(m("section:(alpha beta)", doc)).toBe(false);
    expect(m("section:(One alpha)", doc)).toBe(true);
  });

  it("accepts quoted property names, as the suggester inserts them", () => {
    expect(m('["reviewed_by":ann]')).toBe(true);
  });

  it("knows when it needs file contents", () => {
    expect(needsContent(parseGraphQuery("path:a tag:b [x]"))).toBe(false);
    expect(needsContent(parseGraphQuery("path:a word"))).toBe(true);
    expect(needsContent(parseGraphQuery("line:(a)"))).toBe(true);
    expect(needsContent(parseGraphQuery(""))).toBe(false);
  });

  it("matches tag nodes and attachments the way core does", () => {
    expect(matchesTag(parseGraphQuery("tag:claim"), "#claim")).toBe(true);
    expect(matchesTag(parseGraphQuery("muscle"), "#claim")).toBe(false);
    expect(matchesFilename(parseGraphQuery("file:diagram"), "img/diagram.png")).toBe(true);
  });

  it("keeps words with inner dashes and colons intact", () => {
    expect(m("well-known", { ...note, content: "a well-known fact" })).toBe(true);
    expect(m("http://x", { ...note, content: "see http://x" })).toBe(true);
  });
});
