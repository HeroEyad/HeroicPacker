import { inflateSync } from "fflate";
import type { FlaDocument, FlaElement, Matrix, Segment, Timeline } from "./AdobleFLAReader";

type ShapeElement = Extract<FlaElement, { type: "shape" }>;

type Item =
    | { kind: "shape"; m: Matrix; alpha: number; shape: ShapeElement }
    | { kind: "bitmap"; m: Matrix; alpha: number; image: HTMLCanvasElement };

type Box = [number, number, number, number];

export interface FlaSymbolInfo {
    id: string;
    name: string;
    type: string;
    frames: number;
}

export interface RenderedFrame {
    url: string;
    count: number;
}

export interface RenderedTimeline {
    width: number;
    height: number;
    frames: RenderedFrame[];
}

const identity: Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const maxSize = 8192;

const mul = (p: Matrix, c: Matrix): Matrix => ({
    a: p.a * c.a + p.c * c.b,
    b: p.b * c.a + p.d * c.b,
    c: p.a * c.c + p.c * c.d,
    d: p.b * c.c + p.d * c.d,
    tx: p.a * c.tx + p.c * c.ty + p.tx,
    ty: p.b * c.tx + p.d * c.ty + p.ty
});

const rgba = (color: string | undefined, alpha = 1) => {
    const n = parseInt((color ?? "#000000").slice(1), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + alpha + ")";
};

const adler32 = (data: Uint8Array) => {
    let a = 1;
    let b = 0;
    for (let i = 0; i < data.length; i++) {
        a = (a + data[i]) % 65521;
        b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
};

const isZlibHeader = (a: number, b: number) => (a & 0x0f) === 8 && ((a << 8) | b) % 31 === 0;

function inflateChunks(data: Uint8Array) {
    const chunks: Uint8Array[] = [];
    let pos = 0;

    while (pos < data.length - 6) {
        if (isZlibHeader(data[pos], data[pos + 1])) {
            try {
                const out = inflateSync(data.subarray(pos + 2));
                const sum = adler32(out);
                let end = -1;

                for (let p = pos + 2; p <= data.length - 4; p++) {
                    if (((data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3]) >>> 0 === sum) {
                        end = p + 4;
                        break;
                    }
                }

                if (end > 0) {
                    chunks.push(out);
                    pos = end;
                    continue;
                }
            }
            catch {}
        }
        pos++;
    }

    return chunks;
}

function pixelsToCanvas(src: Uint8Array, width: number, height: number) {
    let firstFull = 0;
    let lastFull = 0;
    for (let i = 0; i < src.length; i += 4) {
        if (src[i] === 255) firstFull++;
        if (src[i + 3] === 255) lastFull++;
    }
    const alphaFirst = firstFull > lastFull;

    let partial = 0;
    let overflow = 0;
    for (let i = 0; i < src.length; i += 4) {
        const a = alphaFirst ? src[i] : src[i + 3];
        if (a === 0 || a === 255) continue;
        partial++;
        const o = alphaFirst ? i + 1 : i;
        if (src[o] > a || src[o + 1] > a || src[o + 2] > a) overflow++;
    }
    const premultiplied = partial > 0 && overflow === 0;
    const out = new Uint8ClampedArray(src.length);

	// special thanks to KadeDev for making this a little better :heart_hands:
    const ao = alphaFirst ? 0 : 3;
    const ro = alphaFirst ? 1 : 2;
    const go = alphaFirst ? 2 : 1;
    const bo = alphaFirst ? 3 : 0;

    for (let i = 0; i < src.length; i += 4) {
        const a = src[i + ao];
        let r = src[i + ro];
        let g = src[i + go];
        let b = src[i + bo];

        if (premultiplied && a > 0 && a < 255) {
            const factor = 255 / a;
            r *= factor;
            g *= factor;
            b *= factor;
        }

        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
        out[i + 3] = a;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.putImageData(new ImageData(out, width, height), 0, 0);
    return canvas;
}

async function decodeDat(data: Uint8Array, width: number, height: number) {
    for (let i = 0; i < Math.min(64, data.length - 4); i++) {
        const png = data[i] === 0x89 && data[i + 1] === 0x50 && data[i + 2] === 0x4e && data[i + 3] === 0x47;
        const jpg = data[i] === 0xff && data[i + 1] === 0xd8 && data[i + 2] === 0xff;
        if (!png && !jpg) continue;

        const bitmap = await createImageBitmap(new Blob([data.slice(i)]));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
        bitmap.close();
        return canvas;
    }

    const size = width * height * 4;
    if (!size) return null;

    const chunks = inflateChunks(data);
    let pixels: Uint8Array | null = null;

    if (chunks.length) {
        const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let offset = 0;
        for (const c of chunks) {
            joined.set(c, offset);
            offset += c.length;
        }
        if (joined.length >= size) pixels = joined.subarray(0, size);
    }
    else if (data.length >= size) {
        pixels = data.subarray(data.length - size);
    }

    return pixels ? pixelsToCanvas(pixels, width, height) : null;
}

const flip = (s: Segment): Segment => s.type === "line"
    ? { type: "line", x0: s.x1, y0: s.y1, x1: s.x0, y1: s.y0 }
    : { ...s, x0: s.x1, y0: s.y1, x1: s.x0, y1: s.y0 };

const pointKey = (x: number, y: number) => x.toFixed(3) + "," + y.toFixed(3);

function buildPath(segments: Segment[]) {
    const path = new Path2D();
    const starts = new Map<string, number[]>();
    const used: boolean[] = [];

    segments.forEach((s, i) => {
        const key = pointKey(s.x0, s.y0);
        const list = starts.get(key);
        if (list) list.push(i);
        else starts.set(key, [i]);
    });

    for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;

        const startKey = pointKey(segments[i].x0, segments[i].y0);
        path.moveTo(segments[i].x0, segments[i].y0);

        let cur = i;
        while (cur !== -1) {
            used[cur] = true;
            const s = segments[cur];

            if (s.type === "line") path.lineTo(s.x1, s.y1);
            else path.quadraticCurveTo(s.cx, s.cy, s.x1, s.y1);

            const endKey = pointKey(s.x1, s.y1);
            if (endKey === startKey) {
                path.closePath();
                break;
            }

            cur = starts.get(endKey)?.find((j) => !used[j]) ?? -1;
        }
    }

    return path;
}

function buildStroke(segments: Segment[]) {
    const path = new Path2D();
    let x = NaN;
    let y = NaN;

    for (const s of segments) {
        if (pointKey(s.x0, s.y0) !== pointKey(x, y)) path.moveTo(s.x0, s.y0);

        if (s.type === "line") path.lineTo(s.x1, s.y1);
        else path.quadraticCurveTo(s.cx, s.cy, s.x1, s.y1);

        x = s.x1;
        y = s.y1;
    }

    return path;
}

function itemBox(item: Item): Box {
    const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
    const add = (x: number, y: number) => {
        const px = item.m.a * x + item.m.c * y + item.m.tx;
        const py = item.m.b * x + item.m.d * y + item.m.ty;
        box[0] = Math.min(box[0], px);
        box[1] = Math.min(box[1], py);
        box[2] = Math.max(box[2], px);
        box[3] = Math.max(box[3], py);
    };

    if (item.kind === "bitmap") {
        const { width, height } = item.image;
        add(0, 0);
        add(width, 0);
        add(0, height);
        add(width, height);
        return box;
    }

    for (const edge of item.shape.edges) {
        for (const s of edge.segments) {
            add(s.x0, s.y0);
            add(s.x1, s.y1);
            if (s.type === "curve") add(s.cx, s.cy);
        }
    }

    const weight = item.shape.strokes.reduce((max, s) => Math.max(max, s.weight), 0);
    const pad = weight * Math.max(1, Math.hypot(item.m.a, item.m.b), Math.hypot(item.m.c, item.m.d)) / 2;
    box[0] -= pad;
    box[1] -= pad;
    box[2] += pad;
    box[3] += pad;
    return box;
}

export function listSymbols(doc: FlaDocument): FlaSymbolInfo[] {
    const scenes = doc.timelines
        .map((tl, i) => ({ id: "scene:" + i, name: tl.name || "Scene " + (i + 1), type: "scene", frames: tl.length }))
        .filter((s) => s.frames > 0);

    const symbols = Object.values(doc.symbols)
        .filter((s) => s.timeline && s.timeline.length > 0)
        .map((s) => ({ id: "symbol:" + s.name, name: s.name, type: s.type, frames: s.timeline!.length }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const bitmaps = Object.values(doc.bitmaps)
        .map((b) => ({ id: "bitmap:" + b.name, name: b.name, type: "bitmap", frames: 1 }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return [...scenes, ...symbols, ...bitmaps];
}

export class FlaRenderer {
    readonly failedBitmaps = new Set<string>();
    private readonly cache = new Map<string, Promise<HTMLCanvasElement | null>>();
    private readonly images = new Map<string, HTMLCanvasElement>();

    constructor(private readonly doc: FlaDocument) {}

    timelineOf(id: string): Timeline | undefined {
        if (id.startsWith("scene:")) return this.doc.timelines[Number(id.slice(6))];
        return this.doc.symbols[id.slice(7)]?.timeline;
    }

    getNestedSymbolNames(tl: Timeline): string[] {
        const parts = new Set<string>();

        for (const layer of tl.layers) {
            for (const frame of layer.frames) {
                for (const el of frame.elements) {
                    if (el.type === "symbol" && el.name) {
                        parts.add(el.name);
                    }
                }
            }
        }

        return Array.from(parts);
    }

    private async bitmap(name: string) {
        let pending = this.cache.get(name);

        if (!pending) {
            const bitmap = this.doc.bitmaps[name];
            pending = bitmap?.data ? decodeDat(bitmap.data, bitmap.width, bitmap.height).catch((): null => null) : Promise.resolve(null);
            this.cache.set(name, pending);
        }

        const image = await pending;
        if (image) this.images.set(name, image);
        else this.failedBitmaps.add(name);
        return image;
    }

    private async collect(tl: Timeline, t: number, m: Matrix, alpha: number, out: Item[], depth: number) {
        if (depth > 16) return;

        for (let i = tl.layers.length - 1; i >= 0; i--) {
            const layer = tl.layers[i];
            const parent = layer.parentLayerIndex === undefined ? undefined : tl.layers[layer.parentLayerIndex];
            if (layer.type !== "normal" || !layer.visible || parent?.visible === false) continue;

            const frame = layer.frames.find((f) => t >= f.index && t < f.index + f.duration);
            if (frame) await this.collectElements(frame.elements, t - frame.index, m, alpha, out, depth);
        }
    }

    private async collectElements(elements: FlaElement[], offset: number, m: Matrix, alpha: number, out: Item[], depth: number) {
        for (const el of elements) {
            if (el.type === "shape") {
                for (const fill of el.fills) {
                    if (fill.type === "bitmap" && fill.bitmapPath) await this.bitmap(fill.bitmapPath);
                }
                out.push({ kind: "shape", m: mul(m, el.matrix), alpha, shape: el });
            }
            else if (el.type === "bitmap") {
                const image = await this.bitmap(el.name);
                if (image) out.push({ kind: "bitmap", m: mul(m, el.matrix), alpha, image });
            }
            else if (el.type === "group") {
                await this.collectElements(el.members, offset, mul(m, el.matrix), alpha, out, depth);
            }
            else {
                const tl = this.doc.symbols[el.name]?.timeline;
                if (!tl || !tl.length) continue;

                let frame = 0;
                if (el.symbolType !== "button") {
                    if (el.loop === "single frame") frame = el.firstFrame;
                    else if (el.loop === "play once") frame = Math.min(el.firstFrame + offset, tl.length - 1);
                    else frame = (el.firstFrame + offset) % tl.length;
                }

                const a = alpha * Number(el.color?.alphaMultiplier ?? 1);
                await this.collect(tl, frame, mul(m, el.matrix), a, out, depth + 1);
            }
        }
    }

    private fillPath(ctx: CanvasRenderingContext2D, path: Path2D, fill: ShapeElement["fills"][number]) {
        if (fill.type === "solid") {
            ctx.fillStyle = rgba(fill.color, fill.alpha);
            ctx.fill(path, "evenodd");
            return;
        }

        ctx.save();
        ctx.clip(path, "evenodd");
        if (fill.matrix) ctx.transform(fill.matrix.a, fill.matrix.b, fill.matrix.c, fill.matrix.d, fill.matrix.tx, fill.matrix.ty);

        if (fill.type === "bitmap") {
            const image = this.images.get(fill.bitmapPath ?? "");
            if (!image) {
                ctx.restore();
                return;
            }
            ctx.fillStyle = ctx.createPattern(image, "repeat")!;
        }
        else {
            const gradient = fill.type === "radial" ? ctx.createRadialGradient(0, 0, 0, 0, 0, 819.2) : ctx.createLinearGradient(-819.2, 0, 819.2, 0);

            for (const stop of fill.stops ?? []) {
                const ratio = stop.ratio > 1 ? stop.ratio / 255 : stop.ratio;
                gradient.addColorStop(Math.min(1, Math.max(0, ratio)), rgba(stop.color, stop.alpha));
            }
            ctx.fillStyle = gradient;
        }

        ctx.fillRect(-1e5, -1e5, 2e5, 2e5);
        ctx.restore();
    }

    private drawShape(ctx: CanvasRenderingContext2D, shape: ShapeElement) {
        const bySegments = new Map<number, Segment[]>();
        const add = (index: number, segments: Segment[]) => {
            const list = bySegments.get(index);
            if (list) list.push(...segments);
            else bySegments.set(index, [...segments]);
        };

        for (const edge of shape.edges) {
            if (edge.fill1) add(edge.fill1, edge.segments);
            if (edge.fill0) add(edge.fill0, edge.segments.map(flip).reverse());
        }

        for (const [index, segments] of bySegments) {
            const fill = shape.fills.find((f) => f.index === index);
            if (fill) this.fillPath(ctx, buildPath(segments), fill);
        }

        for (const edge of shape.edges) {
            const stroke = edge.stroke ? shape.strokes.find((s) => s.index === edge.stroke) : undefined;
            if (!stroke || !edge.segments.length) continue;

            const color = stroke.fill?.type === "solid" ? stroke.fill : stroke.fill?.stops?.[0];
            ctx.strokeStyle = rgba(color?.color, color?.alpha);
            ctx.lineWidth = Math.max(stroke.weight, 0.25);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.stroke(buildStroke(edge.segments));
        }
    }

    async renderTimeline(tl: Timeline): Promise<RenderedTimeline | null> {
        const frames: Item[][] = [];
        let box: Box = [Infinity, Infinity, -Infinity, -Infinity];

        for (let t = 0; t < tl.length; t++) {
            const items: Item[] = [];
            await this.collect(tl, t, identity, 1, items, 0);
            frames.push(items);

            for (const item of items) {
                const b = itemBox(item);
                box = [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])];
            }
        }

        if (!isFinite(box[0])) return null;

        const ox = Math.floor(box[0]) - 1;
        const oy = Math.floor(box[1]) - 1;
        const width = Math.ceil(box[2]) + 1 - ox;
        const height = Math.ceil(box[3]) + 1 - oy;
        if (width > maxSize || height > maxSize) throw new Error("too large: " + width + "x" + height);

        const out: RenderedFrame[] = [];

        for (const items of frames) {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext("2d")!;
            ctx.translate(-ox, -oy);

            for (const item of items) {
                ctx.save();
                ctx.globalAlpha = item.alpha;
                ctx.transform(item.m.a, item.m.b, item.m.c, item.m.d, item.m.tx, item.m.ty);

                if (item.kind === "bitmap") ctx.drawImage(item.image, 0, 0);
                else this.drawShape(ctx, item.shape);

                ctx.restore();
            }

            const url = canvas.toDataURL("image/png");
            const last = out[out.length - 1];
            if (last && last.url === url) last.count++;
            else out.push({ url, count: 1 });
        }

        return { width, height, frames: out };
    }

    async renderBitmap(name: string): Promise<RenderedTimeline | null> {
        const image = await this.bitmap(name);
        if (!image) return null;

        return {
            width: image.width,
            height: image.height,
            frames: [{ url: image.toDataURL("image/png"), count: 1 }]
        };
    }
}