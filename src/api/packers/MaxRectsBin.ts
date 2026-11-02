import Packer, { type MethodList, type SheetAttempt } from "./Packer";
import type { Rect } from "api/types";

class Rectangle {
	public x: number;
	public y: number;
	public width: number;
	public height: number;

	constructor(x=0, y=0, width=0, height=0) {
		this.x = x;
		this.y = y;
		this.width = width;
		this.height = height;
	}

	clone() {
		return new Rectangle(this.x, this.y, this.width, this.height);
	}

	hitTest(other: Rectangle) {
		return Rectangle.hitTest(this, other);
	}

	intersects(other: Rectangle) {
		return this.x < other.x + other.width && this.x + this.width > other.x &&
			this.y < other.y + other.height && this.y + this.height > other.y;
	}

	static hitTest(a: Rectangle, b: Rectangle) {
		return a.x >= b.x && a.y >= b.y && a.x+a.width <= b.x+b.width && a.y+a.height <= b.y+b.height;
	}
}

const METHODS = {
	BestShortSideFit: "BestShortSideFit",
	BestLongSideFit: "BestLongSideFit",
	BestAreaFit: "BestAreaFit",
	BottomLeftRule: "BottomLeftRule",
} as const;

type MethodType = typeof METHODS[keyof typeof METHODS];

class MutatableNumber {
	value: number;
	constructor(value:number = 0) {
		this.value = value;
	}
}

type Score = {
	score1: number,
	score2: number,
	x: number,
	y: number
};

type Candidate = {
	score: Score,
	freeRect: Rectangle | null,
	rotated: boolean
};

type SizeClass = Candidate & {
	width: number,
	height: number,
	rects: Rect[],
	next: number
};

type Placement = {
	rect: Rect,
	x: number,
	y: number,
	rotated: boolean
};

type Layout = {
	placements: Placement[],
	width: number,
	height: number,
	usedRectangles: Rectangle[],
	freeRectangles: Rectangle[]
};

const CLASSIC_WIDTHS = 5;
const CHEAP_GLOBAL_CLASSES = 64;

const byLongestSide = (a:Rect, b:Rect) => Math.max(b.frame.w, b.frame.h) - Math.max(a.frame.w, a.frame.h) || Math.min(b.frame.w, b.frame.h) - Math.min(a.frame.w, a.frame.h);
const byArea = (a:Rect, b:Rect) => b.frame.w * b.frame.h - a.frame.w * a.frame.h || Math.max(b.frame.w, b.frame.h) - Math.max(a.frame.w, a.frame.h);
const byHeight = (a:Rect, b:Rect) => b.frame.h - a.frame.h || b.frame.w - a.frame.w;
const byPerimeter = (a:Rect, b:Rect) => (b.frame.w + b.frame.h) - (a.frame.w + a.frame.h) || b.frame.w * b.frame.h - a.frame.w * a.frame.h;
const byWidth = (a:Rect, b:Rect) => b.frame.w - a.frame.w || b.frame.h - a.frame.h;
const byShortestSide = (a:Rect, b:Rect) => Math.min(b.frame.w, b.frame.h) - Math.min(a.frame.w, a.frame.h) || Math.max(b.frame.w, b.frame.h) - Math.max(a.frame.w, a.frame.h);

const SORT_ORDERS:ReadonlyArray<(a:Rect, b:Rect) => number> = [byLongestSide, byArea, byHeight, byPerimeter, byWidth, byShortestSide];

function resetCandidate(candidate:Candidate) {
	candidate.score.score1 = Infinity;
	candidate.score.score2 = Infinity;
	candidate.score.x = Infinity;
	candidate.score.y = Infinity;
	candidate.freeRect = null;
	candidate.rotated = false;
}

function isBetter(score1:number, score2:number, x:number, y:number, best:Score) {
	if(score1 !== best.score1) return score1 < best.score1;
	if(score2 !== best.score2) return score2 < best.score2;
	if(y !== best.y) return y < best.y;
	return x < best.x;
}

class MaxRectsBin extends Packer {
	usedRectangles: Rectangle[];
	freeRectangles: Rectangle[];
	binWidth: number;
	binHeight: number;
	allowRotate: boolean;
	padding: number;
	private scratch: Score;
	private minFitWidth: number;
	private minFitHeight: number;

