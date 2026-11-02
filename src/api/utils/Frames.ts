import type { PackOptions, Rect } from "../types";

function nextPowerOfTwo(value:number) {
	const exponent = Math.round(Math.log2(value));
	const size = 2 ** exponent;
	return size < value ? 2 ** (exponent + 1) : size;
}

function applySizeOptions(width:number, height:number, options:PackOptions) {
	if (options.powerOfTwo) {
		width = nextPowerOfTwo(width);
		height = nextPowerOfTwo(height);
	}

	return {width, height} as const;
}

export function getSheetSizeForExtent(extentWidth:number, extentHeight:number, options:PackOptions={}) {
	if(options.fixedSize) {
		return applySizeOptions(options.width || 0, options.height || 0, options);
	}

	const borderPadding = options.borderPadding || 0;
	return applySizeOptions(extentWidth + borderPadding * 2, extentHeight + borderPadding * 2, options);
}

export function getFramesExtent(data:Rect[]) {
	let width = 0;
	let height = 0;

	for (let item of data) {
		let w = item.frame.x;
		let h = item.frame.y;

		if(item.rotated) {
			w += item.frame.h;
			h += item.frame.w;
		} else {
			w += item.frame.w;
			h += item.frame.h;
		}

		if (w > width) {
			width = w;
		}
		if (h > height) {
			height = h;
		}
	}

	return {width, height} as const;
}

export function getSheetSize(data:Rect[], options:PackOptions={}) {
	if(options.fixedSize) {
		return applySizeOptions(options.width || 0, options.height || 0, options);
	}

	const borderPadding = options.borderPadding || 0;
	const extent = getFramesExtent(data);

	return applySizeOptions(extent.width + borderPadding, extent.height + borderPadding, options);
}
