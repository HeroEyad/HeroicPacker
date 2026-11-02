import type { AnimationOffset } from "./AnimateAtlas";
import type { ResolvedAnimation } from "./Character";

const ALPHA_THRESHOLD = 32;
const FEET_SHARE = 0.1;
const REFERENCE_ANIMATIONS = ["idle", "danceLeft", "danceRight"];

export function findFeet(data: Uint8ClampedArray, width: number, height: number): AnimationOffset | null {
	const visible = (x: number, y: number) => data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD;
	const rowVisible = (y: number) => {
		for (let x = 0; x < width; x++) {
			if (visible(x, y)) return true;
		}
		return false;
	};

	let top = 0;
	while (top < height && !rowVisible(top)) top++;
	if (top === height) return null;

	let bottom = height - 1;
	while (!rowVisible(bottom)) bottom--;

	const band = Math.max(1, Math.round((bottom - top + 1) * FEET_SHARE));
	let sum = 0;
	let count = 0;

	for (let y = bottom - band + 1; y <= bottom; y++) {
		for (let x = 0; x < width; x++) {
			if (!visible(x, y)) continue;
			sum += x + 0.5;
			count++;
		}
	}

	return { x: sum / count, y: bottom + 1 };
}

export function alignReference<T extends Pick<ResolvedAnimation, "anim">>(animations: readonly T[]): T | undefined {
	for (const name of REFERENCE_ANIMATIONS) {
		const found = animations.find(animation => animation.anim === name);
		if (found) return found;
	}

	return animations[0];
}

export function alignOffsets(feet: ReadonlyMap<string, AnimationOffset>, reference: string, referenceOffset: AnimationOffset) {
	const offsets = new Map<string, AnimationOffset>();
	const anchor = feet.get(reference);
	if (!anchor) return offsets;

	for (const [key, point] of feet) {
		if (key === reference) continue;

		offsets.set(key, {
			x: referenceOffset.x + Math.round(point.x - anchor.x),
			y: referenceOffset.y + Math.round(point.y - anchor.y)
		});
	}

	return offsets;
}
