import type { AnimationLabel, AnimationOffset } from "./AnimateAtlas";
import type { AtlasDraw } from "./AnimateTimeline";

export type Bounds = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

const FRAME_DIGITS = 4;

function framePrefix(name: string) {
	const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "anim";
	return /\d$/.test(clean) ? clean + "_" : clean;
}

export function atlasFrameNames(labels: readonly AnimationLabel[], frameCount: number, fallback: string): (string | null)[] {
	const names: (string | null)[] = new Array(frameCount).fill(null);
	const ranges = labels.length ? labels : [{ name: fallback, start: 0, length: frameCount }];
	const used = new Set<string>();

	for (const range of ranges) {
		let prefix = framePrefix(range.name);
		for (let i = 2; used.has(prefix); i++) prefix = framePrefix(range.name + "_" + i);
		used.add(prefix);

		const end = Math.min(frameCount, range.start + range.length);
		for (let frame = Math.max(0, range.start); frame < end; frame++) {
			names[frame] = prefix + String(frame - range.start).padStart(FRAME_DIGITS, "0");
		}
	}

	return names;
}

export function drawBounds(draws: readonly AtlasDraw[], sizes: ReadonlyMap<string, Readonly<{ w: number, h: number }>>, offset: AnimationOffset): Bounds | null {
	let bounds: Bounds | null = null;

	for (const draw of draws) {
		const size = sizes.get(draw.name);
		if (!size || draw.alpha <= 0) continue;

		const [a, b, c, d, e, f] = draw.matrix;
		for (const [x, y] of [[0, 0], [size.w, 0], [0, size.h], [size.w, size.h]]) {
			const px = a * x + c * y + e + offset.x;
			const py = b * x + d * y + f + offset.y;

			if (!bounds) bounds = { left: px, top: py, right: px, bottom: py };
			else {
				bounds.left = Math.min(bounds.left, px);
				bounds.top = Math.min(bounds.top, py);
				bounds.right = Math.max(bounds.right, px);
				bounds.bottom = Math.max(bounds.bottom, py);
			}
		}
	}

	return bounds;
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
	if (!a) return b;
	if (!b) return a;

	return {
		left: Math.min(a.left, b.left),
		top: Math.min(a.top, b.top),
		right: Math.max(a.right, b.right),
		bottom: Math.max(a.bottom, b.bottom)
	};
}
