const LOBES = 3;
const EPSILON = 1e-6;

const floorS = (v: number) => Math.floor(v + EPSILON);
const ceilS = (v: number) => Math.ceil(v - EPSILON);

function sinc(x: number) {
	if (x === 0) return 1;
	const px = Math.PI * x;
	return Math.sin(px) / px;
}

export function lanczos3(x: number) {
	x = Math.abs(x);
	if (x >= LOBES) return 0;
	return sinc(x) * sinc(x / LOBES);
}

type Contributions = {
	starts: Int32Array;
	counts: Int32Array;
	offsets: Int32Array;
	weights: Float32Array;
};

function computeContributions(dstStart: number, dstCount: number, scale: number, srcOrigin: number, srcLen: number): Contributions {
	const filterScale = Math.min(1, scale);
	const support = LOBES / filterScale;

	const starts = new Int32Array(dstCount);
	const counts = new Int32Array(dstCount);
	const offsets = new Int32Array(dstCount);
	const list: number[] = [];

	for (let k = 0; k < dstCount; k++) {
		const center = (dstStart + k + 0.5) / scale - srcOrigin;
		const left = Math.ceil(center - 0.5 - support);
		const right = Math.floor(center - 0.5 + support);

		let total = 0;
		for (let u = left; u <= right; u++) {
			total += lanczos3((u + 0.5 - center) * filterScale);
		}
		if (total === 0) total = 1;

		const first = Math.max(left, 0);
		const last = Math.min(right, srcLen - 1);

		starts[k] = first;
		offsets[k] = list.length;
		counts[k] = Math.max(0, last - first + 1);

		for (let u = first; u <= last; u++) {
			list.push(lanczos3((u + 0.5 - center) * filterScale) / total);
		}
	}

	return { starts, counts, offsets, weights: new Float32Array(list) };
}

export type ScaledSprite = {
	canvas: HTMLCanvasElement | null;
	data: Uint8ClampedArray;
	x: number;
	y: number;
	w: number;
	h: number;
};

export type ScaleSpriteOptions = {
	source: CanvasImageSource;
	pixels?: Uint8ClampedArray;
	pixelsWidth?: number;
	imageOriginX: number;
	imageOriginY: number;
	imageWidth: number;
	imageHeight: number;
	box: { x: number; y: number; w: number; h: number };
	scale: number;
	trim: boolean;
	alphaThreshold: number;
};

let readCtx: CanvasRenderingContext2D | null = null;

function getReadContext() {
	if (!readCtx) {
		readCtx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
		if (!readCtx) {
			throw new Error("No canvas context");
		}
	}
	return readCtx;
}

function readSource(opt: ScaleSpriteOptions, srcW: number, srcH: number) {
	const { box, pixels } = opt;

	if (pixels) {
		const width = opt.pixelsWidth ?? opt.imageWidth;
		const height = Math.floor(pixels.length / (width * 4));
		const out = new Uint8ClampedArray(srcW * srcH * 4);
		const columns = Math.min(srcW, width - box.x);
		const rows = Math.min(srcH, height - box.y);

		for (let y = 0; y < rows; y++) {
			const from = ((box.y + y) * width + box.x) * 4;
			out.set(pixels.subarray(from, from + columns * 4), y * srcW * 4);
		}

		return out;
	}

	const context = getReadContext();
	const readCanvas = context.canvas;

	readCanvas.width = srcW;
	readCanvas.height = srcH;
	context.clearRect(0, 0, srcW, srcH);
	context.drawImage(opt.source, box.x, box.y, srcW, srcH, 0, 0, srcW, srcH);
	return context.getImageData(0, 0, srcW, srcH).data;
}

