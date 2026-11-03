# Graph Plus

A graph view for [Obsidian](https://obsidian.md) that looks and behaves like the core graph view, with a few things core can't do:

- **Open as many as you like.** Each graph view keeps its own search, filters, groups, display and forces.
- **Save graphs to files.** A `.graph` file holds a view's settings, camera and layout, so it reopens looking the same. It works like `.canvas` and `.base` files: open it from the file explorer, rename it, link to it.
- **Sandbox graphs.** Start from an empty graph and add notes by hand, or add a note together with the notes it links to.
- **Extend it.** Other plugins can recolor, fade and enlarge nodes and links through a small API.

Everything core offers is here too: the local graph, color groups, tag and attachment nodes, orphans, the timelapse animation, hover previews and the query search syntax (`path:`, `file:`, `tag:`, `content:`, `line:`, `section:`, `[property:value]`, regex), with the same suggester.

## Usage

Open a graph from the ribbon icon or the command palette. Commands:

| Command | What it does |
| --- | --- |
| Open graph view | A graph of the whole vault |
| Open sandbox | An empty graph you add notes to |
| Open local graph | A graph around the active note, following it as you switch notes |
| Create new graph file | A new `.graph` file of the whole vault |
| Create new empty graph | A new `.graph` file that starts empty, like a sandbox |
| Save the active graph as a graph file | Saves the open graph view to a `.graph` file |
| Export the active graph as a canvas | Writes the graph's current layout to a `.canvas` file |
| Copy settings from the core graph into the active graph | Brings over your core graph's filters, groups, display and forces |
| Start timelapse animation | Core's animation, building the graph up in file-creation order |
| Search in the active graph | Focuses the graph's search box |

Right-click a folder for **New graph**, or a note for **Open local graph in Graph Plus**.

By default, clicking a node opens the note, as in core. In the plugin's settings you can switch this to show a card with the note's links and a preview.

## The `.graph` format

A `.graph` file is JSON. Its `options` use the same keys as core's `.obsidian/graph.json`:

```json
{
  "format": "graph-plus",
  "version": 1,
  "mode": "vault",
  "options": { "search": "tag:#project", "showTags": true, "colorGroups": [] },
  "camera": { "scale": 1, "x": 0, "y": 0 },
  "positions": { "Notes/Idea.md": [120.5, -40] }
}
```

`mode` can be `vault`, `sandbox` (with a `members` list of paths) or `local` (with a `localFile`). Nodes come from the vault every time the file opens, so `positions` only records where they were. Graph Plus won't open or overwrite a `.graph` file that doesn't have `"format": "graph-plus"`.

## API

```ts
const api = app.plugins.getPlugin("graph-plus")?.api;
for (const graph of api.graphs()) {
  graph.setOverlay("my-plugin", {
    nodes: new Map([["Notes/Idea.md", { rgb: 0xe0a030, alpha: 1, sizeBoost: 4 }]]),
    edges: new Map(),
    dimAlpha: 0.3, // fade everything the overlay doesn't mention
  });
  graph.focus("Notes/Idea.md");
}
```

Each plugin paints its own named layer, and `setOverlay(key, null)` removes it. Edges are keyed by their two paths, sorted and joined with `"\u0000"` (`edgeKey` in `src/overlay.ts`). See [`src/api.ts`](src/api.ts) and [`src/overlay.ts`](src/overlay.ts) for the types.

## Installing

Graph Plus isn't in the community plugin list yet. To install it:

- **With [BRAT](https://github.com/TfTHacker/obsidian42-brat):** add `jsmorabito/graph-plus` as a beta plugin.
- **By hand:** download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/jsmorabito/graph-plus/releases/latest) into `.obsidian/plugins/graph-plus/` in your vault, then turn the plugin on in **Settings → Community plugins**.

## Development

```bash
npm install --legacy-peer-deps
npm run dev     # watch build
npm run build   # type-check and production build
npm test        # Vitest
npm run lint
```

The graph logic (building the graph, search, filters, forces, the `.graph` format) lives in modules that don't import `obsidian`, so it runs under Vitest in Node.

## License

[MIT](LICENSE)
