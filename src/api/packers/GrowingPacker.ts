import type { Rect } from "api/types";
import Packer, { type MethodList } from "./Packer";

const METHODS = {
	Sorted: "Sorted",
	SortedHeight: "SortedHeight",
	SortedWidth: "SortedWidth",
	SortedArea: "SortedArea",
	Unsorted: "Unsorted"
} as const;

type MethodType = typeof METHODS[keyof typeof METHODS];

type Block = {
	w: number,
	h: number,
	rect: Rect,
	fit?: Node | null,
	rotated: boolean
}

type Node = {
	x: number,
	y: number,
	w: number,
	h: number,
	used?: boolean,
	down?: Node,
	right?: Node
}

type Growth = {
	right: boolean,
	w: number,
	h: number
}

type Orientation = "keep" | "any" | "wide" | "tall";

type Variant = {
	bestFit: boolean,
	growByArea: boolean,
	orientation: Orientation
}

class GrowingPacker extends Packer {
	root: Node;

	allowRotate: boolean;
	padding: number;
	width: number;
	height: number;
	private maxWidth: number;
	private maxHeight: number;

	constructor(width: number, height: number, allowRotate: boolean = false, padding: number = 0) {
		super(width, height, allowRotate, padding);

		this.root = { x: 0, y: 0, w: width, h: height };

		this.allowRotate = allowRotate;
		this.padding = padding;
		this.width = width;
		this.height = height;
		this.maxWidth = width + padding;
		this.maxHeight = height + padding;
	}

	static override get defaultMethod():MethodType {
		return METHODS.Sorted;
	}

	override pack(_data:Rect[], _method:MethodType):Rect[] {
		const orientations:Orientation[] = this.allowRotate ? ["keep", "any", "wide", "tall"] : ["keep"];

		const variants:Variant[] = [];
		for(const orientation of orientations) {
			variants.push({ bestFit: false, growByArea: false, orientation });
			variants.push({ bestFit: true, growByArea: false, orientation });
			variants.push({ bestFit: true, growByArea: true, orientation });
		}

		let best:Block[] = [];
		let bestCount = -1;
		let bestArea = Infinity;

		for(const variant of variants) {
			const blocks = this.packVariant(_data, _method, variant);

			let count = 0;
			let right = 0;
			let bottom = 0;
			for(const block of blocks) {
				if(!block.fit) continue;
				count++;
				right = Math.max(right, block.fit.x + block.w);
				bottom = Math.max(bottom, block.fit.y + block.h);
			}

			const area = right * bottom;
			if(count > bestCount || (count === bestCount && area < bestArea)) {
				best = blocks;
				bestCount = count;
				bestArea = area;
			}
		}

		const rects:Rect[] = [];

		for(let block of best) {
			if(!block.fit) continue;
			block.rect.frame.x = block.fit.x;
			block.rect.frame.y = block.fit.y;
			block.rect.rotated = block.rotated;
			rects.push(block.rect);
		}

		return rects;
	}

	private packVariant(_data:Rect[], _method:MethodType, variant:Variant):Block[] {
		const blocks:Block[] = [];
		for (const item of _data) {
			const rotated = (variant.orientation === "wide" && item.frame.h > item.frame.w) ||
				(variant.orientation === "tall" && item.frame.w > item.frame.h);
			blocks.push({
				w: rotated ? item.frame.h : item.frame.w,
				h: rotated ? item.frame.w : item.frame.h,
				rect: item,
				rotated
			});
		}

		if(_method == METHODS.Sorted)
			blocks.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || Math.min(b.w, b.h) - Math.min(a.w, a.h));
		if(_method == METHODS.SortedHeight)
			blocks.sort((a, b) => b.h - a.h || b.w - a.w);
		if(_method == METHODS.SortedWidth)
			blocks.sort((a, b) => b.w - a.w || b.h - a.h);
		if(_method == METHODS.SortedArea)
			blocks.sort((a, b) => (b.w * b.h) - (a.w * a.h) || Math.max(b.w, b.h) - Math.max(a.w, a.h));

		this.root = null;
		for(let block of blocks) {
			block.fit = this.placeBlock(block, variant);
		}

