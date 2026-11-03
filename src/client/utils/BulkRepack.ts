import * as JSZip from 'jszip';
import FunkinPackerApi from 'api/FunkinPackerApi';
import { ApiError } from 'api/Errors';
import { getExporterByType, startExporter, type RenderSettings } from 'api/exporters';
import { getPackedSpriteOffsets, transformAnimationJson } from 'api/utils/AnimateAtlas';
import { buildAnimationJson } from 'api/utils/AtlasExport';
import { fixManualOffsets, getDummyRect, setMaxSizesForSourceSize } from 'api/utils/common';
import { ANIMATION_FILE, baseName, classify, cleanPath, outputPath, planJobs, readSheetMeta, splitSheet, stem, type InputFile, type Job } from 'api/utils/SheetJobs';
import type { LoadedImages, PackOptions } from 'api/types';
import type { FileData } from 'types';
import CustomImage from '../data/CustomImage';
import ErrorHandler from '../ErrorHandler';
import { getFilterByType } from '../filters';
import Filter from '../filters/Filter';
import { extractFrames } from './FrameExtractor';
import { arrayBufferToBase64, optimisePng } from './PngOptimizer';
import TextureRenderer from './TextureRenderer';

export type BulkResult = Readonly<{
	name: string;
	before: number;
	after: number;
	beforeSize: string;
	afterSize: string;
	kept: boolean;
	error: string | null;
}>;

export type BulkOutput = Readonly<{
	files: FileData[];
	result: BulkResult;
}>;

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;
const JUNK = /(^|\/)(__MACOSX|\.[^/]*|Thumbs\.db|desktop\.ini)(\/|$)/i;
const LOOSE_NAME = "texture";

function isZip(data: Uint8Array) {
	return data.length >= ZIP_SIGNATURE.length && ZIP_SIGNATURE.every((byte, i) => data[i] === byte);
}

async function loadTexture(data: Uint8Array) {
	const url = URL.createObjectURL(new Blob([data], { type: "image/png" }));
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		return image;
	}
	finally {
		URL.revokeObjectURL(url);
	}
}

async function loadSprite(data: Uint8Array) {
	const content = "data:image/png;base64," + arrayBufferToBase64(data);
	const image = new CustomImage(new Image());
	image.src = content;
	image.base64 = content;
	await image.image.decode();
	return image;
}

export async function expandInputs(files: ReadonlyArray<InputFile>) {
	const out: InputFile[] = [];
	const zips: string[] = [];

	for (const file of files) {
		if (!isZip(file.data)) {
			const name = cleanPath(file.name);
			if (name && !JUNK.test(name)) out.push({ name, data: file.data });
			continue;
		}

		zips.push(stem(file.name));
		const zip = await new JSZip().loadAsync(file.data);
		for (const entry of Object.values(zip.files)) {
			const name = cleanPath(entry.name);
			if (entry.dir || !name || JUNK.test(name)) continue;
			out.push({ name, data: await entry.async("uint8array") });
		}
	}

	return { files: out, zipName: zips.length === 1 ? zips[0] : null } as const;
}

export function planBulk(files: ReadonlyArray<InputFile>, looseName: string = LOOSE_NAME) {
	return planJobs(classify(files), false, looseName);
}

export function jobName(job: Job) {
	return outputPath(job.folder, job.name);
}

function originalFiles(job: Job): FileData[] {
	const files: FileData[] = [];

	for (const sheet of job.sheets) {
		files.push({ name: outputPath(job.folder, baseName(sheet.picture.name)), content: arrayBufferToBase64(sheet.picture.data), base64: true });
		files.push({ name: outputPath(job.folder, baseName(sheet.file.name)), content: sheet.file.text, base64: false });
	}

	if (job.animation) files.push({ name: outputPath(job.folder, baseName(job.animation.name)), content: job.animation.text, base64: false });

	return files;
}

export async function readJobFrames(job: Job) {
	const images: LoadedImages = {};
	const order: string[] = [];
	const sizes: string[] = [];
	let area = 0;

	for (const sheet of job.sheets) {
		const texture = await loadTexture(sheet.picture.data);
		sizes.push(texture.width + "x" + texture.height);
		area += texture.width * texture.height;

		const frames = splitSheet(sheet, texture.width, texture.height);
		if (!frames.length) throw new Error(`No sprites were found in ${baseName(sheet.file.name)}`);

		Object.assign(images, await extractFrames(texture, frames, sheet.splitter));
		order.push(...frames.map(frame => frame.name));
	}

	for (const picture of job.loose) {
		const image = await loadSprite(picture.data);
		const spriteName = cleanPath(picture.name) || "sprite.png";
		image.rect = getDummyRect(spriteName, image.width, image.height);
		images[spriteName] = image;
		area += image.width * image.height;
	}
	if (job.loose.length) sizes.push(job.loose.length + " png");

	const rects = Object.values(images).map(image => image.rect);
	setMaxSizesForSourceSize(rects);
	fixManualOffsets(rects);

	return { images, order, sizes, area } as const;
}

