import type { Rect } from "../types";
import { animationKey } from "./Character";

export type AnimationSpace = Readonly<{
	key: string;
	area: number;
	share: number;
	frames: number;
	unique: number;
}>;

export function getSpaceUsage(sheets: ReadonlyArray<ReadonlyArray<Rect>>, spritePadding: number): AnimationSpace[] {
	const groups = new Map<string, { area: number; frames: number; unique: number }>();
	let total = 0;

	for (const sheet of sheets) {
		for (const rect of sheet) {
			const key = animationKey(rect.originalFile || rect.file || rect.name);

			let group = groups.get(key);
			if (!group) {
				group = { area: 0, frames: 0, unique: 0 };
				groups.set(key, group);
			}

			group.frames++;
			if (rect.cloned) continue;

			const area = (rect.frame.w + spritePadding) * (rect.frame.h + spritePadding);
			group.area += area;
			group.unique++;
			total += area;
		}
	}

	return [...groups].map(([key, group]) => ({ key, ...group, share: total ? group.area / total : 0 })).sort((a, b) => b.area - a.area || (a.key === b.key ? 0 : a.key > b.key ? 1 : -1));
}
