import MaxRectsBinPack from './packers/MaxRectsBin';
import OptimalPacker from './packers/OptimalPacker';
import allPackers, { getPackerByType } from './packers';
import Trimmer from './utils/Trimmer';
import { scaleSprite } from './utils/Lanczos';
import { ApiError, ErrorCodes } from 'api/Errors';
import type { LoadedImages, PackOptions, Rect } from 'api/types';
import type { PackerClass, PackerCombo } from './packers/Packer';
import { getFramesExtent, getSheetSizeForExtent } from './utils/Frames';
import { exporterAllowsScale, exporterAllowsTrim } from './exporters/capabilities';
import FunkinPackerApi from './FunkinPackerApi';

const EXHAUSTIVE_SPRITES = 32;
const FIT_STEPS = 100;
const FIT_MARGIN = 2;
const FIT_RETRY = 0.97;

class PackProcessor {
	private api: FunkinPackerApi;

	constructor(api:FunkinPackerApi) {
		this.api = api;
	}

	private identityKey(rect:Rect, didTrim:boolean) {
		if(!didTrim) {
			const img = rect.image;
			if(!img) return null;
			return img.base64 || img.src || null;
		}

		const data = rect.trimmedImage;
		if(!data) return null;

		let hash = 2166136261;
		const step = Math.max(1, Math.floor(data.length / 1024)) | 1;
		for(let i = 0; i < data.length; i += step) {
			hash = Math.imul(hash ^ data[i], 16777619);
		}

		return rect.spriteSourceSize.w + "x" + rect.spriteSourceSize.h + ":" + (hash >>> 0);
	}

	private detectIdentical(rects: Rect[], didTrim: boolean) {
		const unique:Rect[] = [];
		const identical:Rect[] = [];
		const buckets = new Map<string, Rect[]>();

		for (const rect of rects) {
			const key = this.identityKey(rect, didTrim);
			if (key === null) {
				unique.push(rect);
				continue;
			}

			let bucket = buckets.get(key);
			if (!bucket) {
				bucket = [];
				buckets.set(key, bucket);
			}

			let original:Rect | null = null;
			for (const other of bucket) {
				if (this.compareImages(other, rect, didTrim)) {
					original = other;
					break;
				}
			}

			if (original) {
				rect.identical = original;
				identical.push(rect);
			} else {
				bucket.push(rect);
				unique.push(rect);
			}
		}

		return {
			rects: unique,
			identical
		} as const;
	}

	private compareImages(rect1:Rect, rect2:Rect, didTrim:boolean) {
		if(!didTrim) {
			if(!rect1.image || !rect2.image) return false;
			if(rect1.image.base64 && rect1.image.base64 === rect2.image.base64) {
				return true;
			}
			return Boolean(rect1.image.src) && rect1.image.src === rect2.image.src;
		}

		const i1 = rect1.trimmedImage;
		const i2 = rect2.trimmedImage;

		if(!i1 || !i2) return false;

		if(rect1.spriteSourceSize.w !== rect2.spriteSourceSize.w || rect1.spriteSourceSize.h !== rect2.spriteSourceSize.h) return false;

		if(i1.length !== i2.length) return false;

		let length = i1.length;

		while(length--) {
			if(i1[length] !== i2[length]) return false;
		}
		return true;
	}

	private applyIdentical(rects:Rect[], identical:Rect[], scale:number) {
		if (!identical.length) return rects;

		const placed = new Set(rects);
		let remaining = 0;

		for (const item of identical) {
			const rect = item.identical;
			if (!rect || !placed.has(rect)) {
				identical[remaining++] = item;
				continue;
			}

			const clone = { ...rect};

			clone.name = item.name;
			clone.image = item.image;
			clone.originalFile = item.file;
			clone.frame = { ...rect.frame};
			clone.sourceSize = { ...item.sourceSize};
			clone.spriteSourceSize = { ...item.spriteSourceSize};
			clone.frameSize = item.frameSize;
			clone.manualOffset = item.manualOffset;
			clone.trimmed = item.trimmed;
			clone.duration = item.duration;
			const offset = rect.packedOffset ?? { x: rect.spriteSourceSize.x, y: rect.spriteSourceSize.y };
			clone.packedOffset = {
				x: offset.x + (item.spriteSourceSize.x - rect.spriteSourceSize.x) * scale,
				y: offset.y + (item.spriteSourceSize.y - rect.spriteSourceSize.y) * scale
			};
			clone.skipRender = true;
			clone.cloned = true;

			rects.push(clone);
		}

		identical.length = remaining;

		return rects;
	}

