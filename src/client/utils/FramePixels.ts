import type CustomImage from '../data/CustomImage';

type Visible = Readonly<{
	x: number;
	y: number;
	width: number;
	height: number;
	data: Uint8ClampedArray;
}>;

export type FramePixels = Visible & Readonly<{
	frameWidth: number;
	frameHeight: number;
}>;

const visibleCache = new WeakMap<HTMLImageElement, Visible>();
let canvas: HTMLCanvasElement | null = null;

function readPixels(image: HTMLImageElement) {
	canvas ??= document.createElement("canvas");
	canvas.width = Math.max(1, image.naturalWidth);
	canvas.height = Math.max(1, image.naturalHeight);

	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(image, 0, 0);
	return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function visiblePixels(image: HTMLImageElement): Visible {
	const cached = visibleCache.get(image);
	if (cached) return cached;

	const { width, height, data } = readPixels(image);
	let left = width, top = height, right = -1, bottom = -1;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (data[(y * width + x) * 4 + 3] === 0) continue;
			if (x < left) left = x;
			if (x > right) right = x;
			if (y < top) top = y;
			if (y > bottom) bottom = y;
		}
	}

	let visible: Visible;
	if (right < 0) {
		visible = { x: 0, y: 0, width: 0, height: 0, data: new Uint8ClampedArray(0) };
	}
	else {
		const w = right - left + 1;
		const h = bottom - top + 1;
		const cropped = new Uint8ClampedArray(w * h * 4);
		for (let row = 0; row < h; row++) {
			const start = ((top + row) * width + left) * 4;
			cropped.set(data.subarray(start, start + w * 4), row * w * 4);
		}
		visible = { x: left, y: top, width: w, height: h, data: cropped };
	}

	visibleCache.set(image, visible);
	return visible;
}

export function framePixels(image: CustomImage): FramePixels {
	const visible = visiblePixels(image.image);
	const rect = image.rect;

	return {
		...visible,
		x: visible.x + (rect?.frameSize.x ?? 0),
		y: visible.y + (rect?.frameSize.y ?? 0),
		frameWidth: rect?.sourceSize.w ?? image.naturalWidth,
		frameHeight: rect?.sourceSize.h ?? image.naturalHeight
	};
}

export function drawFrame(ctx: CanvasRenderingContext2D, image: CustomImage, x: number, y: number, scale: number) {
	const rect = image.rect;
	ctx.drawImage(image.image, x + (rect?.frameSize.x ?? 0) * scale, y + (rect?.frameSize.y ?? 0) * scale, image.naturalWidth * scale, image.naturalHeight * scale);
}

export function frameBounds(images: ReadonlyArray<CustomImage>) {
	let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;

	for (const image of images) {
		const pixels = framePixels(image);
		if (!pixels.width) continue;
		left = Math.min(left, pixels.x);
		top = Math.min(top, pixels.y);
		right = Math.max(right, pixels.x + pixels.width);
		bottom = Math.max(bottom, pixels.y + pixels.height);
	}

	if (right < left) return { x: 0, y: 0, width: 1, height: 1 };
	return { x: left, y: top, width: right - left, height: bottom - top };
}
