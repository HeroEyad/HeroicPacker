export type AnimationFrame = Readonly<{
	width: number;
	height: number;
	pixels: Uint8ClampedArray;
	duration: number;
}>;

export type DecodedBitmap = Readonly<{
	width: number;
	height: number;
	data: Uint8ClampedArray;
}>;

export type PngDecoder = (png: Uint8Array) => Promise<DecodedBitmap>;

export type Animation = Readonly<{
	width: number;
	height: number;
	frameCount: number;
	frames: (decodePng: PngDecoder) => AsyncGenerator<AnimationFrame>;
}>;

const MIN_DURATION = 10;
const DEFAULT_DURATION = 100;
const MAX_PIXELS = 4096 * 4096;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

type GifFrame = {
	x: number;
	y: number;
	width: number;
	height: number;
	interlaced: boolean;
	palette: Uint8Array | null;
	transparent: number;
	disposal: number;
	duration: number;
	minCodeSize: number;
	blocks: Uint8Array[];
};

type GifImage = {
	width: number;
	height: number;
	frames: GifFrame[];
};

type PngChunk = {
	type: string;
	data: Uint8Array;
};

type ApngFrame = {
	x: number;
	y: number;
	width: number;
	height: number;
	duration: number;
	dispose: number;
	blend: number;
	data: Uint8Array[];
};

type ApngImage = {
	width: number;
	height: number;
	ihdr: Uint8Array;
	header: PngChunk[];
	frames: ApngFrame[];
};

function frameDuration(ms: number) {
	return ms > MIN_DURATION ? Math.round(ms) : DEFAULT_DURATION;
}

function readUint16(bytes: Uint8Array, pos: number) {
	return bytes[pos] << 8 | bytes[pos + 1];
}

function readUint32(bytes: Uint8Array, pos: number) {
	return (bytes[pos] << 24 | bytes[pos + 1] << 16 | bytes[pos + 2] << 8 | bytes[pos + 3]) >>> 0;
}

function writeUint32(bytes: Uint8Array, pos: number, value: number) {
	bytes[pos] = value >>> 24;
	bytes[pos + 1] = value >>> 16;
	bytes[pos + 2] = value >>> 8;
	bytes[pos + 3] = value;
}

function concatBytes(parts: Uint8Array[]) {
	let length = 0;
	for (const part of parts) length += part.length;

	const out = new Uint8Array(length);
	let pos = 0;
	for (const part of parts) {
		out.set(part, pos);
		pos += part.length;
	}

	return out;
}

function clearRect(canvas: Uint8ClampedArray, width: number, height: number, x: number, y: number, w: number, h: number) {
	const right = Math.min(width, x + w);
	const bottom = Math.min(height, y + h);
	if (right <= x) return;

	for (let row = y; row < bottom; row++) {
		canvas.fill(0, (row * width + x) * 4, (row * width + right) * 4);
	}
}

