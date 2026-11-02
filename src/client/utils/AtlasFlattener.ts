import type { AnimationFile } from 'api/FunkinPackerApi';
import type { LoadedImages } from 'api/types';
import { getAnimationOffsetAt, parseAnimationJson, type AnimationOffset, type JsonObject } from 'api/utils/AnimateAtlas';
import { AnimateTimeline, concatMatrix, type AtlasDraw } from 'api/utils/AnimateTimeline';
import { atlasFrameNames, drawBounds, unionBounds, type Bounds } from 'api/utils/AtlasFrames';
import { getDummyRect } from 'api/utils/common';
import { stem } from 'api/utils/SheetJobs';
import CustomImage from '../data/CustomImage';

export type FlattenResult = Readonly<{
	images: LoadedImages;
	frames: number;
	animations: number;
	missing: string[];
}>;

type TimelineFrame = Readonly<{
	name: string;
	offset: AnimationOffset;
	draws: AtlasDraw[];
}>;

function symbolName(json: JsonObject) {
	const main = json.AN ?? json.ANIMATION;
	if (!main || typeof main !== "object" || Array.isArray(main)) return "frame";

	const name = main.SN ?? main.SYMBOL_name ?? main.N ?? main.name;
	return typeof name === "string" && name.trim() ? name : "frame";
}

export async function flattenAtlas(animation: AnimationFile, sprites: LoadedImages, offsets: ReadonlyMap<string, AnimationOffset>): Promise<FlattenResult | null> {
	const json = parseAnimationJson(animation.data);
	if (!json) return null;

	const timeline = new AnimateTimeline(json);
	const byName = new Map<string, CustomImage>();
	for (const [key, image] of Object.entries(sprites)) {
		byName.set(stem(key), image);
		byName.set(key, image);
	}

	const sizes = new Map([...byName].map(([name, image]) => [name, { w: image.width, h: image.height }] as const));
	const names = atlasFrameNames(timeline.labels, timeline.frameCount, symbolName(json));
	const frames: TimelineFrame[] = [];
	const missing = new Set<string>();
	let bounds: Bounds | null = null;

	for (let index = 0; index < names.length; index++) {
		const name = names[index];
		if (name === null) continue;

		const frame = { name, offset: getAnimationOffsetAt(timeline.labels, offsets, index), draws: timeline.getDraws(index) };
		for (const draw of frame.draws) {
			if (!byName.has(draw.name)) missing.add(draw.name);
		}

		bounds = unionBounds(bounds, drawBounds(frame.draws, sizes, frame.offset));
		frames.push(frame);
	}

	if (!bounds || !frames.length) return null;

	const left = Math.floor(bounds.left);
	const top = Math.floor(bounds.top);
	const width = Math.max(1, Math.ceil(bounds.right) - left);
	const height = Math.max(1, Math.ceil(bounds.bottom) - top);

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	const encoded = new Map<string, string>();
	const images: LoadedImages = {};
	const loading: Promise<void>[] = [];
	const prefixes = new Set<string>();
	const duration = 1000 / timeline.frameRate;

	for (const frame of frames) {
		const signature = JSON.stringify([frame.offset, frame.draws]);
		let content = encoded.get(signature);

		if (content === undefined) {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.globalAlpha = 1;
			ctx.clearRect(0, 0, width, height);

			for (const draw of frame.draws) {
				const sprite = byName.get(draw.name);
				if (!sprite || draw.alpha <= 0) continue;

				const m = concatMatrix([1, 0, 0, 1, frame.offset.x - left, frame.offset.y - top], draw.matrix);
				ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
				ctx.globalAlpha = draw.alpha;
				ctx.drawImage(sprite.image, 0, 0);
			}

			content = canvas.toDataURL("image/png");
			encoded.set(signature, content);
		}

		const key = frame.name + ".png";
		const image = new CustomImage(new Image());
		image.src = content;
		image.base64 = content;
		image.rect = getDummyRect(key, width, height);
		image.rect.duration = duration;

		images[key] = image;
		prefixes.add(frame.name.slice(0, -4));
		loading.push(image.image.decode().catch(() => {}));
	}

	await Promise.all(loading);

	return { images, frames: frames.length, animations: prefixes.size, missing: [...missing] };
}
