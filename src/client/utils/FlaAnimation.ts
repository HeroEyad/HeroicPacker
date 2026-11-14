import { getAnimationInfo, getAnimationLabels, parseAnimationJson, type Json, type JsonObject } from "api/utils/AnimateAtlas";
import type { FlaDocument, FlaElement, Matrix, Timeline } from "./AdobleFLAReader";
import { mul, type FlaRenderer } from "./FlaRenderer";

export interface FlaPart {
    name: string;
    url: string;
}

export interface FlaAnimationResult {
    label: string;
    length: number;
    rootSymbol: string;
    symbols: JsonObject[];
    parts: FlaPart[];
}

type ShapeElement = Extract<FlaElement, { type: "shape" }>;
type ShapePart = { sprite: string; x: number; y: number } | null;

const identity: Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const symbolTypes: Record<string, string> = { graphic: "G", "movie clip": "MC", button: "B" };
const loopTypes: Record<string, string> = { loop: "LP", "play once": "PO", "single frame": "SF" };

const tidy = (v: number) => Math.round(v * 1000) / 1000 || 0;
const toMatrix = (m: Matrix) => [m.a, m.b, m.c, m.d, m.tx, m.ty].map(tidy);

const isObject = (v: Json | undefined): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const objects = (v: Json | undefined) => (Array.isArray(v) ? v.filter(isObject) : []);

export async function buildFlaAnimation(doc: FlaDocument, renderer: FlaRenderer, root: Timeline, rootName: string, label: string, taken: Set<string>): Promise<FlaAnimationResult | null> {
    const parts: FlaPart[] = [];
    const symbols: JsonObject[] = [];
    const symbolNames = new Map<string, string | null>();
    const bitmapSprites = new Map<string, string | null>();
    const shapeSprites = new Map<string, ShapePart>();

    const claim = (base: string) => {
        let name = base || "part";
        for (let i = 2; taken.has(name); i++) name = base + "_" + i;
        taken.add(name);
        return name;
    };

    const bitmapSprite = async (name: string) => {
        if (bitmapSprites.has(name)) return bitmapSprites.get(name)!;

        const image = await renderer.bitmap(name);
        let sprite: string | null = null;

        if (image) {
            sprite = claim((name.split("/").pop() || name).replace(/\.[^.]+$/, ""));
            parts.push({ name: sprite, url: image.toDataURL("image/png") });
        }

        bitmapSprites.set(name, sprite);
        return sprite;
    };

    const shapeSprite = async (shape: ShapeElement) => {
        const key = JSON.stringify([shape.fills, shape.strokes, shape.edges]);
        if (shapeSprites.has(key)) return shapeSprites.get(key)!;

        const rendered = await renderer.renderShape(shape);
        let part: ShapePart = null;

        if (rendered) {
            part = { sprite: claim("shape"), x: rendered.x, y: rendered.y };
            parts.push({ name: part.sprite, url: rendered.url });
        }

        shapeSprites.set(key, part);
        return part;
    };

    const convertElements = async (elements: FlaElement[], base: Matrix, out: Json[]) => {
        for (const el of elements) {
            if (el.type === "bitmap") {
                const sprite = await bitmapSprite(el.name);
                if (sprite) out.push({ ASI: { N: sprite, MX: toMatrix(mul(base, el.matrix)) } });
            }
            else if (el.type === "shape") {
                const part = await shapeSprite(el);
                if (!part) continue;

                const m = mul(mul(base, el.matrix), { ...identity, tx: part.x, ty: part.y });
                out.push({ ASI: { N: part.sprite, MX: toMatrix(m) } });
            }
            else if (el.type === "group") {
                await convertElements(el.members, mul(base, el.matrix), out);
            }
            else {
                const name = await convertSymbol(el.name);
                if (name === null) continue;

                const instance: JsonObject = {
                    SN: name,
                    FF: el.firstFrame,
                    ST: symbolTypes[el.symbolType] ?? "MC",
                    LP: loopTypes[el.loop] ?? "LP",
                    MX: toMatrix(mul(base, el.matrix))
                };

                const alpha = Number(el.color?.alphaMultiplier ?? 1);
                if (alpha !== 1) instance.C = { M: "CA", AM: tidy(alpha) };

                out.push({ SI: instance });
            }
        }
    };

    const convertTimeline = async (tl: Timeline) => {
        const layers: Json[] = [];
        let length = 0;

        for (const layer of tl.layers) {
            const parent = layer.parentLayerIndex === undefined ? undefined : tl.layers[layer.parentLayerIndex];
            if (layer.type !== "normal" || !layer.visible || parent?.visible === false) continue;

            const frames: Json[] = [];
            for (const frame of layer.frames) {
                const elements: Json[] = [];
                await convertElements(frame.elements, identity, elements);
                frames.push({ I: frame.index, DU: frame.duration, E: elements });
                length = Math.max(length, frame.index + frame.duration);
            }

            layers.push({ LN: layer.name, FR: frames });
        }

        if (length < tl.length) layers.push({ LN: "length", FR: [{ I: length, DU: tl.length - length, E: [] }] });
        return { L: layers };
    };

    const convertSymbol = async (name: string) => {
        if (symbolNames.has(name)) return symbolNames.get(name)!;

        const tl = doc.symbols[name]?.timeline;
        if (!tl || !tl.length) {
            symbolNames.set(name, null);
            return null;
        }

        const sn = label + "/" + name;
        symbolNames.set(name, sn);

        const entry: JsonObject = { SN: sn, TL: { L: [] } };
        symbols.push(entry);
        entry.TL = await convertTimeline(tl);

        return sn;
    };

    const rootSymbol = label + "/" + rootName;
    const entry: JsonObject = { SN: rootSymbol, TL: { L: [] } };
    symbols.push(entry);
    entry.TL = await convertTimeline(root);

    if (!parts.length) return null;
    return { label, length: root.length, rootSymbol, symbols, parts };
}

