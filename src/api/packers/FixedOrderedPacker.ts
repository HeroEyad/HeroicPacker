import type { Rect } from "api/types";
import Packer, { type MethodList } from "./Packer";

const METHODS = {
	SortedAreaDsc: "SortedAreaDsc",
	SortedAreaAsc: "SortedAreaAsc",
	Unsorted: "Unsorted",
	AltSortedAreaDsc: "AltSortedAreaDsc",
	AltSortedAreaAsc: "AltSortedAreaAsc",
	AltUnsorted: "AltUnsorted",
} as const;

type MethodType = typeof METHODS[keyof typeof METHODS];

type Block = {
	x?: number,
	y?: number,
	w: number,
	h: number,
	rect: Rect,
	rotated: boolean,
}

function calculateWidth(blocks: Block[] | null): number {
	if(!blocks) return 0;
	if(blocks.length === 0) return 0;

	let rightBound = 0;
	for(const block of blocks) {
		rightBound = Math.max(rightBound, (block.x ?? 0) + block.w);
	}
	return rightBound;
}

function calculateHeight(blocks: Block[] | null): number {
	if(!blocks) return 0;
	if(blocks.length === 0) return 0;

	let bottomBound = 0;
	for (const block of blocks) {
		bottomBound = Math.max(bottomBound, (block.y ?? 0) + block.h);
	}
	return bottomBound;
}

function calculateArea(blocks:Block[] | null) {
	if(!blocks) return 0;
	if(blocks.length === 0) return 0;

	let rightBound = 0;
	let bottomBound = 0;
	for(const block of blocks) {
		rightBound = Math.max(rightBound, (block.x ?? 0) + block.w);
		bottomBound = Math.max(bottomBound, (block.y ?? 0) + block.h);
	}
	return rightBound * bottomBound;
}

function getMinimumSize(blocks: Rect[] | null) {
	if(!blocks) return {w: 0, h: 0};
	if(blocks.length === 0) return {w: 0, h: 0};

	let width = 0;
	let height = 0;

	for(const block of blocks) {
		width = Math.max(width, block.frame.w);
		height = Math.max(height, block.frame.h);
	}

	return {w: width, h: height};
}

function rotateBlock(block:Block) {
	block.rotated = !block.rotated;
	const temp = block.w;
	block.w = block.h;
	block.h = temp;
}

class FixedOrderedPacker extends Packer {
	readonly allowRotate: boolean;
	readonly padding: number;
	width: number;
	height: number;
	isSmart: boolean;
	isAlt: boolean;

	constructor(width: number, height: number, allowRotate: boolean = false, padding: number = 0) {
		super(width, height, allowRotate, padding);

		this.width = width;
		this.height = height;
		this.allowRotate = allowRotate;
		this.padding = padding;
		this.isSmart = false;
		this.isAlt = false;
	}

	override pack(_data:Rect[], _method:MethodType):Rect[] {
		let method = _method;
		this.isSmart = false;
		this.isAlt = false;

		switch(method) {
			case METHODS.AltSortedAreaDsc:
				this.isAlt = true;
				method = METHODS.SortedAreaDsc;
				break;
			case METHODS.AltSortedAreaAsc:
				this.isAlt = true;
				method = METHODS.SortedAreaAsc;
				break;
			case METHODS.AltUnsorted:
				this.isAlt = true;
				method = METHODS.Unsorted;
				break;
		}

		let sortedData = [..._data];

		if(method == METHODS.SortedAreaDsc)
			sortedData.sort((a, b) => (b.frame.w * b.frame.h) - (a.frame.w * a.frame.h));

		if(method == METHODS.SortedAreaAsc)
			sortedData.sort((a, b) => (a.frame.w * a.frame.h) - (b.frame.w * b.frame.h));

		const originalWidth = this.width;
		const originalHeight = this.height;

		let blocks:Block[] | null = null;
		let currentBest:number = -1;
		let currentLength = Number.NEGATIVE_INFINITY;

		function setBest(bb:Block[] | null) {
			if(bb != null) {
				blocks = bb;
				currentBest = calculateArea(bb);
				currentLength = bb.length;
			}
		}

		const minSize = getMinimumSize(_data);

		const incW = 128;

		let maxWidth = 0;

		for(const block of sortedData) {
			maxWidth += block.frame.w + this.padding;
		}

		maxWidth = Math.max(maxWidth, minSize.w);

		if(minSize.h > originalHeight) {
			this.width = originalWidth;
			this.height = originalHeight;
			throw new Error("No blocks found");
		}

		const startWidth = Math.max(minSize.w, 1);
		const searchLimit = Math.min(maxWidth, originalWidth);

		const findWidth = (allowRotation:boolean):Block[][] => {
			this.height = originalHeight;

			let low = startWidth;
			let high = -1;
			let found:Block[] | null = null;

			for(let xx = startWidth; xx <= searchLimit; xx += incW) {
				this.width = xx;
				found = this._pack(sortedData, allowRotation);
				if(found != null) {
					high = xx;
					break;
				}
				low = xx + 1;
			}

			if(found == null && searchLimit >= low) {
				this.width = searchLimit;
				found = this._pack(sortedData, allowRotation);
				high = searchLimit;
			}

			if(found == null) {
				return [];
			}

			const stepped = found;

			while(low < high) {
				const mid = Math.floor((low + high) / 2);
				this.width = mid;
				const newBlocks = this._pack(sortedData, allowRotation);
				if(newBlocks != null) {
					high = mid;
					found = newBlocks;
				} else {
					low = mid + 1;
				}
			}

			return found === stepped ? [stepped] : [stepped, found];
		};
		
		const candidates = this.allowRotate ? [...findWidth(false), ...findWidth(true)] : findWidth(false);
		for(const candidate of candidates) {
			if(blocks == null || calculateArea(candidate) < currentBest) {
				setBest(candidate);
			}
		}

		this.width = originalWidth;
		this.height = originalHeight;

		if(blocks == null) {
			let newBlocks = this._pack(sortedData, false, true);
			setBest(newBlocks);

			if(this.allowRotate) {
				let new_blocks = this._pack(sortedData, true, true);

				if(new_blocks != null && new_blocks.length > currentLength) {
					blocks = new_blocks;
				}
			}

			if(blocks == null) {
				throw new Error("No blocks found");
			}
		}

		if(blocks == null) {
			throw new Error("No blocks found");
		}

		const rects:Rect[] = [];

		for(let block of blocks) {
			if(block.x == null || block.y == null) {
				continue;
			}

			block.rect.frame.x = block.x;
			block.rect.frame.y = block.y;
			block.rect.rotated = block.rotated ?? false;

			rects.push(block.rect);
		}

		return rects;
	}

