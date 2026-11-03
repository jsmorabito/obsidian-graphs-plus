import { describe, expect, it } from "vitest";
import { coloredQueries, nodeFilter, queriesNeedContent } from "../graphFilter";
import type { NoteInfo } from "../graphSearch";

const info = (path: string): NoteInfo => ({
  path,
  name: path.replace(/\.md$/, ""),
  tags: path.startsWith("claims/") ? ["#claim"] : [],
  properties: {},
  content: path === "b.md" ? "mentions muscle" : "",
});

describe("nodeFilter", () => {
  it("passes everything without queries", () => {
    const f = nodeFilter([], info);
    expect(f("a.md", "")).toBe(true);
    expect(f("#x", "tag")).toBe(true);
  });

  it("filters files by the search box and colors by the first matching group", () => {
    const q = coloredQueries("-path:drafts", [
      { query: "tag:#claim", rgb: 0xff0000 },
      { query: "claims/", rgb: 0x00ff00 },
    ]);
    const f = nodeFilter(q, info);
    expect(f("drafts/x.md", "")).toBe(false);
    expect(f("claims/x.md", "")).toBe(0xff0000);
    expect(f("other.md", "")).toBe(true);
  });

  it("matches content", () => {
    const q = coloredQueries("muscle", []);
    expect(queriesNeedContent(q)).toBe(true);
    const f = nodeFilter(q, info);
    expect(f("b.md", "")).toBe(true);
    expect(f("c.md", "")).toBe(false);
  });

  it("always shows unresolved links and the local file", () => {
    const f = nodeFilter(coloredQueries("nothing-matches", []), info, { localFile: "a.md" });
    expect(f("Missing", "unresolved")).toBe(true);
    expect(f("a.md", "")).toBe(true);
    expect(f("c.md", "")).toBe(false);
  });

  it("filters tags and attachments by tag and file name", () => {
    const f = nodeFilter(coloredQueries("tag:claim", [{ query: "x", rgb: 1 }]), info);
    expect(f("#claim", "tag")).toBe(true);
    expect(f("#other", "tag")).toBe(false);
    const g = nodeFilter(coloredQueries("file:diagram", []), info);
    expect(g("img/diagram.png", "attachment")).toBe(true);
    expect(g("img/photo.png", "attachment")).toBe(false);
  });

  it("limits files to the sandbox scope", () => {
    const f = nodeFilter([], info, { scope: new Set(["a.md"]) });
    expect(f("a.md", "")).toBe(true);
    expect(f("b.md", "")).toBe(false);
    expect(f("Missing", "unresolved")).toBe(true);
  });
});
