import * as JSZip from 'jszip';
import CustomImage from '../data/CustomImage';
import type { LoadedImages, PackOptions, Rect } from 'api/types';
import type { AnimationFile } from 'api/FunkinPackerApi';
import type { AnimationOffset } from 'api/utils/AnimateAtlas';
import type { AtlasMeta } from 'api/utils/AtlasMeta';
import type { CharacterAnimation, ImportedCharacter } from 'api/utils/Character';
import type { RepackInfoEvent } from '../ui/StatsInfo';

export const PROJECT_EXTENSION = ".heroic";

const FORMAT = "heroic-packer-project";
const VERSION = 1;
const MANIFEST_FILE = "project.json";
const ANIMATION_FILE = "animation.json";
const DATA_URL = /^data:([^;,]+);base64,/;
const EXTENSIONS: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const MIME_TYPES: Readonly<Record<string, string>> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export type SavedRect = Pick<Rect, "trimmed" | "frame" | "spriteSourceSize" | "sourceSize" | "frameSize" | "rotated" | "manualOffset" | "duration" | "importedOffset">;

export type CustomExporterData = {
	allowTrim: boolean;
	allowRotation: boolean;
	fileExt: string;
	content: string;
};

export type ProjectState = {
	images: LoadedImages;
	options: PackOptions;
	customExporter: CustomExporterData | null;
	order: string[] | null;
	atlasMeta: AtlasMeta | null;
	animation: AnimationFile | null;
	animationOffsets: Record<string, AnimationOffset>;
	characterAnimations: Record<string, Partial<CharacterAnimation>>;
	importedCharacter: ImportedCharacter | null;
	repackInfo: RepackInfoEvent | null;
};

type SavedFrame = {
	name: string;
	image: string;
	rect: SavedRect;
};

type Manifest = Omit<ProjectState, "images" | "animation"> & {
	format: string;
	version: number;
	app: string;
	frames: SavedFrame[];
	animation: { name: string, file: string } | null;
};

export class ProjectError extends Error {
	readonly newerVersion: boolean;

	constructor(newerVersion: boolean = false) {
		super(newerVersion ? "Project saved by a newer version" : "Not a project file");
		this.newerVersion = newerVersion;
	}
}

export function isProjectFile(name: string) {
	return name.toLowerCase().endsWith(PROJECT_EXTENSION);
}

export function savedRect(rect: Rect): SavedRect {
	return {
		trimmed: rect.trimmed,
		frame: rect.frame,
		spriteSourceSize: rect.spriteSourceSize,
		sourceSize: rect.sourceSize,
		frameSize: rect.frameSize,
		rotated: rect.rotated,
		manualOffset: rect.manualOffset,
		duration: rect.duration,
		importedOffset: rect.importedOffset
	};
}

function encodeImage(image: CustomImage) {
	let url = image.base64 || image.src;
	let match = DATA_URL.exec(url);

	if (!match || !EXTENSIONS[match[1]]) {
		const canvas = document.createElement("canvas");
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		canvas.getContext("2d").drawImage(image.image, 0, 0);
		url = canvas.toDataURL("image/png");
		match = DATA_URL.exec(url);
	}

	return { extension: EXTENSIONS[match[1]], data: url.substring(match[0].length) };
}

export function writeProject(state: ProjectState, appVersion: string): Promise<Blob> {
	// vscode is tweaking bruh
	const zip = new JSZip();
	const paths = new Map<string, string>();
	const frames: SavedFrame[] = [];

	for (const [name, image] of Object.entries(state.images)) {
		const source = image.base64 || image.src;
		let path = paths.get(source);

		if (path === undefined) {
			const { extension, data } = encodeImage(image);
			path = `images/${paths.size}.${extension}`;
			zip.file(path, data, { base64: true, compression: "STORE" });
			paths.set(source, path);
		}

		frames.push({ name, image: path, rect: savedRect(image.rect) });
	}

	if (state.animation) zip.file(ANIMATION_FILE, state.animation.data);

	const manifest: Manifest = {
		format: FORMAT,
		version: VERSION,
		app: appVersion,
		options: state.options,
		customExporter: state.customExporter,
		frames,
		order: state.order,
		atlasMeta: state.atlasMeta,
		animation: state.animation && { name: state.animation.name, file: ANIMATION_FILE },
		animationOffsets: state.animationOffsets,
		characterAnimations: state.characterAnimations,
		importedCharacter: state.importedCharacter,
		repackInfo: state.repackInfo
	};
	zip.file(MANIFEST_FILE, JSON.stringify(manifest, null, "\t"));

	return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

async function readManifest(zip: JSZip): Promise<Manifest> {
	const file = zip.file(MANIFEST_FILE);
	if (!file) throw new ProjectError();

	let manifest: Manifest;
	try {
		manifest = JSON.parse(await file.async("string"));
	}
	catch {
		throw new ProjectError();
	}

	if (manifest?.format !== FORMAT || !Array.isArray(manifest.frames)) throw new ProjectError();
	if (!(manifest.version <= VERSION)) throw new ProjectError(true);

	return manifest;
}

async function readImages(zip: JSZip, frames: readonly SavedFrame[]) {
	const sources = new Map<string, { element: HTMLImageElement, url: string }>();
	const images: LoadedImages = {};

	for (const frame of frames) {
		if (typeof frame?.name !== "string" || typeof frame.image !== "string" || !frame.rect) throw new ProjectError();

		let source = sources.get(frame.image);
		if (!source) {
			const file = zip.file(frame.image);
			if (!file) throw new ProjectError();

			const mime = MIME_TYPES[frame.image.split(".").pop().toLowerCase()] ?? "image/png";
			const element = new Image();
			source = { element, url: `data:${mime};base64,` + await file.async("base64") };
			element.src = source.url;
			sources.set(frame.image, source);
		}

		const image = new CustomImage(source.element);
		image.base64 = source.url;
		image.rect = { ...frame.rect, name: frame.name };
		images[frame.name] = image;
	}

	try {
		await Promise.all([...sources.values()].map(source => source.element.decode()));
	}
	catch {
		throw new ProjectError();
	}

	return images;
}

export async function readProject(file: Blob): Promise<ProjectState> {
	let zip: JSZip;
	try {
		zip = await new JSZip().loadAsync(file);
	}
	catch {
		throw new ProjectError();
	}

	const manifest = await readManifest(zip);
	const images = await readImages(zip, manifest.frames);

	let animation: AnimationFile | null = null;
	if (manifest.animation) {
		const data = zip.file(manifest.animation.file);
		if (!data) throw new ProjectError();
		animation = { name: manifest.animation.name, data: await data.async("string") };
	}

	return {
		images,
		options: manifest.options ?? {},
		customExporter: manifest.customExporter ?? null,
		order: Array.isArray(manifest.order) ? manifest.order : null,
		atlasMeta: manifest.atlasMeta ?? null,
		animation,
		animationOffsets: manifest.animationOffsets ?? {},
		characterAnimations: manifest.characterAnimations ?? {},
		importedCharacter: manifest.importedCharacter ?? null,
		repackInfo: manifest.repackInfo ?? null
	};
}
