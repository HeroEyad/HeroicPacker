// If you can't beat him, outpace him.
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export type Segment =
  | { type: "line"; x0: number; y0: number; x1: number; y1: number }
  | { type: "curve"; x0: number; y0: number; cx: number; cy: number; x1: number; y1: number };

export interface GradientStop {
  color: string;
  alpha: number;
  ratio: number;
}

export interface Fill {
  index: number;
  type: "solid" | "linear" | "radial" | "bitmap";
  color?: string;
  alpha?: number;
  stops?: GradientStop[];
  matrix?: Matrix;
  bitmapPath?: string;
}

export interface Stroke {
  index: number;
  weight: number;
  fill?: Fill;
}

export interface Edge {
  fill0?: number;
  fill1?: number;
  stroke?: number;
  segments: Segment[];
}

export type FlaElement =
  | {
      type: "symbol";
      name: string;
      instanceName?: string;
      symbolType: string;
      firstFrame: number;
      loop: string;
      matrix: Matrix;
      color?: Record<string, string>;
    }
  | { type: "bitmap"; name: string; matrix: Matrix }
  | { type: "shape"; matrix: Matrix; fills: Fill[]; strokes: Stroke[]; edges: Edge[] }
  | { type: "group"; matrix: Matrix; members: FlaElement[] };

export interface Frame {
  index: number;
  duration: number;
  name?: string;
  tweenType?: string;
  elements: FlaElement[];
}

export interface Layer {
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  parentLayerIndex?: number;
  frames: Frame[];
}

export interface Timeline {
  name: string;
  length: number;
  layers: Layer[];
}

export interface FlaSymbol {
  name: string;
  type: string;
  timeline?: Timeline;
}

export interface FlaBitmap {
  name: string;
  width: number;
  height: number;
  data?: Uint8Array;
}

export interface FlaDocument {
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
  timelines: Timeline[];
  symbols: Record<string, FlaSymbol>;
  bitmaps: Record<string, FlaBitmap>;
}

type XNode = Record<string, any>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  ignoreDeclaration: true,
  attributeNamePrefix: ""
});

const tagOf = (n: XNode): string => Object.keys(n).find((k) => k !== ":@")!;
const attrs = (n: XNode): Record<string, string> => n[":@"] ?? {};
const kids = (n: XNode, tag?: string): XNode[] => (n[tagOf(n)] as XNode[]).filter((c) => tagOf(c) !== "#text" && (!tag || tagOf(c) === tag));
const child = (n: XNode, tag: string): XNode | undefined => kids(n, tag)[0];

const num = (v: string | undefined, fallback: number) => (v === undefined ? fallback : Number(v));
const opt = (v: string | undefined) => (v === undefined ? undefined : Number(v));

const coord = (s: string) => {
  if (s[0] !== "#") return Number(s) / 20;
  const [whole, frac] = s.slice(1).split(".");
  // negative coords come as 24 bit signed hex like #FFF39F.27
  let n = parseInt(whole, 16);
  if (whole.length > 6) n |= 0;
  else if (n >= 0x800000) n -= 0x1000000;
  return (n + (frac ? parseInt(frac, 16) / Math.pow(16, frac.length) : 0)) / 20;
  // idk how this was fixed but yeah, i am TOTALLY not freaking out rn
};

