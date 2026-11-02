import type { Rect } from "../types";
import { exportedName } from "../exporters";
import { atlasLabels, groupFrames, resolveAnimations, type CharacterFrame, type StoredAnimations } from "./Character";
import { smartSortImages } from "./common";

export type AtlasExportOptions = Readonly<{
	name: string;
	scale: number;
	removeFileExtension: boolean;
	prependFolderName: boolean;
	trimMode: "trim" | "crop";
	stored: StoredAnimations;
}>;

type AtlasFrame = Readonly<{
	sprite: string;
	x: number;
	y: number;
	drawing: string;
}>;

type Keyframe = {
	I: number;
	DU: number;
	E: unknown[];
};

const DEFAULT_FPS = 24;
const IDENTITY = [1, 0, 0, 1, 0, 0];

function place(trim: number, offset: number, scale: number) {
	return scale === 1 ? trim + offset : Math.round(trim * scale) + Math.round(offset * scale);
}

function mostCommon(values: readonly number[]) {
	const counts = new Map<number, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

	let best = DEFAULT_FPS, count = 0;
	for (const [value, n] of counts) {
		if (n > count || (n === count && value > best)) {
			best = value;
			count = n;
		}
	}

	return best;
}

export function buildAnimationJson(sheets: ReadonlyArray<ReadonlyArray<Rect>>, options: AtlasExportOptions) {
	const frames = new Map<string, AtlasFrame>();
	const list: CharacterFrame[] = [];
	const scale = options.scale || 1;

	sheets.forEach((sheet, index) => {
		for (const rect of sheet) {
			const file = rect.originalFile || rect.file;
			if (!file || frames.has(file)) continue;

			const cropped = rect.trimmed && options.trimMode === "crop";
			const sprite = exportedName(file, options.removeFileExtension, options.prependFolderName);
			const x = place(cropped ? 0 : rect.spriteSourceSize.x, rect.frameSize.x, scale);
			const y = place(cropped ? 0 : rect.spriteSourceSize.y, rect.frameSize.y, scale);
			const { frame } = rect;

			frames.set(file, { sprite, x, y, drawing: [index, frame.x, frame.y, frame.w, frame.h, rect.rotated, x, y].join(",") });
			list.push({ file, name: sprite, duration: rect.duration });
		}
	});

	const groups = groupFrames(list);
	const animations = resolveAnimations(groups, options.stored);
	const frameRate = mostCommon(animations.map(animation => animation.fps));
	const names = atlasLabels(groups);
	const labels: (Keyframe & { N: string })[] = [];
	const placed: Keyframe[] = [];
	const symbols: unknown[] = [];
	let start = 0;

	for (const animation of animations) {
		const step = Math.max(1, Math.round(frameRate / animation.fps));
		const keyframes: (Keyframe & { drawing: string })[] = [];
		let time = 0;

		for (const file of [...animation.files].sort(smartSortImages)) {
			const frame = frames.get(file);
			const last = keyframes[keyframes.length - 1];

			if (last && last.drawing === frame.drawing) last.DU += step;
			else keyframes.push({ I: time, DU: step, drawing: frame.drawing, E: [{ ASI: { MX: [1, 0, 0, 1, frame.x, frame.y], N: frame.sprite } }] });

			time += step;
		}

		const label = names.get(animation.key);

		labels.push({ N: label, I: start, DU: time, E: [] });
		placed.push({ I: start, DU: time, E: [{ SI: { SN: label, FF: 0, ST: "G", LP: "LP", MX: IDENTITY } }] });
		symbols.push({ SN: label, TL: { L: [{ LN: "Frames", FR: keyframes.map(({ I, DU, E }) => ({ I, DU, E })) }] } });

		start += time;
	}

	return JSON.stringify({
		AN: { N: options.name, SN: options.name, TL: { L: [{ LN: "Labels", FR: labels }, { LN: "Animations", FR: placed }] } },
		SD: { S: symbols },
		MD: { N: options.name, FRT: frameRate }
	});
}