function isGif(bytes: Uint8Array) {
	return bytes.length >= 13 &&
		bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
		(bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
}

function skipSubBlocks(bytes: Uint8Array, pos: number, blocks: Uint8Array[] | null) {
	while (pos < bytes.length) {
		const size = bytes[pos++];
		if (size === 0) return pos;
		if (blocks) blocks.push(bytes.subarray(pos, Math.min(pos + size, bytes.length)));
		pos += size;
	}

	return -1;
}

function parseGif(bytes: Uint8Array): GifImage | null {
	if (!isGif(bytes)) return null;

	let width = bytes[6] | bytes[7] << 8;
	let height = bytes[8] | bytes[9] << 8;
	const flags = bytes[10];
	let pos = 13;

	let globalPalette: Uint8Array | null = null;
	if (flags & 0x80) {
		const size = 3 * (2 << (flags & 7));
		globalPalette = bytes.subarray(pos, pos + size);
		pos += size;
	}

	const frames: GifFrame[] = [];
	let transparent = -1;
	let disposal = 0;
	let delay = 0;

	while (pos < bytes.length) {
		const block = bytes[pos++];

		if (block === 0x21) {
			const label = bytes[pos++];
			if (label === 0xf9 && bytes[pos] >= 4 && pos + 4 < bytes.length) {
				const packed = bytes[pos + 1];
				disposal = (packed >> 2) & 7;
				delay = (bytes[pos + 2] | bytes[pos + 3] << 8) * 10;
				transparent = packed & 1 ? bytes[pos + 4] : -1;
			}

			pos = skipSubBlocks(bytes, pos, null);
			if (pos < 0) break;
			continue;
		}

		if (block !== 0x2c || pos + 10 > bytes.length) break;

		const x = bytes[pos] | bytes[pos + 1] << 8;
		const y = bytes[pos + 2] | bytes[pos + 3] << 8;
		const frameWidth = bytes[pos + 4] | bytes[pos + 5] << 8;
		const frameHeight = bytes[pos + 6] | bytes[pos + 7] << 8;
		const packed = bytes[pos + 8];
		pos += 9;

		let palette = globalPalette;
		if (packed & 0x80) {
			const size = 3 * (2 << (packed & 7));
			palette = bytes.subarray(pos, pos + size);
			pos += size;
		}

		const minCodeSize = bytes[pos++];
		const blocks: Uint8Array[] = [];
		const end = skipSubBlocks(bytes, pos, blocks);

		frames.push({
			x,
			y,
			width: frameWidth,
			height: frameHeight,
			interlaced: (packed & 0x40) !== 0,
			palette,
			transparent,
			disposal,
			duration: frameDuration(delay),
			minCodeSize,
			blocks
		});

		transparent = -1;
		disposal = 0;
		delay = 0;

		if (end < 0) break;
		pos = end;
	}

	if (!width || !height) {
		for (const frame of frames) {
			width = Math.max(width, frame.x + frame.width);
			height = Math.max(height, frame.y + frame.height);
		}
	}

	return { width, height, frames };
}

function decodeLzw(minCodeSize: number, data: Uint8Array, total: number) {
	const indices = new Uint8Array(total);
	const clearCode = 1 << minCodeSize;
	const endCode = clearCode + 1;
	const prefix = new Uint16Array(4096);
	const suffix = new Uint8Array(4096);
	const stack = new Uint8Array(4097);

	for (let i = 0; i < clearCode; i++) suffix[i] = i;

	let codeSize = minCodeSize + 1;
	let codeMask = (1 << codeSize) - 1;
	let next = endCode + 1;
	let previous = -1;
	let first = 0;
	let buffer = 0;
	let bits = 0;
	let pos = 0;
	let count = 0;

	while (count < total) {
		while (bits < codeSize && pos < data.length) {
			buffer |= data[pos++] << bits;
			bits += 8;
		}
		if (bits < codeSize) break;

		const code = buffer & codeMask;
		buffer >>>= codeSize;
		bits -= codeSize;

		if (code === clearCode) {
			codeSize = minCodeSize + 1;
			codeMask = (1 << codeSize) - 1;
			next = endCode + 1;
			previous = -1;
			continue;
		}
		if (code === endCode) break;

		if (previous === -1) {
			if (code > clearCode) break;
			indices[count++] = code;
			previous = code;
			first = code;
			continue;
		}

		let top = 0;
		let current = code;
		if (code >= next) {
			if (code > next) break;
			stack[top++] = first;
			current = previous;
		}

		while (current > endCode) {
			stack[top++] = suffix[current];
			current = prefix[current];
		}

		first = current;
		stack[top++] = first;

		if (next < 4096) {
			prefix[next] = previous;
			suffix[next] = first;
			next++;

			if (next > codeMask && codeSize < 12) {
				codeSize++;
				codeMask = (1 << codeSize) - 1;
			}
		}

		previous = code;

		while (top > 0 && count < total) indices[count++] = stack[--top];
	}

	return { indices, count };
}

function interlacedRows(height: number) {
	const rows = new Uint32Array(height);
	let i = 0;

	for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
		for (let y = start; y < height; y += step) rows[i++] = y;
	}

	return rows;
}

