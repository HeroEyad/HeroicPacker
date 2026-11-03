import type { AnimationOffset } from "./AnimateAtlas";
import { clashingGroups, safePrefix } from "./PrefixClash";

export type CharacterFileFormat = "psych" | "codename" | "nmv" | "vslice";

export const CHARACTER_FILE_FORMATS: ReadonlyArray<Readonly<{ type: CharacterFileFormat, name: string }>> = [
	{ type: "psych", name: "Psych Engine" },
	{ type: "codename", name: "Codename Engine" },
	{ type: "nmv", name: "Nightmare Vision" },
	{ type: "vslice", name: "V-Slice" }
];

export type CharacterAnimation = {
	anim: string;
	fps: number;
	loop: boolean;
	offset: AnimationOffset;
};

export type StoredAnimations = ReadonlyMap<string, Partial<CharacterAnimation>>;

export type CharacterFrame = Readonly<{
	file: string;
	name: string;
	duration?: number;
}>;

export type AnimationGroup = {
	key: string;
	prefix: string;
	files: string[];
	names: string[];
	durations: number[];
};

export type ResolvedAnimation = CharacterAnimation & AnimationGroup;

export type ImportedFormat = CharacterFileFormat;

type JsonFields = Readonly<{
	anim: string;
	prefix: string;
	fps: string;
	loop: string;
	image: string;
}>;

const PSYCH_FIELDS: JsonFields = { anim: "anim", prefix: "name", fps: "fps", loop: "loop", image: "image" };
const VSLICE_FIELDS: JsonFields = { anim: "name", prefix: "prefix", fps: "frameRate", loop: "looped", image: "assetPath" };

export type ImportedAnimation = Readonly<{
	anim: string;
	prefix: string;
	fps?: number;
	loop?: boolean;
	offset?: AnimationOffset;
}>;

export type ImportedCharacter = Readonly<{
	format: ImportedFormat;
	animations: ImportedAnimation[];
	text: string;
}>;

export type CharacterExport = Readonly<{
	format: CharacterFileFormat;
	name: string;
	images: string[];
	frames: CharacterFrame[];
	stored: StoredAnimations;
	scale: number;
	imported?: ImportedCharacter | null;
	atlas?: boolean;
	groups?: AnimationGroup[];
}>;

type ExportAnimation = ResolvedAnimation & { engine: string };

export class CharacterImportError extends Error {}

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp)$/i;
const ANIM_TAG = /<anim\b[^>]*>/g;
const CHARACTER_TAG = /<character\b[^>]*>/;
const XML_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
const DEFAULT_FPS = 24;
const MAX_FPS = 60;
const NMV_HEALTHBAR_COLOUR = 0xff808080 | 0;
const DIRECTIONS = ["left", "down", "up", "right"] as const;
const ANIMATION_ORDER = [
	"idle", "danceLeft", "danceRight",
	"singLEFT", "singDOWN", "singUP", "singRIGHT",
	"singLEFTmiss", "singDOWNmiss", "singUPmiss", "singRIGHTmiss",
	"hey"
];

export function animationKey(name: string) {
	return name.replace(IMAGE_EXTENSION, "").replace(/\d+$/, "");
}

export function animationLabel(key: string) {
	return key.split("/").pop() || key;
}

export function guessAnimationName(prefix: string) {
	const label = animationLabel(prefix);
	const words = label.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).filter(Boolean);
	const has = (word: string) => words.includes(word);
	const direction = DIRECTIONS.find(has);

	if (has("dance") && (direction === "left" || direction === "right")) return direction === "left" ? "danceLeft" : "danceRight";
	if (direction) return "sing" + direction.toUpperCase() + (has("miss") ? "miss" : "");
	if (has("idle")) return "idle";
	if (has("hey")) return "hey";
	if ((has("dead") || has("death")) && has("loop")) return "deathLoop";
	if ((has("dead") || has("death")) && (has("confirm") || has("retry"))) return "deathConfirm";
	if (has("dies") || has("die")) return "firstDeath";

	return label.trim() || prefix || "anim";
}

export function defaultFps(durations: readonly number[]) {
	if (!durations.length) return DEFAULT_FPS;

	let total = 0;
	for (const duration of durations) total += duration;

	return Math.max(1, Math.min(MAX_FPS, Math.round(1000 * durations.length / total)));
}

