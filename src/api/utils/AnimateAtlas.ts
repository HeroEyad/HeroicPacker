import type { Rect } from "api/types";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type AnimationOffset = Readonly<{
	x: number;
	y: number;
}>;

export type AnimationInfo = Readonly<{
	sprites: ReadonlyMap<string, number>;
	symbols: number;
}>;

export type AnimationLabel = Readonly<{
	name: string;
	start: number;
	length: number;
}>;

export const WHOLE_ANIMATION = "";

const isObject = (v: Json | undefined): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: Json | undefined): v is number => typeof v === "number" && isFinite(v);

function tidy(v: number) {
	const r = Math.round(v * 1000) / 1000;
	return r === 0 ? 0 : r;
}

const MATRIX_KEYS = ["M3D", "MX", "Matrix3D", "Matrix"] as const;
const POINT_KEYS = new Set(["TRP", "transformationPoint", "POS", "Position"]);
const POSITION_KEYS = ["POS", "Position"] as const;
const SPRITE_KEYS = new Set(["ASI", "ATLAS_SPRITE_instance"]);
const SYMBOL_KEYS = new Set(["SI", "SYMBOL_Instance"]);
const BITMAP_KEYS = ["BM", "bitmap"] as const;
const DICTIONARY_KEYS = ["SD", "SYMBOL_DICTIONARY"] as const;
const SYMBOL_LIST_KEYS = ["S", "Symbols"] as const;
const FILTER_KEYS = new Set(["F", "filters"]);
const FILTER_SIZE_KEYS = new Set(["BLX", "BLY", "blurX", "blurY", "DST", "distance"]);
const META_KEYS = new Set(["MD", "metadata"]);
const STAGE_SIZE_KEYS = new Set(["W", "H", "width", "height"]);
const ANIMATION_KEYS = ["AN", "ANIMATION"] as const;
const TIMELINE_KEYS = ["TL", "TIMELINE"] as const;
const LAYER_KEYS = ["L", "LAYERS"] as const;
const FRAME_KEYS = ["FR", "Frames"] as const;
const ELEMENT_KEYS = ["E", "elements"] as const;
const INDEX_KEYS = ["I", "index"] as const;
const DURATION_KEYS = ["DU", "duration"] as const;
const NAME_KEYS = ["N", "name"] as const;
const SPRITE_INSTANCE_KEYS = ["ASI", "ATLAS_SPRITE_instance"] as const;
const SYMBOL_INSTANCE_KEYS = ["SI", "SYMBOL_Instance"] as const;
const SYMBOL_NAME_KEYS = ["SN", "SYMBOL_name"] as const;
const SYMBOL_TYPE_KEYS = ["ST", "symbolType"] as const;
const FIRST_FRAME_KEYS = ["FF", "firstFrame"] as const;
const LOOP_KEYS = ["LP", "loop"] as const;

export function parseAnimationJson(data: string): JsonObject | null {
	try {
		if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1);
		const json = JSON.parse(data) as Json;
		if (!isObject(json)) return null;
		if (isObject(json.AN) || isObject(json.ANIMATION)) return json;
		return null;
	} catch (e) {
		return null;
	}
}

export function isAnimationJson(data: string) {
	if (data.indexOf('"AN"') === -1 && data.indexOf('"ANIMATION"') === -1) return false;
	return parseAnimationJson(data) !== null;
}

function spriteName(sprite: JsonObject) {
	const name = sprite.N ?? sprite.name;
	return typeof name === "string" ? name : null;
}

function getBitmap(symbol: JsonObject) {
	for (const key of BITMAP_KEYS) {
		const bitmap = symbol[key];
		if (isObject(bitmap) && spriteName(bitmap) !== null) return bitmap;
	}
	return null;
}

function getChild(node: JsonObject, keys: ReadonlyArray<string>) {
	for (const key of keys) {
		const value = node[key];
		if (value !== undefined) return value;
	}
	return undefined;
}

