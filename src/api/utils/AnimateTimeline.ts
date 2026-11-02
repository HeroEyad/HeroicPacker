import { getAnimationLabels, type AnimationLabel, type Json, type JsonObject } from './AnimateAtlas';

export type AtlasMatrix = readonly [number, number, number, number, number, number];

export type AtlasDraw = Readonly<{
	name: string;
	matrix: AtlasMatrix;
	alpha: number;
}>;

type SymbolType = "graphic" | "movieclip" | "button";
type LoopType = "loop" | "once" | "single";

type Element = Readonly<{
	sprite: string | null;
	symbol: string | null;
	matrix: AtlasMatrix;
	alpha: number;
	type: SymbolType;
	loop: LoopType;
	first: number;
}>;

type Keyframe = Readonly<{
	index: number;
	duration: number;
	elements: Element[];
}>;

type Layer = Readonly<{
	clipper: boolean;
	frames: Keyframe[];
}>;

type Timeline = Readonly<{
	layers: Layer[];
	length: number;
}>;

const IDENTITY: AtlasMatrix = [1, 0, 0, 1, 0, 0];
const MAX_DEPTH = 64;
const DEFAULT_FRAME_RATE = 24;

const isObject = (v: Json | undefined): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: Json | undefined): v is number => typeof v === "number" && isFinite(v);

function objects(value: Json | undefined): JsonObject[] {
	return Array.isArray(value) ? value.filter(isObject) : [];
}

function numberOr(value: Json | undefined, fallback: number) {
	return isNumber(value) ? value : fallback;
}

function text(value: Json | undefined) {
	return typeof value === "string" ? value : null;
}

export function concatMatrix(parent: AtlasMatrix, child: AtlasMatrix): AtlasMatrix {
	return [
		parent[0] * child[0] + parent[2] * child[1],
		parent[1] * child[0] + parent[3] * child[1],
		parent[0] * child[2] + parent[2] * child[3],
		parent[1] * child[2] + parent[3] * child[3],
		parent[0] * child[4] + parent[2] * child[5] + parent[4],
		parent[1] * child[4] + parent[3] * child[5] + parent[5]
	];
}

function readMatrix(owner: JsonObject): AtlasMatrix | null {
	const matrix = owner.M3D ?? owner.MX ?? owner.Matrix3D ?? owner.Matrix;
	let cells: (Json | undefined)[] | null = null;

	if (Array.isArray(matrix)) {
		if (matrix.length === 16) cells = [0, 1, 4, 5, 12, 13].map(i => matrix[i]);
		else if (matrix.length === 6) cells = matrix.slice();
	} else if (isObject(matrix)) {
		const keys = isNumber(matrix.m00) ? ["m00", "m01", "m10", "m11", "m30", "m31"] : ["a", "b", "c", "d", "tx", "ty"];
		cells = keys.map(key => matrix[key]);
	}

	if (!cells || !cells.every(isNumber)) return null;
	return [cells[0], cells[1], cells[2], cells[3], cells[4], cells[5]];
}

function readPosition(owner: JsonObject): AtlasMatrix | null {
	const position = owner.POS ?? owner.Position;
	if (!isObject(position)) return null;
	return [1, 0, 0, 1, numberOr(position.x, 0), numberOr(position.y, 0)];
}

function readAlpha(instance: JsonObject) {
	const color = instance.C ?? instance.color;
	if (!isObject(color)) return 1;
	return Math.max(0, Math.min(1, numberOr(color.AM ?? color.alphaMultiplier, 1)));
}

function readSymbolType(value: Json | undefined): SymbolType {
	if (value === "MC" || value === "movieclip") return "movieclip";
	if (value === "B" || value === "button") return "button";
	return "graphic";
}

function readLoop(value: Json | undefined): LoopType {
	if (value === "PO" || value === "playonce") return "once";
	if (value === "SF" || value === "singleframe") return "single";
	return "loop";
}

function readElement(element: JsonObject): Element | null {
	const sprite = element.ASI ?? element.ATLAS_SPRITE_instance;
	if (isObject(sprite)) {
		const name = text(sprite.N ?? sprite.name);
		if (name === null) return null;
		return {
			sprite: name,
			symbol: null,
			matrix: readMatrix(sprite) ?? readPosition(sprite) ?? IDENTITY,
			alpha: 1,
			type: "graphic",
			loop: "loop",
			first: 0
		};
	}

	const instance = element.SI ?? element.SYMBOL_Instance;
	if (!isObject(instance)) return null;

	const matrix = readMatrix(instance) ?? IDENTITY;
	const alpha = readAlpha(instance);

	const bitmap = isObject(instance.BM) ? instance.BM : instance.bitmap;
	if (isObject(bitmap)) {
		const name = text(bitmap.N ?? bitmap.name);
		if (name !== null) {
			const position = readPosition(bitmap);
			return {
				sprite: name,
				symbol: null,
				matrix: position ? concatMatrix(matrix, position) : matrix,
				alpha,
				type: "graphic",
				loop: "loop",
				first: 0
			};
		}
	}

	const name = text(instance.SN ?? instance.SYMBOL_name);
	if (name === null) return null;

	return {
		sprite: null,
		symbol: name,
		matrix,
		alpha,
		type: readSymbolType(instance.ST ?? instance.symbolType),
		loop: readLoop(instance.LP ?? instance.loop),
		first: Math.max(0, Math.floor(numberOr(instance.FF ?? instance.firstFrame, 0)))
	};
}