function drawGifFrame(canvas: Uint8ClampedArray, width: number, height: number, frame: GifFrame) {
	const palette = frame.palette;
	if (!palette || frame.minCodeSize < 1 || frame.minCodeSize > 11 || !frame.width || !frame.height) return;
	if (frame.x >= width || frame.y >= height || frame.width * frame.height > MAX_PIXELS) return;

	const { indices, count } = decodeLzw(frame.minCodeSize, concatBytes(frame.blocks), frame.width * frame.height);
	const rows = frame.interlaced ? interlacedRows(frame.height) : null;
	const colors = Math.floor(palette.length / 3);

	let i = 0;
	for (let row = 0; row < frame.height && i < count; row++) {
		const y = frame.y + (rows ? rows[row] : row);

		for (let col = 0; col < frame.width && i < count; col++, i++) {
			const x = frame.x + col;
			if (x >= width || y >= height) continue;

			const index = indices[i];
			if (index === frame.transparent || index >= colors) continue;

			const p = (y * width + x) * 4;
			const c = index * 3;
			canvas[p] = palette[c];
			canvas[p + 1] = palette[c + 1];
			canvas[p + 2] = palette[c + 2];
			canvas[p + 3] = 255;
		}
	}
}

async function* gifFrames(gif: GifImage): AsyncGenerator<AnimationFrame> {
	const { width, height } = gif;
	let canvas = new Uint8ClampedArray(width * height * 4);

	for (const frame of gif.frames) {
		const saved = frame.disposal === 3 ? canvas.slice() : null;

		drawGifFrame(canvas, width, height, frame);

		yield { width, height, pixels: canvas.slice(), duration: frame.duration };

		if (frame.disposal === 2) clearRect(canvas, width, height, frame.x, frame.y, frame.width, frame.height);
		else if (saved) canvas = saved;
	}
}