const keyOf = (node: JsonObject, short: string, long: string) => (node[short] !== undefined || node[long] === undefined ? short : long);

function ensureObject(owner: JsonObject, short: string, long: string) {
    const key = keyOf(owner, short, long);
    if (!isObject(owner[key])) owner[key] = {};
    return owner[key] as JsonObject;
}

function ensureList(owner: JsonObject, short: string, long: string) {
    const key = keyOf(owner, short, long);
    if (!Array.isArray(owner[key])) owner[key] = [];
    return owner[key] as JsonObject[];
}

const layerName = (layer: JsonObject) => layer.LN ?? layer.Layer_name;
const frameList = (layer: JsonObject) => ensureList(layer, "FR", "Frames");

function timelineLength(layers: JsonObject[]) {
    let length = 0;

    for (const layer of layers) {
        for (const frame of objects(layer.FR ?? layer.Frames)) {
            const index = Number(frame.I ?? frame.index ?? 0);
            const duration = Number(frame.DU ?? frame.duration ?? 1);
            length = Math.max(length, index + Math.max(1, duration));
        }
    }

    return length;
}

function mainLayers(json: JsonObject) {
    const animation = ensureObject(json, "AN", "ANIMATION");
    const timeline = ensureObject(animation, "TL", "TIMELINE");
    return ensureList(timeline, "L", "LAYERS");
}

function findLayer(layers: JsonObject[], name: string) {
    let layer = layers.find((item) => layerName(item) === name);

    if (!layer) {
        layer = { LN: name, FR: [] };
        layers.push(layer);
    }

    return layer;
}

export function appendAnimations(existing: string | null, name: string, fps: number, results: FlaAnimationResult[]) {
    const json: JsonObject = (existing && parseAnimationJson(existing)) || {
        AN: { N: name, SN: name, TL: { L: [] } },
        SD: { S: [] },
        MD: { N: name, FRT: fps }
    };

    const layers = mainLayers(json);
    const labels = frameList(findLayer(layers, "Labels"));
    const placed = frameList(findLayer(layers, "Animations"));
    const dictionary = ensureList(ensureObject(json, "SD", "SYMBOL_DICTIONARY"), "S", "Symbols");
    let start = timelineLength(layers);

    for (const result of results) {
        labels.push({ N: result.label, I: start, DU: result.length, E: [] });
        placed.push({ I: start, DU: result.length, E: [{ SI: { SN: result.rootSymbol, FF: 0, ST: "G", LP: "LP", MX: [1, 0, 0, 1, 0, 0] } }] });
        dictionary.push(...result.symbols);
        start += result.length;
    }

    return JSON.stringify(json);
}

export function removeAnimation(data: string, label: string) {
    const json = parseAnimationJson(data);
    if (!json) return data;

    const target = getAnimationLabels(json).find((item) => item.name === label);
    if (!target) return data;

    const start = target.start;
    const end = target.start + target.length;
    const length = target.length;

    for (const layer of mainLayers(json)) {
        const kept: JsonObject[] = [];

        for (const frame of frameList(layer)) {
            const indexKey = keyOf(frame, "I", "index");
            const durationKey = keyOf(frame, "DU", "duration");
            const a = Number(frame[indexKey] ?? 0);
            const b = a + Math.max(1, Number(frame[durationKey] ?? 1));

            if (b <= start) {
                kept.push(frame);
            }
            else if (a >= end) {
                frame[indexKey] = a - length;
                kept.push(frame);
            }
            else if (a < start && b > end) {
                frame[durationKey] = b - a - length;
                kept.push(frame);
            }
            else if (a < start) {
                frame[durationKey] = start - a;
                kept.push(frame);
            }
            else if (b > end) {
                frame[indexKey] = start;
                frame[durationKey] = b - end;
                kept.push(frame);
            }
        }

        layer[keyOf(layer, "FR", "Frames")] = kept;
    }

    const dictionary = ensureObject(json, "SD", "SYMBOL_DICTIONARY");
    const listKey = keyOf(dictionary, "S", "Symbols");
    dictionary[listKey] = objects(dictionary[listKey]).filter((symbol) => !String(symbol.SN ?? symbol.SYMBOL_name ?? "").startsWith(label + "/"));

    return JSON.stringify(json);
}

export function animationIsEmpty(data: string) {
    const json = parseAnimationJson(data);
    return !json || getAnimationInfo(json).sprites.size === 0;
}

export function spriteNames(data: string | null) {
    const json = data ? parseAnimationJson(data) : null;
    return json ? new Set(getAnimationInfo(json).sprites.keys()) : new Set<string>();
}

let labelCache: { data: string; names: Set<string> } | null = null;

export function animationLabelNames(data: string | null) {
    if (!data) return new Set<string>();
    if (labelCache && labelCache.data === data) return labelCache.names;

    const json = parseAnimationJson(data);
    const names = new Set<string>(json ? getAnimationLabels(json).map((item) => item.name) : []);

    labelCache = { data, names };
    return names;
}
