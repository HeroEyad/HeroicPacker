import type { Rect } from "api/types";
import Packer, { type MethodList } from "./Packer";

const METHODS = {
	SortedAreaDsc: "SortedAreaDsc",
	SortedAreaAsc: "SortedAreaAsc",
	Unsorted: "Unsorted",
} as const;

type MethodType = typeof METHODS[keyof typeof METHODS];

type Block = {
	x: number,
	y: number,
	w: number,
	h: number,
	rect: Rect,
	rotated?: boolean,
}

const ROW_WIDTH_STEPS = 96;

function calculateArea(blocks:Block[] | null) {
	if(!blocks) return 0;
	if(blocks.length === 0) return 0;
	let rightBound = 0;
	let bottomBound = 0;
	for(const block of blocks) {
		rightBound = Math.max(rightBound, block.x + block.w);
		bottomBound = Math.max(bottomBound, block.y + block.h);
	}
	return rightBound * bottomBound;
}

class OrderedPacker extends Packer {
	allowRotate: boolean;
	padding: number;
	width: number;
	height: number;

	constructor(width: number, height: number, allowRotate: boolean = false, padding: number = 0) {
		super(width, height, allowRotate, padding);

		this.width = width;
		this.height = height;
		this.allowRotate = allowRotate;
		this.padding = padding;
	}

	override pack(_data:Rect[], _method:MethodType):Rect[] {
		const sorted = [..._data];

		if(_method == METHODS.SortedAreaDsc)
			sorted.sort((a, b) => (b.frame.w * b.frame.h) - (a.frame.w * a.frame.h));
		if(_method == METHODS.SortedAreaAsc)
			sorted.sort((a, b) => (a.frame.w * a.frame.h) - (b.frame.w * b.frame.h));

		let blocks:Block[] | null = null;
		let currentBest = Infinity;
		let currentLength = Number.NEGATIVE_INFINITY;

		const rotations = this.allowRotate ? [false, true] : [false];

		for(const rotated of rotations) {
			const new_blocks = this._searchRowWidth(sorted, rotated);
			if(new_blocks != null && calculateArea(new_blocks) < currentBest) {
				blocks = new_blocks;
				currentBest = calculateArea(new_blocks);
			}
		}

		if(blocks == null) {
			for(const rotated of rotations) {
				const new_blocks = this._pack(sorted, rotated, this.width, true);
				const area = calculateArea(new_blocks);
				if(new_blocks.length > currentLength || (new_blocks.length === currentLength && area < currentBest)) {
					blocks = new_blocks;
					currentBest = area;
					currentLength = new_blocks.length;
				}
			}
			if(blocks == null) {
				throw new Error("No blocks found");
			}
		}

		const rects:Rect[] = [];

		for(const block of blocks) {
			block.rect.frame.x = block.x;
			block.rect.frame.y = block.y;
			block.rect.rotated = block.rotated ?? false;
			rects.push(block.rect);
		}

		return rects;
	}

	private _searchRowWidth(rects:Rect[], rotated:boolean):Block[] | null {
		let widest = 0;
		let total = 0;
		for(const rect of rects) {
			widest = Math.max(widest, rect.frame.w);
			total += rect.frame.w + this.padding;
		}

		const limit = Math.min(this.width, Math.max(widest, total - this.padding));
		if(widest > limit) return null;

		let best:Block[] | null = null;
		let bestArea = Infinity;
		let bestWidth = widest;

		const tryWidth = (rowWidth:number) => {
			const blocks = this._pack(rects, rotated, rowWidth);
			if(blocks == null) return;
			const area = calculateArea(blocks);
			if(area < bestArea) {
				best = blocks;
				bestArea = area;
				bestWidth = rowWidth;
			}
		};

		const steps = Math.min(ROW_WIDTH_STEPS, limit - widest);
		const step = steps > 0 ? (limit - widest) / steps : 0;
		for(let i = 0; i <= steps; i++) {
			tryWidth(Math.round(widest + step * i));
		}

		if(step > 1) {
			const from = Math.max(widest, Math.floor(bestWidth - step));
			const to = Math.min(limit, Math.ceil(bestWidth + step));
			const fineStep = Math.max(1, (to - from) / ROW_WIDTH_STEPS);
			for(let rowWidth = from; rowWidth <= to; rowWidth += fineStep) {
				tryWidth(Math.round(rowWidth));
			}
		}

		return best;
	}

	private _pack(rects:Rect[], rotated:boolean, rowWidth:number, stopWhenFull:boolean = false):Block[] | null {
		let curr_x = 0;
		let curr_y = 0;
		let current_max_height = 0;

		const packed_blocks:Block[] = [];

		for(const rect of rects) {
			const bl:Block = {
				x: 0,
				y: 0,
				w: rect.frame.w,
				h: rect.frame.h,
				rect: rect,
				rotated: false
			};

			if(rotated && bl.w > bl.h && bl.w <= current_max_height) {
				bl.rotated = true;
				bl.w = rect.frame.h;
				bl.h = rect.frame.w;
			}

			if(curr_x > 0 && curr_x + bl.w > rowWidth) {
				curr_x = 0;
				curr_y += current_max_height + this.padding;
				current_max_height = 0;

				if(bl.rotated) {
					bl.rotated = false;
					bl.w = rect.frame.w;
					bl.h = rect.frame.h;
				}
			}

			if(curr_x + bl.w > this.width || curr_y + bl.h > this.height) {
				return stopWhenFull ? packed_blocks : null;
			}

			bl.x = curr_x;
			bl.y = curr_y;

			curr_x += bl.w + this.padding;
			if(bl.h > current_max_height) {
				current_max_height = bl.h;
			}

			packed_blocks.push(bl);
		}
		return packed_blocks;
	}

	private _get_total_width(blocks: Block[]): number {
		let sum = 0;
		for(const block of blocks) {
			sum += block.w + this.padding;
		}
		return sum;
	}

	private _get_total_height(blocks: Block[]): number {
		let sum = 0;
		for(const block of blocks) {
			sum += block.h;
		}
		return sum;
	}

	static override get packerName() {
		return "OrderedPacker";
	}

	static override get defaultMethod():MethodType {
		return METHODS.SortedAreaDsc;
	}

	static override get methods():MethodList {
		return METHODS;
	}

	static override needsNonRotation(): boolean {
		return false;
	}

	static override getMethodProps(id:MethodType) {
		switch(id) {
			case METHODS.SortedAreaDsc:
				return {name: "SortedAreaDsc", description: "Sorted placement"};
			case METHODS.SortedAreaAsc:
				return {name: "SortedAreaAsc", description: "Sorted placement"};
			case METHODS.Unsorted:
				return {name: "Unsorted", description: "Unsorted placement"};
			default:
				throw Error("Unknown method " + id);
		}
	}
}

export default OrderedPacker;