export function getAnimationInfo(json: JsonObject): AnimationInfo {
	const sprites = new Map<string, number>();

	const use = (name: string | null) => {
		if (name !== null) sprites.set(name, (sprites.get(name) ?? 0) + 1);
	};

	const visit = (node: Json) => {
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		if (!isObject(node)) return;

		for (const key of Object.keys(node)) {
			const value = node[key];
			if (isObject(value)) {
				if (SPRITE_KEYS.has(key)) use(spriteName(value));
				else if (SYMBOL_KEYS.has(key)) {
					const bitmap = getBitmap(value);
					if (bitmap) use(spriteName(bitmap));
				}
			}
			visit(value);
		}
	};
	visit(json);

	let symbols = 0;
	const dictionary = getChild(json, DICTIONARY_KEYS);
	if (isObject(dictionary)) {
		const list = getChild(dictionary, SYMBOL_LIST_KEYS);
		if (Array.isArray(list)) symbols = list.length;
	}

	return { sprites, symbols };
}

function scaleMatrix(matrix: Json, scale: number) {
	if (Array.isArray(matrix)) {
		if (matrix.length === 16) {
			for (const i of [12, 13, 14]) {
				const v = matrix[i];
				if (isNumber(v)) matrix[i] = tidy(v * scale);
			}
		} else if (matrix.length === 6) {
			for (const i of [4, 5]) {
				const v = matrix[i];
				if (isNumber(v)) matrix[i] = tidy(v * scale);
			}
		}
	} else if (isObject(matrix)) {
		for (const key of ["m30", "m31", "m32", "tx", "ty"]) {
			const v = matrix[key];
			if (isNumber(v)) matrix[key] = tidy(v * scale);
		}
	}
}

function translate(owner: JsonObject, x: number, y: number, throughMatrix: boolean) {
	const matrix = getChild(owner, MATRIX_KEYS);

	let at: ReadonlyArray<number | string>;
	let cells: { [key: string | number]: Json };

	if (Array.isArray(matrix) && (matrix.length === 16 || matrix.length === 6)) {
		at = matrix.length === 16 ? [0, 1, 4, 5, 12, 13] : [0, 1, 2, 3, 4, 5];
		cells = matrix as { [key: number]: Json };
	} else if (isObject(matrix)) {
		at = isNumber(matrix.m00) ? ["m00", "m01", "m10", "m11", "m30", "m31"] : ["a", "b", "c", "d", "tx", "ty"];
		cells = matrix;
	} else {
		return false;
	}

	const m = at.map(i => cells[i]);
	if (!m.every(isNumber)) return false;

	const dx = throughMatrix ? m[0] * x + m[2] * y : x;
	const dy = throughMatrix ? m[1] * x + m[3] * y : y;
	cells[at[4]] = tidy(m[4] + dx);
	cells[at[5]] = tidy(m[5] + dy);

	const decomposed = owner.DecomposedMatrix;
	if (isObject(decomposed)) {
		const position = getChild(decomposed, POSITION_KEYS);
		if (isObject(position)) {
			if (isNumber(position.x)) position.x = tidy(position.x + dx);
			if (isNumber(position.y)) position.y = tidy(position.y + dy);
		}
	}

	return true;
}

function translateLocal(owner: JsonObject, x: number, y: number) {
	return translate(owner, x, y, true);
}

function movePosition(owner: JsonObject, x: number, y: number) {
	let position = getChild(owner, POSITION_KEYS);
	if (!isObject(position)) {
		position = { x: 0, y: 0 };
		owner[owner.N !== undefined ? "POS" : "Position"] = position;
	}
	position.x = tidy((isNumber(position.x) ? position.x : 0) + x);
	position.y = tidy((isNumber(position.y) ? position.y : 0) + y);
}

function objectList(value: Json | undefined): JsonObject[] {
	return Array.isArray(value) ? value.filter(isObject) : [];
}

function mainTimeline(json: JsonObject) {
	const animation = getChild(json, ANIMATION_KEYS);
	const timeline = isObject(animation) ? getChild(animation, TIMELINE_KEYS) : undefined;
	return isObject(timeline) ? timeline : null;
}

function frameRange(frame: JsonObject) {
	const index = getChild(frame, INDEX_KEYS);
	const duration = getChild(frame, DURATION_KEYS);
	const start = isNumber(index) ? Math.floor(index) : 0;
	return { start, end: start + (isNumber(duration) ? Math.max(1, Math.floor(duration)) : 1) };
}

function timelineLength(timeline: JsonObject) {
	let length = 0;
	for (const layer of objectList(getChild(timeline, LAYER_KEYS))) {
		for (const frame of objectList(getChild(layer, FRAME_KEYS))) {
			length = Math.max(length, frameRange(frame).end);
		}
	}
	return length;
}

