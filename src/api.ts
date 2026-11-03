import type { GraphOverlay } from "./overlay";
import type { GraphViewState } from "./graphState";
import { isGraphHost } from "./views";
import type GraphPlusPlugin from "./main";

export type { EdgeStyle, GraphOverlay, NodeStyle } from "./overlay";
export { edgeKey } from "./overlay";

/** One open graph, as other plugins see it. */
export type GraphHandle = {
  /** The leaf's id, stable while the tab is open. */
  id: string;
  state: () => Readonly<GraphViewState>;
  /** Paints a named overlay layer; null removes it. Layers merge in insertion order. */
  setOverlay: (key: string, overlay: GraphOverlay | null) => void;
  /** Eases the view to a node, centered right of an `inset`-wide panel. */
  focus: (nodeId: string, inset?: number) => void;
};

/**
 * What Graph plus offers other plugins, at
 * `app.plugins.plugins["graph-plus"].api`. Views are looked up on each call,
 * never stored, so closed tabs are never held on to.
 */
export type GraphPlusApi = {
  graphs: () => GraphHandle[];
};

export const createApi = (plugin: GraphPlusPlugin): GraphPlusApi => ({
  graphs: () => {
    const handles: GraphHandle[] = [];
    plugin.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!isGraphHost(view)) return;
      const id = (leaf as unknown as { id?: string }).id ?? "";
      handles.push({
        id,
        state: () => {
          const controller = isGraphHost(leaf.view) ? leaf.view.controller : null;
          if (!controller) throw new Error("This graph is closed.");
          return controller.state;
        },
        setOverlay: (key, overlay) => {
          if (isGraphHost(leaf.view)) leaf.view.controller?.setOverlay(key, overlay);
        },
        focus: (nodeId, inset) => {
          if (isGraphHost(leaf.view)) leaf.view.controller?.renderer.focus(nodeId, inset);
        },
      });
    });
    return handles;
  },
});