	pack(images:LoadedImages, options: PackOptions = {}) {
		if(PROFILER)
			console.time("pack");

		try {
			return this.packImages(images, options);
		}
		finally {
			if(PROFILER)
				console.timeEnd("pack");
		}
	}

	private packImages(images:LoadedImages, options: PackOptions) {
		let rects:Rect[] = [];

		let alphaThreshold = Math.max(Math.min(options.alphaThreshold || 0, 255), 0);

		const names = Object.keys(images).sort();

		for (const key of names) {
			const img = images[key];
			if(!img) continue;

			const name = key.split(".")[0];

			rects.push({
				frame: { x: 0, y: 0, w: img.width, h: img.height },
				rotated: false,
				trimmed: false,
				spriteSourceSize: { x: 0, y: 0, w: img.width, h: img.height },
				sourceSize: { ...img.rect.sourceSize },
				frameSize: img.rect.frameSize,
				manualOffset: img.rect.manualOffset,
				duration: img.rect.duration,
				name,
				file: key,
				image: img
			});
		}

		const allowTrim = Boolean(options.allowTrim) && exporterAllowsTrim(options.exporterCls);
		const canScale = exporterAllowsScale(options.exporterCls);
		const scale = canScale ? (options.scale || 1) : 1;

		if (allowTrim) {
			Trimmer.trim(rects, alphaThreshold);
		}

		let identical:Rect[] = [];

		if (options.detectIdentical) {
			const res = this.detectIdentical(rects, allowTrim);

			rects = res.rects;
			identical = res.identical;
		}

		if (options.fitToSize && canScale) {
			return this.packToFit(rects, identical, options, scale, allowTrim, alphaThreshold);
		}

		return { ...this.packAtScale(rects, identical, options, scale, allowTrim, alphaThreshold), scale } as const;
	}

	private packToFit(rects:Rect[], identical:Rect[], options:PackOptions, maxScale:number, allowTrim:boolean, alphaThreshold:number) {
		const packIfFits = (scale:number) => {
			try {
				const packed = this.packAtScale(rects, identical, options, scale, allowTrim, alphaThreshold);
				return packed.result.length <= 1 ? packed : null;
			}
			catch (e) {
				if (e instanceof ApiError && e.code === ErrorCodes.INVALID_SIZE_ERROR) return null;
				throw e;
			}
		};

		const full = packIfFits(maxScale);
		if (full) return { ...full, scale: maxScale } as const;

		let steps = this.largestFittingStep(rects, options, maxScale);
		for (;;) {
			const scale = steps / FIT_STEPS;
			if (steps <= 1) return { ...this.packAtScale(rects, identical, options, scale, allowTrim, alphaThreshold), scale } as const;

			const packed = packIfFits(scale);
			if (packed) return { ...packed, scale } as const;

			steps = Math.min(steps - 1, Math.floor(steps * FIT_RETRY));
		}
	}

	private largestFittingStep(rects:Rect[], options:PackOptions, maxScale:number) {
		const fits = (steps:number) => {
			const scale = steps / FIT_STEPS;
			const estimated = rects.map(rect => ({
				...rect,
				frame: {
					x: 0,
					y: 0,
					w: Math.ceil(rect.frame.w * scale) + FIT_MARGIN,
					h: Math.ceil(rect.frame.h * scale) + FIT_MARGIN
				}
			}));

			try {
				return this.packRects(estimated, [], options, scale).result.length <= 1;
			}
			catch (e) {
				if (e instanceof ApiError && e.code === ErrorCodes.INVALID_SIZE_ERROR) return false;
				throw e;
			}
		};

		let low = 1;
		let high = Math.ceil(maxScale * FIT_STEPS) - 1;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if (fits(middle)) low = middle;
			else high = middle - 1;
		}