export function getAnimationLabels(json: JsonObject): AnimationLabel[] {
	const timeline = mainTimeline(json);
	if (!timeline) return [];

	const starts = new Map<string, number>();
	for (const layer of objectList(getChild(timeline, LAYER_KEYS))) {
		for (const frame of objectList(getChild(layer, FRAME_KEYS))) {
			const name = getChild(frame, NAME_KEYS);
			if (typeof name !== "string" || !name) continue;

			const start = frameRange(frame).start;
			const known = starts.get(name);
			if (known === undefined || start < known) starts.set(name, start);
		}
	}

	const total = timelineLength(timeline);
	const sorted = [...starts.entries()].sort((a, b) => a[1] - b[1]);
	const labels: AnimationLabel[] = [];

	for (let i = 0; i < sorted.length; i++) {
		const [name, start] = sorted[i];
		const end = i + 1 < sorted.length ? sorted[i + 1][1] : total;
		if (end > start) labels.push({ name, start, length: end - start });
	}

	return labels;
}

export function getAnimationOffsetAt(labels: ReadonlyArray<AnimationLabel>, offsets: ReadonlyMap<string, AnimationOffset>, frame: number): AnimationOffset {
	const whole = offsets.get(WHOLE_ANIMATION);
	let x = whole ? whole.x : 0;
	let y = whole ? whole.y : 0;

	for (const label of labels) {
		if (frame < label.start || frame >= label.start + label.length) continue;

		const offset = offsets.get(label.name);
		if (offset) {
			x += offset.x;
			y += offset.y;
		}
		break;
	}

	return { x, y };
}

function moveInstance(instance: JsonObject, isSprite: boolean, x: number, y: number) {
	if (translate(instance, x, y, false)) return;

	if (isSprite) {
		movePosition(instance, x, y);
		return;
	}

	const bitmap = getBitmap(instance);
	if (bitmap) {
		movePosition(bitmap, x, y);
		return;
	}

	if (instance.SN !== undefined) {
		instance.M3D = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tidy(x), tidy(y), 0, 1];
	} else {
		instance.Matrix3D = {
			m00: 1, m01: 0, m02: 0, m03: 0,
			m10: 0, m11: 1, m12: 0, m13: 0,
			m20: 0, m21: 0, m22: 1, m23: 0,
			m30: tidy(x), m31: tidy(y), m32: 0, m33: 1
		};
	}
}

function moveElements(frame: JsonObject, x: number, y: number) {
	if (x === 0 && y === 0) return;

	for (const element of objectList(getChild(frame, ELEMENT_KEYS))) {
		const sprite = getChild(element, SPRITE_INSTANCE_KEYS);
		if (isObject(sprite)) moveInstance(sprite, true, x, y);

		const symbol = getChild(element, SYMBOL_INSTANCE_KEYS);
		if (isObject(symbol)) moveInstance(symbol, false, x, y);
	}
}

function setChild(node: JsonObject, keys: ReadonlyArray<string>, value: Json) {
	for (const key of keys) {
		if (node[key] !== undefined) {
			node[key] = value;
			return;
		}
	}
	node[keys[0]] = value;
}

function advanceFirstFrames(frame: JsonObject, elapsed: number, symbolLength: (name: string) => number) {
	for (const element of objectList(getChild(frame, ELEMENT_KEYS))) {
		const instance = getChild(element, SYMBOL_INSTANCE_KEYS);
		if (!isObject(instance)) continue;

		const type = getChild(instance, SYMBOL_TYPE_KEYS);
		const first = getChild(instance, FIRST_FRAME_KEYS);
		if ((type !== "G" && type !== "graphic") || !isNumber(first)) continue;

		const loop = getChild(instance, LOOP_KEYS);
		if (loop === "SF" || loop === "singleframe") continue;

		const name = getChild(instance, SYMBOL_NAME_KEYS);
		const length = typeof name === "string" ? symbolLength(name) : 0;
		let next = first + elapsed;

		if (length > 0) {
			next = (loop === "PO" || loop === "playonce") ? Math.min(length - 1, next) : next % length;
		}

		setChild(instance, FIRST_FRAME_KEYS, next);
	}
}