		return blocks;
	}

	private placeBlock = (block:Block, variant:Variant):Node | null => {
		const padding = this.padding;
		const canRotate = variant.orientation === "any" && block.w !== block.h;
		let w = block.w + padding;
		let h = block.h + padding;

		if(!this.root) {
			if(w > this.maxWidth || h > this.maxHeight) {
				if(!canRotate || h > this.maxWidth || w > this.maxHeight) return null;
				this.rotateBlock(block);
				[w, h] = [h, w];
			}
			this.root = { x: 0, y: 0, w: w, h: h };
		}

		let node = variant.bestFit ? this.findBestNode(w, h) : this.findNode(this.root, w, h);
		if(canRotate) {
			const rotatedNode = variant.bestFit ? this.findBestNode(h, w) : this.findNode(this.root, h, w);
			if(rotatedNode && (!node || (variant.bestFit && this.fitScore(rotatedNode, h, w) < this.fitScore(node, w, h)))) {
				node = rotatedNode;
				this.rotateBlock(block);
				[w, h] = [h, w];
			}
		}
		if(node)
			return this.splitNode(node, w, h);

		let growth = this.chooseGrowth(w, h, variant.growByArea);
		if(canRotate) {
			const rotatedGrowth = this.chooseGrowth(h, w, variant.growByArea);
			if(rotatedGrowth && (!growth || rotatedGrowth.w * rotatedGrowth.h < growth.w * growth.h)) {
				growth = rotatedGrowth;
				this.rotateBlock(block);
				[w, h] = [h, w];
			}
		}
		if(!growth)
			return null;

		return growth.right ? this.growRight(w, h) : this.growDown(w, h);
	}

	private rotateBlock = (block:Block) => {
		block.rotated = !block.rotated;
		const temp = block.w;
		block.w = block.h;
		block.h = temp;
	}

	private fitScore = (node:Node, w:number, h:number) => {
		const shortSide = Math.min(node.w - w, node.h - h);
		const longSide = Math.max(node.w - w, node.h - h);
		return shortSide * 1e8 + longSide;
	}

	private findNode = (root:Node | null | undefined, w:number, h:number):Node | null => {
		if (!root)
			return null;
		if (root.used)
			return this.findNode(root.right, w, h) || this.findNode(root.down, w, h);
		if ((w <= root.w) && (h <= root.h))
			return root;
		return null;
	}

	private findBestNode = (w:number, h:number):Node | null => {
		let best:Node | null = null;
		let bestScore = Infinity;
		const stack:Node[] = [this.root];
		while(stack.length) {
			const node = stack.pop() as Node;
			if(node.used) {
				if(node.down) stack.push(node.down);
				if(node.right) stack.push(node.right);
				continue;
			}
			if(w <= node.w && h <= node.h) {
				const score = this.fitScore(node, w, h);
				if(score < bestScore) {
					best = node;
					bestScore = score;
				}
			}
		}
		return best;
	}

	private splitNode = (node:Node, w:number, h:number) => {
		node.used = true;
		node.down  = { x: node.x,     y: node.y + h, w: node.w,     h: node.h - h };
		node.right = { x: node.x + w, y: node.y,     w: node.w - w, h: h          };
		return node;
	}

	private chooseGrowth = (w:number, h:number, byArea:boolean):Growth | null => {
		const root = this.root;
		const right:Growth = { right: true, w: root.w + w, h: Math.max(root.h, h) };
		const down:Growth = { right: false, w: Math.max(root.w, w), h: root.h + h };
		const canRight = right.w <= this.maxWidth && right.h <= this.maxHeight;
		const canDown = down.w <= this.maxWidth && down.h <= this.maxHeight;

		if(!byArea) {
			const canGrowDown  = canDown  && (w <= root.w);
			const canGrowRight = canRight && (h <= root.h);

			const shouldGrowRight = canGrowRight && (root.h >= (root.w + w));
			const shouldGrowDown  = canGrowDown  && (root.w >= (root.h + h));

			if (shouldGrowRight)
				return right;
			if (shouldGrowDown)
				return down;
			if (canGrowRight)
				return right;
			if (canGrowDown)
				return down;
		}

		if(canRight && canDown) {
			const rightArea = right.w * right.h;
			const downArea = down.w * down.h;
			if(rightArea !== downArea)
				return rightArea < downArea ? right : down;
			return Math.max(right.w, right.h) <= Math.max(down.w, down.h) ? right : down;
		}
		if(canRight)
			return right;
		if(canDown)
			return down;
		return null;
	}

	private growRight = (w:number, h:number) => {
		if(h > this.root.h)
			this.growEmptyDown(h - this.root.h);
		this.root = {
			used: true,
			x: 0,
			y: 0,
			w: this.root.w + w,
			h: this.root.h,
			down: this.root,
			right: { x: this.root.w, y: 0, w: w, h: this.root.h }
		};
		return this.splitNode(this.root.right as Node, w, h);
	}

	private growDown = (w:number, h:number) => {
		if(w > this.root.w)
			this.growEmptyRight(w - this.root.w);
		this.root = {
			used: true,
			x: 0,
			y: 0,
			w: this.root.w,
			h: this.root.h + h,
			down:  { x: 0, y: this.root.h, w: this.root.w, h: h },
			right: this.root
		};
		return this.splitNode(this.root.down as Node, w, h);
	}

	private growEmptyRight = (w:number) => {
		this.root = {
			used: true,
			x: 0,
			y: 0,
			w: this.root.w + w,
			h: this.root.h,
			down: this.root,
			right: { x: this.root.w, y: 0, w: w, h: this.root.h }
		};
	}

	private growEmptyDown = (h:number) => {
		this.root = {
			used: true,
			x: 0,
			y: 0,
			w: this.root.w,
			h: this.root.h + h,
			down:  { x: 0, y: this.root.h, w: this.root.w, h: h },
			right: this.root
		};
	}

	static override get packerName() {
		return "GrowingPacker";
	}

	static override get methods():MethodList {
		return METHODS;
	}

	static override needsNonRotation(): boolean {
		return true;
	}

	static override getMethodProps(id:MethodType) {
		return {name: "Default", description: "Default placement"};
	}
}

export default GrowingPacker;