		return low;
	}

	private packAtScale(rects:Rect[], identical:Rect[], options:PackOptions, scale:number, allowTrim:boolean, alphaThreshold:number) {
		const copies = new Map<Rect, Rect>();
		const sized = rects.map(rect => {
			const copy = {
				...rect,
				frame: { ...rect.frame },
				spriteSourceSize: { ...rect.spriteSourceSize },
				sourceSize: { ...rect.sourceSize }
			};
			copies.set(rect, copy);
			return copy;
		});
		const sizedIdentical = identical.map(rect => ({ ...rect, identical: copies.get(rect.identical) ?? rect.identical }));

		this.scaleRects(sized, scale, allowTrim, alphaThreshold);

		return this.packRects(sized, sizedIdentical, options, scale);
	}

	private scaleRects(rects:Rect[], scale:number, allowTrim:boolean, alphaThreshold:number) {
		for (const rect of rects) {
			rect.packedOffset = { x: rect.spriteSourceSize.x, y: rect.spriteSourceSize.y };

			const img = rect.image;
			if (scale === 1 || !img) continue;

			const scaled = scaleSprite({
				source: img.image,
				pixels: img.pixels,
				pixelsWidth: img.width,
				imageOriginX: 0,
				imageOriginY: 0,
				imageWidth: img.width,
				imageHeight: img.height,
				box: {
					x: rect.spriteSourceSize.x,
					y: rect.spriteSourceSize.y,
					w: rect.spriteSourceSize.w,
					h: rect.spriteSourceSize.h
				},
				scale,
				trim: allowTrim,
				alphaThreshold
			});

			rect.frame.w = scaled.w;
			rect.frame.h = scaled.h;
			if (scaled.canvas) rect.renderSource = scaled.canvas;
			else rect.renderPixels = scaled.data;
			rect.packedOffset = { x: scaled.x, y: scaled.y };
		}
	}

	private packRects(rects:Rect[], identical:Rect[], options:PackOptions, scale:number) {
		const spritePadding = options.spritePadding || 0;
		const borderPadding = options.borderPadding || 0;

		let maxWidth = 0, maxHeight = 0;
		let minWidth = 0, minHeight = 0;

		for (const rect of rects) {
			maxWidth += rect.frame.w;
			maxHeight += rect.frame.h;

			minWidth = Math.max(minWidth, rect.frame.w + spritePadding * 2);
			minHeight = Math.max(minHeight, rect.frame.h + spritePadding * 2);
		}

		minWidth += borderPadding * 2;
		minHeight += borderPadding * 2;

		let width = options.width || 0;
		let height = options.height || 0;

		if (!width) width = maxWidth;
		if (!height) height = maxHeight;

		if (options.powerOfTwo) {
			const sw = Math.round(Math.log2(width));
			const sh = Math.round(Math.log2(height));

			let pw = 2 ** sw;
			let ph = 2 ** sh;

			if (pw < width) pw = 2 ** (sw + 1);
			if (ph < height) ph = 2 ** (sh + 1);

			width = pw;
			height = ph;
		}

		if (width < minWidth || height < minHeight) {
			throw new ApiError(ErrorCodes.INVALID_SIZE_ERROR, minWidth.toString(10), minHeight.toString(10));
		}

		const getAllPackers = () => {
			const methods:PackerCombo[] = [];
			for (const packerClass of allPackers) {
				if (packerClass === OptimalPacker) continue;

				for (const method in packerClass.methods) {
					if(!Object.hasOwn(packerClass.methods, method)) continue;

					if(options.allowRotation && packerClass.needsNonRotation() || !options.allowRotation) {
						methods.push({ packerClass, packerMethod: packerClass.methods[method], allowRotation: false } as const);
					}

					if (options.allowRotation) {
						methods.push({ packerClass, packerMethod: packerClass.methods[method], allowRotation: true } as const);
					}
				}
			}
			return methods;
		};

		const packWidth = width - borderPadding * 2;
		const packHeight = height - borderPadding * 2;

		const sheetArea = (extentWidth:number, extentHeight:number) => {
			const size = getSheetSizeForExtent(extentWidth, extentHeight, options);
			return size.width * size.height;
		};

		const packerClass:PackerClass = getPackerByType(options.packer) || MaxRectsBinPack;
		const packerMethod = options.packerMethod || MaxRectsBinPack.methods.BestShortSideFit;
		const packerCombos:PackerCombo[] = (packerClass === OptimalPacker) ? getAllPackers() : [{ packerClass, packerMethod, allowRotation: options.allowRotation } as const];
		const multipleCombos = packerCombos.length > 1;

		const exhaustive = rects.length <= EXHAUSTIVE_SPRITES;
		const isFavorite = (combo:PackerCombo) => combo.packerClass === MaxRectsBinPack && combo.packerMethod === MaxRectsBinPack.methods.BestShortSideFit;
		if (multipleCombos) {
			const rank = (combo:PackerCombo) => isFavorite(combo) ? (combo.allowRotation ? 0 : 1) : 2;
			packerCombos.sort((a, b) => rank(a) - rank(b));
		}

		let optimalRes:Rect[][];
		let optimalArea = Infinity;
		let optimalSheets = Infinity;
		let optimalLargestSheet = Infinity;
		let usedPacker:PackerCombo;

		const runCombo = (combo:PackerCombo, quick:boolean) => {
			const res = [];
			let totalArea = 0;
			let largestSheet = 0;

			let _rects = rects;
			let _identical = identical;

			if (multipleCombos) {
				const copies = new Map<Rect, Rect>();
				_rects = rects.map(rect => {
					const copy = {
						...rect,
						frame: { ...rect.frame},
						spriteSourceSize: { ...rect.spriteSourceSize},
						sourceSize: { ...rect.sourceSize}
					};
					copies.set(rect, copy);
					return copy;
				});

				_identical = identical.map(rect => ({ ...rect, identical: copies.get(rect.identical) ?? rect.identical}));
			}

			let lastLoop = -1;

			while (_rects.length && lastLoop !== _rects.length) {
				lastLoop = _rects.length;
				const packer = new combo.packerClass(packWidth, packHeight, combo.allowRotation, spritePadding);
				packer.sheetArea = sheetArea;
				packer.quick = quick;
				packer.thorough = Boolean(options.tightPack);
				if (!exhaustive && res.length === 0 && optimalSheets === 1) {
					packer.areaToBeat = optimalArea;
				}

				let result = packer.pack(_rects, combo.packerMethod);

				const packed = new Set(result);
				let remaining = 0;
				for (let i = 0; i < _rects.length; i++) {
					const rect = _rects[i];
					if (!packed.has(rect)) _rects[remaining++] = rect;
				}
				_rects.length = remaining;

				const extent = getFramesExtent(result);
				const area = sheetArea(extent.width, extent.height);
				totalArea += area;
				largestSheet = Math.max(largestSheet, area);

				if (options.detectIdentical) {
					result = this.applyIdentical(result, _identical, scale);
				}

				res.push(result);
			}

			if(_rects.length) {
				if(multipleCombos) {
					return;
				}
				console.warn("PackProcessor: Not all images were packed. Some images may be missing.");
			}

			const sheets = res.length;

			if (
				totalArea < optimalArea ||
				(totalArea === optimalArea && sheets < optimalSheets) ||
				(totalArea === optimalArea && sheets === optimalSheets && largestSheet < optimalLargestSheet)
			) {
				optimalRes = res;
				optimalArea = totalArea;
				optimalSheets = sheets;
				optimalLargestSheet = largestSheet;
				usedPacker = combo;
			}
		};

		const quickLook = (combo:PackerCombo) => multipleCombos && !exhaustive && !options.tightPack && !isFavorite(combo);

		for (const combo of packerCombos) {
			runCombo(combo, quickLook(combo));
		}

		if (usedPacker && quickLook(usedPacker)) {
			runCombo(usedPacker, false);
		}

		for (const sheet of optimalRes) {
			for(const item of sheet) {
				item.frame.x += borderPadding;
				item.frame.y += borderPadding;
			}
		}

		return {
			result: optimalRes,
			usedPacker
		} as const;
	}
}

export default PackProcessor;