function applyLabelOffsets(json: JsonObject, offsets: ReadonlyMap<string, AnimationOffset>) {
	const timeline = mainTimeline(json);
	if (!timeline) return;

	const labels = getAnimationLabels(json);
	const total = timelineLength(timeline);

	const cuts = new Set<number>([0, total]);
	for (const label of labels) {
		cuts.add(label.start);
		cuts.add(label.start + label.length);
	}
	const points = [...cuts].sort((a, b) => a - b);

	const segments: { start: number, end: number, x: number, y: number }[] = [];
	for (let i = 0; i + 1 < points.length; i++) {
		const offset = getAnimationOffsetAt(labels, offsets, points[i]);
		const last = segments[segments.length - 1];
		if (last && last.x === offset.x && last.y === offset.y) last.end = points[i + 1];
		else segments.push({ start: points[i], end: points[i + 1], x: offset.x, y: offset.y });
	}

	let lengths: Map<string, number> | null = null;
	const symbolLength = (name: string) => {
		if (!lengths) {
			lengths = new Map();
			const dictionary = getChild(json, DICTIONARY_KEYS);
			if (isObject(dictionary)) {
				for (const symbol of objectList(getChild(dictionary, SYMBOL_LIST_KEYS))) {
					const symbolName = getChild(symbol, SYMBOL_NAME_KEYS);
					const symbolTimeline = getChild(symbol, TIMELINE_KEYS);
					if (typeof symbolName === "string" && isObject(symbolTimeline)) lengths.set(symbolName, timelineLength(symbolTimeline));
				}
			}
		}
		return lengths.get(name) ?? 0;
	};

	for (const layer of objectList(getChild(timeline, LAYER_KEYS))) {
		const key = FRAME_KEYS.find(item => Array.isArray(layer[item]));
		if (!key) continue;

		const frames: Json[] = [];

		for (const frame of layer[key] as Json[]) {
			if (!isObject(frame)) {
				frames.push(frame);
				continue;
			}

			const range = frameRange(frame);
			const parts = segments.filter(segment => segment.start < range.end && segment.end > range.start);

			if (parts.length <= 1 || !objectList(getChild(frame, ELEMENT_KEYS)).length) {
				if (parts.length === 1) moveElements(frame, parts[0].x, parts[0].y);
				frames.push(frame);
				continue;
			}

			const copies = parts.map((_, index) => index === 0 ? frame : JSON.parse(JSON.stringify(frame)) as JsonObject);

			parts.forEach((part, index) => {
				const copy = copies[index];
				const start = Math.max(range.start, part.start);
				const end = Math.min(range.end, part.end);

				setChild(copy, INDEX_KEYS, start);
				setChild(copy, DURATION_KEYS, end - start);

				if (index > 0) {
					for (const name of NAME_KEYS) delete copy[name];
					advanceFirstFrames(copy, start - range.start, symbolLength);
				}

				moveElements(copy, part.x, part.y);
				frames.push(copy);
			});
		}

		layer[key] = frames;
	}
}

type WriteStyle = Readonly<{
	newline: string;
	indent: string;
	colon: string;
	inline: boolean;
}>;