export function groupFrames(frames: readonly CharacterFrame[]) {
	const groups = new Map<string, AnimationGroup>();

	for (const frame of frames) {
		const key = animationKey(frame.file);

		let group = groups.get(key);
		if (!group) {
			group = { key, prefix: animationKey(frame.name), files: [], names: [], durations: [] };
			groups.set(key, group);
		}

		group.files.push(frame.file);
		group.names.push(frame.name);
		if (typeof frame.duration === "number") group.durations.push(frame.duration);
	}

	return [...groups.values()].sort((a, b) => a.key === b.key ? 0 : a.key > b.key ? 1 : -1);
}

export function resolveAnimations(groups: readonly AnimationGroup[], stored: StoredAnimations): ResolvedAnimation[] {
	const used = new Set<string>();
	for (const group of groups) {
		const anim = stored.get(group.key)?.anim;
		if (anim) used.add(anim);
	}

	return groups.map(group => {
		const settings = stored.get(group.key) ?? {};

		let anim = settings.anim;
		if (!anim) {
			anim = guessAnimationName(group.prefix);
			if (used.has(anim)) anim = animationLabel(group.prefix).trim() || group.key;

			const base = anim;
			for (let i = 2; used.has(anim); i++) anim = base + " " + i;

			used.add(anim);
		}

		return {
			...group,
			anim,
			fps: settings.fps ?? defaultFps(group.durations),
			loop: settings.loop ?? false,
			offset: settings.offset ?? { x: 0, y: 0 }
		};
	});
}

function readNumber(value: unknown) {
	const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
	return typeof parsed === "number" && isFinite(parsed) ? parsed : undefined;
}

function readBoolean(value: unknown) {
	if (typeof value === "boolean") return value;
	if (value === "true") return true;
	if (value === "false") return false;
	return undefined;
}

function readText(value: unknown) {
	return typeof value === "string" ? value : "";
}

function readPair(value: unknown): AnimationOffset | undefined {
	if (!Array.isArray(value)) return undefined;

	const x = readNumber(value[0]);
	const y = readNumber(value[1]);
	return x === undefined || y === undefined ? undefined : { x, y };
}

function xmlAttributes(tag: string) {
	const attributes = new Map<string, string>();

	for (const [, name, , value] of tag.matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
		attributes.set(name, value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => XML_ENTITIES[entity]));
	}

	return attributes;
}

function parseCodename(text: string): ImportedCharacter {
	if (!CHARACTER_TAG.test(text)) throw new CharacterImportError("No <character> element was found");

	const animations = [...text.matchAll(ANIM_TAG)].map(([tag]) => {
		const attributes = xmlAttributes(tag);
		const x = readNumber(attributes.get("x"));
		const y = readNumber(attributes.get("y"));

		return {
			anim: attributes.get("name") ?? "",
			prefix: attributes.get("anim") ?? "",
			fps: readNumber(attributes.get("fps")),
			loop: readBoolean(attributes.get("loop")),
			offset: x === undefined && y === undefined ? undefined : { x: x ?? 0, y: y ?? 0 }
		};
	});

	return { format: "codename", animations, text };
}

export function parseCharacterFile(text: string): ImportedCharacter {
	const content = text.replace(/^﻿/, "").trim();
	if (content.startsWith("<")) return parseCodename(content);

	let data: unknown;
	try {
		data = JSON.parse(content);
	}
	catch (e) {
		throw new CharacterImportError("The file is neither JSON nor XML");
	}

	if (!data || typeof data !== "object" || !Array.isArray((data as Record<string, unknown>).animations)) {
		throw new CharacterImportError("The file has no animations list");
	}

	const fields = data as Record<string, unknown>;
	const list = (fields.animations as unknown[]).map(item => (item && typeof item === "object" ? item : {}) as Record<string, unknown>);

	const vslice = list.some(item => "prefix" in item);
	const nmv = "healthbar_colour" in fields || "scalableOffsets" in fields || "vslice_sustains" in fields;
	const keys = vslice ? VSLICE_FIELDS : PSYCH_FIELDS;

	return {
		format: vslice ? "vslice" : nmv ? "nmv" : "psych",
		animations: list.map(item => ({ anim: readText(item[keys.anim]), prefix: readText(item[keys.prefix]), fps: readNumber(item[keys.fps]), loop: readBoolean(item[keys.loop]), offset: readPair(item.offsets) })),
		text: content
	};
}

