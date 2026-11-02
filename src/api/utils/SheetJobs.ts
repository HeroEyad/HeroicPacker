import { isAnimationJson } from "./AnimateAtlas";
import type { Rect } from "../types";
import type Splitter from "../splitters/Splitter";
import Sparrow from "../splitters/Sparrow";
import JsonHash from "../splitters/JsonHash";
import JsonArray from "../splitters/JsonArray";
import UIKit from "../splitters/UIKit";
import Spine from "../splitters/Spine";
import Phaser3 from "../splitters/Phaser3";
import AtlasSpritemap from "../splitters/AtlasSpritemap";

export type InputFile<T extends Uint8Array = Uint8Array> = Readonly<{
	name: string;
	data: T;
}>;

export type TextFile = Readonly<{
	name: string;
	text: string;
}>;

export type Sheet<T extends Uint8Array = Uint8Array> = Readonly<{
	file: TextFile;
	picture: InputFile<T>;
	splitter: Splitter;
}>;

type DataFile = Readonly<{
	file: TextFile;
	splitter: Splitter;
}>;

export type Job<T extends Uint8Array = Uint8Array> = Readonly<{
	folder: string;
	name: string;
	sheets: ReadonlyArray<Sheet<T>>;
	loose: ReadonlyArray<InputFile<T>>;
	animation: TextFile | null;
}>;

export type ClassifiedFiles<T extends Uint8Array = Uint8Array> = Readonly<{
	pictures: InputFile<T>[];
	described: DataFile[];
	animations: TextFile[];
	skipped: string[];
}>;

export class JobError extends Error {}

export const ATLAS_SPLITTER = "Atlas Spritemap";
export const ANIMATION_FILE = "Animation.json";

const TEXT_SPLITTERS: ReadonlyArray<Splitter> = [new Sparrow(), new UIKit(), new Spine()];
const JSON_SPLITTERS: ReadonlyArray<Splitter> = [new JsonHash(), new JsonArray(), new Phaser3(), new AtlasSpritemap()];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_HEADER_LENGTH = 24;
const DEFAULT_NAME = "texture";
const MAX_NAME_LENGTH = 100;

export function isPng(data: Uint8Array) {
	return data.length >= PNG_HEADER_LENGTH && PNG_SIGNATURE.every((byte, i) => data[i] === byte);
}

export function baseName(name: string) {
	return name.replace(/\\/g, "/").split("/").pop() ?? "";
}

export function stem(name: string) {
	const base = baseName(name);
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}

export function cleanPath(name: string) {
	return name.replace(/\\/g, "/").replace(/^[a-z]:/i, "").split("/").filter(part => part && part !== "." && part !== "..").join("/");
}

export function folderOf(name: string) {
	const path = cleanPath(name);
	const slash = path.lastIndexOf("/");
	return slash < 0 ? "" : path.slice(0, slash);
}

export function cleanFileName(name: string) {
	const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim().slice(0, MAX_NAME_LENGTH);
	return cleaned || DEFAULT_NAME;
}

export function outputPath(folder: string, file: string) {
	return folder ? folder.split("/").map(cleanFileName).join("/") + "/" + file : file;
}

