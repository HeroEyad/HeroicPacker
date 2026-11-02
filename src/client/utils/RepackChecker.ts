import type { Rect } from 'api/types';
import { exportedName } from 'api/exporters';
import Sparrow from 'api/splitters/Sparrow';
import Splitter from 'api/splitters/Splitter';
import { placeAlpha, samePlacement } from 'api/utils/RepackCheck';

export type RepackCheckResult = Readonly<{
	frames: number;
	moved: string[];
	edited: number;
}>;

export type CheckedSheet = Readonly<{
	data: Rect[];
	buffer: HTMLCanvasElement;
	content: string;
}>;

export type CheckOptions = Readonly<{
	removeFileExtension: boolean;
	prependFolderName: boolean;
	alphaThreshold: number;
}>;

function readPixels(ctx: CanvasRenderingContext2D, width: number, height: number, draw: () => void) {
	const canvas = ctx.canvas;
	canvas.width = Math.max(1, width);
	canvas.height = Math.max(1, height);

	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	draw();
	ctx.setTransform(1, 0, 0, 1, 0, 0);

	return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

function exportedPixels(ctx: CanvasRenderingContext2D, sheet: HTMLCanvasElement, rect: Rect, splitter: Splitter) {
	const { x, y, w, h } = rect.frame;

	return readPixels(ctx, w, h, () => {
		if (!rect.rotated) {
			ctx.drawImage(sheet, x, y, w, h, 0, 0, w, h);
			return;
		}

		ctx.translate(w / 2, h / 2);
		ctx.rotate(splitter.inverseRotation ? Math.PI / 2 : -Math.PI / 2);
		ctx.drawImage(sheet, x, y, h, w, -h / 2, -w / 2, h, w);
	});
}

export function checkRepack(sheets: ReadonlyArray<CheckedSheet>, options: CheckOptions): RepackCheckResult {
	const splitter = new Sparrow();
	const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	const moved: string[] = [];
	let frames = 0;
	let edited = 0;

	if (!ctx) return { frames, moved, edited };

	for (const sheet of sheets) {
		let parsed: Rect[] = [];
		splitter.options = { textureWidth: sheet.buffer.width, textureHeight: sheet.buffer.height, width: 32, height: 32, padding: 0 };
		splitter.doSplit(splitter.cleanData(sheet.content), result => {
			if (result) parsed = result;
		});

		const byName = new Map(parsed.map(rect => [rect.name, rect]));

		for (const rect of sheet.data) {
			const file = rect.originalFile || rect.file;
			const image = rect.image;
			if (!file || !image) continue;

			frames++;
			const own = image.rect;
			if (own?.importedOffset && (own.importedOffset.x !== own.frameSize.x || own.importedOffset.y !== own.frameSize.y)) edited++;

			const name = exportedName(file, options.removeFileExtension, options.prependFolderName);
			const exported = byName.get(Splitter.fixFileName(name));
			if (!exported) {
				moved.push(name);
				continue;
			}

			const expected = placeAlpha(readPixels(ctx, image.width, image.height, () => ctx.drawImage(image.image, 0, 0)), image.width, image.height, rect.frameSize.x, rect.frameSize.y, options.alphaThreshold);
			const actual = placeAlpha(exportedPixels(ctx, sheet.buffer, exported, splitter), exported.frame.w, exported.frame.h, exported.frameSize.x, exported.frameSize.y, options.alphaThreshold);

			if (!samePlacement(expected, actual)) moved.push(name);
		}
	}

	return { frames, moved, edited };
}
