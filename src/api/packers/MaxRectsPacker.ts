import { MaxRectsPacker as MaxRectsPackerEngine, PACKING_LOGIC, type IRectangle, type IOption } from "maxrects-packer";
import type { Rect } from "api/types";
import Packer, { type MethodList } from "./Packer";

const METHODS = {
	Smart: "Smart",
	SmartArea: "SmartArea",
	Square: "Square",
	SquareArea: "SquareArea",
	SmartSquare: "SmartSquare",
	SmartSquareArea: "SmartSquareArea"
} as const;

type MethodType = typeof METHODS[keyof typeof METHODS];

interface Rectangle extends IRectangle {
	data: Rect;
	rot: boolean;
}

class MaxRectsPacker extends Packer {
	binWidth: number;
	binHeight: number;
	allowRotate: boolean;
	padding: number;

	constructor(width: number, height: number, allowRotate: boolean = false, padding: number = 0) {
		super(width, height, allowRotate, padding);

		this.binWidth = width;
		this.binHeight = height;
		this.allowRotate = allowRotate;
		this.padding = padding;
	}

	override pack(data: Rect[], method: MethodType) {
		const smart = (method === METHODS.Smart || method === METHODS.SmartArea || method === METHODS.SmartSquare || method === METHODS.SmartSquareArea);
		const square = (method === METHODS.Square || method === METHODS.SquareArea || method === METHODS.SmartSquare || method === METHODS.SmartSquareArea);
		const options = {
			smart,
			pot: false,
			square,
			allowRotation: this.allowRotate,
			logic: (method === METHODS.Smart || method === METHODS.Square || method === METHODS.SmartSquare) ? PACKING_LOGIC.MAX_EDGE : PACKING_LOGIC.MAX_AREA
		} as const;

		const padding = this.padding;
		const shrink = smart ? padding * 2 : padding;

		let area = 0;
		let minWidth = 0;
		let minHeight = 0;
		for (const item of data) {
			area += (item.frame.w + padding) * (item.frame.h + padding);
			minWidth = Math.max(minWidth, item.frame.w + shrink);
			minHeight = Math.max(minHeight, item.frame.h + shrink);
		}

		const bounded = this.areaToBeat < Infinity;
		const found = { rects: null as Rectangle[] | null, area: this.areaToBeat };
		const keep = (rects: Rectangle[] | null) => {
			if (!rects) return null;
			let right = 0;
			let bottom = 0;
			for (const item of rects) {
				right = Math.max(right, item.x + (item.rot ? item.height : item.width));
				bottom = Math.max(bottom, item.y + (item.rot ? item.width : item.height));
			}
			const rectsArea = this.sheetArea(right, bottom);
			if (rectsArea < found.area) {
				found.rects = rects;
				found.area = rectsArea;
			}
			return { height: bottom + padding, area: rectsArea };
		};

		const maxWidth = this.binWidth + padding;
		const maxHeight = this.binHeight + padding;

		this.searchSheetSize(area, minWidth, minHeight, maxWidth, maxHeight, padding, square,
			(width, height) => keep(this.packInto(data, width - shrink, height - shrink, options, false)), this.searchPrecision(data.length > 150 ? 0.02 : 0.004), this.searchWidthCount(data.length), found.area);

		if (!(this.quick && bounded)) {
			keep(this.packInto(data, maxWidth - shrink, maxHeight - shrink, options, !found.rects && !bounded, true));
		}

		const res = [];

		for (const item of found.rects ?? []) {
			if(!item) {
				continue;
			}
			item.data.frame.x = item.x;
			item.data.frame.y = item.y;
			item.data.rotated = item.rot;
			res.push(item.data);
		}

		return res;
	}

	private packInto(data: Rect[], width: number, height: number, options: IOption, allowPartial: boolean, keepInputOrder: boolean = false): Rectangle[] | null {
		const packer = new MaxRectsPackerEngine<Rectangle>(width, height, this.padding, options);

		const input:Rectangle[] = [];
		for (let i = 0; i < data.length; i++) {
			const item = data[i] as Rect;
			const second = options.logic === PACKING_LOGIC.MAX_EDGE ? Math.min(item.frame.w, item.frame.h) : Math.max(item.frame.w, item.frame.h);
			input.push({ x: 0, y: 0, width: item.frame.w, height: item.frame.h, data: item, rot: false, hash: keepInputOrder ? 0 : (second + 1) * 1000000 - i });
		}

		const maxEdge = options.logic === PACKING_LOGIC.MAX_EDGE;
		input.sort((a, b) => (maxEdge ? Math.max(b.width, b.height) - Math.max(a.width, a.height) : b.width * b.height - a.width * a.height) || b.hash - a.hash);

		for (const item of input) {
			packer.add(item);
			if (!allowPartial && packer.bins.length > 1) {
				return null;
			}
		}

		const bin = packer.bins[0];
		if(!bin) {
			return null;
		}
		if(!allowPartial && bin.rects.length !== data.length) {
			return null;
		}
		return bin.rects;
	}

	static override get packerName() {
		return "MaxRectsPacker";
	}

	static override get defaultMethod():MethodType {
		return METHODS.Smart;
	}

	static override get methods():MethodList {
		return METHODS;
	}

	static override needsNonRotation(): boolean {
		return true;
	}

	static override getMethodProps(id:MethodType) {
		switch (id) {
			case METHODS.Smart:
				return { name: "Smart edge logic", description: "" };
			case METHODS.SmartArea:
				return { name: "Smart area logic", description: "" };
			case METHODS.Square:
				return { name: "Square edge logic", description: "" };
			case METHODS.SquareArea:
				return { name: "Square area logic", description: "" };
			case METHODS.SmartSquare:
				return { name: "Smart square edge logic", description: "" };
			case METHODS.SmartSquareArea:
				return { name: "Smart square area logic", description: "" };
			default:
				throw Error("Unknown method " + id);
		}
	}
}

export default MaxRectsPacker;