	constructor(width: number, height: number, allowRotate: boolean = false, padding: number = 0) {
		super(width, height, allowRotate, padding);

		this.usedRectangles = [];
		this.freeRectangles = [];

		this.binWidth = width;
		this.binHeight = height;
		this.allowRotate = allowRotate;
		this.padding = padding;
		this.scratch = {score1: 0, score2: 0, x: 0, y: 0};
		this.minFitWidth = 0;
		this.minFitHeight = 0;

		this.freeRectangles.push(new Rectangle(
			0,
			0,
			width,
			height
		));
	}

	override pack(data:Rect[], method:MethodType) {
		if(!Object.hasOwn(METHODS, method)) {
			throw Error("Unknown method " + method);
		}

		const padding = this.padding;
		const maxWidth = this.binWidth + padding;
		const maxHeight = this.binHeight + padding;

		const classes = this._buildClasses(data);

		let area = 0;
		let minWidth = 0;
		let minHeight = 0;
		this.minFitWidth = Infinity;
		this.minFitHeight = Infinity;
		for(const sizeClass of classes) {
			area += sizeClass.width * sizeClass.height * sizeClass.rects.length;
			const shortSide = Math.min(sizeClass.width, sizeClass.height);
			minWidth = Math.max(minWidth, this.allowRotate ? shortSide : sizeClass.width);
			minHeight = Math.max(minHeight, this.allowRotate ? shortSide : sizeClass.height);
			this.minFitWidth = Math.min(this.minFitWidth, this.allowRotate ? shortSide : sizeClass.width);
			this.minFitHeight = Math.min(this.minFitHeight, this.allowRotate ? shortSide : sizeClass.height);
		}
		const precision = this.searchPrecision(data.length > 150 ? 0.01 : 0.004);
		const widthCount = this.searchWidthCount(data.length);

		const bounded = this.areaToBeat < Infinity;
		const found = {layout: null as Layout | null, area: this.areaToBeat};
		const keep = (layout:Layout | null) => {
			if(!layout) return null;
			const layoutArea = this.sheetArea(layout.width - padding, layout.height - padding);
			if(layoutArea < found.area) {
				found.layout = layout;
				found.area = layoutArea;
			}
			return {height: layout.height, area: layoutArea};
		};

		const search = (tryPack:(width:number, height:number) => SheetAttempt, widths?:number, seed:number = found.area) => {
			this.searchSheetSize(area, minWidth, minHeight, maxWidth, maxHeight, padding, false, tryPack, precision, widths, seed);
		};

		const global = (width:number, height:number) => keep(this._packGlobal(classes, width, height, method, false));
		const sortedBy = (order:(a:Rect, b:Rect) => number) => {
			const sorted = [...data].sort(order);
			return (width:number, height:number) => keep(this._packSorted(sorted, width, height, method, false));
		};

		const cheapGlobal = classes.length <= CHEAP_GLOBAL_CLASSES;

		if(this.quick) {
			search(sortedBy(SORT_ORDERS[0]), widthCount);
			if(cheapGlobal) search(global, widthCount);
		} else {
			search(global, undefined, this.areaToBeat);
			search(sortedBy(SORT_ORDERS[0]), undefined, this.areaToBeat);

			const orderCount = this.thorough || data.length <= 80 ? SORT_ORDERS.length : (data.length <= 160 ? 3 : (data.length <= 320 ? 2 : 1));
			for(let i = 0; i < orderCount; i++) {
				if(i === 0 && widthCount <= CLASSIC_WIDTHS) continue;
				search(sortedBy(SORT_ORDERS[i]), widthCount);
			}
			if(cheapGlobal && widthCount > CLASSIC_WIDTHS) search(global, widthCount);
		}

		if(!bounded) {
			keep(this._packGlobal(classes, maxWidth, maxHeight, method, !found.layout));
		}

		const layout = found.layout;
		if(!layout) {
			return [];
		}

		this.usedRectangles = layout.usedRectangles;
		this.freeRectangles = layout.freeRectangles;

		const res:Rect[] = [];
		for(const placement of layout.placements) {
			const rect = placement.rect;
			rect.frame.x = placement.x;
			rect.frame.y = placement.y;
			rect.rotated = placement.rotated;
			res.push(rect);
		}

		const placed = new Set(res);
		let remaining = 0;
		for(const rect of data) {
			if(!placed.has(rect)) {
				data[remaining++] = rect;
			}
		}
		data.length = remaining;

		return res;
	}