export async function optimizeJob(job: Job, base: PackOptions): Promise<BulkOutput> {
	const name = jobName(job);
	let beforeSizes: string[] = [];
	let before = 0;

	try {
		const read = await readJobFrames(job);
		const { images, order } = read;
		beforeSizes = read.sizes;
		before = read.area;

		const exporter = (job.sheets.length ? getExporterByType(job.sheets[0].splitter.splitterName) : null) ?? base.exporterCls;
		const options: PackOptions = {
			...base,
			exporter: exporter.exporterName,
			exporterCls: exporter,
			allowRotation: Boolean(base.allowRotation) && exporter.allowRotation,
			fileName: job.name
		};

		const api = new FunkinPackerApi();
		if (order.length) api.setStoredOrder(order);
		if (job.sheets.length === 1) api.setAtlasMeta(readSheetMeta(job.sheets[0]));
		if (job.animation) api.setAnimation({ name: baseName(job.animation.name), data: job.animation.text });
		api.loadImages(images);
		api.setOptions(options);

		const packed = await api.pack();

		const textureFormat = options.textureFormat ?? "png";
		const optimizePNG = textureFormat === "png" && (options.optimizePNG ?? true);
		const filterClass = getFilterByType(options.filter);

		const buffers = packed.result.map(data => new TextureRenderer(data, options).getBuffer());
		const after = buffers.reduce((sum, buffer) => sum + buffer.width * buffer.height, 0);
		const afterSizes = buffers.map(buffer => buffer.width + "x" + buffer.height);

		const unchanged = packed.scale === 1 && textureFormat === "png" && filterClass === Filter;
		if (after >= before && unchanged && job.sheets.length && !job.loose.length) {
			return { files: originalFiles(job), result: { name, before, after: before, beforeSize: beforeSizes.join(" + "), afterSize: beforeSizes.join(" + "), kept: true, error: null } };
		}

		const filter = new filterClass();
		const files: FileData[] = [];

		for (let ix = 0; ix < packed.result.length; ix++) {
			const data = packed.result[ix];
			const buffer = buffers[ix];
			const fileName = exporter.animateAtlas ? "spritemap" + (ix + 1) : job.name + (packed.result.length > 1 ? "-" + ix : "");

			let imageData = filter.apply(buffer).toDataURL(textureFormat === "png" ? "image/png" : "image/jpeg").split(",").pop();
			if (optimizePNG) {
				try {
					imageData = await optimisePng(imageData);
				}
				catch (e) {
					console.error("oxipng optimization failed, using the unoptimized png: " + e);
				}
			}

			files.push({ name: outputPath(job.folder, fileName + "." + textureFormat), content: imageData, base64: true });

			const settings: RenderSettings = {
				imageName: fileName,
				imageFile: fileName + "." + textureFormat,
				imageData,
				spritePadding: options.spritePadding ?? 3,
				borderPadding: options.borderPadding ?? 1,
				format: textureFormat === "png" ? "RGBA8888" : "RGB888",
				textureFormat,
				imageWidth: buffer.width,
				imageHeight: buffer.height,
				removeFileExtension: options.removeFileExtension ?? true,
				prependFolderName: options.prependFolderName ?? true,
				base64Export: false,
				scale: packed.scale,
				changedScale: packed.scale !== 1,
				trimMode: options.trimMode ?? "trim",
				sortExportedRows: options.sortExportedRows ?? true
			};

			files.push({ name: outputPath(job.folder, fileName + "." + exporter.fileExt), content: await startExporter(api, exporter, data, settings), base64: false });
		}

		if (exporter.animateAtlas) {
			files.push({
				name: outputPath(job.folder, ANIMATION_FILE),
				content: job.animation
					? transformAnimationJson(job.animation.text, packed.scale, getPackedSpriteOffsets(packed.result), api.getAnimationOffsets())
					: buildAnimationJson(packed.result, {
						name: job.name,
						scale: packed.scale,
						removeFileExtension: options.removeFileExtension ?? true,
						prependFolderName: options.prependFolderName ?? true,
						trimMode: options.trimMode ?? "trim",
						stored: api.getCharacterAnimations()
					}),
				base64: false
			});
		}

		return { files, result: { name, before, after, beforeSize: beforeSizes.join(" + "), afterSize: afterSizes.join(" + "), kept: false, error: null } };
	}
	catch (e) {
		const error = e instanceof ApiError ? ErrorHandler.translateError(e) : e instanceof Error ? e.message : String(e);
		return { files: [], result: { name, before, after: 0, beforeSize: beforeSizes.join(" + "), afterSize: "", kept: false, error } };
	}
}
