export type MetaRect = {
	x: number;
	y: number;
	w?: number;
	h?: number;
};

export type FrameTag = {
	name: string;
	from: number;
	to: number;
	direction?: string;
	color?: string;
	repeat?: string;
	data?: string;
};

export type Layer = {
	name: string;
	opacity?: number;
	blendMode?: string;
	group?: string;
	color?: string;
	data?: string;
};

export type SliceKey = {
	frame: number;
	bounds: MetaRect;
	center?: MetaRect;
	pivot?: MetaRect;
};

export type Slice = {
	name: string;
	color?: string;
	data?: string;
	keys: SliceKey[];
};

export type AtlasMeta = Readonly<{
	frameCount: number;
	frameTags: FrameTag[] | null;
	layers: Layer[] | null;
	slices: Slice[] | null;
}>;

export type ExportedAtlasMeta = Partial<Record<"frameTags" | "layers" | "slices", string>>;

const SLICE_RECTS = ["bounds", "center", "pivot"] as const;

function listOf<T>(value: unknown) {
	return Array.isArray(value) ? value as T[] : null;
}

export function readAtlasMeta(meta: unknown, frameCount: number): AtlasMeta | null {
	if(!meta || typeof meta !== "object") return null;

	const { frameTags, layers, slices } = meta as Record<string, unknown>;
	const read: AtlasMeta = {
		frameCount,
		frameTags: listOf<FrameTag>(frameTags),
		layers: listOf<Layer>(layers),
		slices: listOf<Slice>(slices)
	};

	return read.frameTags || read.layers || read.slices ? read : null;
}

function scaleRect(rect: MetaRect, scale: number): MetaRect {
	const scaled: MetaRect = { ...rect, x: Math.round(rect.x * scale), y: Math.round(rect.y * scale) };
	if(rect.w !== undefined) scaled.w = Math.max(1, Math.round(rect.w * scale));
	if(rect.h !== undefined) scaled.h = Math.max(1, Math.round(rect.h * scale));
	return scaled;
}

function scaleSlice(slice: Slice, scale: number): Slice {
	if(scale === 1 || !Array.isArray(slice.keys)) return slice;

	return {
		...slice,
		keys: slice.keys.map(key => {
			const scaled = { ...key };
			for(const field of SLICE_RECTS) {
				if(key[field]) scaled[field] = scaleRect(key[field], scale);
			}
			return scaled;
		})
	};
}

function toTemplateJson(value: unknown) {
	return JSON.stringify(value, null, "\t").replace(/\n/g, "\n\t\t");
}

export function exportAtlasMeta(meta: AtlasMeta | null, framesInOrder: boolean, scale: number): ExportedAtlasMeta {
	const exported: ExportedAtlasMeta = {};
	if(!meta) return exported;

	if(meta.layers) exported.layers = toTemplateJson(meta.layers);

	if(framesInOrder) {
		if(meta.frameTags) exported.frameTags = toTemplateJson(meta.frameTags);
		if(meta.slices) exported.slices = toTemplateJson(meta.slices.map(slice => scaleSlice(slice, scale)));
	}

	return exported;
}