const parseEdgeString = (s: string): Segment[] => {
  const tokens = s.match(/[!|\/\[\]S]|#[0-9A-Fa-f]+(?:\.[0-9A-Fa-f]+)?|-?\d+(?:\.\d+)?/g) ?? [];
  const segments: Segment[] = [];
  let x = 0;
  let y = 0;
  let i = 0;

  while (i < tokens.length) {
    const t = tokens[i++];
    if (t === "!") {
      x = coord(tokens[i++]);
      y = coord(tokens[i++]);
    } else if (t === "|" || t === "/") {
      const x1 = coord(tokens[i++]);
      const y1 = coord(tokens[i++]);
      segments.push({ type: "line", x0: x, y0: y, x1, y1 });
      x = x1;
      y = y1;
    } else if (t === "[" || t === "]") {
      const cx = coord(tokens[i++]);
      const cy = coord(tokens[i++]);
      const x1 = coord(tokens[i++]);
      const y1 = coord(tokens[i++]);
      segments.push({ type: "curve", x0: x, y0: y, cx, cy, x1, y1 });
      x = x1;
      y = y1;
    } else if (t === "S") {
      i++;
    }
  }

  return segments;
};

const parseMatrix = (n?: XNode): Matrix => {
  const m = n && child(n, "Matrix");
  const at = m ? attrs(m) : {};
  return {
    a: num(at.a, 1),
    b: num(at.b, 0),
    c: num(at.c, 0),
    d: num(at.d, 1),
    tx: num(at.tx, 0),
    ty: num(at.ty, 0)
  };
};

const parseFill = (n: XNode, index: number): Fill => {
  const f = kids(n)[0];
  if (!f) return { index, type: "solid", color: "#000000", alpha: 0 };

  const tag = tagOf(f);
  const at = attrs(f);

  if (tag === "SolidColor") {
    return { index, type: "solid", color: at.color ?? "#000000", alpha: num(at.alpha, 1) };
  }
  if (tag === "BitmapFill") {
    return { index, type: "bitmap", bitmapPath: at.bitmapPath, matrix: parseMatrix(child(f, "matrix")) };
  }
  return {
    index,
    type: tag === "RadialGradient" ? "radial" : "linear",
    matrix: parseMatrix(child(f, "matrix")),
    stops: kids(f, "GradientEntry").map((e) => ({
      color: attrs(e).color ?? "#000000",
      alpha: num(attrs(e).alpha, 1),
      ratio: num(attrs(e).ratio, 0)
    }))
  };
};

const parseStroke = (n: XNode): Stroke => {
  const s = kids(n)[0];
  const fillNode = s && child(s, "fill");
  return {
    index: num(attrs(n).index, 0),
    weight: num(s && attrs(s).weight, 1),
    fill: fillNode ? parseFill(fillNode, 0) : undefined
  };
};

const parseEdge = (n: XNode): Edge => {
  const at = attrs(n);
  return {
    fill0: opt(at.fillStyle0),
    fill1: opt(at.fillStyle1),
    stroke: opt(at.strokeStyle),
    segments: parseEdgeString(at.edges ?? "")
  };
};

const parseElement = (n: XNode): FlaElement | undefined => {
  const tag = tagOf(n);
  const at = attrs(n);

  if (tag === "DOMSymbolInstance") {
    const color = child(n, "color");
    const colorNode = color && child(color, "Color");
    return {
      type: "symbol",
      name: at.libraryItemName,
      instanceName: at.name,
      symbolType: at.symbolType ?? "movie clip",
      firstFrame: num(at.firstFrame, 0),
      loop: at.loop ?? "loop",
      matrix: parseMatrix(child(n, "matrix")),
      color: colorNode ? attrs(colorNode) : undefined
    };
  }

  if (tag === "DOMBitmapInstance") {
    return { type: "bitmap", name: at.libraryItemName, matrix: parseMatrix(child(n, "matrix")) };
  }

  if (tag === "DOMShape") {
    const fills = child(n, "fills");
    const strokes = child(n, "strokes");
    const edges = child(n, "edges");
    return {
      type: "shape",
      matrix: parseMatrix(child(n, "matrix")),
      fills: fills ? kids(fills, "FillStyle").map((f) => parseFill(f, num(attrs(f).index, 0))) : [],
      strokes: strokes ? kids(strokes, "StrokeStyle").map(parseStroke) : [],
      edges: edges ? kids(edges, "Edge").map(parseEdge) : []
    };
  }

  if (tag === "DOMGroup") {
    const members = child(n, "members");
    return {
      type: "group",
      matrix: parseMatrix(child(n, "matrix")),
      members: members ? parseElements(members) : []
    };
  }

  return undefined;
};

const parseElements = (n: XNode) => kids(n).map(parseElement).filter((e): e is FlaElement => !!e);

const parseFrame = (n: XNode): Frame => {
  const at = attrs(n);
  const elements = child(n, "elements");
  return {
    index: num(at.index, 0),
    duration: num(at.duration, 1),
    name: at.name,
    tweenType: at.tweenType,
    elements: elements ? parseElements(elements) : []
  };
};

const parseLayer = (n: XNode): Layer => {
  const at = attrs(n);
  const frames = child(n, "frames");
  return {
    name: at.name ?? "",
    type: at.layerType ?? "normal",
    visible: at.visible !== "false",
    locked: at.locked === "true",
    parentLayerIndex: opt(at.parentLayerIndex),
    frames: frames ? kids(frames, "DOMFrame").map(parseFrame) : []
  };
};

const parseTimeline = (n: XNode): Timeline => {
  const layers = child(n, "layers");
  const parsed = layers ? kids(layers, "DOMLayer").map(parseLayer) : [];
  const length = parsed.reduce(
    (max, l) => l.frames.reduce((m, f) => Math.max(m, f.index + f.duration), max),
    0
  );
  return { name: attrs(n).name ?? "", length, layers: parsed };
};

export function readXfl(files: Record<string, Uint8Array>): FlaDocument {
  const parse = (path: string) => {
    const data = files[path];
    if (!data) throw new Error("missing " + path);
    return parser.parse(strFromU8(data).replace(/^\uFEFF/, "")) as XNode[];
  };

  const root = parse("DOMDocument.xml").find((n) => tagOf(n) === "DOMDocument")!;
  const at = attrs(root);

  const symbols: Record<string, FlaSymbol> = {};
  const symbolList = child(root, "symbols");
  for (const inc of symbolList ? kids(symbolList, "Include") : []) {
    const item = parse("LIBRARY/" + attrs(inc).href).find((n) => tagOf(n) === "DOMSymbolItem")!;
    const itemAt = attrs(item);
    const tl = child(item, "timeline");
    const timeline = tl && child(tl, "DOMTimeline");
    symbols[itemAt.name] = {
      name: itemAt.name,
      type: itemAt.symbolType ?? "movie clip",
      timeline: timeline ? parseTimeline(timeline) : undefined
    };
  }

  const bitmaps: Record<string, FlaBitmap> = {};
  const media = child(root, "media");
  for (const b of media ? kids(media, "DOMBitmapItem") : []) {
    const bAt = attrs(b);
    bitmaps[bAt.name] = {
      name: bAt.name,
      width: num(bAt.frameRight, 0) / 20,
      height: num(bAt.frameBottom, 0) / 20,
      data: (bAt.bitmapDataHRef && files["bin/" + bAt.bitmapDataHRef]) ||  (bAt.href && files["LIBRARY/" + bAt.href])
    };
  }

  const timelines = child(root, "timelines");
  return {
    width: num(at.width, 550),
    height: num(at.height, 400),
    fps: num(at.frameRate, 24),
    backgroundColor: at.backgroundColor ?? "#FFFFFF",
    timelines: timelines ? kids(timelines, "DOMTimeline").map(parseTimeline) : [],
    symbols,
    bitmaps
  };
}

export function readFla(data: ArrayBuffer | Uint8Array): FlaDocument {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("not a zip based fla, resave it in cs5 or newer");
  }
  return readXfl(unzipSync(bytes));
}