function readPngChunks(bytes: Uint8Array): PngChunk[] | null {
	if (bytes.length < 8 || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null;

	const chunks: PngChunk[] = [];
	let pos = 8;

	while (pos + 8 <= bytes.length) {
		const length = readUint32(bytes, pos);
		const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
		const start = pos + 8;
		const end = start + length;
		if (end > bytes.length) break;

		chunks.push({ type, data: bytes.subarray(start, end) });
		if (type === "IEND") break;

		pos = end + 4;
	}

	return chunks;
}

function parseApng(bytes: Uint8Array): ApngImage | null {
	const chunks = readPngChunks(bytes);
	if (!chunks || !chunks.length || chunks[0].type !== "IHDR" || chunks[0].data.length < 13) return null;

	const ihdr = chunks[0].data;
	const header: PngChunk[] = [];
	const frames: ApngFrame[] = [];
	let animated = false;
	let seenImageData = false;
	let frame: ApngFrame | null = null;

	for (const chunk of chunks) {
		const data = chunk.data;

		switch (chunk.type) {
			case "IHDR":
			case "IEND":
				break;
			case "acTL":
				animated = true;
				break;
			case "fcTL": {
				if (data.length < 26) {
					frame = null;
					break;
				}

				frame = {
					width: readUint32(data, 4),
					height: readUint32(data, 8),
					x: readUint32(data, 12),
					y: readUint32(data, 16),
					duration: frameDuration(readUint16(data, 20) * 1000 / (readUint16(data, 22) || 100)),
					dispose: data[24],
					blend: data[25],
					data: []
				};
				frames.push(frame);
				break;
			}
			case "IDAT":
				seenImageData = true;
				if (frame) frame.data.push(data);
				break;
			case "fdAT":
				if (frame && data.length > 4) frame.data.push(data.subarray(4));
				break;
			default:
				if (!seenImageData) header.push(chunk);
		}
	}

	if (!animated) return null;

	const width = readUint32(ihdr, 0);
	const height = readUint32(ihdr, 4);

	return {
		width,
		height,
		ihdr,
		header,
		frames: frames.filter(item => item.data.length > 0 && item.width > 0 && item.height > 0 && item.x + item.width <= width && item.y + item.height <= height)
	};
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array) {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}

	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);

	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array) {
	const out = new Uint8Array(data.length + 12);
	writeUint32(out, 0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	writeUint32(out, data.length + 8, crc32(out.subarray(4, data.length + 8)));

	return out;
}

function buildFramePng(image: ApngImage, frame: ApngFrame) {
	const ihdr = image.ihdr.slice();
	writeUint32(ihdr, 0, frame.width);
	writeUint32(ihdr, 4, frame.height);

	const parts = [Uint8Array.from(PNG_SIGNATURE), pngChunk("IHDR", ihdr)];
	for (const chunk of image.header) parts.push(pngChunk(chunk.type, chunk.data));
	parts.push(pngChunk("IDAT", concatBytes(frame.data)));
	parts.push(pngChunk("IEND", new Uint8Array(0)));

	return concatBytes(parts);
}

function blit(canvas: Uint8ClampedArray, width: number, height: number, bitmap: DecodedBitmap, x: number, y: number, over: boolean) {
	const source = bitmap.data;
	const right = Math.min(width, x + bitmap.width);
	const bottom = Math.min(height, y + bitmap.height);

	for (let row = y; row < bottom; row++) {
		for (let col = x; col < right; col++) {
			const s = ((row - y) * bitmap.width + (col - x)) * 4;
			const d = (row * width + col) * 4;
			const sa = source[s + 3];

			if (!over || sa === 255) {
				canvas[d] = source[s];
				canvas[d + 1] = source[s + 1];
				canvas[d + 2] = source[s + 2];
				canvas[d + 3] = sa;
				continue;
			}

			if (sa === 0) continue;

			const da = canvas[d + 3] * (255 - sa) / 255;
			const outA = sa + da;

			canvas[d] = (source[s] * sa + canvas[d] * da) / outA;
			canvas[d + 1] = (source[s + 1] * sa + canvas[d + 1] * da) / outA;
			canvas[d + 2] = (source[s + 2] * sa + canvas[d + 2] * da) / outA;
			canvas[d + 3] = outA;
		}
	}
}

async function* apngFrames(image: ApngImage, decodePng: PngDecoder): AsyncGenerator<AnimationFrame> {
	const { width, height } = image;
	let canvas = new Uint8ClampedArray(width * height * 4);

	for (let i = 0; i < image.frames.length; i++) {
		const frame = image.frames[i];
		const dispose = i === 0 && frame.dispose === 2 ? 1 : frame.dispose;
		const saved = dispose === 2 ? canvas.slice() : null;

		const bitmap = await decodePng(buildFramePng(image, frame));
		blit(canvas, width, height, bitmap, frame.x, frame.y, frame.blend === 1);

		yield { width, height, pixels: canvas.slice(), duration: frame.duration };

		if (dispose === 1) clearRect(canvas, width, height, frame.x, frame.y, frame.width, frame.height);
		else if (saved) canvas = saved;
	}
}

export function readAnimation(bytes: Uint8Array): Animation | null {
	const gif = parseGif(bytes);
	if (gif) {
		if (gif.frames.length < 2 || !gif.width || !gif.height || gif.width * gif.height > MAX_PIXELS) return null;

		return {
			width: gif.width,
			height: gif.height,
			frameCount: gif.frames.length,
			frames: () => gifFrames(gif)
		};
	}

	const apng = parseApng(bytes);
	if (apng) {
		if (apng.frames.length < 2 || !apng.width || !apng.height || apng.width * apng.height > MAX_PIXELS) return null;

		return {
			width: apng.width,
			height: apng.height,
			frameCount: apng.frames.length,
			frames: (decodePng: PngDecoder) => apngFrames(apng, decodePng)
		};
	}

	return null;
}
