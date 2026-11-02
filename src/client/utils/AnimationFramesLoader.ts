import CustomImage from "../data/CustomImage";
import { readAnimation, type Animation, type DecodedBitmap } from "api/utils/AnimatedImage";
import { getDummyRect } from "api/utils/common";
import type { LoadedImages } from "api/types";

const MIN_DIGITS = 4;

async function decodePng(bytes: Uint8Array): Promise<DecodedBitmap> {
	const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
	const canvas = document.createElement("canvas");
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;

	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("No canvas context");

	ctx.drawImage(bitmap, 0, 0);
	bitmap.close();

	return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

function frameBaseName(path: string) {
	const dot = path.lastIndexOf(".");
	const base = dot > path.lastIndexOf("/") ? path.substring(0, dot) : path;

	return /\d$/.test(base) ? base + "_" : base;
}

export function mayBeAnimated(name: string) {
	return /\.(gif|png)$/i.test(name);
}

async function loadFrames(animation: Animation, path: string, into: LoadedImages) {
	const base = frameBaseName(path);
	const digits = Math.max(MIN_DIGITS, (animation.frameCount - 1).toString(10).length);

	const canvas = document.createElement("canvas");
	canvas.width = animation.width;
	canvas.height = animation.height;

	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("No canvas context");

	const frames: LoadedImages = {};
	const loading: Promise<void>[] = [];
	let index = 0;

	for await (const frame of animation.frames(decodePng)) {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.putImageData(new ImageData(frame.pixels, frame.width, frame.height), 0, 0);

		const src = canvas.toDataURL("image/png");
		const name = base + index.toString(10).padStart(digits, "0") + ".png";

		const image = new CustomImage(new Image());
		image.src = src;
		image.base64 = src;
		image.rect = getDummyRect(name, frame.width, frame.height);
		image.rect.duration = frame.duration;

		frames[name] = image;
		loading.push(image.image.decode().catch(() => {}));
		index++;
	}

	await Promise.all(loading);
	Object.assign(into, frames);
}

export async function loadAnimationFrames(bytes: Uint8Array, path: string, into: LoadedImages) {
	try {
		const animation = readAnimation(bytes);
		if (!animation) return false;

		await loadFrames(animation, path, into);
		return true;
	}
	catch (e) {
		console.error("Could not read the frames of " + path + ", loading it as a single image", e);
		return false;
	}
}