export function scaleSprite(opt: ScaleSpriteOptions): ScaledSprite {
	const { scale, box } = opt;
	const srcW = Math.max(1, box.w);
	const srcH = Math.max(1, box.h);

	const originX = opt.imageOriginX + box.x;
	const originY = opt.imageOriginY + box.y;

	const imgX0 = floorS(opt.imageOriginX * scale);
	const imgY0 = floorS(opt.imageOriginY * scale);
	const imgX1 = ceilS((opt.imageOriginX + opt.imageWidth) * scale);
	const imgY1 = ceilS((opt.imageOriginY + opt.imageHeight) * scale);

	let dx0: number, dy0: number, dx1: number, dy1: number;
	if (opt.trim) {
		const support = LOBES / Math.min(1, scale);
		dx0 = Math.max(imgX0, floorS((originX - support) * scale));
		dy0 = Math.max(imgY0, floorS((originY - support) * scale));
		dx1 = Math.min(imgX1, ceilS((originX + srcW + support) * scale));
		dy1 = Math.min(imgY1, ceilS((originY + srcH + support) * scale));
	} else {
		dx0 = imgX0; dy0 = imgY0;
		dx1 = imgX1; dy1 = imgY1;
	}

	const dw = Math.max(1, dx1 - dx0);
	const dh = Math.max(1, dy1 - dy0);

	const src = readSource(opt, srcW, srcH);

	const pre = new Float32Array(srcW * srcH * 4);
	for (let i = 0; i < src.length; i += 4) {
		const a = src[i + 3];
		const f = a / 255;
		pre[i] = src[i] * f;
		pre[i + 1] = src[i + 1] * f;
		pre[i + 2] = src[i + 2] * f;
		pre[i + 3] = a;
	}

	const cx = computeContributions(dx0, dw, scale, originX, srcW);
	const cy = computeContributions(dy0, dh, scale, originY, srcH);

	const tmp = new Float32Array(dw * srcH * 4);
	for (let y = 0; y < srcH; y++) {
		const rowIn = y * srcW * 4;
		const rowOut = y * dw * 4;
		for (let k = 0; k < dw; k++) {
			let r = 0, g = 0, b = 0, a = 0;
			const start = cx.starts[k];
			const count = cx.counts[k];
			const wOff = cx.offsets[k];
			for (let n = 0; n < count; n++) {
				const w = cx.weights[wOff + n];
				const p = rowIn + (start + n) * 4;
				r += pre[p] * w;
				g += pre[p + 1] * w;
				b += pre[p + 2] * w;
				a += pre[p + 3] * w;
			}
			const o = rowOut + k * 4;
			tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
		}
	}

	let out = new Uint8ClampedArray(dw * dh * 4);
	for (let j = 0; j < dh; j++) {
		const start = cy.starts[j];
		const count = cy.counts[j];
		const wOff = cy.offsets[j];
		for (let k = 0; k < dw; k++) {
			let r = 0, g = 0, b = 0, a = 0;
			for (let n = 0; n < count; n++) {
				const w = cy.weights[wOff + n];
				const p = ((start + n) * dw + k) * 4;
				r += tmp[p] * w;
				g += tmp[p + 1] * w;
				b += tmp[p + 2] * w;
				a += tmp[p + 3] * w;
			}
			const o = (j * dw + k) * 4;
			if (a <= 0.5) continue;
			if (a > 255) a = 255;
			const inv = 255 / a;
			out[o] = r * inv;
			out[o + 1] = g * inv;
			out[o + 2] = b * inv;
			out[o + 3] = a;
		}
	}

	let x = dx0, y = dy0, w = dw, h = dh;

	if (opt.trim) {
		const threshold = opt.alphaThreshold;
		let minX = w, minY = h, maxX = -1, maxY = -1;
		for (let j = 0; j < h; j++) {
			for (let k = 0; k < w; k++) {
				if (out[(j * w + k) * 4 + 3] > threshold) {
					if (k < minX) minX = k;
					if (k > maxX) maxX = k;
					if (j < minY) minY = j;
					if (j > maxY) maxY = j;
				}
			}
		}

		if (maxX < 0) {
			out = new Uint8ClampedArray(4);
			x = floorS(originX * scale);
			y = floorS(originY * scale);
			w = 1;
			h = 1;
		} else if (minX > 0 || minY > 0 || maxX < w - 1 || maxY < h - 1) {
			const nw = maxX - minX + 1;
			const nh = maxY - minY + 1;
			const cropped = new Uint8ClampedArray(nw * nh * 4);
			for (let j = 0; j < nh; j++) {
				const from = ((minY + j) * w + minX) * 4;
				cropped.set(out.subarray(from, from + nw * 4), j * nw * 4);
			}
			out = cropped;
			x += minX;
			y += minY;
			w = nw;
			h = nh;
		}
	}

	if (opt.pixels) {
		return { canvas: null, data: out, x, y, w, h };
	}

	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("No canvas context");
	}
	ctx.putImageData(new ImageData(out, w, h), 0, 0);

	return { canvas, data: out, x, y, w, h };
}