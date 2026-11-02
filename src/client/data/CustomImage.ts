import type { Rect } from "api/types";
import { dataURItoBlob } from "api/utils/common";

export type FileSystemPath = {
	name: string;
	path: string;
	folder: string;
};

class CustomImage {
	base64: string;
	pixels?: Uint8ClampedArray;
	cachedTrim?: number;
	cachedTrimmedImage?: Uint8ClampedArray;
	cachedSpaces?: Readonly<{
		left: number;
		right: number;
		top: number;
		bottom: number;
	}>;
	readonly image: HTMLImageElement;
	selected: boolean;
	current: boolean;
	rect: Rect;

	fsPath: FileSystemPath;

	private _blobString:string;
	private _blob:Blob;

	constructor(image: HTMLImageElement, name?: string, path?: string, folder?: string) {
		this.image = image;
		if(name && path && folder) {
			this.fsPath = { name, path, folder } as const;
		}
		this._blobString = null;
		this._blob = null;
	}

	copy() {
		const image = new CustomImage(this.image);
		const rect = this.rect;

		image.base64 = this.base64;
		image.pixels = this.pixels;
		image.rect = {
			...rect,
			frame: { ...rect.frame },
			spriteSourceSize: { ...rect.spriteSourceSize },
			sourceSize: { ...rect.sourceSize },
			frameSize: { ...rect.frameSize },
			importedOffset: rect.importedOffset && { ...rect.importedOffset }
		};

		return image;
	}

	get width() {
		return this.image.width;
	}

	get height() {
		return this.image.height;
	}

	set width(value) {
		this.image.width = value;
	}

	set height(value) {
		this.image.height = value;
	}

	get blobSrc() {
		if(!globalThis.Blob) return this.image.src;
		if(this._blob === null) {
			this._blob = dataURItoBlob(this.src);
			this._blobString = URL.createObjectURL(this._blob);
		}
		return this._blobString;
	}

	get src() {
		return this.image.src;
	}

	get srcset() {
		return this.image.srcset;
	}

	get sizes() {
		return this.image.sizes;
	}

	get naturalWidth() {
		return this.image.naturalWidth;
	}

	get naturalHeight() {
		return this.image.naturalHeight;
	}

	get complete() {
		return this.image.complete;
	}

	set src(value) {
		this.image.src = value;
	}

	set srcset(value) {
		this.image.srcset = value;
	}

	set sizes(value) {
		this.image.sizes = value;
	}
}

export default CustomImage;