function readTimeline(timeline: Json | undefined): Timeline {
	const layers: Layer[] = [];
	let length = 0;

	if (isObject(timeline)) {
		for (const layer of objects(timeline.L ?? timeline.LAYERS)) {
			const type = layer.LT ?? layer.Layer_type;
			const frames: Keyframe[] = [];

			for (const frame of objects(layer.FR ?? layer.Frames)) {
				const index = Math.floor(numberOr(frame.I ?? frame.index, 0));
				const duration = Math.max(1, Math.floor(numberOr(frame.DU ?? frame.duration, 1)));
				const elements: Element[] = [];

				for (const item of objects(frame.E ?? frame.elements)) {
					const element = readElement(item);
					if (element) elements.push(element);
				}

				frames.push({ index, duration, elements });
				length = Math.max(length, index + duration);
			}

			frames.sort((a, b) => a.index - b.index);
			layers.push({ clipper: type === "Clp" || type === "Clipper", frames });
		}
	}

	return { layers, length };
}

function findKeyframe(frames: Keyframe[], frame: number) {
	let low = 0;
	let high = frames.length - 1;

	while (low <= high) {
		const mid = (low + high) >> 1;
		const key = frames[mid];
		if (frame < key.index) high = mid - 1;
		else if (frame >= key.index + key.duration) low = mid + 1;
		else return key;
	}

	return null;
}

export class AnimateTimeline {
	readonly frameCount: number;
	readonly frameRate: number;
	readonly labels: AnimationLabel[];

	private readonly main: Timeline;
	private readonly symbols = new Map<string, Timeline>();

	constructor(json: JsonObject) {
		const animation = json.AN ?? json.ANIMATION;
		this.main = readTimeline(isObject(animation) ? (animation.TL ?? animation.TIMELINE) : undefined);

		const dictionary = json.SD ?? json.SYMBOL_DICTIONARY;
		if (isObject(dictionary)) {
			for (const symbol of objects(dictionary.S ?? dictionary.Symbols)) {
				const name = text(symbol.SN ?? symbol.SYMBOL_name);
				if (name !== null) this.symbols.set(name, readTimeline(symbol.TL ?? symbol.TIMELINE));
			}
		}

		const meta = json.MD ?? json.metadata;
		const frameRate = isObject(meta) ? numberOr(meta.FRT ?? meta.framerate, DEFAULT_FRAME_RATE) : DEFAULT_FRAME_RATE;

		this.frameRate = frameRate > 0 ? frameRate : DEFAULT_FRAME_RATE;
		this.frameCount = this.main.length;
		this.labels = getAnimationLabels(json);
	}

	getDraws(frame: number): AtlasDraw[] {
		const draws: AtlasDraw[] = [];
		this.collect(this.main, frame, IDENTITY, 1, draws, 0);
		return draws;
	}

	private childFrame(element: Element, child: Timeline, elapsed: number) {
		const length = Math.max(1, child.length);

		if (element.type === "button") return 0;
		if (element.type === "movieclip") return elapsed % length;

		if (element.loop === "single") return Math.min(length - 1, element.first);
		if (element.loop === "once") return Math.min(length - 1, element.first + elapsed);
		return (element.first + elapsed) % length;
	}

	private collect(timeline: Timeline, frame: number, matrix: AtlasMatrix, alpha: number, draws: AtlasDraw[], depth: number) {
		for (let i = timeline.layers.length - 1; i >= 0; i--) {
			const layer = timeline.layers[i];
			if (layer.clipper) continue;

			const key = findKeyframe(layer.frames, frame);
			if (!key) continue;

			for (const element of key.elements) {
				const elementMatrix = concatMatrix(matrix, element.matrix);
				const elementAlpha = alpha * element.alpha;

				if (element.sprite !== null) {
					draws.push({ name: element.sprite, matrix: elementMatrix, alpha: elementAlpha });
					continue;
				}

				const child = this.symbols.get(element.symbol);
				if (!child || depth >= MAX_DEPTH) continue;

				this.collect(child, this.childFrame(element, child, frame - key.index), elementMatrix, elementAlpha, draws, depth + 1);
			}
		}
	}
}
