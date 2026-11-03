import {
  defaultGraphState,
  fromCoreOptions,
  toCoreOptions,
  type GraphMode,
  type GraphViewState,
} from "./graphState";

/**
 * The `.graph` file: a saved view of the vault, like a `.base` file is a
 * saved table. It holds what to show and how (core's own graph options, so
 * `graph.json` settings carry over), plus the camera and node positions so
 * it reopens looking the same. The nodes themselves are rebuilt from the
 * vault each time it opens.
 */

export const GRAPH_EXTENSION = "graph";
export const FORMAT = "graphs-plus";
/** The tag files had before the plugin was renamed from Graph Plus. */
const OLD_FORMATS: readonly unknown[] = ["graph-plus"];
export const FORMAT_VERSION = 1;

export type Camera = { scale: number; x: number; y: number };

export type GraphFile = {
  state: GraphViewState;
  camera: Camera | null;
  positions: Map<string, { x: number; y: number }>;
};

export type GraphFileJson = {
  format: typeof FORMAT;
  version: number;
  mode: GraphMode;
  members?: string[];
  localFile?: string;
  options: Record<string, unknown>;
  camera?: Camera;
  positions?: Record<string, [number, number]>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const round = (n: number): number => Math.round(n * 10) / 10;

export const serializeGraphFile = (file: GraphFile): string => {
  const { state } = file;
  const json: GraphFileJson = {
    format: FORMAT,
    version: FORMAT_VERSION,
    mode: state.mode,
    ...(state.mode === "sandbox" ? { members: state.members } : {}),
    ...(state.mode === "local" && state.localFile
      ? { localFile: state.localFile }
      : {}),
    options: toCoreOptions(state),
    ...(file.camera
      ? {
          camera: {
            scale: file.camera.scale,
            x: round(file.camera.x),
            y: round(file.camera.y),
          },
        }
      : {}),
  };
  if (file.positions.size > 0) {
    const positions: Record<string, [number, number]> = {};
    for (const id of [...file.positions.keys()].sort()) {
      const p = file.positions.get(id)!;
      positions[id] = [round(p.x), round(p.y)];
    }
    json.positions = positions;
  }
  return JSON.stringify(json, null, 2) + "\n";
};

export class GraphFileError extends Error {}

/**
 * Parses a `.graph` file. An empty file is a new, default graph. Throws
 * `GraphFileError` for something that is not ours (e.g. another program's
 * `.graph`) or from a newer version, so the view can say so instead of
 * overwriting it.
 */
export const parseGraphFile = (text: string): GraphFile => {
  if (!text.trim()) {
    return { state: defaultGraphState(), camera: null, positions: new Map() };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GraphFileError("This file is not a Graphs Plus file.");
  }
  if (
    !isRecord(json) ||
    (json.format !== FORMAT && !OLD_FORMATS.includes(json.format))
  ) {
    throw new GraphFileError("This file is not a Graphs Plus file.");
  }
  if (typeof json.version !== "number" || json.version > FORMAT_VERSION) {
    throw new GraphFileError(
      "This file was saved by a newer version of Graphs Plus.",
    );
  }
  const mode: GraphMode =
    json.mode === "sandbox" || json.mode === "local" ? json.mode : "vault";
  const state = fromCoreOptions(defaultGraphState(mode), json.options);
  if (Array.isArray(json.members)) {
    state.members = json.members.filter(
      (m): m is string => typeof m === "string",
    );
  }
  if (typeof json.localFile === "string") state.localFile = json.localFile;

  const camera =
    isRecord(json.camera) &&
    typeof json.camera.scale === "number" &&
    typeof json.camera.x === "number" &&
    typeof json.camera.y === "number" &&
    json.camera.scale > 0
      ? { scale: json.camera.scale, x: json.camera.x, y: json.camera.y }
      : null;

  const positions = new Map<string, { x: number; y: number }>();
  if (isRecord(json.positions)) {
    for (const [id, p] of Object.entries(json.positions)) {
      if (
        Array.isArray(p) &&
        typeof p[0] === "number" &&
        typeof p[1] === "number"
      ) {
        positions.set(id, { x: p[0], y: p[1] });
      }
    }
  }
  return { state, camera, positions };
};

/** True when two layouts differ enough to be worth writing to disk. */
export const positionsChanged = (
  a: ReadonlyMap<string, { x: number; y: number }>,
  b: ReadonlyMap<string, { x: number; y: number }>,
  tolerance = 1,
): boolean => {
  if (a.size !== b.size) return true;
  for (const [id, p] of a) {
    const q = b.get(id);
    if (!q) return true;
    if (Math.abs(p.x - q.x) > tolerance || Math.abs(p.y - q.y) > tolerance) {
      return true;
    }
  }
  return false;
};