function detectStyle(data: string): WriteStyle | null {
	const firstBreak = data.indexOf("\n");
	if (firstBreak === -1 || firstBreak > 200) return null;

	const newline = data[firstBreak - 1] === "\r" ? "\r\n" : "\n";

	let end = firstBreak + 1;
	while (data[end] === " " || data[end] === "\t") end++;
	const indent = data.slice(firstBreak + 1, end);

	const head = data.slice(0, 20000);
	const colon = /"\s*:\s*[^\s]/.exec(head);

	return {
		newline,
		indent,
		colon: colon && /:\s/.test(colon[0]) ? ": " : ":",
		inline: /\[[ \t]*-?\d/.test(head)
	};
}

const isPlain = (v: Json) => v === null || typeof v !== "object";

function write(value: Json, style: WriteStyle, depth: number): string {
	if (isPlain(value)) return JSON.stringify(value);

	const isArray = Array.isArray(value);
	const keys = isArray ? null : Object.keys(value);
	const count = isArray ? value.length : keys.length;
	if (count === 0) return isArray ? "[]" : "{}";

	if (style.inline && (isArray ? value.every(isPlain) : keys.every(key => isPlain((value as JsonObject)[key])))) {
		return JSON.stringify(value);
	}

	const pad = style.indent.repeat(depth + 1);
	const parts: string[] = [];
	if (isArray) {
		for (const item of value) parts.push(pad + write(item, style, depth + 1));
	} else {
		for (const key of keys) parts.push(pad + JSON.stringify(key) + style.colon + write((value as JsonObject)[key], style, depth + 1));
	}

	return (isArray ? "[" : "{") + style.newline + parts.join("," + style.newline) + style.newline + style.indent.repeat(depth) + (isArray ? "]" : "}");
}

function hasAnyOffset(offsets: ReadonlyMap<string, AnimationOffset> | undefined) {
	if (!offsets) return false;
	for (const offset of offsets.values()) {
		if (offset.x !== 0 || offset.y !== 0) return true;
	}
	return false;
}

export function getPackedSpriteOffsets(sheets: ReadonlyArray<ReadonlyArray<Rect>>) {
	const offsets = new Map<string, AnimationOffset>();

	for (const sheet of sheets) {
		for (const rect of sheet) {
			const file = (rect.originalFile || rect.file || "").split("/").pop();
			if (!file) continue;

			const offset = rect.packedOffset ?? { x: 0, y: 0 };

			const dot = file.lastIndexOf(".");
			if (dot > 0 && !offsets.has(file.substring(0, dot))) offsets.set(file.substring(0, dot), offset);
			if (!offsets.has(file)) offsets.set(file, offset);
		}
	}

	return offsets;
}

export function transformAnimationJson(data: string, scale: number, offsets?: ReadonlyMap<string, AnimationOffset>, labelOffsets?: ReadonlyMap<string, AnimationOffset>): string {
	const hasOffsets = hasAnyOffset(offsets);
	const hasLabelOffsets = hasAnyOffset(labelOffsets);

	if (scale === 1 && !hasOffsets && !hasLabelOffsets) return data;

	const json = parseAnimationJson(data);
	if (!json) throw new Error("Invalid Animation.json");

	if (hasLabelOffsets) applyLabelOffsets(json, labelOffsets);

	const offsetOf = (name: string | null) => {
		const offset = name !== null && hasOffsets ? offsets.get(name) : undefined;
		return offset && (offset.x !== 0 || offset.y !== 0) ? offset : null;
	};

	const visit = (node: Json, inFilters: boolean, inMeta: boolean) => {
		if (Array.isArray(node)) {
			for (const item of node) visit(item, inFilters, false);
			return;
		}
		if (!isObject(node)) return;

		for (const key of Object.keys(node)) {
			const value = node[key];

			if (scale !== 1) {
				if ((MATRIX_KEYS as ReadonlyArray<string>).includes(key)) {
					scaleMatrix(value, scale);
					continue;
				}

				if (POINT_KEYS.has(key) && isObject(value)) {
					for (const axis of ["x", "y", "z"]) {
						const v = value[axis];
						if (isNumber(v)) value[axis] = tidy(v * scale);
					}
					continue;
				}

				if (isNumber(value)) {
					if (inFilters && FILTER_SIZE_KEYS.has(key)) node[key] = tidy(value * scale);
					else if (inMeta && STAGE_SIZE_KEYS.has(key)) node[key] = Math.max(1, Math.round(value * scale));
					continue;
				}
			}

			visit(value, inFilters || FILTER_KEYS.has(key), META_KEYS.has(key));

			if (!hasOffsets || !isObject(value)) continue;

			if (SPRITE_KEYS.has(key)) {
				const offset = offsetOf(spriteName(value));
				if (offset && !translateLocal(value, offset.x, offset.y)) {
					movePosition(value, offset.x, offset.y);
				}
			} else if (SYMBOL_KEYS.has(key)) {
				const bitmap = getBitmap(value);
				const offset = bitmap ? offsetOf(spriteName(bitmap)) : null;
				if (!offset) continue;

				if (translateLocal(value, offset.x, offset.y)) {
					const pivot = value.TRP ?? value.transformationPoint;
					if (isObject(pivot)) {
						if (isNumber(pivot.x)) pivot.x = tidy(pivot.x - offset.x);
						if (isNumber(pivot.y)) pivot.y = tidy(pivot.y - offset.y);
					}
				} else {
					movePosition(bitmap, offset.x, offset.y);
				}
			}
		}
	};
	visit(json, false, false);

	const style = detectStyle(data);
	return style ? write(json, style, 0) : JSON.stringify(json);
}
