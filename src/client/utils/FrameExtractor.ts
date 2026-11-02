import CustomImage from "../data/CustomImage";
import type Splitter from "api/splitters/Splitter";
import type { LoadedImages, Rect } from "api/types";
import { fixManualOffsets, setMaxSizesForSourceSize } from "api/utils/common";

type ExtractedFrame = {
	name: string;
	content: string;
	rect: Rect;
};

export async function extractFrames(texture: CanvasImageSource, frames: Rect[], splitter: Splitter, disableUntrim: boolean = false): Promise<LoadedImages> {
	const buffer = document.createElement("canvas");
	const ctx = buffer.getContext("2d");
	const files: ExtractedFrame[] = [];
	const encoded = new Map<string, string>();

	fixManualOffsets(frames);
	if(splitter.groupFramesByAnimation)
		setMaxSizesForSourceSize(frames);

	for(const item of frames) {
		const trimmed = item.trimmed ? disableUntrim : false;

		const ssw = item.sourceSize.mw ?? item.frame.w;
		const ssh = item.sourceSize.mh ?? item.frame.h;

		let width = (disableUntrim && trimmed) ? item.spriteSourceSize.w : ssw;
		let height = (disableUntrim && trimmed) ? item.spriteSourceSize.h : ssh;

		const isEmpty = width === 0 || height === 0;

		if(isEmpty) {
			width = 1;
			height = 1;
		}

		let ext = item.name.split('.').pop().toLowerCase();
		if(!ext) {
			ext = 'png';
			item.name += '.' + ext;
		}
		const mime = ext === 'png' ? 'image/png' : 'image/jpeg';

		const pieceKey = [
			mime, width, height, isEmpty, item.rotated, trimmed,
			item.frame.x, item.frame.y, item.frame.w, item.frame.h,
			item.spriteSourceSize.x, item.spriteSourceSize.y, item.spriteSourceSize.w, item.spriteSourceSize.h
		].join(',');

		let base64 = encoded.get(pieceKey);

		if(base64 === undefined) {
			buffer.width = width;
			buffer.height = height;

			ctx.clearRect(0, 0, buffer.width, buffer.height);

			if(!isEmpty) {
				if(item.rotated) {
					ctx.save();

					ctx.translate(item.spriteSourceSize.x + item.spriteSourceSize.w/2, item.spriteSourceSize.y + item.spriteSourceSize.h/2);
					ctx.rotate(splitter.inverseRotation ? Math.PI/2 : -Math.PI/2);

					let dx = trimmed ? item.spriteSourceSize.y - item.spriteSourceSize.h/2 : -item.spriteSourceSize.h/2;
					let dy = trimmed ? -(item.spriteSourceSize.x + item.spriteSourceSize.w/2) : -item.spriteSourceSize.w/2;

					ctx.drawImage(texture,
						item.frame.x, item.frame.y,
						item.frame.h, item.frame.w,
						dx, dy,
						item.spriteSourceSize.h, item.spriteSourceSize.w);

					ctx.restore();
				} else {
					let dx = trimmed ? 0 : item.spriteSourceSize.x;
					let dy = trimmed ? 0 : item.spriteSourceSize.y;

					ctx.drawImage(texture,
						item.frame.x, item.frame.y,
						item.frame.w, item.frame.h,
						dx, dy,
						item.spriteSourceSize.w, item.spriteSourceSize.h);
				}
			}

			base64 = buffer.toDataURL(mime);
			encoded.set(pieceKey, base64);
		}

		files.push({
			name: item.name,
			content: base64,
			rect: item
		});
	}

	const images: LoadedImages = {};
	const loading: Promise<void>[] = [];

	for(const file of files) {
		const image = new CustomImage(new Image());
		image.src = file.content;
		image.base64 = file.content;
		image.rect = file.rect;

		images[file.name] = image;
		loading.push(image.image.decode().catch(() => {}));
	}

	await Promise.all(loading);

	return images;
}