function findGroup<T extends AnimationGroup>(prefix: string, groups: readonly T[]) {
	const wanted = prefix.replace(/\d+$/, "");
	if (!wanted) return undefined;

	const labelled = groups.map(group => ({ group, label: animationLabel(group.prefix) }));
	const exact = labelled.find(item => item.group.prefix === wanted || item.label === wanted);
	if (exact) return exact.group;

	const partial = labelled
		.filter(item => item.group.prefix.startsWith(wanted) || item.label.startsWith(wanted))
		.sort((a, b) => a.label.length - b.label.length);

	return partial[0]?.group;
}

export function matchImported<T extends AnimationGroup>(animations: readonly ImportedAnimation[], groups: readonly T[]) {
	const matches = new Map<number, T>();
	const primary = new Map<string, number>();

	animations.forEach((animation, index) => {
		const group = findGroup(animation.prefix, groups);
		if (!group) return;

		matches.set(index, group);
		if (!primary.has(group.key)) primary.set(group.key, index);
	});

	return { matches, primary } as const;
}

export function importedSettings(character: ImportedCharacter, groups: readonly AnimationGroup[]) {
	const { matches, primary } = matchImported(character.animations, groups);
	const settings = new Map<string, Partial<CharacterAnimation>>();

	for (const [key, index] of primary) {
		const animation = character.animations[index];
		const values: Partial<CharacterAnimation> = {};

		if (animation.anim) values.anim = animation.anim;
		if (animation.fps !== undefined) values.fps = Math.max(1, Math.min(MAX_FPS, Math.round(animation.fps)));
		if (animation.loop !== undefined) values.loop = animation.loop;
		if (animation.offset) values.offset = { ...animation.offset };

		settings.set(key, values);
	}

	const missing = character.animations
		.filter((_, index) => !matches.has(index))
		.map(animation => animation.anim || animation.prefix)
		.filter(Boolean);

	return { settings, missing } as const;
}

function enginePrefix(animation: ResolvedAnimation, all: readonly ResolvedAnimation[]) {
	if (!clashingGroups(animation, all).length) return animation.prefix;
	return safePrefix(animation, all) ?? animation.prefix;
}

export function labelGroups(labels: ReadonlyArray<Readonly<{ name: string, length: number }>>, frameRate: number): AnimationGroup[] {
	return labels.map(label => ({
		key: label.name,
		prefix: label.name,
		files: [] as string[],
		names: [] as string[],
		durations: new Array<number>(Math.max(1, label.length)).fill(1000 / frameRate)
	}));
}

export function atlasLabels(groups: readonly AnimationGroup[]) {
	const labels = new Map<string, string>();
	const used = new Set<string>();

	for (const group of groups) {
		const base = animationLabel(group.prefix).trim() || "anim";
		let label = base;
		for (let i = 2; used.has(label); i++) label = base + " " + i;

		used.add(label);
		labels.set(group.key, label);
	}

	return labels;
}

function animationRank(anim: string) {
	const index = ANIMATION_ORDER.indexOf(anim);
	return index < 0 ? ANIMATION_ORDER.length : index;
}

function escapeXml(value: string) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function imageFolder(previous: unknown, fallback: string) {
	if (typeof previous !== "string") return fallback;

	const first = previous.split(",")[0];
	return first.slice(0, first.lastIndexOf("/") + 1);
}

function characterImage(options: CharacterExport, previous?: unknown) {
	const folder = imageFolder(previous, "characters/");
	return options.images.map(image => folder + image).join(",");
}

