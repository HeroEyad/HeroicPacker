import type CustomImage from '../data/CustomImage';
import type { FrameSet } from './FrameSets';
import { framePixels, type FramePixels } from './FramePixels';

export type FrameStatus = "changed" | "moved" | "renamed" | "added" | "removed" | "same";

export const FRAME_STATUSES: ReadonlyArray<FrameStatus> = ["changed", "moved", "renamed", "added", "removed", "same"];

export type FrameDifference = Readonly<{
	name: string;
	status: FrameStatus;
	before: CustomImage | null;
	after: CustomImage | null;
	beforeName: string | null;
	moveX: number;
	moveY: number;
	beforeFrame: string;
	afterFrame: string;
	changedShare: number;
}>;

export type Box = Readonly<{
	x: number;
	y: number;
	width: number;
	height: number;
}>;

const TOLERANCE = 2;

function pixelsDiffer(a: Uint8ClampedArray, ia: number, b: Uint8ClampedArray, ib: number) {
	const alphaA = ia < 0 ? 0 : a[ia + 3];
	const alphaB = ib < 0 ? 0 : b[ib + 3];
	if (alphaA === 0 && alphaB === 0) return false;
	if (alphaA === 0 || alphaB === 0) return true;

	return Math.abs(alphaA - alphaB) > TOLERANCE
		|| Math.abs(a[ia] - b[ib]) > TOLERANCE
		|| Math.abs(a[ia + 1] - b[ib + 1]) > TOLERANCE
		|| Math.abs(a[ia + 2] - b[ib + 2]) > TOLERANCE;
}

function samePixels(a: FramePixels, b: FramePixels) {
	if (a.width !== b.width || a.height !== b.height) return false;

	for (let i = 0; i < a.data.length; i += 4) {
		if (pixelsDiffer(a.data, i, b.data, i)) return false;
	}
	return true;
}

function signature(pixels: FramePixels) {
	let hash = 2166136261;
	for (let i = 0; i < pixels.data.length; i++) hash = Math.imul(hash ^ pixels.data[i], 16777619);
	return pixels.width + "x" + pixels.height + ":" + (hash >>> 0);
}

function frameSize(pixels: FramePixels) {
	return pixels.frameWidth + "x" + pixels.frameHeight;
}

export function unionBox(a: FramePixels | null, b: FramePixels | null): Box {
	const boxes = [a, b].filter((pixels): pixels is FramePixels => !!pixels && pixels.width > 0);
	if (!boxes.length) return { x: 0, y: 0, width: 1, height: 1 };

	const x = Math.min(...boxes.map(box => box.x));
	const y = Math.min(...boxes.map(box => box.y));
	const right = Math.max(...boxes.map(box => box.x + box.width));
	const bottom = Math.max(...boxes.map(box => box.y + box.height));
	return { x, y, width: right - x, height: bottom - y };
}

function indexIn(pixels: FramePixels, x: number, y: number) {
	const px = x - pixels.x;
	const py = y - pixels.y;
	if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) return -1;
	return (py * pixels.width + px) * 4;
}

export function differenceMask(a: FramePixels, b: FramePixels) {
	const box = unionBox(a, b);
	const mask = new Uint8Array(box.width * box.height);
	let changed = 0;
	let visible = 0;

	for (let y = 0; y < box.height; y++) {
		for (let x = 0; x < box.width; x++) {
			const ia = indexIn(a, box.x + x, box.y + y);
			const ib = indexIn(b, box.x + x, box.y + y);
			const alphaA = ia < 0 ? 0 : a.data[ia + 3];
			const alphaB = ib < 0 ? 0 : b.data[ib + 3];
			if (alphaA === 0 && alphaB === 0) continue;

			visible++;
			if (pixelsDiffer(a.data, ia, b.data, ib)) {
				changed++;
				mask[y * box.width + x] = 1;
			}
		}
	}

	return { box, mask, changed, visible } as const;
}

function pairDifference(name: string, before: CustomImage, after: CustomImage, beforeName: string, renamed: boolean): FrameDifference {
	const a = framePixels(before);
	const b = framePixels(after);
	const base = { name, before, after, beforeName, beforeFrame: frameSize(a), afterFrame: frameSize(b) };

	if (samePixels(a, b)) {
		const moveX = b.x - a.x;
		const moveY = b.y - a.y;
		const moved = moveX !== 0 || moveY !== 0 || base.beforeFrame !== base.afterFrame;
		return { ...base, status: renamed ? "renamed" : moved ? "moved" : "same", moveX, moveY, changedShare: 0 };
	}

	const { changed, visible } = differenceMask(a, b);
	return { ...base, status: "changed", moveX: 0, moveY: 0, changedShare: visible ? changed / visible : 1 };
}

export function compareFrameSets(before: FrameSet, after: FrameSet): FrameDifference[] {
	const results: FrameDifference[] = [];
	const removed: string[] = [];
	const added: string[] = [];

	for (const [name, image] of before.frames) {
		const other = after.frames.get(name);
		if (other) results.push(pairDifference(name, image, other, name, false));
		else removed.push(name);
	}

	for (const name of after.frames.keys()) {
		if (!before.frames.has(name)) added.push(name);
	}

	const removedBySignature = new Map<string, string[]>();
	for (const name of removed) {
		const key = signature(framePixels(before.frames.get(name)));
		removedBySignature.set(key, [...(removedBySignature.get(key) ?? []), name]);
	}

	const renamedFrom = new Set<string>();
	for (const name of added) {
		const image = after.frames.get(name);
		const pixels = framePixels(image);
		const candidates = removedBySignature.get(signature(pixels)) ?? [];
		const source = candidates.find(candidate => !renamedFrom.has(candidate) && samePixels(framePixels(before.frames.get(candidate)), pixels));

		if (source) {
			renamedFrom.add(source);
			results.push(pairDifference(name, before.frames.get(source), image, source, true));
		}
		else {
			results.push({ name, status: "added", before: null, after: image, beforeName: null, moveX: 0, moveY: 0, beforeFrame: "", afterFrame: frameSize(pixels), changedShare: 0 });
		}
	}

	for (const name of removed) {
		if (renamedFrom.has(name)) continue;
		const image = before.frames.get(name);
		results.push({ name, status: "removed", before: image, after: null, beforeName: name, moveX: 0, moveY: 0, beforeFrame: frameSize(framePixels(image)), afterFrame: "", changedShare: 0 });
	}

	return results;
}
