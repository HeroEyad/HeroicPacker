import type { Rect } from "api/types";

export type MethodList = Readonly<Record<string, string>>;

export type PackerClass = {
	readonly packerName: string,
	readonly methods: MethodList,
	readonly defaultMethod: string,
	getMethodProps(name:string): {name: string, description: string},
	needsNonRotation(): boolean,
	new(width: number, height: number, allowRotate?: boolean, padding?: number):Packer
};

export type PackerCombo = Readonly<{
	packerClass: PackerClass,
	packerMethod: string,
	allowRotation: boolean
}>;

export type SheetAttempt = Readonly<{
	height: number,
	area: number
}> | null;

const METHODS = {
	Default: "Default"
} as const;

const SEARCH_RATIOS = [1, 0.75, 1.33, 0.5, 2] as const;
const SEARCH_RATIO_MIN = 0.5;
const SEARCH_RATIO_MAX = 2;
const THOROUGH_WIDTHS = 97;

class Packer {
	public areaToBeat: number = Infinity;

	public sheetArea: (width:number, height:number) => number = (width, height) => width * height;

	public quick: boolean = false;

	public thorough: boolean = false;

	constructor(width: number, height: number, allowRotate: boolean = false, padding: number = 0) {
	}

	pack(_data:Rect[], _method:string):Rect[] {
		throw Error("Abstract method. Override it.");
	}

	protected searchWidthCount(count:number) {
		if(this.quick) return SEARCH_RATIOS.length;
		if(this.thorough) return THOROUGH_WIDTHS;
		if(count <= 80) return 33;
		if(count <= 160) return 17;
		if(count <= 320) return 9;
		return SEARCH_RATIOS.length;
	}

	protected searchPrecision(precision:number) {
		return this.thorough ? 0 : precision;
	}

	private searchWidths(side:number, minWidth:number, maxWidth:number, count:number) {
		const ratios:number[] = SEARCH_RATIOS.slice(0, Math.max(1, count));
		if(count > ratios.length) {
			const extra:number[] = [];
			const span = Math.log(SEARCH_RATIO_MAX / SEARCH_RATIO_MIN);
			for(let i = 0; i < count; i++) {
				extra.push(SEARCH_RATIO_MIN * Math.exp(span * i / (count - 1)));
			}
			extra.sort((a, b) => Math.abs(Math.log(a)) - Math.abs(Math.log(b)));
			ratios.push(...extra);
		}

		const widths:number[] = [];
		for(const ratio of ratios) {
			const width = Math.min(maxWidth, Math.max(minWidth, Math.round(side * ratio)));
			if(widths.indexOf(width) === -1) widths.push(width);
		}
		return widths;
	}

	protected searchSheetSize(area:number, minWidth:number, minHeight:number, maxWidth:number, maxHeight:number, pad:number, square:boolean, tryPack:(width:number, height:number) => SheetAttempt, precision:number = 0.004, widthCount:number = SEARCH_RATIOS.length, bestArea:number = Infinity) {
		if(area <= 0 || minWidth > maxWidth || minHeight > maxHeight) return bestArea;

		const attempt = (width:number, height:number) => {
			const res = tryPack(width, height);
			if(res && res.area < bestArea) bestArea = res.area;
			return res;
		};

		const usefulHeight = (width:number, low:number, limit:number) => {
			if(bestArea === Infinity) return limit;
			const contentWidth = Math.max(1, width - pad);
			if(this.sheetArea(contentWidth, Math.max(1, low - pad)) >= bestArea) return -1;
			let fits = low;
			let over = limit + 1;
			while(over - fits > 1) {
				const mid = Math.floor((fits + over) / 2);
				if(this.sheetArea(contentWidth, mid - pad) < bestArea) fits = mid;
				else over = mid;
			}
			return fits;
		};

		if(square) {
			let low = Math.max(minWidth, minHeight, Math.ceil(Math.sqrt(area)));
			let limit = Math.min(maxWidth, maxHeight);
			if(low > limit) return bestArea;

			if(bestArea < Infinity) {
				if(this.sheetArea(Math.max(1, low - pad), Math.max(1, low - pad)) >= bestArea) return bestArea;
				let fits = low;
				let over = limit + 1;
				while(over - fits > 1) {
					const mid = Math.floor((fits + over) / 2);
					if(this.sheetArea(mid - pad, mid - pad) < bestArea) fits = mid;
					else over = mid;
				}
				limit = fits;
			}

			let high = Math.min(limit, Math.ceil(low / 0.9));
			while(!attempt(high, high)) {
				if(high >= limit) return bestArea;
				low = high + 1;
				high = Math.min(limit, Math.ceil(high / 0.85));
			}
			while(high - low > Math.max(1, Math.floor(high * precision))) {
				const mid = Math.floor((low + high) / 2);
				if(attempt(mid, mid)) high = mid;
				else low = mid + 1;
			}
			return bestArea;
		}

		const widths = this.searchWidths(Math.sqrt(area), minWidth, maxWidth, widthCount);

		for(const width of widths) {
			let low = Math.max(minHeight, Math.ceil(area / width));
			if(low > maxHeight) continue;

			let high:number;
			let res:SheetAttempt;

			if(bestArea < Infinity) {
				high = usefulHeight(width, low, maxHeight);
				if(high < low) continue;
				res = attempt(width, high);
				if(!res) continue;
			} else {
				high = Math.min(maxHeight, Math.ceil(low / 0.9));
				res = attempt(width, high);
				if(!res) {
					for(const density of [0.75, 0.55, 0]) {
						if(high >= maxHeight) break;
						high = density > 0 ? Math.min(maxHeight, Math.ceil(low / density)) : maxHeight;
						res = attempt(width, high);
						if(res) break;
					}
					if(!res) continue;
				}
			}

			high = Math.min(high, res.height);
			while(high - low > Math.max(1, Math.floor(high * precision))) {
				const mid = Math.floor((low + high) / 2);
				res = attempt(width, mid);
				if(res) high = Math.min(mid, res.height);
				else low = mid + 1;
			}
		}

		return bestArea;
	}

	static get packerName() {
		return "Default";
	}

	static get defaultMethod():string {
		return METHODS.Default;
	}

	static get methods():MethodList {
		return METHODS;
	}

	static needsNonRotation(): boolean {
		return true;
	}

	static getMethodProps(id:string) {
		return {name: "Default", description: "Default placement"};
	}
}

export default Packer;