	private _buildClasses(data:Rect[]) {
		const classes:SizeClass[] = [];
		const byKey = new Map<string, SizeClass>();

		for(const rect of data) {
			const width = rect.frame.w + this.padding;
			const height = rect.frame.h + this.padding;
			const key = width + "x" + height;

			let sizeClass = byKey.get(key);
			if(!sizeClass) {
				sizeClass = {
					width,
					height,
					rects: [],
					next: 0,
					score: {score1: Infinity, score2: Infinity, x: Infinity, y: Infinity},
					freeRect: null,
					rotated: false
				};
				byKey.set(key, sizeClass);
				classes.push(sizeClass);
			}
			sizeClass.rects.push(rect);
		}

		return classes;
	}

	private _packGlobal(classes:SizeClass[], width:number, height:number, method:MethodType, allowPartial:boolean):Layout | null {
		this.freeRectangles = [new Rectangle(0, 0, width, height)];
		this.usedRectangles = [];

		for(const sizeClass of classes) {
			sizeClass.next = 0;
			resetCandidate(sizeClass);
			this._scoreFreeRects(sizeClass.width, sizeClass.height, method, this.freeRectangles, sizeClass);
			if(!sizeClass.freeRect && !allowPartial) {
				return null;
			}
		}

		const placements:Placement[] = [];
		let right = 0;
		let bottom = 0;

		for(;;) {
			let bestClass:SizeClass | null = null;
			for(const sizeClass of classes) {
				if(!sizeClass.freeRect || sizeClass.next >= sizeClass.rects.length) continue;
				const score = sizeClass.score;
				if(!bestClass || isBetter(score.score1, score.score2, score.x, score.y, bestClass.score)) {
					bestClass = sizeClass;
				}
			}

			if(!bestClass) {
				break;
			}

			const freeRect = bestClass.freeRect as Rectangle;
			const node = bestClass.rotated ?
				new Rectangle(freeRect.x, freeRect.y, bestClass.height, bestClass.width) :
				new Rectangle(freeRect.x, freeRect.y, bestClass.width, bestClass.height);

			placements.push({rect: bestClass.rects[bestClass.next++] as Rect, x: node.x, y: node.y, rotated: bestClass.rotated});
			right = Math.max(right, node.x + node.width);
			bottom = Math.max(bottom, node.y + node.height);

			const newFreeRects = this._placeRectangle(node);

			for(const sizeClass of classes) {
				if(!sizeClass.freeRect || sizeClass.next >= sizeClass.rects.length) continue;

				if(sizeClass.freeRect.intersects(node)) {
					resetCandidate(sizeClass);
					this._scoreFreeRects(sizeClass.width, sizeClass.height, method, this.freeRectangles, sizeClass);
					if(!sizeClass.freeRect && !allowPartial) {
						return null;
					}
				} else {
					this._scoreFreeRects(sizeClass.width, sizeClass.height, method, newFreeRects, sizeClass);
				}
			}
		}

		return {placements, width: right, height: bottom, usedRectangles: this.usedRectangles, freeRectangles: this.freeRectangles};
	}

	private _packSorted(rects:Rect[], width:number, height:number, method:MethodType, allowPartial:boolean):Layout | null {
		this.freeRectangles = [new Rectangle(0, 0, width, height)];
		this.usedRectangles = [];

		const placements:Placement[] = [];
		const candidate:Candidate = {score: {score1: Infinity, score2: Infinity, x: Infinity, y: Infinity}, freeRect: null, rotated: false};
		let right = 0;
		let bottom = 0;

		for(const rect of rects) {
			const rectWidth = rect.frame.w + this.padding;
			const rectHeight = rect.frame.h + this.padding;

			resetCandidate(candidate);
			this._scoreFreeRects(rectWidth, rectHeight, method, this.freeRectangles, candidate);

			const freeRect = candidate.freeRect;
			if(!freeRect) {
				if(!allowPartial) return null;
				continue;
			}

			const node = candidate.rotated ?
				new Rectangle(freeRect.x, freeRect.y, rectHeight, rectWidth) :
				new Rectangle(freeRect.x, freeRect.y, rectWidth, rectHeight);

			placements.push({rect, x: node.x, y: node.y, rotated: candidate.rotated});
			right = Math.max(right, node.x + node.width);
			bottom = Math.max(bottom, node.y + node.height);

			this._placeRectangle(node);
		}

		return {placements, width: right, height: bottom, usedRectangles: this.usedRectangles, freeRectangles: this.freeRectangles};
	}

