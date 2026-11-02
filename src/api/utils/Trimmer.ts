import type { Rect } from "api/types";

let ctx: CanvasRenderingContext2D | null = null;

function getContext() {
	if(!ctx) {
		ctx = document.createElement("canvas").getContext("2d", {willReadFrequently: true});
		if(!ctx) {
			throw new Error("No canvas context");
		}
	}
	return ctx;
}

class Trimmer {
	private static getSpacing(data: Uint8ClampedArray, width: number, height: number, threshold: number) {
		const stride = width * 4;
		let left = width, top = height;
		let right = width, bottom = height;

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < left; x++) {
				const alpha = data[(y * stride) + (x * 4) + 3];
				if (alpha > threshold) {
					if (x < left) left = x;
					break;
				}
			}
			for (let x = 0; x < right; x++) {
				const rx = width - x - 1;
				const alpha = data[(y * stride) + (rx * 4) + 3];
				if (alpha > threshold) {
					if (x < right) right = x;
					break;
				}
			}
		}

		for (let x = 0; x < width; x++) {
			for (let y = 0; y < top; y++) {
				const alpha = data[(y * stride) + (x * 4) + 3];
				if (alpha > threshold) {
					if (y < top) top = y;
					break;
				}
			}
			for (let y = 0; y < bottom; y++) {
				const ry = height - y - 1;
				const alpha = data[(ry * stride) + (x * 4) + 3];
				if (alpha > threshold) {
					if (y < bottom) bottom = y;
					break;
				}
			}
		}

		return { left, right, top, bottom };
	}

	private static readPixels(img: Rect["image"]) {
		const pixels = img.pixels;
		if(pixels) return pixels;

		const context = getContext();
		const cns = context.canvas;

		cns.width = img.width;
		cns.height = img.height;

		context.clearRect(0, 0, cns.width, cns.height);

		context.drawImage(img.image, 0, 0, img.width, img.height, 0, 0, img.width, img.height);

		return context.getImageData(0, 0, img.width, img.height).data;
	}

	private static crop(data: Uint8ClampedArray, width: number, box: Rect["spriteSourceSize"]) {
		const out = new Uint8ClampedArray(box.w * box.h * 4);
		const rowLength = box.w * 4;

		for (let y = 0; y < box.h; y++) {
			const from = ((box.y + y) * width + box.x) * 4;
			out.set(data.subarray(from, from + rowLength), y * rowLength);
		}

		return out;
	}

	static trim(rects:Rect[], threshold:number=0) {
		if(rects.length === 0) return;

		if(PROFILER)
			console.time("trim");
		for(const item of rects) {
			const img = item.image;
			if(!img) continue;

			let spaces = {left: 0, right: 0, top: 0, bottom: 0};
			let data: Uint8ClampedArray | null = null;

			const cached = img.cachedTrim !== undefined && img.cachedTrim === threshold;

			if(cached && img.cachedSpaces) {
				spaces = img.cachedSpaces;
			} else {

				data = this.readPixels(img);

				spaces = this.getSpacing(data, img.width, img.height, threshold);
			}

			if(spaces.left !== img.width) {
				if(spaces.left > 0 || spaces.right > 0 || spaces.top > 0 || spaces.bottom > 0) {
					item.trimmed = true;
					item.spriteSourceSize.x = spaces.left;
					item.spriteSourceSize.y = spaces.top;
					item.spriteSourceSize.w = img.width - spaces.left - spaces.right;
					item.spriteSourceSize.h = img.height - spaces.top - spaces.bottom;
				}
			} else {
				item.trimmed = true;
				item.spriteSourceSize.x = 0;
				item.spriteSourceSize.y = 0;
				item.spriteSourceSize.w = 1;
				item.spriteSourceSize.h = 1;
			}

			item.trimmedImage = (cached || !data) ? img.cachedTrimmedImage : this.crop(data, img.width, item.spriteSourceSize);

			if(item.trimmed) {
				item.frame.w = item.spriteSourceSize.w;
				item.frame.h = item.spriteSourceSize.h;
			}

			img.cachedTrimmedImage = item.trimmedImage;
			img.cachedSpaces = spaces;
			img.cachedTrim = threshold;
		}
		if(PROFILER)
			console.timeEnd("trim");
	}
}

export default Trimmer;