export function findSplitter(text: string) {
	const candidates = /^\s*[{[]/.test(text) ? JSON_SPLITTERS : TEXT_SPLITTERS;

	for (const splitter of candidates) {
		let valid = false;
		try {
			splitter.doCheck(splitter.cleanData(text), checked => {
				if (checked) valid = true;
			});
		}
		catch (e) {
			valid = false;
		}
		if (valid) return splitter;
	}

	return null;
}

export function splitSheet(sheet: Sheet<Uint8Array>, textureWidth: number, textureHeight: number) {
	let frames: Rect[] = [];

	sheet.splitter.options = { textureWidth, textureHeight, width: 32, height: 32, padding: 0 };
	sheet.splitter.doSplit(sheet.splitter.cleanData(sheet.file.text), result => {
		if (result) frames = result;
	});

	return frames;
}

export function readSheetMeta(sheet: Sheet<Uint8Array>) {
	return sheet.splitter.readMeta(sheet.splitter.cleanData(sheet.file.text));
}

export function classify<T extends Uint8Array>(files: ReadonlyArray<InputFile<T>>): ClassifiedFiles<T> {
	const pictures: InputFile<T>[] = [];
	const described: DataFile[] = [];
	const animations: TextFile[] = [];
	const skipped: string[] = [];

	for (const file of files) {
		if (isPng(file.data)) {
			pictures.push(file);
			continue;
		}

		if (/\.(jpe?g|gif|webp|bmp)$/i.test(file.name)) {
			skipped.push(`${file.name} is not a PNG, only PNG images can be packed`);
			continue;
		}

		const text: TextFile = { name: file.name, text: new TextDecoder("utf-8").decode(file.data) };

		if (isAnimationJson(text.text)) {
			animations.push(text);
			continue;
		}

		const splitter = findSplitter(text.text);
		if (splitter) described.push({ file: text, splitter });
		else skipped.push(`${file.name} is not a sheet data file this packer can read`);
	}

	return { pictures, described, animations, skipped };
}

export function planJobs<T extends Uint8Array>(sorted: ClassifiedFiles<T>, merge: boolean, looseName: string) {
	const { pictures, described, animations } = sorted;
	const skipped = sorted.skipped.slice();
	const remaining = pictures.slice();
	const sheets: Sheet<T>[] = [];

	for (const { file, splitter } of described) {
		const folder = folderOf(file.name);
		const wanted = stem(file.name).toLowerCase();
		let index = remaining.findIndex(picture => folderOf(picture.name) === folder && stem(picture.name).toLowerCase() === wanted);
		if (index < 0 && described.length === 1 && pictures.length === 1) index = 0;

		if (index < 0) {
			skipped.push(`${file.name} has no png with the same name next to it`);
			continue;
		}

		sheets.push({ file, picture: remaining[index], splitter });
		remaining.splice(index, 1);
	}

	const isAtlas = (sheet: Sheet<T>) => sheet.splitter.splitterName === ATLAS_SPLITTER;

	if (merge) {
		if (animations.length > 1) {
			throw new JobError("More than one Animation.json was sent, merge packs one texture atlas at a time");
		}

		const animation = animations[0] ?? null;
		if (animation && !sheets.some(isAtlas)) {
			throw new JobError(`${animation.name} was sent without its spritemap json and png`);
		}

		const jobs: Job<T>[] = sheets.length || remaining.length ? [{
			folder: "",
			name: sheets.length ? stem(sheets[0].picture.name) : looseName,
			sheets,
			loose: remaining,
			animation
		}] : [];

		return { jobs, skipped } as const;
	}

	const jobs: Job<T>[] = [];
	const animationFolders = new Map<string, TextFile>();

	for (const animation of animations) {
		const folder = folderOf(animation.name);
		if (animationFolders.has(folder)) {
			throw new JobError(`More than one Animation.json was sent for ${folder ? "the folder " + folder : "the same folder"}`);
		}
		animationFolders.set(folder, animation);
	}

	const inAtlas = new Set<Sheet<T>>();
	for (const [folder, animation] of animationFolders) {
		const atlas = sheets.filter(sheet => isAtlas(sheet) && folderOf(sheet.file.name) === folder);
		if (!atlas.length) {
			skipped.push(`${animation.name} has no spritemap json and png next to it`);
			continue;
		}

		atlas.forEach(sheet => inAtlas.add(sheet));
		jobs.push({ folder, name: stem(atlas[0].picture.name), sheets: atlas, loose: [], animation });
	}

	for (const sheet of sheets) {
		if (inAtlas.has(sheet)) continue;
		jobs.push({ folder: folderOf(sheet.picture.name), name: stem(sheet.picture.name), sheets: [sheet], loose: [], animation: null });
	}

	if (!described.length && remaining.length) {
		jobs.push({ folder: "", name: looseName, sheets: [], loose: remaining, animation: null });
	}
	else {
		for (const picture of remaining) skipped.push(`${picture.name} has no data file with the same name next to it`);
	}

	return { jobs, skipped } as const;
}