	private _scoreFreeRects(width:number, height:number, method:MethodType, freeRects:Rectangle[], candidate:Candidate) {
		const score = this.scratch;
		const canRotate = this.allowRotate && width !== height;
		const best = candidate.score;

		for(const freeRect of freeRects) {
			if(freeRect.width >= width && freeRect.height >= height) {
				this._scoreNode(freeRect, width, height, method, score);
				if(isBetter(score.score1, score.score2, freeRect.x, freeRect.y, best)) {
					best.score1 = score.score1;
					best.score2 = score.score2;
					best.x = freeRect.x;
					best.y = freeRect.y;
					candidate.freeRect = freeRect;
					candidate.rotated = false;
				}
			}

			if(canRotate && freeRect.width >= height && freeRect.height >= width) {
				this._scoreNode(freeRect, height, width, method, score);
				if(isBetter(score.score1, score.score2, freeRect.x, freeRect.y, best)) {
					best.score1 = score.score1;
					best.score2 = score.score2;
					best.x = freeRect.x;
					best.y = freeRect.y;
					candidate.freeRect = freeRect;
					candidate.rotated = true;
				}
			}
		}
	}

	private _scoreNode(freeRect:Rectangle, width:number, height:number, method:MethodType, out:Score) {
		const leftoverHoriz = freeRect.width - width;
		const leftoverVert = freeRect.height - height;

		switch(method) {
			case METHODS.BestShortSideFit:
				out.score1 = Math.min(leftoverHoriz, leftoverVert);
				out.score2 = Math.max(leftoverHoriz, leftoverVert);
				break;
			case METHODS.BestLongSideFit:
				out.score1 = Math.max(leftoverHoriz, leftoverVert);
				out.score2 = Math.min(leftoverHoriz, leftoverVert);
				break;
			case METHODS.BestAreaFit:
				out.score1 = freeRect.width * freeRect.height - width * height;
				out.score2 = Math.min(leftoverHoriz, leftoverVert);
				break;
			case METHODS.BottomLeftRule:
				out.score1 = freeRect.y + height;
				out.score2 = freeRect.x;
				break;
			default:
				throw Error("Unknown method " + method);
		}
	}

	private _placeRectangle(node:Rectangle) {
		const freeRectangles = this.freeRectangles;
		const newFreeRects:Rectangle[] = [];

		let kept = 0;
		for(let i = 0; i < freeRectangles.length; i++) {
			const freeRect = freeRectangles[i] as Rectangle;
			if(this._splitFreeNode(freeRect, node, newFreeRects)) continue;
			freeRectangles[kept++] = freeRect;
		}
		freeRectangles.length = kept;

		const added = this._pruneFreeList(newFreeRects);
		this.usedRectangles.push(node);
		return added;
	}

	private _occupancy() {
		let usedRectangles = this.usedRectangles;
		let usedSurfaceArea = 0;
		for(const rect of usedRectangles) {
			usedSurfaceArea += rect.width * rect.height;
		}

		return usedSurfaceArea/(this.binWidth * this.binHeight);
	}

	private static _commonIntervalLength(i1start: number, i1end: number, i2start: number, i2end: number): number {
		if (i1end <= i2start || i2end <= i1start) {
			return 0;
		}
		return Math.min(i1end, i2end) - Math.max(i1start, i2start);
	}

	private _contactPointScoreNode(x: number, y: number, width: number, height: number): number {
		const usedRectangles = this.usedRectangles;
		let score = 0;

		const xEnd = x + width;
		const yEnd = y + height;

		if (x === 0 || xEnd === this.binWidth) {
			score += height;
		}
		if (y === 0 || yEnd === this.binHeight) {
			score += width;
		}

		for (const { x: rectX, y: rectY, width: rectWidth, height: rectHeight } of usedRectangles) {
			const rectXEnd = rectX + rectWidth;
			const rectYEnd = rectY + rectHeight;

			if (rectX === xEnd || rectXEnd === x) {
				score += MaxRectsBin._commonIntervalLength(rectY, rectYEnd, y, yEnd);
			}
			if (rectY === yEnd || rectYEnd === y) {
				score += MaxRectsBin._commonIntervalLength(rectX, rectXEnd, x, xEnd);
			}
		}

		return score;
	}