	private _pack(_data:Rect[], allowRotation:boolean, stopWhenFull:boolean = false):Block[] {
		const blocks:Block[] = [];

		for(const data of _data) {
			const block:Block = {
				w: data.frame.w,
				h: data.frame.h,
				rect: data,
				rotated: false
			};

			blocks.push(block);
		}

		let packedBlocks:Block[];

		if(this.isAlt) {
			packedBlocks = this.packAlt(blocks, allowRotation, stopWhenFull);
		} else {
			packedBlocks = this.packNormal(blocks, allowRotation, stopWhenFull);
		}

		return packedBlocks;
	}

	private packNormal(blocks: Block[], allowRotation: boolean, stopWhenFull: boolean = false): Block[] | null {
		let xPos = 0;
		let yPos = 0;
		let maxRowHeight = 0;

		let currentWidth = 0;
		let currentHeight = 0;

		const packedBlocks:Block[] = [];

		for(const bl of blocks) {
			const firstOfRow = xPos === 0;
			const shouldRotate = allowRotation && bl.w > bl.h && bl.w <= maxRowHeight && !firstOfRow;

			if(shouldRotate) {
				rotateBlock(bl);
			}

			if(xPos > 0 && xPos + bl.w > this.width) {
				xPos = 0;
				yPos += maxRowHeight + this.padding;

				maxRowHeight = 0;

				if(bl.rotated) {
					rotateBlock(bl);
				}
			}

			if(xPos + bl.w > this.width || yPos + bl.h > this.height) {
				return stopWhenFull ? packedBlocks : null;
			}

			bl.x = xPos;
			bl.y = yPos;

			xPos += bl.w + this.padding;

			if(bl.h > maxRowHeight) {
				maxRowHeight = bl.h;
			}

			if(bl.x + bl.w > currentWidth) {
				currentWidth = bl.x + bl.w;
			}

			if(bl.y + bl.h > currentHeight) {
				currentHeight = bl.y + bl.h;
			}

			packedBlocks.push(bl);
		}

		return packedBlocks;
	}

	private packAlt(blocks: Block[], allowRotation: boolean, stopWhenFull: boolean = false) {
		let xPos = 0;
		let yPos = 0;
		let maxRowHeight = 0;

		const packedBlocks:Block[] = [];

		for(const bl of blocks) {
			let fitsNormally = (xPos + bl.w <= this.width) && (yPos + bl.h <= this.height);
			let fitsRotated = allowRotation && (xPos + bl.h <= this.width) && (yPos + bl.w <= this.height);

			if(!fitsNormally && !fitsRotated && xPos > 0) {
				xPos = 0;
				yPos += maxRowHeight + this.padding;
				maxRowHeight = 0;
			}

			fitsNormally = (xPos + bl.w <= this.width) && (yPos + bl.h <= this.height);
			fitsRotated = allowRotation && (xPos + bl.h <= this.width) && (yPos + bl.w <= this.height);

			if(!fitsNormally && !fitsRotated) {
				return stopWhenFull ? packedBlocks : null;
			}

			if(fitsNormally && (!fitsRotated || bl.w <= bl.h)) {
				bl.rotated = false;
			} else if(fitsRotated) {
				bl.rotated = true;

				const temp = bl.w;
				bl.w = bl.h;
				bl.h = temp;
			}

			bl.x = xPos;
			bl.y = yPos;

			xPos += bl.w + this.padding;

			if(bl.h > maxRowHeight) {
				maxRowHeight = bl.h;
			}

			packedBlocks.push(bl);
		}

		return packedBlocks;
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
		return "FixedOrderedPacker";
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
			case METHODS.AltSortedAreaDsc:
				return {name: "AltSortedAreaDsc", description: "Sorted placement, rotates to fit the row"};
			case METHODS.AltSortedAreaAsc:
				return {name: "AltSortedAreaAsc", description: "Sorted placement, rotates to fit the row"};
			case METHODS.AltUnsorted:
				return {name: "AltUnsorted", description: "Unsorted placement, rotates to fit the row"};
			default:
				throw Error("Unknown method " + id);
		}
	}
}

export default FixedOrderedPacker;