function setAttribute(tag: string, name: string, value: string) {
	const escaped = escapeXml(value);
	const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(["'])[\\s\\S]*?\\2`);

	if (pattern.test(tag)) return tag.replace(pattern, (_, start: string, quote: string) => start + quote + escaped + quote);
	return tag.replace(/(\s*\/?>)$/, end => ` ${name}="${escaped}"${end}`);
}

function psychAnimations(options: CharacterExport, animations: readonly ExportAnimation[]) {
	const scale = options.scale || 1;

	return animations.map(animation => ({
		anim: animation.anim,
		name: animation.engine,
		fps: animation.fps,
		loop: animation.loop,
		indices: [] as number[],
		offsets: [Math.round(animation.offset.x * scale), Math.round(animation.offset.y * scale)]
	}));
}

function jsonAnimations(options: CharacterExport, animations: readonly ExportAnimation[]): Record<string, unknown>[] {
	const entries = psychAnimations(options, animations);

	if (options.format === "nmv") return entries.map(entry => ({ ...entry, flipX: false, flipY: false }));
	if (options.format === "vslice") {
		return entries.map(entry => ({
			offsets: entry.offsets,
			prefix: entry.name,
			frameIndices: [] as number[],
			animType: "framelabel",
			flipX: false,
			looped: entry.loop,
			name: entry.anim,
			flipY: false,
			frameRate: entry.fps
		}));
	}

	return entries;
}

function vsliceAsset(options: CharacterExport, previous?: unknown) {
	return imageFolder(previous, "characters/") + (options.images[0] ?? options.name);
}

function psychCharacter(options: CharacterExport, animations: readonly ExportAnimation[]) {
	return JSON.stringify({
		animations: psychAnimations(options, animations),
		vocals_file: "",
		no_antialiasing: false,
		image: characterImage(options),
		position: [0, 0],
		healthicon: "face",
		flip_x: false,
		healthbar_colors: [161, 161, 161],
		camera_position: [0, 0],
		sing_duration: 4,
		scale: 1,
		_editor_isPlayer: false
	}, null, "\t");
}

function nmvCharacter(options: CharacterExport, animations: readonly ExportAnimation[]) {
	return JSON.stringify({
		animations: jsonAnimations(options, animations),
		image: characterImage(options),
		scale: 1,
		sing_duration: 4,
		healthicon: "face",
		position: [0, 0],
		camera_position: [0, 0],
		flip_x: false,
		vslice_sustains: false,
		ghosts_enabled: false,
		no_antialiasing: false,
		healthbar_colour: NMV_HEALTHBAR_COLOUR,
		scalableOffsets: false,
		dance_every: 2,
		_editor_isPlayer: false,
		gameover_character: null as string | null,
		gameover_intial_sound: null as string | null,
		gameover_loop_sound: null as string | null,
		gameover_confirm_sound: null as string | null
	}, null, "\t");
}

function vsliceCharacter(options: CharacterExport, animations: readonly ExportAnimation[]) {
	const names = animations.map(animation => animation.anim);
	const starting = names.includes("idle") ? "idle" : names.includes("danceRight") ? "danceRight" : names[0] ?? "idle";

	return JSON.stringify({
		version: "1.0.0",
		name: options.name,
		renderType: options.atlas ? "animateatlas" : "sparrow",
		assetPath: vsliceAsset(options),
		scale: 1,
		offsets: [0, 0],
		cameraOffsets: [0, 0],
		isPixel: false,
		danceEvery: 1,
		singTime: 8,
		startingAnimation: starting,
		flipX: false,
		healthIcon: {
			id: options.name,
			scale: 1,
			flipX: false,
			isPixel: false,
			offsets: [0, 0]
		},
		animations: jsonAnimations(options, animations)
	}, null, "\t");
}

function codenameAnimation(animation: ExportAnimation, scale: number) {
	const x = Math.round(animation.offset.x * scale);
	const y = Math.round(animation.offset.y * scale);
	return `<anim name="${escapeXml(animation.anim)}" anim="${escapeXml(animation.engine)}" fps="${animation.fps}" loop="${animation.loop}" x="${x}" y="${y}"/>`;
}

function codenameCharacter(options: CharacterExport, animations: readonly ExportAnimation[]) {
	const scale = options.scale || 1;

	return [
		"<!DOCTYPE codename-engine-character>",
		`<character x="0" y="0" camx="0" camy="0" holdTime="4" flipX="false" sprite="${escapeXml(options.images[0] ?? options.name)}">`,
		...animations.map(animation => "\t" + codenameAnimation(animation, scale)),
		"</character>"
	].join("\n");
}

function mergeJsonCharacter(options: CharacterExport, animations: readonly ExportAnimation[], imported: ImportedCharacter) {
	const data = JSON.parse(imported.text) as Record<string, unknown>;
	const keys = options.format === "vslice" ? VSLICE_FIELDS : PSYCH_FIELDS;
	const fresh = jsonAnimations(options, animations);
	const entries = new Map(animations.map((animation, index) => [animation.key, fresh[index]]));
	const { matches, primary } = matchImported(imported.animations, animations);

	const list: unknown[] = (data.animations as unknown[]).map((raw, index) => {
		const animation = matches.get(index);
		if (!animation) return raw;

		const entry = entries.get(animation.key);
		const fields = raw as Record<string, unknown>;
		if (primary.get(animation.key) !== index) return { ...fields, [keys.prefix]: entry[keys.prefix] };

		return {
			...fields,
			[keys.anim]: entry[keys.anim],
			[keys.prefix]: entry[keys.prefix],
			[keys.fps]: entry[keys.fps],
			[keys.loop]: entry[keys.loop],
			offsets: entry.offsets
		};
	});

	for (const animation of animations) {
		if (!primary.has(animation.key)) list.push(entries.get(animation.key));
	}

	if (options.format === "vslice") {
		const renderType = options.atlas ? "animateatlas" : data.renderType === "animateatlas" ? "sparrow" : data.renderType ?? "sparrow";
		return JSON.stringify({ ...data, renderType, animations: list, [keys.image]: vsliceAsset(options, data[keys.image]) }, null, "\t");
	}

	return JSON.stringify({ ...data, animations: list, [keys.image]: characterImage(options, data[keys.image]) }, null, "\t");
}

function mergeCodenameCharacter(options: CharacterExport, animations: readonly ExportAnimation[], imported: ImportedCharacter) {
	const scale = options.scale || 1;
	const { matches, primary } = matchImported(imported.animations, animations);
	let position = 0;

	let text = imported.text.replace(ANIM_TAG, tag => {
		const index = position++;
		const animation = matches.get(index);
		if (!animation) return tag;

		const prefix = animation.engine;
		if (primary.get(animation.key) !== index) return setAttribute(tag, "anim", prefix);

		const values: ReadonlyArray<readonly [string, string]> = [
			["name", animation.anim],
			["anim", prefix],
			["fps", String(animation.fps)],
			["loop", String(animation.loop)],
			["x", String(Math.round(animation.offset.x * scale))],
			["y", String(Math.round(animation.offset.y * scale))]
		];

		return values.reduce((result, [name, value]) => setAttribute(result, name, value), tag);
	});

	text = text.replace(CHARACTER_TAG, tag => setAttribute(tag, "sprite", imageFolder(xmlAttributes(tag).get("sprite"), "") + (options.images[0] ?? options.name)));

	const added = animations.filter(animation => !primary.has(animation.key)).map(animation => "\t" + codenameAnimation(animation, scale));
	if (added.length) {
		text = text.replace(/(\r?\n)?([ \t]*<\/character>)/, (_, newline: string | undefined, close: string) => {
			const eol = newline ?? "\n";
			return eol + added.join(eol) + eol + close;
		});
	}

	return text;
}

export function buildCharacterFile(options: CharacterExport) {
	const groups = options.groups ?? groupFrames(options.frames);
	const labels = options.groups ? new Map(groups.map(group => [group.key, group.prefix])) : options.atlas ? atlasLabels(groups) : null;
	const resolved = resolveAnimations(groups, options.stored);
	const animations: ExportAnimation[] = resolved
		.map(animation => ({ ...animation, engine: labels?.get(animation.key) ?? enginePrefix(animation, resolved) }))
		.sort((a, b) => animationRank(a.anim) - animationRank(b.anim) || (a.anim === b.anim ? 0 : a.anim > b.anim ? 1 : -1));
	const imported = options.imported && options.imported.format === options.format ? options.imported : null;

	if (options.format === "codename") {
		return { name: "data/characters/" + options.name + ".xml", content: imported ? mergeCodenameCharacter(options, animations, imported) : codenameCharacter(options, animations) };
	}

	if (options.format === "nmv") {
		return { name: "data/characters/" + options.name + ".json", content: imported ? mergeJsonCharacter(options, animations, imported) : nmvCharacter(options, animations) };
	}

	if (options.format === "vslice") {
		return { name: "data/characters/" + options.name + ".json", content: imported ? mergeJsonCharacter(options, animations, imported) : vsliceCharacter(options, animations) };
	}

	return { name: "characters/" + options.name + ".json", content: imported ? mergeJsonCharacter(options, animations, imported) : psychCharacter(options, animations) };
}