	private _findPositionForNewNodeContactPoint(width:number, height:number, bestContactScore:MutatableNumber) {
		let freeRectangles = this.freeRectangles;
		let bestNode = new Rectangle();

		bestContactScore.value = -1;

		for(const rect of freeRectangles) {
			if (rect.width >= width && rect.height >= height) {
				const score = this._contactPointScoreNode(rect.x, rect.y, width, height);
				if (score > bestContactScore.value) {
					bestNode.x = rect.x;
					bestNode.y = rect.y;
					bestNode.width = width;
					bestNode.height = height;
					bestContactScore.value = score;
				}
			}
			if (this.allowRotate && rect.width >= height && rect.height >= width) {
				const score = this._contactPointScoreNode(rect.x, rect.y, height, width);
				if (score > bestContactScore.value) {
					bestNode.x = rect.x;
					bestNode.y = rect.y;
					bestNode.width = height;
					bestNode.height = width;
					bestContactScore.value = score;
				}
			}
		}
		return bestNode;
	}

	private _splitFreeNode(freeNode:Rectangle, usedNode:Rectangle, out:Rectangle[]) {
		if (usedNode.x >= freeNode.x + freeNode.width || usedNode.x + usedNode.width <= freeNode.x ||
			usedNode.y >= freeNode.y + freeNode.height || usedNode.y + usedNode.height <= freeNode.y)
			return false;
		let newNode;
		if (usedNode.x < freeNode.x + freeNode.width && usedNode.x + usedNode.width > freeNode.x) {
			if (usedNode.y > freeNode.y && usedNode.y < freeNode.y + freeNode.height) {
				newNode = freeNode.clone();
				newNode.height = usedNode.y - newNode.y;
				out.push(newNode);
			}

			if (usedNode.y + usedNode.height < freeNode.y + freeNode.height) {
				newNode = freeNode.clone();
				newNode.y = usedNode.y + usedNode.height;
				newNode.height = freeNode.y + freeNode.height - (usedNode.y + usedNode.height);
				out.push(newNode);
			}
		}

		if (usedNode.y < freeNode.y + freeNode.height && usedNode.y + usedNode.height > freeNode.y) {
			if (usedNode.x > freeNode.x && usedNode.x < freeNode.x + freeNode.width) {
				newNode = freeNode.clone();
				newNode.width = usedNode.x - newNode.x;
				out.push(newNode);
			}

			if (usedNode.x + usedNode.width < freeNode.x + freeNode.width) {
				newNode = freeNode.clone();
				newNode.x = usedNode.x + usedNode.width;
				newNode.width = freeNode.x + freeNode.width - (usedNode.x + usedNode.width);
				out.push(newNode);
			}
		}

		return true;
	}

	private _pruneFreeList(newFreeRects:Rectangle[]) {
		const freeRectangles = this.freeRectangles;
		const oldCount = freeRectangles.length;
		const added:Rectangle[] = [];

		for(let i = 0; i < newFreeRects.length; i++) {
			const rect = newFreeRects[i];
			if(!rect) continue;

			let redundant = rect.width < this.minFitWidth || rect.height < this.minFitHeight;
			for(let j = 0; j < oldCount && !redundant; j++) {
				redundant = Rectangle.hitTest(rect, freeRectangles[j] as Rectangle);
			}
			for(let j = 0; j < newFreeRects.length && !redundant; j++) {
				const other = newFreeRects[j];
				if(j === i || !other) continue;
				redundant = Rectangle.hitTest(rect, other);
			}

			if(redundant) {
				newFreeRects[i] = null;
				continue;
			}

			added.push(rect);
			freeRectangles.push(rect);
		}

		return added;
	}

	static override get packerName() {
		return "MaxRectsBin";
	}

	static override get defaultMethod():MethodType {
		return METHODS.BestShortSideFit;
	}

	static override get methods():MethodList {
		return METHODS;
	}

	static override needsNonRotation(): boolean {
		return true;
	}

	static override getMethodProps(id:MethodType) {
		switch(id) {
			case METHODS.BestShortSideFit:
				return {name: "Best short side fit", description: "Positions the Rectangle against the short side of a free Rectangle into which it fits the best."};
			case METHODS.BestLongSideFit:
				return {name: "Best long side fit", description: "Positions the Rectangle against the long side of a free Rectangle into which it fits the best."};
			case METHODS.BestAreaFit:
				return {name: "Best area fit", description: "Positions the Rectangle into the smallest free Rectangle into which it fits."};
			case METHODS.BottomLeftRule:
				return {name: "Bottom left rule", description: "Does the Tetris placement."};
			default:
				throw Error("Unknown method " + id);
		}
	}
}

export default MaxRectsBin;
